---
description: 以另一推理模式在隔离上下文跑一个子任务(不改当前轨迹)
argument-hint: <spec|react|weak|mixed> <task>
---

调用 zcode-dsf-router MCP 服务器的 `router_subagent` 工具:第一个参数 `$1` 作为 `mode`(spec/react/weak/mixed/0-100),其余参数 `$ARGUMENTS` 中去掉首个词后的部分作为 `task`(可选 `maxTokens`,默认 1024)。向用户原样展示返回的 `[mode-subagent <band> | reasoning <N> chars]` 摘要。说明:子任务使用目标模式的 persona 作为独立 system,单轮调用、无工具,当前会话轨迹不受影响。
