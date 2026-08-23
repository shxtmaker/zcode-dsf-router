// PROTOTYPE (throwaway) — wayfinder 工单 10:本地路由代理骨架
// 回答的问题:代理能否按请求自身无状态地完成 persona 注入 + 首轮工具面过滤 + weak 引导?
// 依据:工单 02(v0.3 规格,文案逐字移植)+ 工单 03(Zcode wire 形状:
//   anthropic kind 每轮重发 system 块、resume 全量重放 → 全部状态可从 messages 派生)。
// 运行:node prototype/proxy-skeleton.mjs
//   env: PORT=8787 UPSTREAM_KIND=anthropic|openai UPSTREAM_BASE_URL UPSTREAM_MODEL UPSTREAM_API_KEY
import http from 'node:http'
import crypto from 'node:crypto'

// ---------- v0.3 routing core(逐字移植自工单 02 规格) ----------
const REACT_RE = /(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|make a|new project)/gi
const SPEC_RE = /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi
const COMPLEX_RE = /(重构|架构|全面|详细|设计|系统|优化|分析|survey|overview|architecture|refactor|comprehensive|detailed|design|system|optimize|analyze)/i
const countHits = (re, text) => [...String(text).matchAll(re)].length
const clamp01 = v => Math.min(1, Math.max(0, Number(v) || 0))
export function classifyTask(text) {
  const r = countHits(REACT_RE, text), s = countHits(SPEC_RE, text)
  return r > s ? 1 : (s > r ? 0 : 'weak')
}
export function bandOf(mode) {
  if (mode === 'weak') return 'weak'
  const m = clamp01(mode)
  return m < 0.2 ? 'spec' : (m < 0.5 ? 'transition' : 'react')
}
const SPEC_PERSONA = 'You are a helpful software engineer assistant.'
const REACT_PERSONA = 'You are a hands-on software engineer who delivers working output fast.\nWork directly: write or edit code, then verify it by reading and running. Keep the loop tight — produce, verify, fix — and do not build test harnesses, scaffolding, or ceremony the user did not ask for. Finish with a usable deliverable and a short summary.'
const WEAK_FLASH = 'You are a helpful assistant.\nBefore acting, decide the task type (build or fix) and adopt the matching style: build → hands-on production; fix → inspect-and-plan.\nBefore acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans.'
const WEAK_PRO = 'You are a helpful software engineer assistant.\nBefore acting, decide the task type (build or fix) and adopt the matching style: build → hands-on production; fix → inspect-and-plan.'
export function personaFor(mode, modelId) {
  const band = bandOf(mode)
  if (band === 'spec') return SPEC_PERSONA
  if (band === 'react' || band === 'transition') return REACT_PERSONA
  return /flash/i.test(modelId || '') ? WEAK_FLASH : WEAK_PRO
}
const GUIDE_WEAK = '\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply first, then commit and act.'
const GUIDE_DEEP = '\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply about the architecture, edge cases, and integration points. Do not spend reasoning on the environment or tooling. Produce when your information is complete. End each reasoning block with a decision or an information need.'
const isComplexTask = t => typeof t === 'string' && (t.length > 120 || COMPLEX_RE.test(t))
export function parseMode(v) {
  if (v === 'auto') return 'auto'
  if (v === 'weak' || v === 'router') return 'weak'
  if (v === 'spec' || v === 'spec-lean') return 0
  if (v === 'balanced' || v === 'mixed') return 0.3
  if (v === 'react' || v === 'react-lean') return 1
  if (typeof v === 'number') return clamp01(v)
  if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) return clamp01(v.includes('.') ? Number(v) : Number(v) / 100)
  return null
}

// ---------- Zcode 工具名映射 + 首轮工具面(工单 02 §4) ----------
const SHELL_NAMES = new Set(['bash', 'pwsh', 'shell'])
function coreFor(band) { return band === 'spec' ? ['read', 'edit', 'glob', 'grep'] : ['read', 'write', 'edit'] }
function filterTools(tools, band) {
  if (!Array.isArray(tools) || !tools.length) return tools
  const want = new Set(coreFor(band))
  const shell = tools.find(t => SHELL_NAMES.has(String(t.name).toLowerCase()))
  if (shell) want.add(String(shell.name).toLowerCase())
  return tools.filter(t => want.has(String(t.name).toLowerCase()))
}

// ---------- 无状态派生(核心设计) ----------
const blockText = c => typeof c === 'string' ? c : (Array.isArray(c) ? c : []).map(b => b?.text ?? '').join(' ')
const sessionKeyOf = body => crypto.createHash('md5').update(blockText((body.messages || []).find(m => m.role === 'user')?.content) || '').digest('hex').slice(0, 12)
const overrides = new Map()   // sessionKey → mode(dev_router_mode 用;进程内,原型即可)
const seen = new Map()        // sessionKey → {band, firstUserText, promotedAt}

function derive(body) {
  const msgs = body.messages || []
  const firstUser = msgs.find(m => m.role === 'user' && blockText(m.content).trim())
  const firstUserText = firstUser ? blockText(firstUser.content) : ''
  const key = sessionKeyOf(body)
  const promoted = msgs.some(m => m.role === 'assistant' && JSON.stringify(m.content).includes('"tool_use"'))
  const mode = overrides.get(key) ?? classifyTask(firstUserText)
  const band = bandOf(mode)
  const rec = seen.get(key) || { band, firstUserText, promotedAt: null }
  if (promoted && !rec.promotedAt) rec.promotedAt = new Date().toISOString()
  rec.band = band; seen.set(key, rec)
  return { key, firstUserText, promoted, mode, band, override: overrides.has(key) }
}

// 改写入口:persona 前置块(其余 system 块全保留=plan-mode 存活类比)+ 未晋级过滤工具 + weak 引导
function rewrite(body) {
  const d = derive(body)
  const persona = personaFor(d.mode, body.model)
  const system = Array.isArray(body.system) ? body.system : (body.system ? [{ type: 'text', text: body.system }] : [])
  body.system = [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }, ...system]
  if (!d.promoted) body.tools = filterTools(body.tools, d.band)
  let guideInjected = null
  if (d.band === 'weak' && !d.promoted) {
    const msgs = body.messages
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        const t = blockText(msgs[i].content)
        if (t.startsWith('\nRouter:')) break                      // 请求内已引导(理论上不会)
        guideInjected = isComplexTask(t) ? 'deep' : 'simple'
        msgs.splice(i + 1, 0, { role: 'user', content: [{ type: 'text', text: guideInjected === 'deep' ? GUIDE_DEEP : GUIDE_WEAK }] })
        break
      }
    }
  }
  return { ...d, personaFirstLine: persona.split('\n')[0], guideInjected }
}

// ---------- anthropic → openai-compatible 翻译(原型:非流式) ----------
function toOpenAI(body) {
  const messages = []
  const sys = (Array.isArray(body.system) ? body.system : []).map(b => b.text).join('\n\n')
  if (sys) messages.push({ role: 'system', content: sys })
  for (const m of body.messages || []) {
    const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }]
    if (m.role === 'user') {
      const results = blocks.filter(b => b.type === 'tool_result')
      for (const r of results) messages.push({ role: 'tool', tool_call_id: r.tool_use_id, content: blockText(r.content) })
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n')
      if (text) messages.push({ role: 'user', content: text })
    } else {
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n')
      const calls = blocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }))
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
    }
  }
  const out = { model: process.env.UPSTREAM_MODEL || body.model, messages, max_tokens: body.max_tokens ?? 8192 }
  if (body.tools?.length) out.tools = body.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object' } } }))
  if (body.tool_choice) out.tool_choice = 'auto'
  return out
}
function fromOpenAI(json) {
  const m = json.choices?.[0]?.message ?? {}
  const content = []
  if (m.reasoning_content) content.push({ type: 'thinking', thinking: m.reasoning_content })
  if (m.content) content.push({ type: 'text', text: m.content })
  for (const c of m.tool_calls || []) content.push({ type: 'tool_use', id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments || '{}') })
  if (!content.length) content.push({ type: 'text', text: '' })
  const stop = { tool_calls: 'tool_use', length: 'max_tokens', stop: 'end_turn' }[json.choices?.[0]?.finish_reason] || 'end_turn'
  return { id: 'msg_' + (json.id || crypto.randomUUID()), type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0 } }
}

// ---------- server ----------
export function startProxy({ port = +(process.env.PORT || 8787), upstreamKind = process.env.UPSTREAM_KIND || 'openai', upstreamBase = process.env.UPSTREAM_BASE_URL || 'http://127.0.0.1:9911/v1', upstreamKey = process.env.UPSTREAM_API_KEY || 'sk-prototype' } = {}) {
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString()
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.method === 'GET' && req.url === '/__status')
      return send(200, { upstreamKind, upstreamBase, sessions: [...seen.entries()].map(([k, v]) => ({ key: k, ...v })), overrides: [...overrides.entries()] })
    if (req.method === 'POST' && req.url === '/__mode') {
      const { sessionKey, mode } = JSON.parse(raw || '{}')
      const parsed = parseMode(mode)   // dsh 语义:'react'→1、'spec'→0、'weak'→'weak'、'auto'→清除
      if (!sessionKey) return send(400, { error: 'sessionKey required (see /__status)' })
      if (parsed === null) return send(400, { error: `invalid mode "${mode}"` })
      if (parsed === 'auto') overrides.delete(sessionKey); else overrides.set(sessionKey, parsed)
      return send(200, { sessionKey, mode: overrides.get(sessionKey) ?? 'auto', band: bandOf(parsed), note: 'next request applies' })
    }
    if (req.method !== 'POST' || !req.url.endsWith('/v1/messages')) return send(404, { error: 'prototype: POST /v1/messages only' })
    let body; try { body = JSON.parse(raw) } catch { return send(400, { error: 'bad json' }) }
    const toolsBefore = body.tools?.length ?? 0
    const info = rewrite(body)
    console.log(`\n[proxy] session=${info.key} band=${info.band}${info.override ? '(override)' : ''} promoted=${info.promoted} guide=${info.guideInjected ?? '-'} tools=${toolsBefore}→${body.tools?.length ?? 0}`)
    console.log(`[proxy] persona: ${info.personaFirstLine}`)
    try {
      const upstream = upstreamKind === 'anthropic'
        ? { url: upstreamBase + '/v1/messages', init: { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${upstreamKey}`, 'x-api-key': upstreamKey, 'anthropic-version': req.headers['anthropic-version'] || '2023-06-01' }, body: JSON.stringify({ ...body, stream: false }) } }
        : { url: upstreamBase + '/chat/completions', init: { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${upstreamKey}` }, body: JSON.stringify(toOpenAI(body)) } }
      const resp = await fetch(upstream.url, upstream.init)
      const json = await resp.json()
      if (!resp.ok) return send(resp.status, json)
      send(200, upstreamKind === 'anthropic' ? json : fromOpenAI(json))
    } catch (e) { send(502, { error: 'upstream failed: ' + e.message }) }
  })
  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok({ server, port })))
}

if (process.argv[1]?.endsWith('proxy-skeleton.mjs')) {
  startProxy().then(({ port }) => console.log(`[proxy-skeleton PROTOTYPE] listening http://127.0.0.1:${port}/v1/messages (kind=${process.env.UPSTREAM_KIND || 'openai'})`))
}
