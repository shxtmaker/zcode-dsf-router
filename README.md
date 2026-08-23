# zcode-dsf-router

DeepSeek V4 flash 的**任务感知推理模式路由** Zcode 插件——原项目机制的 Zcode 移植与适配。

> ## ⚠️ 重要说明
>
> - 本仓库**只做了 Zcode 平台的适配验证**(Zcode 0.16.3,OpenCode go 与 Command Code 两家第三方平台的 DeepSeek V4 flash 端到端实测;国家超算 SCNet 完成端点/协议验证待 key)。
> - 路由机制(persona、三带、首轮工具面、晋级、引导文案等)逐字移植自下列**原项目**,其效果与实测数据以原项目为准,本仓库未在 DeepSeek Harness 上复验:
>   - 原项目一:**[dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)**(v0.3 机制来源:任务感知推理模式路由预设)
>   - 原项目二:**[dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)**(配套套件)
> - 作者:[shxtmaker](https://github.com/shxtmaker);致敬原作者 yjh051108 的开创性实测工作。

## 它做什么

会话首条用户消息被分类(构建→react / 修复→spec / 歧义→weak),首个模型请求注入对应 persona(Flash 用 w7+防跑偏锚点)并收窄首轮工具面;**首次持久工具调用后**放开全量工具、路由停止干预;模式随会话历史派生,resume/重启天然保持。另附深度自适应引导、显式切档、隔离换模子代理、多平台预设一键切换。

## 架构

```
Zcode ──(anthropic kind, http://127.0.0.1:8787)──▶ 本地路由代理(MCP server 双角色)
                                                      │ persona 注入 / 首轮工具面过滤 / weak 引导
                                                      ▼
                                        上游平台(OpenAI 或 Anthropic 协议)
```

插件壳零 hooks:路由状态全部从请求自身**无状态派生**(会话 key=首条用户消息、band=分类、晋级=历史含 tool_use),换平台不动 Zcode 侧 provider。

## 快速开始

**最简接入**:在 Zcode 里输入 `/router:install` —— 自动扫描你已接入的供应商、**弹出选项**列出带 DeepSeek V4 flash 模型的那些,选中后自动绑定上游(复制其 baseURL/模型/key,不回显)并注册模型列表条目(带时间戳备份、幂等),然后 `/model` 选「dsf-router」即启用。

或按 **[plugin/README.md](plugin/README.md)** 手动部署(平台预设、key 通道、命令表、验证方式)。支持的平台预设:`deepseek-official` / `siliconflow` / `volc-ark` / `scnet` / `opencode` / `commandcode` / `openrouter` / `bailian` / `together` / `fireworks`。

## 仓库结构

```
plugin/          插件本体(manifest + MCP server + 路由核心 + 翻译层 + 预设 + 命令 + README)
tests/verify.mjs A 层机制验收(persona 逐字/工具面/晋级/引导/resume/分类表/流式翻译/预设)
docs/            B 层行为评审示例与靶项目(eval-fixture)
prototype/       设计期原型(代理骨架五场景演示,保留作参考)
CONTEXT.md       术语表
NOTICE           出处与致谢
```

## 验证摘要(均在本机 Zcode 0.16.3 真实链路)

- **A 机制层**:`node tests/verify.mjs` → 58 通过 0 失败
- **B 行为层**(无头 Zcode → 代理 → OpenCode go):spec 修复任务 6 轮先读后改(读入 81K/输出 1154);react 构建任务 3 轮直接产出(输出 3124);weak 分档引导;隔离子代理;晋级后全量放开
- **C 平台层**:OpenCode go ✅ / Command Code ✅ 端到端;SCNet 端点与协议 ✅(公测 key 待申请)

## License

MIT(见 [LICENSE](LICENSE));出处与逐字移植清单见 [NOTICE](NOTICE)。
