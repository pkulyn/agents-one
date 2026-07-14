# 多智能体集成待办清单

日期：2026-07-10。状态标记：`[ ]` 待开始，`[~]` 进行中，`[x]` 已完成，`[!]` 阻塞。

## 当前基线

- [x] 远程 Hermes 已接入，并完成对话与任务真实联调。
- [x] 远程 Dashboard HTTP 管理 API 已探测；聊天 WebSocket 不可用时明确采用 legacy chat 回退。
- [x] 远程 Dashboard 配置、TLS 限域、Memory/Skills/Tools 远程调用已完成回归与真实 NAS 探测，见 `docs/REMOTE_HERMES_SMOKE_MATRIX.md`。
- [x] Runtime Registry 后端、Hermes 参考运行时、任务 start/get/cancel IPC 已完成，并通过目标测试与类型检查。
- [ ] 清理和归档当前工作树的全部改动，形成可回滚的 Hermes 基线提交。

## P0：基线验收与接口冻结

| ID | 任务 | 实现负责人 | 验收负责人 | 完成定义 |
| --- | --- | --- | --- | --- |
| P0-01 | 远程 Hermes 回归矩阵 | Codex | Codex | [x] Chat、sessions、models、tools、skills、memory、gateway 分别记录可用性与降级路径。 |
| P0-02 | Dashboard HTTP/WS 分离测试 | Subagent | Codex | [x] HTTP 管理 API 可用 + WS 404/403 时，聊天自动走 legacy，管理页面仍可用。 |
| P0-03 | 远程改动安全审查 | Codex | Codex | [x] 凭据不泄露；TLS 例外只允许已配置的远程主机；IPC 无本地静默回退。 |
| P0-04 | 当前基线构建验收 | Codex | Codex | [x] `typecheck`、目标测试、`build` 通过；间歇性失败单独复跑并留痕。 |

## P1：统一 Runtime Registry

| ID | 任务 | 实现负责人 | 验收负责人 | 完成定义 |
| --- | --- | --- | --- | --- |
| P1-01 | 共享运行时类型与能力模型 | Codex | Codex | [x] 新增 `agent-runtimes` 类型，能力、状态、运行任务模型有目标测试覆盖。 |
| P1-02 | Runtime Registry 与配置校验 | Codex | Codex | [x] 可保存/读取/删除用户运行时；秘密字段被拒绝，内置 Hermes 不序列化 API key。 |
| P1-03 | HermesRemoteAdapter | Codex | Codex | [x] 用统一接口完成 health、capabilities、最小 task dispatch，并支持查询/取消。 |
| P1-04 | IPC 与 preload 白名单 | Codex | Codex | [x] Renderer 只能通过 list/save/remove/probe/start/get/cancel 白名单访问运行时。 |
| P1-05 | Agent Runtimes 最小 UI | Subagent | Codex | 可新增、编辑、探测、禁用一个 Runtime，状态明确可扫描。 |

## P2：OpenClaw 接入

| ID | 任务 | 实现负责人 | 验收负责人 | 完成定义 |
| --- | --- | --- | --- | --- |
| P2-01 | 与远程 OpenClaw 对齐 bridge 协议 | Codex + 用户 | Codex | 获得不含密钥的端点、请求、响应、认证和事件流样例。 |
| P2-02 | OpenClaw mock bridge | Subagent | Codex | [x] 本地 HTTP mock 覆盖 health、任务成功、非 2xx、超时、取消和路径编码。 |
| P2-03 | OpenClawAdapter | Subagent | Codex | [x] 后端支持探测、派发、查询轮询和取消，并已接入 Runtime Registry。 |
| P2-04 | 真实 OpenClaw 联调 | 用户 + Codex | Codex | 真实任务产生可回看的结果与安全错误信息。 |

## P3：本地 Claude Code 与 Codex

| ID | 任务 | 实现负责人 | 验收负责人 | 完成定义 |
| --- | --- | --- | --- | --- |
| P3-01 | CLI preflight 与工作区策略 | Subagent | Codex | 发现 CLI、读取版本、校验目录；不执行任务。 |
| P3-02 | CodexCliAdapter | Subagent | Codex | 在临时工作区完成只读分析任务，支持 timeout/cancel。 |
| P3-03 | ClaudeCodeAdapter | Subagent | Codex | 在临时工作区完成只读分析任务，支持 timeout/cancel。 |
| P3-04 | 子进程安全测试 | Subagent | Codex | 参数数组、环境白名单、路径校验、输出截断均受测。 |

## P4：任务编排与发布

| ID | 任务 | 实现负责人 | 验收负责人 | 完成定义 |
| --- | --- | --- | --- | --- |
| P4-01 | Task/Assignment/Artifact/Event 模型 | Subagent | Codex | 任务全生命周期可保存并恢复。 |
| P4-02 | 手动编排流程 | Subagent | Codex | 用户可选择运行时、确认交接、查看时间线。 |
| P4-03 | 跨运行时集成测试 | Codex | Codex | Hermes + OpenClaw、Hermes + Codex 两条链路各通过一次。 |
| P4-04 | Windows 便携发布验收 | Codex | Codex | 新用户目录 smoke、配置迁移、构建产物启动均通过。 |

## 执行规则

1. Subagent 只领取一个 ID 对应的任务包，不顺手重构其他模块。
2. 每个任务包必须包含：变更文件清单、测试命令、已知限制、无密钥的 mock/fixture。
3. Codex 在合并前执行接口审查、冲突解决、目标测试、类型检查、构建和真实/模拟 smoke。
4. 任何协议、凭据存储、CLI 启动方式或 IPC 新增能力，必须在编码前由 Codex 冻结接口后再实现。
5. 未通过 P0 前，不启动 P1 的实现；未通过 P2 mock 验收前，不连接真实 OpenClaw。

## 2026-07-10 update

- [x] P1-05 Agent Runtimes minimal UI completed in Settings -> Runtimes.
- [x] Renderer can list built-in/user runtimes, add/save a non-secret user runtime, enable/disable it, probe health/capabilities, and remove user runtimes.
- [x] UI regression test added: `src/renderer/src/components/settings/AgentRuntimesPane.test.tsx`.
- [x] Validation run passed: `npm.cmd test -- src/renderer/src/components/settings/AgentRuntimesPane.test.tsx tests/agent-runtimes.test.ts tests/openclaw-runtime.test.ts` (3 files / 15 tests).
- [x] Production build passed with `npm.cmd run build`.
- [ ] P2-04 remains pending until a real OpenClaw bridge endpoint is available for live integration.

## 2026-07-11 update

- [x] Added detailed executable task plan: `docs/AGENT_CONSOLE_DETAILED_TASK_PLAN.md`.
- [x] Restored validation chain after the earlier Windows/esbuild `spawn EPERM` startup issue.
- [x] `npm.cmd run typecheck` passed.
- [x] Targeted tests passed: `tests/messaging-platforms-remote.test.ts`, `tests/agent-runtimes.test.ts`, `tests/openclaw-runtime.test.ts`, `src/renderer/src/components/settings/AgentRuntimesPane.test.tsx` (4 files / 17 tests).
- [x] `npm.cmd run build` passed.
- [x] Remote Gateway messaging API HTML fallback is now documented and covered by test; Gateway should render read-only instead of crashing.
- [ ] Next: confirm real OpenClaw bridge endpoint and run live probe/task dispatch.
