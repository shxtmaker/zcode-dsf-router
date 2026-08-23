# Changelog

## 0.2.0(2026-08-24)

- **`/router:install` 一键接入**:扫描已接入 Zcode 供应商 → AskUserQuestion 弹窗选择带 DeepSeek flash 系模型的供应商 → 自动绑上游(服务端复制 baseURL/model/apiKey,不回显)→ 幂等注册模型列表条目(带时间戳备份)
- 新增 MCP 工具:`router_providers`(扫描)、`router_bind`(绑定)、`router_install`(注册)
- `router_config` 支持 `preset` 参数:10 平台预设一键切换(DeepSeek 官方/硅基流动/火山方舟/国家超算/OpenCode go/Command Code/OpenRouter/百炼/Together/Fireworks)
- 修复:流式 tool_call 续片(`id:null + index:N`)翻译错块导致工具参数为空的问题;parseMode 量化;`/__status` 上游 key 脱敏
- 验收:63 项断言全绿;OpenCode go / Command Code 真实平台端到端;正常模型会话内 `/router:install` 工具链实测可用

## 0.1.0(2026-08-23)

- 首个版本:v0.3 经典路由全链路(分类 → persona 注入 → 首轮工具面 → 首次持久工具调用后放开 → 模式持久化)
- 架构:anthropic kind 本地代理(OpenAI/Anthropic 双协议上游翻译 + SSE 流式)+ 零 hooks 插件壳 + 无状态逐请求派生
- 命令:`/router:status`、`/router:mode`、`/router:subagent`、`/router:setup`
- `__zcode-plugin-host` 官方运行时包装;单实例锁;RL 极简变体(`DSF_VARIANT=rl-minimal`)
