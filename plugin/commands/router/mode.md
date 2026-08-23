---
description: 设置推理模式(spec/react/weak/mixed/0-100/0.0-1.0/auto)
argument-hint: <spec|react|weak|mixed|0-100|0.0-1.0|auto>
---

调用 zcode-dsf-router MCP 服务器提供的 `router_mode` 工具,把 `$ARGUMENTS` 作为 `mode` 参数传入(可选 `sessionKey`,缺省取最近会话),向用户展示返回结果。合法输入:spec / weak / mixed / react / 0-100 整数 / 0.0-1.0 小数 / auto(恢复任务分类)。下一次请求生效。
