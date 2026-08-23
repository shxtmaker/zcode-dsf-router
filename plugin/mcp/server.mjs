#!/usr/bin/env node
// zcode-dsf-router MCP server(双角色,工单 10/11/12 决议的实现)
//   角色 A:MCP stdio server(JSON-RPC):router_status / router_mode / router_subagent
//   角色 B:本地 HTTP 代理(anthropic /v1/messages):persona 注入 + 首轮工具面 + weak 引导 + 流式
// 配置优先级:${ZCODE_PLUGIN_DATA}/config.json > 环境变量 > 默认值
//   (apiKey 主通道:config.json 或环境变量——GUI userConfig 的敏感值宿主无法持久化,save 会直接报错)
// 环境变量:DSF_ROUTER_PORT DSF_VARIANT(standard|rl-minimal)
//           UPSTREAM_KIND(openai|anthropic) UPSTREAM_BASE_URL UPSTREAM_MODEL UPSTREAM_API_KEY
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import readline from 'node:readline'
import { rewrite, bandOf, bandFor, parseMode, personaFor, coreFor, testinessFor, userTextOf, blockText } from './router-core.mjs'
import { anthropicToOpenAIBody, openAIToAnthropicResponse, openaiSSEToAnthropicSSE } from './translate.mjs'
import { PRESETS, presetNames } from './presets.mjs'

const uuid = () => crypto.randomUUID()
export const configFilePath = () => (process.env.ZCODE_PLUGIN_DATA ? path.join(process.env.ZCODE_PLUGIN_DATA, 'config.json') : null)
export const v2ConfigPath = () => process.env.DSF_V2_CONFIG || path.join(os.homedir(), '.zcode', 'v2', 'config.json')

// 扫描 Zcode 已接入供应商,挑出带 DeepSeek flash 系模型的(apiKey 永不外泄,只报 keySet)
const FLASH_MODEL_RE = /deepseek[\w./-]*flash|flash[\w./-]*deepseek/i
export function scanV2Providers(p = v2ConfigPath()) {
  let raw
  try { raw = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return [] }
  const out = []
  for (const [id, v] of Object.entries(raw.provider || {})) {
    if ((v.name || '').toLowerCase().startsWith('dsf-router')) continue   // 自己的条目不算
    const models = Object.keys(v.models || {}).filter(m => FLASH_MODEL_RE.test(m))
    if (!models.length || !v.options?.baseURL) continue
    out.push({ providerId: id, name: v.name, baseURL: v.options.baseURL, kind: v.kind === 'anthropic' ? 'anthropic' : 'openai', models, keySet: !!v.options.apiKey })
  }
  return out
}
// 在 v2/config.json 里幂等 upsert 本地路由 provider 条目(先备份;不动其他条目)
export function installRouterProvider(p = v2ConfigPath(), { model, port = 8787 } = {}) {
  let raw
  try { raw = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return { error: `cannot read ${p}` } }
  raw.provider = raw.provider || {}
  let key = Object.keys(raw.provider).find(k => (raw.provider[k].name || '').toLowerCase().startsWith('dsf-router'))
  const updated = !!key
  if (!key) key = uuid()
  raw.provider[key] = {
    name: 'dsf-router (V4 flash 任务感知路由)',
    kind: 'anthropic',
    options: { apiKey: 'dsf-local-proxy', baseURL: `http://127.0.0.1:${port}`, apiKeyRequired: false },
    source: 'custom',
    models: { [model]: { reasoning: { enabled: true, variants: ['off', 'high', 'max'], defaultVariant: 'max' }, limit: { context: 1000000, output: 384000 }, modalities: { input: ['text'], output: ['text'] }, zcode: { modified: false, priority: 99 } } },
  }
  const bak = `${p}.bak-dsf-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`
  fs.copyFileSync(p, bak)
  fs.writeFileSync(p, JSON.stringify(raw, null, 2) + '\n')
  return { key, updated, backup: bak, model, port }
}
export function loadConfig() {
  const cfg = {
    port: +(process.env.DSF_ROUTER_PORT || 8787),
    variant: process.env.DSF_VARIANT === 'rl-minimal' ? 'rl-minimal' : 'standard',
    upstreamKind: process.env.UPSTREAM_KIND === 'anthropic' ? 'anthropic' : 'openai',
    upstreamBase: process.env.UPSTREAM_BASE_URL || '',
    upstreamModel: process.env.UPSTREAM_MODEL || 'deepseek-v4-flash',
    upstreamKey: process.env.UPSTREAM_API_KEY || '',
  }
  const file = configFilePath()
  if (file && fs.existsSync(file)) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'))
      cfg.upstreamKind = j.upstreamKind === 'anthropic' || j.upstreamKind === 'openai' ? j.upstreamKind : cfg.upstreamKind
      cfg.upstreamBase = j.baseURL || cfg.upstreamBase
      cfg.upstreamModel = j.model || cfg.upstreamModel
      cfg.upstreamKey = j.apiKey || cfg.upstreamKey
      if (j.variant) cfg.variant = j.variant
      if (j.port) cfg.port = +j.port
    } catch { /* 配置损坏时按 env/默认值运行 */ }
  }
  return cfg
}
export function saveConfig(cfg) {
  const file = configFilePath()
  if (!file) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ port: cfg.port, variant: cfg.variant, upstreamKind: cfg.upstreamKind, baseURL: cfg.upstreamBase, model: cfg.upstreamModel, apiKey: cfg.upstreamKey }, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(file, 0o600)   // 文件已存在时 writeFileSync 的 mode 不生效,显式收紧权限
  return true
}
export function describeConfig(cfg) {   // 脱敏视图,永不回显 apiKey
  return { port: cfg.port, variant: cfg.variant, upstreamKind: cfg.upstreamKind, baseURL: cfg.upstreamBase, model: cfg.upstreamModel, keySet: !!cfg.upstreamKey, upstreamKey: cfg.upstreamKey ? 'sk-***' : '', file: configFilePath() }
}

export function createRouter(cfg = loadConfig()) {
  const overrides = new Map()   // sessionKey → mode(经 parseMode)
  const seen = new Map()        // sessionKey → {band, mode, firstUserText, promotedAt, lastSeen}
  const log = (...a) => console.error('[dsf-router]', ...a)

  const httpServer = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString()
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.method === 'GET' && req.url === '/__status') {
      return send(200, { ...describeConfig(cfg), sessions: [...seen.entries()].map(([k, v]) => ({ key: k, ...v })), overrides: [...overrides.entries()].map(([k, m]) => [k, bandOf(m)]) })
    }
    if (req.method !== 'POST' || !req.url.endsWith('/v1/messages')) return send(404, { error: 'POST /v1/messages only' })
    let body; try { body = JSON.parse(raw) } catch { return send(400, { error: 'bad json' }) }
    if (!cfg.upstreamBase) return send(503, { error: 'upstream not configured (UPSTREAM_BASE_URL or plugin config.json)' })
    const info = rewrite(body, overrides, cfg.variant)
    const rec = seen.get(info.key) || { promotedAt: null }
    Object.assign(rec, { band: info.band, mode: info.mode, firstUserText: info.firstUserText.slice(0, 60), lastSeen: new Date().toISOString(), ...(info.promoted && !rec.promotedAt ? { promotedAt: new Date().toISOString() } : {}) })
    seen.set(info.key, rec)
    log(`session=${info.key} band=${info.band}${info.override ? '(override)' : ''} promoted=${info.promoted} guide=${info.guideInjected ?? '-'} tools=${body.tools?.length ?? 0} stream=${body.stream === true}`)
    const wantsStream = body.stream === true
    try {
      let url, init
      if (cfg.upstreamKind === 'anthropic') {
        url = cfg.upstreamBase.replace(/\/$/, '') + '/v1/messages'
        init = { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.upstreamKey}`, 'x-api-key': cfg.upstreamKey, 'anthropic-version': req.headers['anthropic-version'] || '2023-06-01' }, body: JSON.stringify(body) }
      } else {
        url = cfg.upstreamBase.replace(/\/$/, '') + '/chat/completions'
        init = { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.upstreamKey}` }, body: JSON.stringify(anthropicToOpenAIBody(body, cfg.upstreamModel)) }
      }
      const resp = await fetch(url, init)
      if (!resp.ok) { const t = await resp.text(); log(`upstream ${resp.status}`); return send(resp.status, safeJSON(t, { error: 'upstream ' + resp.status })) }
      if (!wantsStream) {
        const json = await resp.json()
        return send(200, cfg.upstreamKind === 'anthropic' ? json : openAIToAnthropicResponse(json, uuid))
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      if (cfg.upstreamKind === 'anthropic') {
        ReadableTeardown(resp.body, res)
      } else {
        for await (const ev of openaiSSEToAnthropicSSE(resp, uuid, cfg.upstreamModel)) res.write(ev)
        res.end()
      }
    } catch (e) { log('upstream failed:', e.message); if (!res.headersSent) send(502, { error: 'upstream failed: ' + e.message }); else res.end() }
  })

  function fmtStatus() {
    const lines = []
    if (cfg.variant !== 'standard') lines.push(`variant=${cfg.variant}`)
    for (const [key, rec] of seen) {
      const mode = overrides.has(key) ? overrides.get(key) : rec.mode
      const band = bandFor(mode)
      const modeDisp = typeof mode === 'number' ? mode.toFixed(2) : mode
      lines.push(`session=${key} first="${rec.firstUserText}"`, `mode=${modeDisp} (band=${band})`, `persona=${personaFor(mode, cfg.upstreamModel).replace(/\n/g, ' / ')}`, `core=[${coreFor(band).join(', ')}]`, `testiness=${testinessFor(band)}`, `override=${overrides.has(key) ? 'yes' : 'no'} promoted=${rec.promotedAt ? 'yes' : 'no'}`, '')
    }
    return lines.join('\n') || 'no sessions routed yet'
  }
  async function toolCall(name, args) {
    if (name === 'router_status') {
      if (primary) return fmtStatus()
      const r = await fetch(`http://127.0.0.1:${cfg.port}/__status`).then(r => r.json()).catch(() => null)
      return r ? JSON.stringify(r, null, 2) : `primary instance unreachable on port ${cfg.port}`
    }
    if (name === 'router_mode') {
      const mode = parseMode(args?.mode)
      if (mode === null) return `invalid mode "${args?.mode}": use spec/weak/mixed/react, 0-100, 0.0-1.0, or auto`
      let key = args?.sessionKey
      if (!key && primary) key = [...seen.keys()].at(-1)
      if (!key) return 'no session key; pass sessionKey from router_status'
      if (mode === 'auto') overrides.delete(key); else overrides.set(key, mode)
      return `mode=${overrides.get(key) ?? 'auto'} (band=${bandFor(mode)}) — next request applies (session ${key})`
    }
    if (name === 'router_config') {
      const a = args || {}
      const changed = []
      if (a.preset !== undefined) {
        const p = String(a.preset).trim()
        if (p === 'list') return '可用预设:\n' + Object.entries(PRESETS).map(([n, v]) => `  ${n} → ${v.baseURL} (${v.kind}) model=${v.model} — ${v.note}`).join('\n')
        const preset = PRESETS[p]
        if (!preset) return `invalid preset "${a.preset}": use one of ${presetNames().join(', ')}; or preset:"list"`
        cfg.upstreamBase = preset.baseURL; cfg.upstreamKind = preset.kind; cfg.upstreamModel = preset.model
        changed.push(`preset(${p}: baseURL/kind/model)`)
      }
      if (a.baseURL !== undefined) { cfg.upstreamBase = String(a.baseURL).trim(); changed.push('baseURL') }
      if (a.model !== undefined) { cfg.upstreamModel = String(a.model).trim(); changed.push('model') }
      if (a.kind !== undefined) { const k = String(a.kind).trim(); if (k !== 'openai' && k !== 'anthropic') return `invalid kind "${a.kind}": use openai or anthropic`; cfg.upstreamKind = k; changed.push('kind') }
      if (a.apiKey !== undefined) { cfg.upstreamKey = String(a.apiKey).trim(); changed.push('apiKey') }
      if (a.port !== undefined) { const p = +a.port; if (!Number.isInteger(p) || p < 1 || p > 65535) return `invalid port "${a.port}": 1-65535`; cfg.port = p; changed.push('port') }
      const persisted = saveConfig(cfg)
      const view = describeConfig(cfg)
      const head = changed.length ? `已更新 ${changed.join(', ')}` : '当前配置(未改动)'
      return `${head};${persisted ? '已写入 ' + (view.file || '') : '未持久化(需设置 ZCODE_PLUGIN_DATA,仅本次进程内生效)'}\nupstream=${view.upstreamKind} baseURL=${view.baseURL || '(未配置)'} model=${view.model} port=${view.port} keySet=${view.keySet} (apiKey 不回显)`
    }
    if (name === 'router_providers') {
      const list = scanV2Providers()
      if (!list.length) return '未发现带 DeepSeek flash 系模型的已接入供应商(~/.zcode/v2/config.json)。可先用 /router:setup 的平台预设,或手动在 Zcode 里接入平台后再试。'
      return '已接入且带 DeepSeek flash 模型的供应商:\n' + list.map(v => `  providerId=${v.providerId}  ${v.name}  [${v.kind}] ${v.baseURL}\n    模型: ${v.models.join(', ')}  keySet=${v.keySet}`).join('\n')
    }
    if (name === 'router_bind') {
      const list = scanV2Providers()
      const hit = list.find(v => v.providerId === args?.providerId)
      if (!hit) return `invalid providerId "${args?.providerId}": 先调 router_providers 查看`
      const p = (JSON.parse(fs.readFileSync(v2ConfigPath(), 'utf8')).provider || {})[hit.providerId]
      const model = hit.models.includes(args?.model) ? args.model : hit.models[0]
      cfg.upstreamBase = hit.baseURL
      cfg.upstreamKind = hit.kind
      cfg.upstreamModel = model
      cfg.upstreamKey = p?.options?.apiKey || ''
      saveConfig(cfg)
      if (!cfg.upstreamKey) log('WARNING: 所选供应商无 apiKey,上游请求将 401')
      return `已绑定上游: ${hit.name} → ${cfg.upstreamBase} (${cfg.upstreamKind}) model=${model} keySet=${!!cfg.upstreamKey}(${hit.providerId})`
    }
    if (name === 'router_install') {
      const r = installRouterProvider(v2ConfigPath(), { model: cfg.upstreamModel, port: cfg.port })
      if (r.error) return `install error: ${r.error}`
      return `已${r.updated ? '更新' : '注册'}模型列表条目「dsf-router (V4 flash 任务感知路由)」(模型 ${r.model} → 本地代理 :${r.port};备份 ${path.basename(r.backup)})。现在 /model 选择它即可启用任务感知路由;不想用时在模型列表里删除该条目即可(代理与命令不受影响)。`
    }
    if (name === 'router_subagent') {
      const mode = parseMode(args?.mode)
      if (mode === null) return `invalid mode "${args?.mode}"`
      const task = String(args?.task ?? '').trim()
      if (!task) return 'task required'
      const maxTokens = Math.max(64, Math.min(65536, +args?.maxTokens || 1024))
      const persona = personaFor(mode, cfg.upstreamModel)
      if (!cfg.upstreamBase) return 'subagent error: upstream not configured'
      const upstream = cfg.upstreamKind === 'anthropic'
        ? { url: cfg.upstreamBase.replace(/\/$/, '') + '/v1/messages', body: { model: cfg.upstreamModel, system: persona, messages: [{ role: 'user', content: [{ type: 'text', text: task }] }], max_tokens: maxTokens, stream: false }, headers: { authorization: `Bearer ${cfg.upstreamKey}`, 'x-api-key': cfg.upstreamKey, 'anthropic-version': '2023-06-01' } }
        : { url: cfg.upstreamBase.replace(/\/$/, '') + '/chat/completions', body: { model: cfg.upstreamModel, messages: [{ role: 'system', content: persona }, { role: 'user', content: task }], max_tokens: maxTokens }, headers: { authorization: `Bearer ${cfg.upstreamKey}` } }
      try {
        const resp = await fetch(upstream.url, { method: 'POST', headers: { 'content-type': 'application/json', ...upstream.headers }, body: JSON.stringify(upstream.body) })
        const json = await resp.json()
        if (!resp.ok) return `subagent error: upstream ${resp.status}`
        const msg = cfg.upstreamKind === 'anthropic'
          ? { content: (json.content || []).filter(b => b.type === 'text').map(b => b.text).join(''), reasoning: (json.content || []).filter(b => b.type === 'thinking').map(b => b.thinking).join('') }
          : { content: json.choices?.[0]?.message?.content ?? '', reasoning: json.choices?.[0]?.message?.reasoning_content ?? '' }
        const answer = msg.content || '(no content)'
        return `[mode-subagent ${bandOf(mode)} | reasoning ${msg.reasoning.length} chars]\n${answer.slice(0, 3000)}${answer.length > 3000 ? '\n…(truncated)' : ''}`
      } catch (e) { return `subagent error: ${e.message}${e.cause ? ' (' + (e.cause.code || e.cause.message || e.cause) + ')' : ''}` }
    }
    throw new Error(`unknown tool ${name}`)
  }

  let primary = false
  const TOOLS = [{
    name: 'router_status', description: "Show this deployment's reasoning-mode routing: per session — mode, band, persona, first-turn core tools, test-suppression, override and promotion state.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }, {
    name: 'router_mode', description: "Set a session's reasoning mode: spec (plan-first) / weak (internal routing) / mixed (transition, trap) / react (doer). Accepts band names, 0-100, or 0.0-1.0; use auto to return to task classification. The next request applies it.",
    inputSchema: { type: 'object', properties: { mode: { type: 'string', description: 'spec|weak|mixed|react|0-100|0.0-1.0|auto' }, sessionKey: { type: 'string', description: 'session key from router_status; defaults to most recent' } }, required: ['mode'], additionalProperties: false },
  }, {
    name: 'router_providers', description: 'Scan already-connected Zcode providers (~/.zcode/v2/config.json) and list those serving DeepSeek flash-family models (with providerId/name/baseURL/kind/models/keySet; apiKey never returned). Use before router_bind.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }, {
    name: 'router_bind', description: 'Point the routing proxy upstream at one of the already-connected providers (copies baseURL/kind/model and its apiKey server-side; key never echoed). Get providerId from router_providers.',
    inputSchema: { type: 'object', properties: { providerId: { type: 'string', description: 'provider key from router_providers' }, model: { type: 'string', description: 'one of the provider\'s flash models; defaults to first' } }, required: ['providerId'], additionalProperties: false },
  }, {
    name: 'router_install', description: 'Register (or update) the local routing provider entry in the Zcode model list, pointing at this proxy (idempotent, timestamped backup first; model = current upstream model). After install, select it via /model to activate task-aware routing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }, {
    name: 'router_subagent', description: 'Run one task in a DIFFERENT reasoning mode inside an isolated single-shot context (its own persona as system, no tools, current trajectory untouched). Mode isolation is the only reliable way to change modes mid-session.',
    inputSchema: { type: 'object', properties: { mode: { type: 'string', description: 'spec|weak|mixed|react|0-100' }, task: { type: 'string', description: 'the task text' }, maxTokens: { type: 'number', description: 'default 1024' } }, required: ['mode', 'task'], additionalProperties: false },
  }, {
    name: 'router_config', description: 'Read or set this deployment\'s upstream configuration (preset/baseURL/model/kind/apiKey/port). Persists to ZCODE_PLUGIN_DATA/config.json (0600) and applies to the running proxy immediately; apiKey is never echoed back. Use this instead of the plugin settings UI for the API key — sensitive userConfig values cannot be stored by the host. Platform presets fill baseURL/kind/model in one call (pass apiKey alongside).',
    inputSchema: { type: 'object', properties: { preset: { type: 'string', description: 'platform preset name; "list" shows all', enum: [...presetNames(), 'list'] }, baseURL: { type: 'string', description: 'upstream baseURL, e.g. https://api.siliconflow.cn/v1 (empty string clears)' }, model: { type: 'string', description: 'upstream model id (empty string clears)' }, kind: { type: 'string', description: 'openai | anthropic' }, apiKey: { type: 'string', description: 'upstream API key, never echoed back (empty string clears)' }, port: { type: 'integer', description: 'local HTTP port (1-65535)' } }, additionalProperties: false },
  }]
  const send = obj => process.stdout.write(JSON.stringify(obj) + '\n')

  async function start() {
    try { await new Promise((ok, err) => { httpServer.once('error', err); httpServer.listen(cfg.port, '127.0.0.1', ok) }); primary = true }
    catch { primary = false }
    readline.createInterface({ input: process.stdin }).on('line', async line => {
      let msg; try { msg = JSON.parse(line) } catch { return }
      const { id, method, params } = msg
      if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'zcode-dsf-router', version: '0.2.0' } } })
      if (id === undefined) return   // notifications
      if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
      if (method === 'tools/call') {
        try { const text = await toolCall(params?.name, params?.arguments); send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(text) }] } }) }
        catch (e) { send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'error: ' + e.message }], isError: true } }) }
      }
    })
    log(`MCP ready (stdio). HTTP ${primary ? `listening :${cfg.port}` : `delegated to :${cfg.port} (single-instance)`}. variant=${cfg.variant} upstream=${cfg.upstreamKind} ${cfg.upstreamBase ? cfg.upstreamBase.replace(/\/\/[^@]*@/, '//') : '(unconfigured)'}`)
    if (cfg.upstreamBase && !cfg.upstreamKey) log(`WARNING: 上游已配置但 apiKey 为空——上游请求将返回 401。调用 router_config 工具写入 apiKey(${configFilePath() || '需设置 ZCODE_PLUGIN_DATA'})`)
    return { primary, cfg, httpServer, overrides, seen, fmtStatus, toolCall }
  }
  return { start }
}
const ReadableTeardown = (body, res) => { body.pipeTo(new WritableStream({ write: c => res.write(c), close: () => res.end() })) }
const safeJSON = (t, fb) => { try { return JSON.parse(t) } catch { return fb } }

const isMain = process.argv[1] && import.meta.url === new URL('file://' + process.argv[1].replace(/ /g, '%20')).href
export async function main() { return createRouter().start() }   // __zcode-plugin-host 入口(官方包装协议:导入模块并调 main())
if (isMain) main()
