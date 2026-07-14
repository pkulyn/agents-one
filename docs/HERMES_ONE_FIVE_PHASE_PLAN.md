# Hermes One 五阶段实施计划

日期：2026-07-12

## 与前一版计划的关系

本计划**继承并扩展**此前的《Hermes One 五阶段实施计划》，不是推翻重来。

- 前一版解决基础问题：远程 Hermes 稳定性、本地数据层、统一 Runtime、Codex worktree、Task Center 和 Windows 验收。
- 本版保留上述严格顺序，并把已经明确的产品方向写入后续阶段：**Hermes One 是稳定的协作控制面；项目经理智能体由用户按项目指定，而不是写死为 Hermes。**
- 前一版的首个里程碑仍有效：**Hermes + 本地 Codex + Task Center**。当前已完成其大部分实现和真实 Codex 冒烟验证。
- 本版新增的重点是 Phase 3、4：项目经理可选、任务图、智能体邮箱、按需上下文包、角色协作和跨 Runtime 项目验收。

## 总体产品方向

Hermes One 是多智能体工作台，而不是固定由 Hermes 指挥其他智能体的单向命令链。

- **Hermes One 控制面**负责持久化项目状态、权限、队列、任务生命周期、事件历史、产物、重试、取消和人工审批。任何模型均不能绕过这些控制。
- **项目经理智能体**由用户按项目或父任务选择。Hermes 是默认值，但 Codex、Claude Code、OpenClaw 或用户本人均可承担该角色。
- **执行智能体**仅接收完成当前任务所需的上下文包，并通过 Hermes One 回传进度、摘要、产物、diff、测试报告和安全诊断信息。
- 日常工作保持在对话或项目视图；Task Center 是复杂多智能体任务的编排台，不是所有请求的默认入口。

```text
用户 -> 项目（指定 coordinatorRuntimeId）
               |
               v
Hermes One 控制面 -> 任务图 / 智能体邮箱 / 上下文包 / 产物
               |                    |                    |
               v                    v                    v
         Hermes 智能体          Codex 智能体        Claude/OpenClaw 智能体
```

## 核心协作约定

每个项目增加 `coordinatorRuntimeId`；每个任务具有父子关系、执行分配、依赖、生命周期和不可变交接记录。项目经理可以提出计划并请求受控操作，但每一项状态变更均由 Hermes One 校验后才会提交。

| 概念 | 实施要求 |
| --- | --- |
| 项目经理 | 每项目可选择 Runtime；Hermes 为默认值，不是唯一选择。 |
| 任务图 | 支持父子任务、依赖、重试、超时、取消、审查和人工审批。 |
| 智能体邮箱 | 使用结构化事件传递分配、进度、问题、交接、产物、审查和完成信息。 |
| 上下文包 | 仅包含需求、验收标准、工作区/worktree 引用、选定的上游摘要和产物引用；不默认共享完整对话或密钥。 |
| 产物 | diff、测试报告、文件、摘要和链接均作为不可变任务输出，供下游智能体按引用获取。 |
| 权限 | 项目经理与执行智能体按能力授权；凭据始终留在受保护的存储中，不进入任务提示词、日志或产物。 |

## Phase 1：Hermes 与数据基础

**目标：** 在扩展协作能力前，先确保远程 Hermes、本地会话数据、诊断和离线恢复足够稳定。

- 固化 Dashboard、API、WebSocket 的错误分类、重连、超时、远程会话缓存和消息对账。
- 继续使用 `node:sqlite` 兼容层与 JSON 覆盖缓存，确保 Electron 版本变化、应用重启和远端故障不会丢失数据。
- 保持可读会话标题和完整用户消息；将自动化/定时任务会话从常规聊天导航中隔离。
- 建立可重复的远端故障矩阵：Dashboard 重启、短暂 WebSocket 中断、502/403 恢复。

**验收门槛：** 远程 Hermes 对话、任务和历史记录在故障后可恢复，不泄露 Token、API Key 或完整认证请求。当前实现已基本完成，剩余为发布环境下的可重复验证。

**当前自动化证据：** 远程 Dashboard/认证回退/缓存/HTML 降级回归共 46 项通过；SQLite 兼容、JSON 覆盖缓存和远程会话缓存回归共 34 项通过。Dashboard 重启、真实短暂 WebSocket 中断及 NAS 侧 502/403 恢复仍需在远端维护窗口按 [Phase 1 故障复验手册](./PHASE1_REMOTE_FAULT_RUNBOOK.md) 手工复验。

## Phase 2：Runtime 对齐与本地智能体安全执行

**目标：** 将外部智能体作为能力诚实、边界明确的 Runtime 接入。

- 保持统一 Adapter 契约：`probe`、`start`、`get`、`cancel`、能力、事件、错误和产物。
- 完成 Codex 实现型任务在受管 Git worktree 中的验收，覆盖 Windows 进程树取消、diff 采集、审查和重试。
- 实现 Claude Code，复用 Codex 的预检、worktree、环境变量白名单、输出脱敏、取消和产物契约。
- 扩展能力模型，区分 `chat`、`taskDispatch`、`orchestration`、`mailbox`、`memory`、`artifacts` 与 `workspaceAccess`；不支持时必须显式降级。
- OpenClaw 保持在明确的 Bridge 协议之后；仅在获得端点和认证语义后完成真实联调。

**验收门槛：** Hermes、Codex、Claude Code 都可以注册、探测和安全执行，并各有真实端到端冒烟记录；OpenClaw 要么通过真实 Bridge 验收，要么明确展示不可用原因。

## Phase 3：可指定的项目经理

**目标：** 将 Hermes One 的持久化控制面与用户指定的项目经理智能体分离。

- 新增 `Project`、`CoordinatorAssignment`、`Task`、`TaskAssignment`、`TaskEvent` 与 `ArtifactReference` 数据模型。
- 创建项目时由用户选择项目经理：默认 Hermes，也可为 Codex、Claude Code、OpenClaw 或人工管理。
- 提供受控的项目经理操作：创建/修改任务、分配具备资格的 Runtime、请求上下文包、请求审查、提出交接；Hermes One 校验权限、工作区范围和生命周期转换。
- 对 CLI 智能体先采用“计划 - 执行 - 回传摘要 - 再决策”的编排模式；Hermes 可额外支持持续对话式项目管理。
- 保持现有聊天、Kanban、计划任务和直接 Runtime 执行；项目只与它们关联，不替代它们。

**验收门槛：** 同一项目可选择 Hermes 或 Codex 作为项目经理，且不改变任务存储、审计、权限和执行器 UI；项目经理不能直接读取密钥、修改无关工作区或绕过审批。

## Phase 4：按需上下文共享与多智能体协作

**目标：** 让智能体通过受控交接协作，而非无限制共享上下文。

- 实现可版本化的上下文包：任务需求、验收标准、选定项目摘要、工作区/worktree 引用和产物引用。
- 增加任务邮箱/时间线，记录结构化进度、问题、交接摘要、审查结果和最终输出。
- 建立依赖感知的任务图：`blocked`、`ready`、`running`、`review_required`、`accepted`、`rejected`、`retried`、`cancelled`。
- 提供项目经理、实现、测试、审查、验收等角色模板；模板只选择所需能力，不强制指定某个 Runtime。
- 形成审查闭环：Codex 提交 diff/测试，Claude Code 或 Hermes 审查，项目经理决定返工或验收，用户在配置要求时保留最终审批权。

**验收门槛：** 复杂项目可完成“项目经理 -> 实现 -> 测试/审查 -> 项目经理”的产物化交接，具有完整审计历史，且不泄露原始凭据或不必要的聊天记录。

## Phase 5：跨 Runtime 发布验收

**目标：** 在 Windows 上验证完整多智能体工作台，并形成可发布的运维基线。

- 执行 Hermes + Codex、Hermes + Claude Code、可选 Codex/Claude 项目经理，以及 OpenClaw（Bridge 就绪后）的跨 Runtime 冒烟场景。
- 验证取消、超时、应用重启恢复、远端重连、worktree 隔离、产物保留、审批与审查拒绝流程。
- 执行安全审查：IPC 白名单、路径包含关系、参数数组启动、环境变量白名单、脱敏、日志上限和受保护凭据。
- 输出 Windows 便携版验证、发布说明、故障恢复手册、Runtime 配置说明和项目协作使用指南。

**验收门槛：** 全量测试、生产构建和 Windows 冒烟通过；至少一个由用户指定项目经理的真实多智能体项目完成并保留可审计产物；不存在未解决的 P0/P1 安全或数据丢失问题。

## 当前优先级

1. 基于已冻结的 [项目协作控制面契约](./PROJECT_COORDINATION_CONTRACT.md) 实现 Project、受控项目经理和任务图。
2. 实现上下文包、结构化交接事件和项目时间线。
3. 完成跨 Runtime 协作、Windows 发布验收与运行手册。

## 2026-07-12 Phase 2 验证记录

- Claude Code `2.1.185` 已以本机用户级安装验证。Adapter 使用参数数组和 `shell: false`；Windows 的 `claude.cmd` / `claude.ps1` 包装会解析为安装目录内的 `claude.exe`。
- Codex `0.144.1` 已以用户级安装验证。Windows 的 `codex.cmd` 包装会解析为同目录 `node.exe` 与 Codex JavaScript 入口，避免 `spawn EINVAL`；真实 `workspace-write` 冒烟仅在临时 detached worktree 内创建了指定文件，原项目目录未被写入，随后已清理测试 worktree。
- 分析任务固定使用 `--permission-mode plan`；实现任务仅在 Hermes One 创建的 detached Git worktree 内使用 `acceptEdits`，不使用绕过权限模式。
- 已完成真实实现型冒烟：Claude Code 在临时 detached worktree 中创建了一个指定测试文件，原项目工作区无该文件或其他改动；临时 worktree 随即移除。
- Claude 的 SessionStart 钩子会输出大量本地启动元数据；Adapter 在持久化和展示前过滤系统启动事件，仅保留助手、工具、错误和最终结果事件。
- Runtime 能力模型现在显式包含 `orchestration` 与 `mailbox`；在项目协作功能实装前，Hermes、Codex、Claude Code 与 OpenClaw 均报告为 `false`，避免将普通任务派发误判为可协调或可接收交接事件。
- OpenClaw Bearer Token 通过运行时 ID 派生的 secrets-provider 键保存；远程 Runtime 配置和 Renderer 只持有端点与“凭据是否已配置”状态，Bridge 请求由主进程附加认证头。
- 真实 OpenClaw Bridge 已完成健康探测、Task Center 成功任务和运行中任务取消验收。Bridge 返回的能力为 chat、taskDispatch、cancellation、tools、artifacts；未声明的协作能力继续显式降级。

## 2026-07-12 Phase 3/4 实现记录

- 已新增 Projects 工作台和持久化的控制面数据模型：`Project`、`ProjectTask`、`CoordinatorAssignment`、`TaskAssignment`、`TaskEvent`、`ContextPackage` 与 `ArtifactReference`。
- 用户可将 Human、Hermes、Codex、Claude Code 或 OpenClaw 设为项目协调者。协调者的首个实际动作是受控的“Plan”分析任务：它走原有 Task Center 与 Runtime Adapter，产生可审查结果，不会自动派发写入任务或越过人工审批。
- 项目任务可建模父子关系和前置依赖；依赖任务被接受前，下游任务保持 `blocked`。任务可分配到 Runtime、经 Task Center 派发、取消、重试，并将 `review_required` 的接受/拒绝决定同步回原始 Task Center 记录。
- 上下文包与产物只保存按需的摘要、路径和引用，不复制敏感运行输出。Projects 页面提供时间线、产物引用和上下文包预览。
- 已通过项目控制面单元测试、Projects Renderer 测试、类型检查和生产构建。下一项验收是用用户选定的远程 Hermes 或 OpenClaw 作为协调者，联合 Codex/Claude Code 执行一次真实的“规划 -> 实现/分析 -> 审核”项目闭环。
- 真实 Hermes 协调者规划联调已启动并安全取消：远端 Runtime 试图在自己的工作区写入计划，说明当前 API 不提供可强制的只读规划边界。该结果已转化为安全门槛：自动“Plan”仅允许本地 Codex/Claude Code 的受控分析模式；Hermes/OpenClaw 在远端 Bridge 增加 no-tools/read-only 语义前只允许人工协调与手工派发。
- 已吸收 Hermes/OpenClaw 的协议评审意见，补齐默认/最大超时、能力发现端点、并发与幂等、异步取消、清理确认、安全事件查询、artifact 隔离与 TTL，以及 Runtime 枚举。远端 Bridge 所需的 capabilities、接口和验收条件见 [远程协调者 Bridge 能力要求（v1）](./REMOTE_COORDINATOR_BRIDGE_REQUIREMENTS.md)。
- Hermes One 的统一 Runtime 能力模型现已预留 `readOnlyPlanning` 与 `securityEvents`；OpenClaw Adapter 优先探测 `GET /capabilities`，仅在该端点返回 `404` 时回退至兼容的 `GET /health`。专用能力端点的其他失败不会静默回退或误报安全可用。
