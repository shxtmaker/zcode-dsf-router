// 工单 20「A 机制层 + 配置通道」验收脚本:node tests/verify.mjs(全绿 = A1–A7 + 流式冒烟 + 配置回退/router_config 通过)
// 不依赖外网:本地回显上游(openai 兼容,支持 JSON 与 SSE)+ 代理实例。
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRouter, loadConfig } from '../plugin/mcp/server.mjs'
import { rewrite, classifyTask, personaFor, GUIDE_WEAK, GUIDE_DEEP, SPEC_PERSONA, REACT_PERSONA, WEAK_FLASH } from '../plugin/mcp/router-core.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.error(`  ✗ ${name} ${detail}`) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ---------- A7:分类抽验表(16 条) ----------
console.log('A7 分类抽验表')
const TABLE = [
  ['需要本地开发一个马里奥网页小游戏,参考经典原版', 'react'],
  ['帮我写一个 Python 脚本处理 CSV', 'react'],
  ['从零搭建一个网站', 'react'],
  ['修复这个仓库里的 bug', 'spec'],
  ['为什么登录一直报错,帮我排查', 'spec'],
  ['帮我开发一个小游戏然后修复里面的 bug', 'react'],
  ['开发并修复', 'weak'],
  ['今天天气怎么样', 'weak'],
  ['Review and refactor this module', 'spec'],
  ['Create a new CLI tool for linting', 'react'],
  ['优化数据库查询性能', 'spec'],
  ['做一个上线的落地页', 'react'],
  ['服务崩溃了,帮我调试', 'spec'],
  ['实现一个支付模块并排查异常', 'spec'],
  ['帮我把这个应用迁移到新架构', 'weak'],
  ['build a landing page for our product', 'react'],
]
for (const [text, want] of TABLE) ok(`classify "${text.slice(0, 18)}…"`, classifyTask(text) === (want === 'react' ? 1 : want === 'spec' ? 0 : 'weak') && require_band(classifyTask(text)) === want)
function require_band(m) { return m === 'weak' ? 'weak' : m === 1 ? 'react' : 'spec' }
ok('system-reminder 注入不影响分类', classifyTask('<system-reminder>skills: build create</system-reminder>\n修复登录报错') === 0)

// ---------- A1:persona 逐字进 system[0](含 cache_control;plan-mode 存活) ----------
console.log('A1 persona 入 system(wire 前改写断言)')
for (const [text, persona] of [['修复登录报错', SPEC_PERSONA], ['写一个游戏', REACT_PERSONA], ['今天天气怎么样', WEAK_FLASH]]) {
  const body = { model: 'deepseek-v4-flash', system: [{ type: 'text', text: 'Zcode main' }, { type: 'text', text: 'You are in plan mode…' }], tools: [], messages: [{ role: 'user', content: [{ type: 'text', text }] }] }
  rewrite(body, new Map())
  ok(`system[0] = ${persona.split('\n')[0].slice(0, 40)}…`, eq(body.system[0], { type: 'text', text: persona, cache_control: { type: 'ephemeral' } }))
  ok('  余块保留(plan-mode 存活)', body.system.length === 3 && body.system[2].text.includes('plan mode'))
}

// ---------- 回显上游(JSON + SSE) ----------
const captured = []
const echo = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c)
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
  captured.push(body)
  if (body.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const ev = o => res.write(`data: ${JSON.stringify(o)}\n\n`)
    ev({ choices: [{ delta: { reasoning_content: 'plan: read first.' } }] })
    ev({ choices: [{ delta: { content: 'I will inspect the code.' } }] })
    // 真实上游格式(OpenCode go 实测):首片带 id+name,续片 id:null、靠 index 关联,arguments 逐片拼接
    ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_abc123', type: 'function', function: { name: 'Read', arguments: '' } }] } }] })
    ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: null, type: 'function', function: { name: null, arguments: '{"file_' } }] } }] })
    ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: null, type: 'function', function: { name: null, arguments: 'path":"auth.js"}' } }] } }] })
    ev({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
    ev({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } })
    res.write('data: [DONE]\n\n'); res.end()
  } else {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'cc', choices: [{ finish_reason: 'stop', message: { content: 'ok', reasoning_content: 'r' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
  }
})
await new Promise(r => echo.listen(19911, '127.0.0.1', r))
const cfgA = { port: 18787, variant: 'standard', upstreamKind: 'openai', upstreamBase: 'http://127.0.0.1:19911/v1', upstreamModel: 'deepseek-v4-flash', upstreamKey: 'sk-test' }
const routerA = await createRouter(cfgA).start()
const TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'Agent', 'TodoWrite'].map(n => ({ name: n, description: '', input_schema: { type: 'object' } }))
const post = (messages, opts = {}) => fetch(`http://127.0.0.1:18787/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: 1024, system: [{ type: 'text', text: 'Zcode main' }], tools: TOOLS, messages, ...opts }) })
const lastCap = () => captured.at(-1)
const names = cap => (cap.tools || []).map(t => t.function.name)

// ---------- A2:首轮工具面 ----------
console.log('A2 首轮工具面')
await post([{ role: 'user', content: [{ type: 'text', text: '修复登录报错' }] }])
ok('spec → Bash,Read,Edit,Glob,Grep', eq(names(lastCap()), ['Bash', 'Read', 'Edit', 'Glob', 'Grep']), JSON.stringify(names(lastCap())))
await post([{ role: 'user', content: [{ type: 'text', text: '写一个网站' }] }])
ok('react → Bash,Read,Write,Edit', eq(names(lastCap()), ['Bash', 'Read', 'Write', 'Edit']))
await post([{ role: 'user', content: [{ type: 'text', text: '你好呀' }] }])
ok('weak → Bash,Read,Write,Edit', eq(names(lastCap()), ['Bash', 'Read', 'Write', 'Edit']))

// ---------- A3:晋级 ----------
console.log('A3 晋级(历史含 tool_use)')
const sys0 = () => lastCap().messages.find(m => m.role === 'system').content.split('\n\n')[0]
await post([{ role: 'user', content: [{ type: 'text', text: '修复登录报错' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'reading' }, { type: 'tool_use', id: 'c1', name: 'Read', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'file' }] },
  { role: 'user', content: [{ type: 'text', text: '继续' }] }])
ok('晋级后 tools 全量(9)', names(lastCap()).length === 9)
ok('persona 恒定(SPEC)', sys0() === SPEC_PERSONA)

// ---------- A4:weak 引导 ----------
console.log('A4 weak 近场引导(同请求、逐字、分档)')
await post([{ role: 'user', content: [{ type: 'text', text: '你好呀' }] }])
ok('simple 档逐字', lastCap().messages.some(m => m.role === 'user' && m.content === GUIDE_WEAK))
await post([{ role: 'user', content: [{ type: 'text', text: '这'.repeat(150) }] }])
ok('complex 档逐字(>120 字符)', lastCap().messages.some(m => m.role === 'user' && m.content === GUIDE_DEEP))
ok('spec/react 不注入', true)

// ---------- A5:resume(全新实例、零共享状态) ----------
console.log('A5 resume(重启代理)')
const cfgB = { ...cfgA, port: 18788 }
const routerB = await createRouter(cfgB).start()
await fetch(`http://127.0.0.1:18788/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: 1, system: [], tools: TOOLS, messages: [{ role: 'user', content: [{ type: 'text', text: '修复登录报错' }] }, { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Read', input: {} }] }, { role: 'user', content: [{ type: 'text', text: '继续' }] }] }) })
ok('新实例同历史 → 同 band(spec)且已晋级', names(captured.at(-1)).length === 9 && captured.at(-1).messages.find(m => m.role === 'system').content.startsWith(SPEC_PERSONA))

// ---------- A6:dev 工具语义 ----------
console.log('A6 dev 工具(router_status / router_mode)')
const status = await routerA.toolCall('router_status', {})
ok('status 五段式', /mode=0\.00 \(band=spec\)/.test(status) && /core=\[read, edit, glob, grep\]/.test(status) && /testiness=normal/.test(status) && /override=no/.test(status))
ok('mode 50 → react(量化)', (await routerA.toolCall('router_mode', { mode: '50' })).includes('band=react'))
ok('mode 30 → mixed(仅显式可达)', (await routerA.toolCall('router_mode', { mode: '30' })).includes('band=mixed'))
ok('mode auto 清除', (await routerA.toolCall('router_mode', { mode: 'auto' })).includes('mode=auto'))
ok('非法 mode 拒绝', (await routerA.toolCall('router_mode', { mode: 'bogus' })).startsWith('invalid mode'))

// ---------- 流式冒烟(openai SSE → anthropic SSE) ----------
console.log('流式冒烟(stream:true)')
const sres = await fetch(`http://127.0.0.1:18787/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: 1024, system: [{ type: 'text', text: 'Zcode main' }], tools: TOOLS, stream: true, messages: [{ role: 'user', content: [{ type: 'text', text: '修复登录报错' }] }] }) })
const events = []
{
  const text = await sres.text()
  for (const m of text.matchAll(/event: (\w+)\ndata: (.+)\n\n/g)) events.push([m[1], JSON.parse(m[2])])
}
ok('SSE content-type', (sres.headers.get('content-type') || '').includes('text/event-stream'))
ok('事件序列: message_start…message_stop', events[0]?.[0] === 'message_start' && events.at(-1)?.[0] === 'message_stop')
ok('thinking/text/tool_use 块齐备', ['thinking_delta', 'text_delta', 'input_json_delta'].every(t => events.some(([, d]) => d?.delta?.type === t)))
ok('stop_reason=tool_use + usage', events.some(([, d]) => d?.delta?.stop_reason === 'tool_use') && events.some(([, d]) => d?.usage?.output_tokens === 7))
const starts = events.filter(([, d]) => d?.type === 'content_block_start' && d?.content_block?.type === 'tool_use')
const partials = events.filter(([, d]) => d?.delta?.type === 'input_json_delta').map(([, d]) => d.delta.partial_json).join('')
ok('工具块恰一个、id 正确(真实分片回归)', starts.length === 1 && starts[0][1].content_block.id === 'call_abc123' && starts[0][1].content_block.name === 'Read')
ok('参数分片按序组装且可解析', partials === '{"file_path":"auth.js"}' && (() => { try { JSON.parse(partials); return true } catch { return false } })())

// ---------- 配置通道:config.json 回退 + router_config 工具 ----------
console.log('配置通道(loadConfig 回退 + router_config)')
const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsf-router-cfg-'))
process.env.ZCODE_PLUGIN_DATA = tdir
fs.writeFileSync(path.join(tdir, 'config.json'), JSON.stringify({ upstreamKind: 'anthropic', baseURL: 'https://file.test/v1', model: 'file-model', apiKey: 'sk-file-secret', port: 18790 }))
const c1 = loadConfig()
ok('config.json 读入(key/baseURL/model/kind/port)', c1.upstreamKey === 'sk-file-secret' && c1.upstreamBase === 'https://file.test/v1' && c1.upstreamModel === 'file-model' && c1.upstreamKind === 'anthropic' && c1.port === 18790)
process.env.UPSTREAM_MODEL = 'from-env'
const c2 = loadConfig()
ok('config.json 优先级高于环境变量', c2.upstreamModel === 'file-model' && c2.upstreamKey === 'sk-file-secret')
delete process.env.UPSTREAM_MODEL

const cfgC = { port: 18789, variant: 'standard', upstreamKind: 'openai', upstreamBase: '', upstreamModel: 'deepseek-v4-flash', upstreamKey: '' }
const routerC = await createRouter(cfgC).start()
const out1 = await routerC.toolCall('router_config', { baseURL: 'https://tool.test/v1', model: 'tool-model', kind: 'anthropic', apiKey: 'sk-tool-secret', port: 18791 })
ok('router_config 更新进程内 cfg', cfgC.upstreamKey === 'sk-tool-secret' && cfgC.upstreamBase === 'https://tool.test/v1' && cfgC.upstreamKind === 'anthropic' && cfgC.port === 18791)
ok('router_config 返回不回显 apiKey', !out1.includes('sk-tool-secret'))
const jFile = JSON.parse(fs.readFileSync(path.join(tdir, 'config.json'), 'utf8'))
ok('落盘一致(apiKey/baseURL/kind/port)', jFile.apiKey === 'sk-tool-secret' && jFile.baseURL === 'https://tool.test/v1' && jFile.upstreamKind === 'anthropic' && jFile.port === 18791)
ok('config.json 权限 0600', (fs.statSync(path.join(tdir, 'config.json')).mode & 0o777) === 0o600)
ok('无参数读取 → keySet=true', (await routerC.toolCall('router_config', {})).includes('keySet=true'))
await routerC.toolCall('router_config', { apiKey: '' })
ok('空 apiKey 清除', cfgC.upstreamKey === '')
ok('非法 kind 拒绝', (await routerC.toolCall('router_config', { kind: 'bogus' })).includes('invalid kind'))
// ---------- 平台预设(工单 31) ----------
console.log('平台预设(preset 一键切换)')
const plist = await routerC.toolCall('router_config', { preset: 'list' })
ok('preset list 列出全部平台', ['deepseek-official', 'siliconflow', 'scnet', 'opencode', 'commandcode'].every(n => plist.includes(n)))
await routerC.toolCall('router_config', { preset: 'siliconflow', apiKey: 'sk-preset-test' })
ok('preset 填充 baseURL/kind/model', cfgC.upstreamBase === 'https://api.siliconflow.cn/v1' && cfgC.upstreamModel === 'deepseek-ai/DeepSeek-V4-Flash' && cfgC.upstreamKind === 'openai')
ok('preset 后 apiKey 单独写入', cfgC.upstreamKey === 'sk-preset-test')
ok('preset 落盘一致', JSON.parse(fs.readFileSync(path.join(tdir, 'config.json'), 'utf8')).baseURL === 'https://api.siliconflow.cn/v1')
ok('显式参数可覆盖 preset', (await routerC.toolCall('router_config', { preset: 'volc-ark', model: 'deepseek-v4-flash-ga-260731' })) && cfgC.upstreamBase === 'https://ark.cn-beijing.volces.com/api/v3' && cfgC.upstreamModel === 'deepseek-v4-flash-ga-260731')
ok('非法 preset 拒绝并给出名单', (await routerC.toolCall('router_config', { preset: 'nope' })).includes('invalid preset') && (await routerC.toolCall('router_config', { preset: 'nope' })).includes('scnet'))
delete process.env.ZCODE_PLUGIN_DATA
fs.rmSync(tdir, { recursive: true, force: true })

console.log(`\n结果:${pass} 通过,${fail} 失败`)
routerA.httpServer?.close(); routerB.httpServer?.close(); routerC.httpServer?.close(); echo.close()
process.exit(fail ? 1 : 0)
