// anthropic ↔ openai-compatible 翻译层(工单 30:SSE 流式 + 非流式)
import { Readable } from 'node:stream'
import { blockText } from './router-core.mjs'

// ---------- 非流式 ----------
export function anthropicToOpenAIBody(body, model) {
  const messages = []
  const sys = (Array.isArray(body.system) ? body.system : []).map(b => b.text).join('\n\n')
  if (sys) messages.push({ role: 'system', content: sys })
  for (const m of body.messages || []) {
    const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }]
    if (m.role === 'user') {
      for (const r of blocks.filter(b => b.type === 'tool_result')) messages.push({ role: 'tool', tool_call_id: r.tool_use_id, content: blockText(r.content) })
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n')
      if (text) messages.push({ role: 'user', content: text })
    } else {
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n')
      const calls = blocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }))
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
    }
  }
  const out = { model, messages, max_tokens: body.max_tokens ?? 8192, stream: body.stream === true }
  if (out.stream) out.stream_options = { include_usage: true }   // Zcode 侧同款(工单 03)
  if (body.tools?.length) out.tools = body.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object' } } }))
  if (body.tool_choice) out.tool_choice = typeof body.tool_choice === 'object' ? 'auto' : body.tool_choice
  if (typeof body.temperature === 'number') out.temperature = body.temperature
  if (typeof body.top_p === 'number') out.top_p = body.top_p
  return out
}
export function openAIToAnthropicResponse(json, uuid) {
  const m = json.choices?.[0]?.message ?? {}
  const content = []
  if (m.reasoning_content) content.push({ type: 'thinking', thinking: m.reasoning_content })
  if (m.content) content.push({ type: 'text', text: m.content })
  for (const c of m.tool_calls || []) content.push({ type: 'tool_use', id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments || '{}') })
  if (!content.length) content.push({ type: 'text', text: '' })
  const stop = { tool_calls: 'tool_use', length: 'max_tokens', stop: 'end_turn' }[json.choices?.[0]?.finish_reason] || 'end_turn'
  return { id: 'msg_' + (json.id || uuid()), type: 'message', role: 'assistant', model: json.model, content, stop_reason: stop, usage: { input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0 } }
}

// ---------- SSE:openai chunks → anthropic 事件流 ----------
const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
export async function* openaiSSEToAnthropicSSE(response, uuid, model) {
  yield sse('message_start', { type: 'message_start', message: { id: 'msg_' + uuid(), type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } })
  const blocks = { thinking: null, text: null, tools: new Map() }   // {index} / {index} / 流式index→{wireIndex,name}
  let next = 0, stopReason = null, usage = { input_tokens: 0, output_tokens: 0 }
  const ensureThinking = function* () { if (blocks.thinking === null) { blocks.thinking = { index: next++ }; yield sse('content_block_start', { type: 'content_block_start', index: blocks.thinking.index, content_block: { type: 'thinking', thinking: '' } }) } }
  const ensureText = function* () { if (blocks.text === null) { blocks.text = { index: next++ }; yield sse('content_block_start', { type: 'content_block_start', index: blocks.text.index, content_block: { type: 'text', text: '' } }) } }
  const closeAll = function* () {
    if (blocks.thinking !== null) yield sse('content_block_stop', { type: 'content_block_stop', index: blocks.thinking.index })
    if (blocks.text !== null) yield sse('content_block_stop', { type: 'content_block_stop', index: blocks.text.index })
    for (const [, t] of blocks.tools) yield sse('content_block_stop', { type: 'content_block_stop', index: t.wireIndex })
  }
  for await (const line of sseLines(response)) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6).trim()
    if (payload === '[DONE]') break
    let chunk; try { chunk = JSON.parse(payload) } catch { continue }
    if (chunk.usage) usage = { input_tokens: chunk.usage.prompt_tokens ?? usage.input_tokens, output_tokens: chunk.usage.completion_tokens ?? usage.output_tokens }
    const choice = chunk.choices?.[0]
    if (!choice) continue
    const delta = choice.delta ?? {}
    if (delta.reasoning_content) yield* ensureThinking()
    if (blocks.thinking !== null && delta.reasoning_content) yield sse('content_block_delta', { type: 'content_block_delta', index: blocks.thinking.index, delta: { type: 'thinking_delta', thinking: delta.reasoning_content } })
    if (delta.content) yield* ensureText()
    if (blocks.text !== null && delta.content) yield sse('content_block_delta', { type: 'content_block_delta', index: blocks.text.index, delta: { type: 'text_delta', text: delta.content } })
    for (const tc of delta.tool_calls || []) {
      // OpenAI 流式标准:首片带 id+name,续片 id:null、靠 index 关联(实测 OpenCode go 如此)
      const idx = tc.index ?? 0
      if (tc.id && !blocks.tools.has(idx)) {
        const slot = { wireIndex: next++, name: tc.function?.name || '' }
        blocks.tools.set(idx, slot)
        yield sse('content_block_start', { type: 'content_block_start', index: slot.wireIndex, content_block: { type: 'tool_use', id: tc.id, name: slot.name, input: {} } })
      }
      const t = blocks.tools.get(idx)
      if (t && tc.function?.arguments) yield sse('content_block_delta', { type: 'content_block_delta', index: t.wireIndex, delta: { type: 'input_json_delta', partial_json: tc.function.arguments } })
    }
    if (choice.finish_reason) stopReason = { tool_calls: 'tool_use', length: 'max_tokens', stop: 'end_turn' }[choice.finish_reason] || 'end_turn'
  }
  if (blocks.thinking === null && blocks.text === null && blocks.tools.size === 0) {
    yield* ensureText()
    yield sse('content_block_delta', { type: 'content_block_delta', index: blocks.text.index, delta: { type: 'text_delta', text: '' } })
  }
  yield* closeAll()
  yield sse('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason ?? 'end_turn' }, usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } })
  yield sse('message_stop', { type: 'message_stop' })
}
async function* sseLines(response) {
  const readable = Readable.fromWeb(response.body)
  let buf = ''
  for await (const chunk of readable) {
    buf += chunk.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '')
      buf = buf.slice(i + 1)
      if (line) yield line
    }
  }
  if (buf.trim()) yield buf.trim()
}
