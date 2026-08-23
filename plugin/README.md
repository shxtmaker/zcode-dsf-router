# zcode-dsf-router

DeepSeek V4 flash 的**任务感知推理模式路由**——[dsh-router-standard](https://github.com/yjh051108/dsh-router-standard) v0.3 的 Zcode 移植。

会话首条用户消息被分类(build→react / fix→spec / 歧义→weak),首个模型请求注入对应 persona(Flash 用 w7+防跑偏锚点)并收窄首轮工具面;**首次持久工具调用后**放开全量工具、路由停止干预;模式随会话历史派生,resume/重启天然保持。附带深度自适应引导(weak 带 simple/complex 两档)、显式切档、隔离子代理。

## 架构

```
Zcode ──(anthropic kind, http://127.0.0.1:8787)──▶ 本地路由代理(MCP server 双角色)
                                                      │ persona 注入 / 工具面过滤 / weak 引导
                                                      ▼
                                        上游平台(OpenAI 或 Anthropic 协议)
```

- 插件壳 = manifest + MCP server + 4 个斜杠命令,**零 hooks**(路由状态全部从请求自身无状态派生)
- 代理同时是 MCP server(stdio):Zcode 会话启动即自动拉起;多会话单实例锁自动降级转发
- Zcode 侧 provider 永远指向本地代理——**换平台不动 Zcode 配置**

## 快速开始

1. **部署**(本地目录 marketplace,或当前用户级部署:`~/.zcode/cli/config.json` 的 `mcp.servers` + `~/.zcode/commands/router/`)
2. **注册 provider**(备份后加进 `~/.zcode/v2/config.json` 顶层 provider 映射):
   ```json
   "<uuid>": { "name": "dsf-router", "kind": "anthropic",
     "options": { "apiKey": "dsf-local-proxy", "baseURL": "http://127.0.0.1:8787", "apiKeyRequired": false },
     "source": "custom",
     "models": { "deepseek-v4-flash": { "reasoning": { "enabled": true, "variants": ["off","high","max"], "defaultVariant": "max" }, "limit": { "context": 1000000, "output": 384000 } } } }
   ```
3. **配上游**:`/router:setup` 向导,或直接让模型调 MCP 工具
   `router_config({ preset: "<平台>", apiKey: "<key>" })`
   平台预设:`deepseek-official` / `siliconflow` / `volc-ark` / `scnet`(国家超算,公测 key 需在 scnet.cn 模型服务页申请)/ `opencode` / `commandcode` / `openrouter` / `bailian` / `together` / `fireworks`;`preset:"list"` 查看全部。
   key 通道:MCP env(`UPSTREAM_API_KEY`)或 `router_config` 落盘(插件数据目录 config.json,0600)——**不要**走插件设置的 sensitive 字段(宿主拒绝持久化)。
4. `/model` 切到 dsf-router 的 `deepseek-v4-flash`,发任务。

## 命令与工具

| 命令 | MCP 工具 | 作用 |
|---|---|---|
| `/router:install` | `router_providers` + `router_bind` + `router_install` | **一键接入**:扫描已接入供应商 → AskUserQuestion 弹窗选一个带 DeepSeek flash 模型的 → 自动绑上游(复制其 baseURL/model/key)并注册模型列表条目(带备份、幂等) |
| `/router:status` | `router_status` | 各会话 mode/band/persona/首轮工具面/override/晋级 |
| `/router:mode <spec\|react\|weak\|mixed\|0-100\|auto>` | `router_mode` | 显式切档(下一请求生效;数值量化到三带,mixed 仅显式) |
| `/router:subagent <mode> <task>` | `router_subagent` | 隔离单轮换模子任务(无工具,轨迹零污染) |
| `/router:setup [平台]` | `router_config` | 平台预设切换 / 手动配置向导 |

变体:`DSF_VARIANT=rl-minimal` = RL 极简模式(整个 system 替换为 RL 训练句 + Bash/Edit 两工具面)。

## 验证

```sh
node tests/verify.mjs   # A 层机制断言:persona 逐字/工具面/晋级/引导/resume/dev 工具/16 条分类表/流式翻译/预设
```

B 层行为评审示例:`docs/b-layer-smoke.md`(靶项目 `docs/eval-fixture/`)。实测基线:spec 修复任务 6 轮先读后改、react 构建 3 轮直接产出(OpenCode go 真实链路)。

## 已知限制

- 持有代理端口的会话退出后,其他在用会话不自动接管(重开会话即恢复)
- 无头 Zcode 工具目录无 Glob/Grep,spec 首轮面退化为 Bash/Read/Edit
- 改代理代码后需重启 Zcode 会话加载(MCP 进程内持有旧代码)

## 致谢

**本作者([shxtmaker](https://github.com/shxtmaker))只做了 Zcode 平台的移植适配工作;核心功能(路由机制设计、persona 文案、三带实测与结论)全部为原作者 yjh051108 完成**,致谢。以下为机制来源(**仅做了 Zcode 适配验证,原项目效果与实测以其仓库为准**):

- [dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)(v0.3 机制来源,MIT)
- [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)(配套套件)

本插件适配部分:MIT。
