// 平台预设(工单 31;事实来源:工单 01 答案的平台预设事实表,核验于 2026-08-23)
// 用途:router_config {preset:"<name>", apiKey:"sk-..."} 一键切换上游平台;
//       Zcode 侧 provider 始终指向本地代理,换平台不动 Zcode 配置。
export const PRESETS = {
  'deepseek-official': { baseURL: 'https://api.deepseek.com', kind: 'openai', model: 'deepseek-v4-flash', note: 'DeepSeek 官方;另有 Anthropic 兼容端点可手动切 kind=anthropic' },
  siliconflow: { baseURL: 'https://api.siliconflow.cn/v1', kind: 'openai', model: 'deepseek-ai/DeepSeek-V4-Flash', note: '硅基流动;模型 ID 以接入时 GET /v1/models 核验' },
  'volc-ark': { baseURL: 'https://ark.cn-beijing.volces.com/api/v3', kind: 'openai', model: 'deepseek-v4-flash', note: '火山方舟;GA 快照 deepseek-v4-flash-ga-260731;另有 Coding 端点支持 Anthropic' },
  scnet: { baseURL: 'https://api.scnet.cn/api/llm/v1', kind: 'openai', model: 'DeepSeek-V4-Flash-0731', note: '国家超算互联网(公测);官方文档称另支持 Anthropic 协议,可手动切 kind=anthropic 验证' },
  opencode: { baseURL: 'https://opencode.ai/zen/go/v1', kind: 'openai', model: 'deepseek-v4-flash', note: 'OpenCode go(已实测打通)' },
  commandcode: { baseURL: 'https://api.commandcode.ai/provider/v1', kind: 'openai', model: 'deepseek/deepseek-v4-flash', note: 'Command Code(已实测打通)' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', kind: 'openai', model: 'deepseek/deepseek-v4-flash', note: 'OpenRouter;快照后缀漂移,接入时核验' },
  bailian: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', kind: 'openai', model: 'deepseek-v4-flash', note: '阿里云百炼;注意地域可用性' },
  together: { baseURL: 'https://api.together.xyz/v1', kind: 'openai', model: 'deepseek-ai/deepseek-v4-flash-0731', note: 'Together AI' },
  fireworks: { baseURL: 'https://api.fireworks.ai/inference/v1', kind: 'openai', model: 'deepseek-ai/deepseek-v4-flash-0731', note: 'Fireworks(serverless)' },
}
export const presetNames = () => Object.keys(PRESETS)
