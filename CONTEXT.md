# CONTEXT.md

## 术语表

- **三带(behavior band)**:persona 轴上测得的三个稳定行为区:spec(规划集体态,先读后改)、react(执行者态,直接产出)、weak(弱引导态,模型内路由窗口);中间 mixed 带不稳定,路由永不自动选它。
- **persona**:注入模型首请求的单句身份设定,行为带的主触发器;DeepSeek V4 Flash 用 w7 文案+防跑偏锚点。
- **任务分类(classifyTask)**:读取会话首条真实用户消息,build→react / fix→spec / 歧义→weak。
- **首轮工具面(first-turn tool surface)**:会话首个请求暴露给模型的收窄工具清单,按带不同;首次持久工具调用后放开全量。
- **首次持久工具调用(first durable tool call)**:触发放开全量工具、路由停止干预的判定事件;模式由持久会话事件派生,resume 保持。
- **近场引导(near-field guidance)**:weak 带下随每条真实用户消息同请求注入的路由引导。
- **深度自适应引导(depth-adaptive guidance)**:按任务复杂度分档的引导:简单任务→快收敛,复杂任务→决策收束深思考。
- **路由代理(router proxy)**:随插件分发的本地服务,承接 Zcode 自定义 provider 流量,执行 system 改写与工具面过滤。
- **插件壳(plugin shell)**:Zcode 插件本体(hooks/commands/技能),负责分类、会话状态与用户命令,与代理协作。
- **平台预设(platform preset)**:第三方平台的接入配置事实(baseURL/模型 ID/协议/鉴权),供一键注册 provider。
