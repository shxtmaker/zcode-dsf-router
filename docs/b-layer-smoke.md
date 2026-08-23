# B 层行为评审示例(zcode-dsf-router · 工单 30 收尾)

> 用法:每个示例都**开全新会话**(路由按首条消息锁定);`/model` 切到 **dsf-router** 提供商的 `deepseek-v4-flash`。做完动作后跑 `/router:status` 核对 band。
> 对照基线:想比较原生行为,临时 `/model` 切回 **opencode go** 原提供商发同样消息(不经路由),对比后切回。

## 准备清单

- [ ] Zcode 已重启(或新会话),MCP `zcode-dsf-router` 已连接(代理 8787 自动启动)
- [ ] `/model` → dsf-router / deepseek-v4-flash
- [ ] 上游:OpenCode go(已配好)

## 示例 1 · spec 带(修复/排查类)

**首条消息**(有真实靶项目:`docs/eval-fixture/`,含植入 bug,`node reproduce.js` 可复现):
```
帮我修复这个报错:登录后 token 为空,控制台抛 TypeError。项目在 /run/media/lin-qingyue/AI Project/Zcode/插件开发/zcode-dsf专武/docs/eval-fixture/,先跑 reproduce.js 复现,再排查原因并修复,修完跑通给我看
```

**预期**:`/router:status` → `band=spec`,`core=[read, edit, glob, grep]`

**观察点**:
- [ ] 先读后改:先跑复现/读 auth.js、api.js 定位,而不是上来就改文件
- [ ] 修复最小:改 `resp.token` → `resp.data.token`(及 saveSession 参数),不重构无关代码
- [ ] 修完自跑 `node reproduce.js` 验证输出「登录成功 token=tk_…」

**通过标准**:行动序=复现→读→定位→改→验证;思维链长度显著大于示例 2。

## 示例 2 · react 带(构建类)

**首条消息**:
```
写一个单文件的 HTML 待办事项网页,带本地存储,直接给我能跑的
```

**预期**:`band=react`,`core=[read, write, edit]`

**观察点**:
- [ ] 直接产出:很快开始 Write 文件
- [ ] 循环紧凑:写完简单自查即交付,总结简短
- [ ] 无长篇架构分析、无过度确认

**通过标准**:首工具=Write(或很快 Write);从发消息到首个文件产出的间隔明显短于示例 1。

## 示例 3 · weak 带(歧义短消息 + 引导分档)

**首条消息 A(simple 档)**:
```
这个项目怎么跑起来?
```

**首条消息 B(deep 档,>120 字符)**:把问题写长,例如描述一段架构迁移的纠结,让模型给建议。

**预期**:两者均 `band=weak`(persona=w7 含防跑偏锚点);B 走 deep 引导。

**观察点**:
- [ ] 模型自选风格(内路由):简短问题→轻量回答;长描述→先分析再建议
- [ ] 无重复已完成步骤、无环境探测命令(锚点生效)

## 示例 4 · 模式干预(dev 工具)

**4a 强制切档**:新会话先发 `/router:mode react`,再发示例 1 的修复任务。
- [ ] 行为转为直接产出风格(下一请求生效);status 显示 `override=yes`

**4b 隔离子任务**:任一会话发:
```
/router:subagent spec 从架构角度评估:把单体拆成事件驱动的微服务,风险有哪些?
```
- [ ] 返回 `[mode-subagent spec | reasoning N chars]` 开头的单轮深思考答案
- [ ] 当前会话轨迹不受影响(继续原任务无跳变)

## 示例 5 · 晋级(首次工具调用后放开)

任一会话持续工作到模型完成**第一个工具调用**后:
- [ ] `/router:status` → `promoted=yes`
- [ ] 之后模型可调用全量工具(WebSearch/Agent/TodoWrite 等),不再被首轮白名单限制
- [ ] persona 不变(行为风格不漂)

## 记录表(把结果告诉我)

| 示例 | 预期带 | 实际带(status) | 行为符合度 1-5 | 备注(思维链/首工具/异常) |
|---|---|---|---|---|
| 1 修复类 | spec | | | |
| 2 构建类 | react | | | |
| 3A 歧义短 | weak | | | |
| 3B 歧义长 | weak(deep) | | | |
| 4a 强制 react | react(override) | | | |
| 4b 子代理 | spec(隔离) | | | |
| 5 晋级 | promoted=yes | | | |

## 通过标准(工单 20 · B 层)

- 方向符合:示例 1 先读后改、示例 2 直接产出、示例 3 引导生效、示例 4 干预生效、示例 5 放开正常
- 稳定性:全程无断流/崩溃/乱码(SSE 翻译稳定)
- 幅度:示例 1 与 2 的风格差异**肉眼可辨**(这是 persona 路由的意义所在)

任何一项不符,把现象记进备注列——修完再复评。
