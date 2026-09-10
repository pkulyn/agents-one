# 项目协作控制面契约

状态：**Phase 3 基础实现完成；Phase 4 联调与跨 Runtime 验收进行中**
对应路线图：[Agents One 五阶段实施计划](./AGENTS_ONE_FIVE_PHASE_PLAN.md) 的 Phase 3、4。
前置条件：完成 Phase 2 的真实 OpenClaw Bridge 联调后才能开始实现。

## 目标与边界

Agents One 是项目协作的确定性控制面，不是某个模型的代理外壳。用户选择项目经理 Runtime；控制面负责验证、存储、审计和执行边界。

- 现有 Chat、Cron、Kanban、Hermes 任务与 Task Center 保持原有工作流，不做隐式迁移。
- `TaskCenterTask` 继续代表一次直接派发；项目任务使用新的 `ProjectTask`，两者可由显式引用关联。
- 项目经理可**提出**计划、分配、上下文请求和验收建议，但不能直接写数据库、读取凭据、访问未获授权的工作区，或跳过状态机。
- CLI Runtime 的写入始终只能在控制面创建的 Git worktree 内发生；非 Git 工作区只允许分析任务。

## 实体模型

所有 ID 均由控制面生成，时间使用 UTC epoch milliseconds。正文与产物内容受限长度、经过脱敏，并采用 append-only 审计事件记录。

```ts
type CoordinatorKind = "runtime" | "human";
type ProjectRole =
  | "manager"
  | "implementer"
  | "tester"
  | "reviewer"
  | "acceptor";
type ProjectStatus = "draft" | "active" | "paused" | "completed" | "cancelled";
type ProjectTaskStatus =
  | "blocked"
  | "ready"
  | "queued"
  | "running"
  | "review_required"
  | "accepted"
  | "rejected"
  | "failed"
  | "cancelled"
  | "timed_out";

interface Project {
  id: string;
  title: string;
  objective: string;
  status: ProjectStatus;
  coordinator: CoordinatorAssignment;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

interface CoordinatorAssignment {
  kind: CoordinatorKind;
  runtimeId?: string; // required only when kind === "runtime"
  assignedBy: "user" | "control_plane";
  assignedAt: number;
}

interface ProjectTask {
  id: string;
  projectId: string;
  parentTaskId?: string;
  title: string;
  requirement: string;
  acceptanceCriteria: string;
  status: ProjectTaskStatus;
  dependencies: string[];
  assignment?: TaskAssignment;
  contextPackageId?: string;
  directTaskCenterTaskId?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

interface TaskAssignment {
  runtimeId: string;
  role: ProjectRole;
  requestedBy: "user" | "coordinator";
  assignedAt: number;
  workspace?: string;
  mode: "analysis" | "implementation";
}

interface ArtifactReference {
  id: string;
  projectId: string;
  taskId?: string;
  kind: "worktree" | "diff" | "test_report" | "summary" | "file" | "link";
  label: string;
  sourceRuntimeId?: string;
  path?: string;
  content?: string;
  createdAt: number;
}

interface TaskEvent {
  id: string;
  projectId: string;
  taskId?: string;
  type:
    | "project_created"
    | "coordinator_changed"
    | "task_created"
    | "task_assigned"
    | "task_status_changed"
    | "progress"
    | "question"
    | "handoff"
    | "review"
    | "acceptance"
    | "artifact_published"
    | "context_requested";
  actor: { kind: "user" | "runtime" | "control_plane"; runtimeId?: string };
  summary: string;
  payload?: Record<string, unknown>; // schema-validated, no credentials
  createdAt: number;
}
```

## 状态机

```text
blocked -- dependencies accepted --> ready --> queued --> running
  ^                                  |          |          |
  |                                  |          |          +--> review_required
  |                                  |          |                     |
  +----------- rejected -------------+          |                     +--> accepted
                                                |                     +--> rejected --> ready
                                                +--> failed | timed_out | cancelled
```

控制面是唯一可提交状态转换的一方：

| 转换                                   | 必须条件                                                        |
| -------------------------------------- | --------------------------------------------------------------- |
| `blocked -> ready`                     | 所有依赖均为 `accepted`，项目为 `active`。                      |
| `ready -> queued`                      | 有有效 Runtime 分配，且 Runtime probe 显示 `taskDispatch`。     |
| `queued -> running`                    | 控制面创建了对应的 Runtime run。                                |
| `running -> review_required`           | 运行成功并产生需要人工/审查角色确认的产物。                     |
| `review_required -> accepted/rejected` | 具备 `acceptor` 角色的用户或获准 Runtime 提交带摘要的验收事件。 |
| `rejected -> ready`                    | 保留拒绝理由与先前产物，新一轮运行必须获得新的 run ID。         |
| 任意非终态 -> `cancelled`              | 用户取消，或控制面按授权取消。                                  |

`succeeded` 不作为项目任务的终态；完成实现后应进入 `review_required` 或在明确无需审查的分析任务中由控制面转为 `accepted`。

## 项目经理的受控操作

项目经理 Runtime 只能通过受控的控制面操作提交意图，不能调用内部存储：

```ts
type CoordinatorCommand =
  | {
      type: "propose_task";
      projectId: string;
      title: string;
      requirement: string;
      acceptanceCriteria: string;
      dependencies?: string[];
    }
  | {
      type: "propose_assignment";
      taskId: string;
      runtimeId: string;
      role: ProjectRole;
      mode: "analysis" | "implementation";
      workspace?: string;
    }
  | {
      type: "request_context";
      taskId: string;
      artifactIds?: string[];
      includeProjectSummary?: boolean;
    }
  | { type: "publish_progress"; taskId: string; summary: string }
  | {
      type: "propose_review";
      taskId: string;
      reviewerRuntimeId?: string;
      summary: string;
    }
  | {
      type: "propose_acceptance";
      taskId: string;
      decision: "accepted" | "rejected";
      summary: string;
    };
```

控制面逐项校验：项目归属、当前状态、依赖、Runtime 存在且启用、`taskDispatch` 能力、工作区边界、角色授权、输入长度和秘密字段。校验失败只产生安全诊断事件，不执行副作用。

## 上下文包与智能体邮箱

上下文不是共享整个聊天历史，而是控制面生成的不可变包：

```ts
interface ContextPackage {
  id: string;
  projectId: string;
  taskId: string;
  version: number;
  requirement: string;
  acceptanceCriteria: string;
  projectSummary?: string;
  workspace?: { reference: string; kind: "repository" | "worktree" };
  artifacts: ArtifactReference[];
  upstreamSummaries: Array<{ taskId: string; summary: string }>;
  createdAt: number;
}
```

禁止放入 Context Package 的内容：认证 Token/API Key、完整系统提示词、未获引用的聊天记录、其他项目数据、任意 Runtime 的环境变量、未脱敏错误堆栈。

邮箱由 `TaskEvent` 实现，而不是点对点网络连接：任务分配、进度、问题、交接、审查和验收都以结构化 append-only 事件写入。下游 Runtime 只能读取被分配任务的事件摘要与显式引用的 Context Package。

## 持久化、兼容与迁移

- 新建 `project-control.json` 覆盖缓存和 SQLite 表/版本迁移；读取错误时降级为只读缓存且不清除历史。
- 首版项目与 Task Center 只使用引用关联，绝不改写既有 `task-center.json` 或聊天会话文件。
- 所有写入使用原子安全写；每次状态改变同时写入 `TaskEvent`。
- 迁移失败时保留原数据库/JSON，显示可诊断、无凭据的错误，并禁止新建项目而非静默丢失记录。

## Phase 3/4 验收用例

1. 用户创建项目并选择 Hermes、Codex、Claude Code 或人工为项目经理；无 `orchestration` 能力的 Runtime 不可被自动选择为 Runtime 项目经理。
2. 项目经理提出任务与分配，控制面拒绝无效 Runtime、无效状态转换、非 Git 实现型任务和越界工作区。
3. Codex 实现任务产生 worktree/diff；Claude Code 审查通过 Context Package 引用获取必要信息，不能读原始凭据或全部聊天。
4. 审查拒绝后任务回到 `ready`，保留旧产物与拒绝事件；再次运行产生新的 run/产物。
5. 重启应用后项目、任务、事件、上下文包和产物引用恢复；存储失败时保留只读历史。

## 2026-07-12 实现记录

- 已新增按 Profile 隔离的 `desktop/project-control.json`，以原子写入保存项目、任务、事件、上下文包和产物引用；该存储与既有聊天、Cron、Kanban、Task Center 数据互不覆盖。
- `Project` 支持用户选择 Human 或任一已启用 Runtime 作为协调者；协调者的“Plan”操作会创建一个普通、可审计的分析型项目任务并通过 Task Center 执行，不授予该 Runtime 直接写入控制面或读取凭据的权限。
- 项目任务支持父子关系、同项目依赖、角色分配、分析/实现模式、取消、重试、人工接受/拒绝和从 Task Center 回写的状态同步。实现模式仍只允许 Codex 与 Claude Code。
- 上下文包只包含本任务需求、验收标准、选定工作区引用、依赖任务的事件摘要和产物引用。不会复制原始任务输出、完整聊天、Token 或 API Key；Task Center 产物也只保存安全引用，不复制 artifact 内容。
- 当前的事件时间线由控制面写入 `TaskEvent`。自动解析项目经理输出并自动创建/分配下游任务尚未启用，后续只会以“提案 -> 用户审阅 -> 控制面校验”的方式增加。
- 2026-07-12 的真实 Hermes 协调者联调证明：该远端任务接口会让智能体自行调用工具，提示词不能强制只读边界。Projects 因此只对本地 Codex/Claude Code 开放自动“Plan”；Hermes 与 OpenClaw 仍可作为协调者，但必须经人工对话/手工任务编排，直到其 Bridge 提供可验证的无工具只读规划模式。
