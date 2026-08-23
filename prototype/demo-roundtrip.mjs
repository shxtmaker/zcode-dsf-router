// PROTOTYPE (throwaway) — 工单 10 演示驱动:一条命令跑通四个关键场景
// 运行:node prototype/demo-roundtrip.mjs
// 场景:① spec 分类收窄 ② react 分类 ③ weak+引导(Flash w7 persona) ④ 首次工具调用后晋级放开
import http from 'node:http'
import { startProxy } from './proxy-skeleton.mjs'

// ---- 回显上游(openai 兼容,记录收到的翻译请求,返回带 tool_calls 的应答) ----
const captured = []
const echo = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c)
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
  captured.push({ url: req.url, auth: !!req.headers.authorization, body })
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    id: 'chatcmpl-demo', choices: [{ finish_reason: 'tool_calls', message: { content: 'I will inspect the login code first.', reasoning_content: 'User reports a login crash; plan: read auth module, reproduce, fix.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: body.tools?.[0]?.function?.name || 'Read', arguments: '{}' } }] } }],
    usage: { prompt_tokens: 123, completion_tokens: 45 },
  }))
})
await new Promise(ok => echo.listen(9911, '127.0.0.1', ok))
await startProxy({ port: 8787, upstreamKind: 'openai', upstreamBase: 'http://127.0.0.1:9911/v1' })

// ---- Zcode 形状的请求(工单 03 实测:3 块 cache_control system + input_schema 工具) ----
const ZCODE_SYSTEM = [
  { type: 'text', text: 'You are Zcode, an interactive coding agent…', cache_control: { type: 'ephemeral' } },
  { type: 'text', text: '# Tone and style…', cache_control: { type: 'ephemeral' } },
  { type: 'text', text: 'You are in plan mode…', cache_control: { type: 'ephemeral' } },
]
const FULL_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'Agent', 'TodoWrite'].map(name => ({ name, description: `tool ${name}`, input_schema: { type: 'object', properties: {} } }))
const call = (messages, label) => fetch('http://127.0.0.1:8787/v1/messages', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'sk-local', 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: 16384, system: ZCODE_SYSTEM, tools: FULL_TOOLS, messages }),
}).then(r => r.json()).then(resp => {
  const cap = captured.at(-1).body
  const sys = cap.messages.find(m => m.role === 'system')?.content || ''
  console.log(`\n=== ${label} ===`)
  console.log(`  system 首行: ${sys.split('\n')[0].slice(0, 80)}`)
  console.log(`  system 块数: ${sys.split('\n\n').length}(含 plan-mode 块: ${sys.includes('plan mode')})`)
  console.log(`  工具面: ${cap.tools?.map(t => t.function.name).join(', ') || '(无)'}`)
  console.log(`  消息流: ${cap.messages.map(m => m.role + (m.role === 'tool' ? `(${m.tool_call_id})` : '')).join(' → ')}`)
  console.log(`  引导注入: ${cap.messages.some(m => String(m.content).includes('Router:')) ? '是' : '否'}`)
  console.log(`  响应块: ${resp.content?.map(b => b.type).join(',')} stop=${resp.stop_reason}`)
})

// ① spec:修复类首条消息
await call([{ role: 'user', content: [{ type: 'text', text: '帮我修复这个登录报错,为什么一直崩溃' }] }], '① spec 分类(修复→收窄 read/edit/glob/grep+shell)')
// ② react:构建类首条消息
await call([{ role: 'user', content: [{ type: 'text', text: '帮我开发一个马里奥网页小游戏' }] }], '② react 分类(构建→read/write/edit+shell)')
// ③ weak:无命中 → w7 persona + 近场引导(simple)
await call([{ role: 'user', content: [{ type: 'text', text: '今天天气怎么样' }] }], '③ weak 分类(w7 persona + simple 引导)')
// ④ 晋级:①的会话历史里出现 tool_use → 全量放开,persona 恒定
await call([
  { role: 'user', content: [{ type: 'text', text: '帮我修复这个登录报错,为什么一直崩溃' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'I will inspect the login code first.' }, { type: 'tool_use', id: 'call_1', name: 'Read', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'auth.ts: 42 lines' }] },
  { role: 'user', content: [{ type: 'text', text: '继续' }] },
], '④ 晋级后(历史含 tool_use → 工具全量放开,persona 仍注入)')
// ⑤ override 演示:把 ① 的会话钉到 react
const k = [...(await (await fetch('http://127.0.0.1:8787/__status')).json()).sessions][0].key
await fetch('http://127.0.0.1:8787/__mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionKey: k, mode: 'react' }) })
await call([{ role: 'user', content: [{ type: 'text', text: '帮我修复这个登录报错,为什么一直崩溃' }] }], '⑤ override(同首条消息强制 react)')

console.log('\n[demo] 完成。/__status 可查会话注册表;PROTOTYPE 验证点:band 推导、persona 前置块、工具面过滤/放开、weak 引导、openai 翻译往返。')
process.exit(0)
