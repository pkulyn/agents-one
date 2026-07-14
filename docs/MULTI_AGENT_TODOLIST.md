# Hermes One Phase 4 后半段 Todolist

日期：2026-07-14

状态标记：`[ ]` 待开始，`[~]` 进行中，`[x]` 已完成，`[!]` 阻塞。

## 当前基线

- [x] Phase 3/4 集成基线已提交：`c776a63 Integrate Hermes One phase 3 and 4 baseline`。
- [x] 远程 Hermes Bridge 已完成 `orchestration/readOnlyPlanning/cancellation/artifacts/securityEvents` 能力探测与真实只读规划 smoke test。
- [x] 远程 OpenClaw Bridge 已完成同等能力探测与真实只读规划 smoke test。
- [x] Hermes -> Codex analysis 端到端测试已通过。
- [x] OpenClaw -> Codex implementation 端到端测试已通过；Codex 在隔离 Git worktree 产出 diff，原工作区未被直接修改。

## P4-H1：Task Center 审查能力增强

| ID | 状态 | 任务 | 完成定义 |
| --- | --- | --- | --- |
| H1-01 | [x] | 展示审查重点 | Task Center 清晰展示 final response、diff artifact、worktree artifact、错误和运行日志。 |
| H1-02 | [x] | 完善验收入口 | `review_required` 任务同时支持 Accept 与 Reject，并展示当前验收状态。 |
| H1-03 | [x] | 改善 artifact 操作 | worktree 可打开，diff 可复制和查看；后续可接入“应用 diff”，但默认不自动合并。 |
| H1-04 | [x] | 测试覆盖 | UI 测试覆盖 diff 展示、accept/reject、worktree 打开和日志折叠。 |

## P4-H2：从 Coordinator Plan 半自动生成项目任务

| ID | 状态 | 任务 | 完成定义 |
| --- | --- | --- | --- |
| H2-01 | [x] | 解析远程计划 artifact | 从 Hermes/OpenClaw 的结构化 plan 中提取建议任务、Runtime kind、角色、模式和验收标准；非结构化文本降级为一条人工复核任务。 |
| H2-02 | [x] | 用户确认后创建任务 | Project Center 提供 Preview tasks / Create tasks 两步入口；用户确认后才创建 Project tasks。 |
| H2-03 | [x] | 映射 Runtime 与角色 | 已保存 `suggestedRuntimeKind`、`suggestedRole`、`suggestedMode`；Project Center 会按建议 Runtime kind 优先筛选候选 Runtime，并默认带出建议角色与模式，但仍不自动派发。 |
| H2-04 | [x] | 回归测试 | 已覆盖结构化计划、非结构化计划降级、空 artifact、重复生成保护、UI 预览/创建和建议 Runtime 默认填充。 |

## P4-H3：Claude Code Adapter 验收

| ID | 状态 | 任务 | 完成定义 |
| --- | --- | --- | --- |
| H3-01 | [x] | 本地能力探测 | 已探测 Claude Code CLI 路径、版本、登录状态和默认工作区；本机 `claude auth status` 显示已登录。 |
| H3-02 | [x] | Analysis 模式 | Claude Code 使用 `--permission-mode plan` 执行只读分析任务，输出进入 Task Center，并过滤启动/Hook 元数据。 |
| H3-03 | [x] | Implementation 模式 | 复用 Codex worktree 隔离策略，使用 `acceptEdits` 仅在隔离 worktree 中执行，产出 worktree/diff artifact。 |
| H3-04 | [x] | 取消与超时 | 已覆盖 cancel、timeout、输出截断和失败状态归档。 |

## P4-H4：安全、恢复与运维

| ID | 状态 | 任务 | 完成定义 |
| --- | --- | --- | --- |
| H4-01 | [x] | 输出脱敏 | Task Center 在存盘前统一脱敏日志、错误、diff/final artifact 中的 Token、API Key、Authorization Header、Cookie。 |
| H4-02 | [x] | 重启恢复 | 应用重启后，遗留 running 任务明确标记为 failed/recoverable，不丢历史。 |
| H4-03 | [x] | Worktree 管理 | Task Center 可列出、打开、清理旧 worktree；清理动作需要用户确认，且不能清理运行中或待验收任务的 worktree。 |
| H4-04 | [x] | 发布前回归矩阵 | 已建立发布前回归矩阵，覆盖 Hermes/OpenClaw coordinator、Codex/Claude execution、取消、超时、断网与重连。 |

## 执行规则

1. 远程 Hermes/OpenClaw 只能通过 Bridge 的强制只读规划接口担任 coordinator。
2. Codex/Claude Code 的 implementation 任务只能写隔离 Git worktree。
3. Hermes One 不自动提交、不自动合并、不自动应用 diff。
4. `review_required` 必须由用户或显式验收动作转为 accepted/rejected。
5. 每个开发包完成后必须运行定向测试；影响面较大时运行完整相关回归和构建。
