---
description: 把 Zcode 的 provider 指向本地路由代理(接入向导)
---

按以下步骤引导用户完成接入;上游平台预设(SiliconFlow/火山方舟/OpenRouter/国家超算 SCNet/OpenCode go/Command Code 等)的 baseURL/模型 ID/协议以插件文档为准,没有预设时先向用户收集:

1. 调用 zcode-dsf-router MCP 服务器的 `router_status` 工具确认代理已启动,记下 HTTP 端口(默认 8787)。
2. 指导用户**先备份** `~/.zcode/v2/config.json`,再在顶层 `provider` 映射新增条目:`kind: "anthropic"`、`baseURL: http://127.0.0.1:<端口>`、`apiKey` 占位、模型 ID 沿用 upstream_model。
3. 配置上游连接。**apiKey 不能走插件设置的 userConfig 字段**(宿主对 sensitive 值拒绝持久化,保存会报错),按运行方式选择通道:
   - **GUI 会话**:调用 MCP 工具 `router_config` 一次性写入(立即生效并落盘 0600 的 config.json):
     - **平台预设(推荐)**:`router_config({ preset: "<平台名>", apiKey: "<平台 API key>" })` —— 一次填好 baseURL/kind/model。平台名:`deepseek-official` / `siliconflow` / `volc-ark` / `scnet` / `opencode` / `commandcode` / `openrouter` / `bailian` / `together` / `fireworks`;`preset:"list"` 查看全部及模型 ID。**换平台不用动 Zcode 侧 provider**(它始终指向本地代理)。
     - 手动:`router_config({ baseURL: "<平台 baseURL>", model: "<模型 ID>", kind: "openai"|"anthropic", apiKey: "<平台 API key>" })`(快照后缀漂移时用 model 覆盖)
     - 或手动在代理数据目录写 config.json(路径见 `router_config()` 返回的 `file` 字段),格式 `{"baseURL":"...","model":"...","upstreamKind":"openai","apiKey":"..."}`,重启 Zcode 生效。
   - **CLI/headless**:环境变量 `UPSTREAM_KIND` / `UPSTREAM_BASE_URL` / `UPSTREAM_MODEL` / `UPSTREAM_API_KEY`,或 `~/.zcode/cli/config.json` 的 `mcp.servers.zcode-dsf-router.env`。
4. 验证:代理 `/__status`(`curl http://127.0.0.1:<端口>/__status`)应显示 `keySet: true`、`upstreamKey: sk-***` 与正确的 baseURL;随后让用户 `/model` 切到新 provider 发一条测试消息,再跑 `/router:status` 确认会话出现且 band 符合预期。

任何一步失败,指导用户恢复备份的 config.json。