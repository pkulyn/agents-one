# Agents One 多智能体集成执行方案

日期：2026-07-10

## 目标

将 Agents One 演进为统一的多智能体工作台：保留既有会话、设置、日志、工具和远程连接能力，同时以统一 Runtime 协议接入远程 Hermes Agent Runtime、远程或本地 OpenClaw、本地 Claude Code 和本地 Codex。

本阶段不重建第二套桌面 UI，也不把某一个智能体当作其他智能体的隐式代理。所有运行时均通过明确的适配器接入，任务编排与实际执行分离。

## 已确认基线

- 远程 Hermes 已完成真实对话与任务联调。
- 远程 Dashboard 的管理 HTTP API 可用；聊天 WebSocket 经 NAS 反向代理不可用时，客户端应保持 legacy chat 回退，不将其判为整体连接失败。
- 现有 Claw3D/OpenClaw 集成主要是可视化、安装迁移和只读 HQ 看板，不是可派发任务的通用 OpenClaw Runtime。
- 当前工作树已有远程 Dashboard、TLS 限域、远程 Memory/Skills/Tools 支持等未提交改动；后续实现必须以此基线工作，不回退或覆盖它们。

## 目标架构

```text
Renderer: Chat / Tasks / Agent Runtimes / Observability
                         |
                  Electron IPC boundary
                         |
             Runtime Registry + Dispatch Service
                         |
  +----------------------+-----------------------+-------------------+
  |                      |                       |                   |
HermesRemoteAdapter  OpenClawAdapter        CodexCliAdapter   ClaudeCodeAdapter
  |                      |                       |                   |
Remote Hermes API    HTTP bridge or local     local CLI           local CLI
                     OpenClaw process
```

Agents One 负责保存非秘密配置、凭据引用、运行状态、任务记录、事件时间线和产物索引。凭据只保存在现有受保护配置位置，不进入日志、调试导出、测试 fixture 或 Git。

## 统一运行时契约

第一版采用能力驱动，而非要求所有智能体支持同一套功能。每个 Adapter 必须实现：

```ts
type AgentRuntimeAdapter = {
  kind: "hermes" | "openclaw" | "codex" | "claude-code";
  health(): Promise<RuntimeHealth>;
  capabilities(): Promise<RuntimeCapabilities>;
  startSession?(input: StartSessionInput): Promise<RuntimeSession>;
  sendMessage?(input: SendMessageInput): AsyncIterable<RuntimeEvent>;
  runTask(input: RunTaskInput): Promise<RuntimeRun>;
  streamEvents?(runId: string): AsyncIterable<RuntimeEvent>;
  cancelTask?(runId: string): Promise<void>;
  listTools?(): Promise<RuntimeTool[]>;
};
```

`RuntimeCapabilities` 至少声明 `chat`、`taskDispatch`、`streaming`、`cancellation`、`tools`、`memory`、`artifacts`、`workspaceAccess`。不支持某能力时 UI 显式降级，不能伪造成功，也不能因为某个可选端点不可用而破坏聊天。

任务状态统一为 `queued -> running -> succeeded | failed | cancelled | timed_out`。所有失败需归入 `auth`、`network`、`protocol`、`runtime`、`validation` 或 `cancelled`，并保留安全的诊断摘要。

## 实施顺序

### Milestone 0：远程 Hermes 基线封板

目标是把已跑通的远程 Hermes 固定为后续适配器的回归基线。

- 为 Dashboard HTTP 可用但 WebSocket 不可用的组合补齐回归测试。
- 确认 Provider、Gateway、Tools、Memory、Skills 在 remote mode 下各自使用正确的 Dashboard API 或明确显示能力缺失。
- 建立一份不含真实密钥的远程 Hermes smoke checklist。

退出条件：远程 Hermes 聊天、会话、Dashboard 管理能力和 legacy chat 回退均有自动化或可重复的人工验收记录。

### Milestone 1：Runtime Registry 与协议冻结

目标是先创建稳定的边界，避免为每个智能体各做一套 IPC、配置和 UI。

- 新增共享类型 `src/shared/agent-runtimes.ts`。
- 新增 `src/main/agent-runtimes/`，包含类型、注册表、配置校验、健康探测和统一错误映射。
- 定义 IPC：列出、保存、删除、探测运行时，以及派发、查询、取消任务。
- 先用 `HermesRemoteAdapter` 复用现有远程 Hermes 调用，作为契约的参照实现。

退出条件：注册表能够枚举一个 Hermes Runtime，执行 health/capability probe，并可用统一 API 派发一项最小任务。

### Milestone 2：OpenClaw 最小闭环

目标是验证通用远程 Agent 接入模型，优先完成 HTTP bridge，不依赖 Claw3D 看板。

- 定义 OpenClaw bridge 最小协议：`GET /health`、`GET /capabilities`、`POST /tasks`、`GET /tasks/:id`，可选 `GET /tasks/:id/events` 与 `POST /tasks/:id/cancel`。
- 实现 `OpenClawAdapter` 的 HTTP transport、鉴权、超时、轮询/事件流和产物映射。
- 为无 streaming、无 cancel、任务超时、认证失败和协议不兼容分别编写测试。
- 以一个真实 OpenClaw 运行时和一个 mock bridge 做联调。

退出条件：用户可在 Agent Runtimes 中配置 OpenClaw，健康检查成功后派发任务并在任务详情看到状态、输出和失败原因。

### Milestone 3：Claude Code 与 Codex CLI 适配器

目标是把本机编码智能体作为受控运行时接入，而非通过不受约束的 shell 命令拼接。

- 增加 CLI preflight：可执行文件发现、版本读取、登录/认证状态、工作目录可访问性。
- 使用参数数组启动子进程，禁止 `shell: true`；输入、工作目录、环境变量采用白名单校验。
- 以 JSON/结构化输出优先，无法结构化时将 stdout/stderr 映射为受限事件流。
- 默认单工作区、显式并发上限、超时和取消策略；任何写操作由运行时自身的权限模型确认。

退出条件：Claude Code 和 Codex 各能完成一个隔离工作目录下的只读分析任务；输出、取消和错误分类可在 Console 中回看。

### Milestone 4：编排、可观测性与发布验收

目标是把多个已验证的运行时变成可追踪的协作系统。

- 新增 Task/Assignment/Artifact/Event 数据模型，初期可使用现有本地 SQLite 层。
- 支持手动选 Agent、串行委派和人工确认的交接；自动路由和并行 fan-out 延后。
- 提供任务时间线、运行日志关联、重试边界和产物链接。
- 完成 Windows 便携构建、升级/降级、真实运行时 smoke 和回归测试矩阵。

退出条件：一次 Hermes + OpenClaw 或 Hermes + Codex 的协作任务可创建、派发、回收、审计和导出，且不破坏现有 Hermes 体验。

## 职责划分

| 责任 | 负责人 | 交付要求 |
| --- | --- | --- |
| 架构契约、任务拆分、接口冻结 | Codex | 在实现前审阅类型、IPC 和错误模型 |
| 单个 Adapter 的代码实现 | Subagent | 仅修改任务包范围，附单元测试与变更说明 |
| 安全审查与集成 | Codex | 检查凭据、子进程、IPC、输入校验和回归风险 |
| 测试与验收 | Codex | 运行目标测试、类型检查、构建、smoke，并记录结果 |
| 真实环境联调 | 用户 + Codex | 用户提供运行时可达性，Codex 验证协议与行为 |

## 不做的事

- 不把 Dashboard WebSocket 失败误判为远程 Hermes 整体失败。
- 不为 OpenClaw、Claude Code、Codex 分别建立孤立的设置和任务页面。
- 不把 API key、token、CLI 登录状态写进仓库、日志、截图或测试快照。
- 不在未完成单运行时回归前引入自动多 Agent 路由。
- 不在没有协议探测和 mock 测试的情况下直接绑定某个远程 OpenClaw 私有 API。

## 总体验收标准

1. 已有远程 Hermes 工作流保持可用，且 Dashboard 失败时可以回退到 legacy chat。
2. 四类 Runtime 在统一注册表中可被识别、探测和安全配置。
3. OpenClaw、Claude Code、Codex 至少各完成一个端到端最小任务闭环。
4. 所有运行任务具有状态、事件、错误类别和产物引用；取消与超时不遗留后台进程。
5. `typecheck`、相关单元测试、生产构建和 Windows smoke 均通过；任何已知不稳定测试单独记录，不能被静默忽略。
