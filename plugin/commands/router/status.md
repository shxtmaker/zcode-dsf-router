---
description: 查看推理模式路由状态(各会话的 mode/band/persona/首轮工具面/override/晋级)
---

调用 zcode-dsf-router MCP 服务器提供的 `router_status` 工具(无参数),把返回内容原样展示给用户。若工具不可用,提示用户:代理未随插件启动或尚无会话经过路由。
