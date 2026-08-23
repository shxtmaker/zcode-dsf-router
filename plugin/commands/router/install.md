---
description: 一键接入:扫描已接入供应商,弹出选项选一个带 DeepSeek V4 flash 的,自动绑上游+注册模型列表条目
---

按以下流程引导(每步向用户展示结果):

1. 调用 MCP 工具 `router_providers`(zcode-dsf-router 服务器,无参数),获得**已接入且带 DeepSeek flash 系模型**的供应商清单。若为空,告知用户先接入平台(或改用 `/router:setup` 平台预设)后重试。
2. **用 AskUserQuestion 工具弹出选项**:一个问题,选项 = 各候选供应商(label 用「供应商名(模型 ID)」,description 写 baseURL 与协议);若某供应商有多个 flash 模型,在同一问题的选项里分别列出。用户选择一个。
3. 用户选定后,调用 `router_bind`,参数 `{providerId: "<所选>", model: "<所选模型>"}`(服务端会复制该供应商的 apiKey,不回显)。
4. 调用 `router_install`(无参数)注册/更新模型列表条目「dsf-router (V4 flash 任务感知路由)」(自动备份原配置)。
5. 告诉用户:现在 `/model` 选择该条目即启用任务感知路由,流量走所选平台;不想用时在模型列表里删掉该条目即可,代理与命令不受影响。
