// 路由核心(纯函数,零依赖)——dsh-router-standard v0.3 逐字移植(工单 02 规格)
// 工单 30 升格:新增 cleanUserText(剥离 <system-reminder> 注入块,保证会话 key 稳定与分类纯净)
export const REACT_RE = /(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|make a|new project)/gi
export const SPEC_RE = /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi
const COMPLEX_RE = /(重构|架构|全面|详细|设计|系统|优化|分析|survey|overview|architecture|refactor|comprehensive|detailed|design|system|optimize|analyze)/i
const countHits = (re, text) => [...String(text).matchAll(re)].length
const clamp01 = v => Math.min(1, Math.max(0, Number(v) || 0))
// Zcode 会把技能清单等运行时上下文以 <system-reminder> 块注入用户消息,且内容随轮次变化:
// 剥离后再分类/取 hash,否则会话 key 漂移(override 失效)、分类被污染。
export const cleanUserText = t => String(t).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
export function classifyTask(text) {
  const t = cleanUserText(text)
  const r = countHits(REACT_RE, t), s = countHits(SPEC_RE, t)
  return r > s ? 1 : (s > r ? 0 : 'weak')
}
export function bandOf(mode) {
  if (mode === 'weak') return 'weak'
  const m = clamp01(mode)
  return m < 0.2 ? 'spec' : (m < 0.5 ? 'transition' : 'react')
}
export function bandFor(mode) { const b = bandOf(mode); return b === 'transition' ? 'mixed' : b }   // 展示名(dsh 语义)
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
export const SPEC_PERSONA = 'You are a helpful software engineer assistant.'
export const REACT_PERSONA = 'You are a hands-on software engineer who delivers working output fast.\nWork directly: write or edit code, then verify it by reading and running. Keep the loop tight — produce, verify, fix — and do not build test harnesses, scaffolding, or ceremony the user did not ask for. Finish with a usable deliverable and a short summary.'
export const WEAK_FLASH = 'You are a helpful assistant.\nBefore acting, decide the task type (build or fix) and adopt the matching style: build → hands-on production; fix → inspect-and-plan.\nBefore acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/glob scans.'
export const WEAK_PRO = 'You are a helpful software engineer assistant.\nBefore acting, decide the task type (build or fix) and adopt the matching style: build → hands-on production; fix → inspect-and-plan.'
export const RL_PERSONA = SPEC_PERSONA   // RL 训练句(rl-minimal 变体用)
export function personaFor(mode, modelId) {
  const band = bandOf(mode)
  if (band === 'spec') return SPEC_PERSONA
  if (band === 'react' || band === 'transition') return REACT_PERSONA
  return /flash/i.test(modelId || '') ? WEAK_FLASH : WEAK_PRO
}
export const GUIDE_WEAK = '\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply first, then commit and act.'
export const GUIDE_DEEP = '\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply about the architecture, edge cases, and integration points. Do not spend reasoning on the environment or tooling. Produce when your information is complete. End each reasoning block with a decision or an information need.'
export const isComplexTask = t => typeof t === 'string' && (t.length > 120 || COMPLEX_RE.test(t))
export const testinessFor = band => band === 'react' ? 'suppressed' : (band === 'spec' ? 'normal' : 'light')

const SHELL_NAMES = new Set(['bash', 'pwsh', 'shell'])
export function coreFor(band) { return band === 'spec' ? ['read', 'edit', 'glob', 'grep'] : band === 'transition' ? ['read', 'edit', 'write', 'glob', 'grep'] : ['read', 'write', 'edit'] }
export function filterTools(tools, band) {
  if (!Array.isArray(tools) || !tools.length) return tools
  const want = new Set(coreFor(band))
  const shell = tools.find(t => SHELL_NAMES.has(String(t.name).toLowerCase()))
  if (shell) want.add(String(shell.name).toLowerCase())
  return tools.filter(t => want.has(String(t.name).toLowerCase()))
}
export const blockText = c => typeof c === 'string' ? c : (Array.isArray(c) ? c : []).map(b => b?.text ?? '').join(' ')
export const userTextOf = m => cleanUserText(blockText(m?.content))
export const sessionKeyOf = body => {
  const t = userTextOf((body.messages || []).find(m => m.role === 'user')) || ''
  let h = 5381; for (const ch of t) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0
  return h.toString(36)
}
export function derive(body, overrides = new Map()) {
  const msgs = body.messages || []
  const firstUser = msgs.find(m => m.role === 'user' && userTextOf(m))
  const firstUserText = firstUser ? userTextOf(firstUser) : ''
  const promoted = msgs.some(m => m.role === 'assistant' && JSON.stringify(m.content).includes('"tool_use"'))
  const mode = overrides.get(sessionKeyOf(body)) ?? classifyTask(firstUserText)
  return { key: sessionKeyOf(body), firstUserText, promoted, mode, band: bandOf(mode), override: overrides.has(sessionKeyOf(body)) }
}
// 改写入口。variant: 'standard'(persona 前置块,默认)| 'rl-minimal'(整个 system 替换为 RL 句 + Bash/Edit 面)
export function rewrite(body, overrides, variant = 'standard') {
  const d = derive(body, overrides)
  const persona = personaFor(d.mode, body.model)
  if (variant === 'rl-minimal') {
    body.system = [{ type: 'text', text: RL_PERSONA, cache_control: { type: 'ephemeral' } }]
    if (!d.promoted) body.tools = (Array.isArray(body.tools) ? body.tools : []).filter(t => ['bash', 'edit'].includes(String(t.name).toLowerCase()))
  } else {
    const system = Array.isArray(body.system) ? body.system : (body.system ? [{ type: 'text', text: body.system }] : [])
    body.system = [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }, ...system]
    if (!d.promoted) body.tools = filterTools(body.tools, d.band)
  }
  let guideInjected = null
  if (d.band === 'weak' && !d.promoted) {
    const msgs = body.messages
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        const t = userTextOf(msgs[i])
        if (!t) continue
        if (blockText(msgs[i].content).startsWith('\nRouter:')) break
        guideInjected = isComplexTask(t) ? 'deep' : 'simple'
        msgs.splice(i + 1, 0, { role: 'user', content: [{ type: 'text', text: guideInjected === 'deep' ? GUIDE_DEEP : GUIDE_WEAK }] })
        break
      }
    }
  }
  return { ...d, personaFirstLine: persona.split('\n')[0], guideInjected }
}
