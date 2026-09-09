# Agents One 项目与任务中心实施计划

日期：2026-07-16  
状态：**Iteration 0 ～ 5 已完成实现与验收；保留远程 Bridge 协议兼容整改项**  
关联路线图：[Agents One 五阶段实施计划](./AGENTS_ONE_FIVE_PHASE_PLAN.md)
参考：Multica 的任务、项目、看板和实时事件设计仅作为产品/架构参考；Agents One 不复制其前端或服务端源码。

## 1. 目标与边界

Agents One 是一个轻量的多智能体工作台：用户可以与 Hermes、OpenClaw、Codex、Claude Code 等智能体对话，分配任务、查看过程与产物，并在需要时组织多智能体协作完成项目。

本轮不引入独立 Go 服务、PostgreSQL、Redis、Docker 或第二套 Agent Daemon。现有 Electron 主进程、Runtime Adapter、远程 Bridge、受管 worktree 和本地持久化继续作为唯一执行与控制基础。

### 产品原则

- **对话优先**：普通工作在对话中完成；右侧可隐藏任务侧栏展示相关任务、进展、产物和验收。
- **项目化任务**：复杂工作通过项目、任务、依赖和看板组织，不把 Cron、普通对话或底层 Runtime 配置混在同一列表。
- **智能体与运行时分离**：智能体是可命名、可换图标、可配置角色的协作者；Runtime 是 Hermes、Codex、OpenClaw、Claude Code 的连接与执行能力。
- **人工可控**：用户指定协调者与执行者。协调者只能提出计划和调度建议；创建、派发、验收、合并均由控制面和用户确认。
- **受控共享**：只按需共享任务需求、工作区引用、摘要和产物引用；不共享密钥、完整无关对话或未经授权的目录。

## 2. 目标架构

```text
智能体（名称、图标、角色、可用性）
               │ 绑定
Runtime（Hermes / Codex / OpenClaw / Claude Code）
               │ 产生
TaskRun（一次执行：输入、日志、状态、产物）
               │ 归属
Task（业务任务：需求、验收、依赖、负责人）
               │ 归属
Project（目标、协调者、资源、任务图、时间线）
```

### 核心实体与职责

| 实体 | 责任 | 首版关键字段 |
| --- | --- | --- |
| `Agent` | 用户可见的协作者身份 | `id`、名称、图标、颜色、默认 Runtime、角色 |
| `Runtime` | 连接、探测、启动、取消、能力声明 | `id`、种类、位置、能力、健康状态 |
| `Project` | 一项可验收的工程目标 | 标题、目标、协调者、状态、资源引用、关联对话 |
| `Task` | 可独立执行与验收的工作单元 | 需求、验收标准、负责人、依赖、业务状态 |
| `TaskRun` | 某 Runtime 的一次实际运行 | Runtime、输入包、开始/结束、执行状态、日志、退出信息 |
| `TaskEvent` | 统一且可审计的过程时间线 | 排队、进度、工具、提问、产物、失败、验收 |
| `Artifact` | 可供查看或交接的不可变输出 | 摘要、测试报告、diff、文件、链接、worktree 引用 |
| `Schedule` | 计划任务的触发规则 | 手动/Cron/Webhook、并发策略、最近运行、关联任务模板 |

业务状态使用 `待规划 / 待执行 / 执行中 / 待验收 / 已完成 / 受阻 / 已取消`；每次 Runtime 执行仍保留 `queued / running / succeeded / failed / cancelled / timed_out`。两者不可混用。

## 3. 统一任务事件

所有 Runtime 映射为同一套 `TaskEvent`，让 Codex、OpenClaw 的过程反馈与 Hermes 对话中的思考、工具、终端事件保持一致的体验：

| 标准事件 | Hermes | Codex | OpenClaw |
| --- | --- | --- | --- |
| `progress` | Dashboard 思考/阶段事件 | NDJSON turn/item 事件 | Bridge 状态或事件流 |
| `tool_call` / `tool_result` | Skill、Terminal、Execute Code | Codex item/tool 事件 | Bridge 工具事件（能力支持时） |
| `message` | 助手消息 | agent message/final response | 任务输出/最终回复 |
| `artifact_published` | 文件、链接、任务产物 | diff、测试、worktree | Bridge artifact 引用 |
| `blocked` / `question` | 远端提示 | CLI 错误或澄清 | Bridge 错误或澄清 |

未声明流式能力的 Runtime 只能展示“远端执行中 + 轮询状态”，不得伪造工具调用详情。事件进入本地存储前必须脱敏、限制大小，并可在重启后恢复展示。

## 4. 分阶段实施清单

### Iteration 0：品牌与兼容（当前迭代）

| 编号 | 工作 | 验收 |
| --- | --- | --- |
| AO-00 | 安装包、窗口、标题、界面文案和路线图改名为 Agents One | Windows 标题栏、安装项、应用内名称均为 Agents One |
| AO-01 | 保留 Hermes Agent、Bridge、`HERMES_HOME` 等技术兼容标识 | 既有远程连接、会话、任务、工作区和配置不丢失 |
| AO-02 | 更新测试中的品牌断言 | 类型检查和相关测试通过 |

### Iteration 1：任务核心与事件时间线

| 编号 | 工作 | 主要改动 | 验收 |
| --- | --- | --- | --- |
| AO-10 | 版本化控制面存储 | 在现有项目控制面上增加 schemaVersion、迁移和备份；保留旧 Task Center 数据读取 | 升级后已有任务仍可打开 |
| AO-11 | 拆分 Task 与 TaskRun | 任务卡不再直接承载一次 CLI/Bridge 运行记录 | 同一任务可重试并保留每轮输出 |
| AO-12 | 统一 TaskEvent | 主进程将 Hermes、Codex、OpenClaw 的事件归一并持久化 | 三类 Runtime 的过程均可在同一时间线查看 |
| AO-13 | 侧栏关联 | 对话右侧侧栏按当前对话/项目显示任务、进度、产物 | 不压缩主对话区域，可隐藏、可恢复 |
| AO-14 | 安全边界 | 事件、错误、产物统一脱敏与大小限制 | Token、Authorization、Cookie 不出现在 UI 或本地日志 |

### Iteration 2：Task Center 看板与定时任务迁移

| 编号 | 工作 | 主要改动 | 验收 |
| --- | --- | --- | --- |
| AO-20 | 列表/看板双视图 | 按业务状态展示任务；支持按项目、智能体、Runtime、状态筛选 | 拖动或操作菜单仅允许合法状态迁移 |
| AO-21 | 任务详情 | 展示需求、验收标准、执行轮次、时间线、附件、产物与审批 | 不再需要跳转多个页面查一次任务结果 |
| AO-22 | 定时任务迁移 | 现有 Cron 迁入 Task Center 的“计划任务”页，保留原数据兼容读取 | 历史计划不丢失，手动触发和最近运行可见 |
| AO-23 | 并发与失败策略 | `skip / queue / replace`、超时、重试与取消记录 | 同一计划任务不会悄悄并发重复执行 |

### Iteration 3：项目工作台

| 编号 | 工作 | 主要改动 | 验收 |
| --- | --- | --- | --- |
| AO-30 | 项目总览 | 项目目标、状态、协调者、工作目录、关联对话、任务概览 | 一个项目可从总览进入对话、任务、产物 |
| AO-31 | 项目资源 | 受控目录引用、附件、上下文包、产物库 | 资源按项目隔离，敏感内容不可自动扩散 |
| AO-32 | 依赖与阻塞 | 父子任务、前置依赖、阻塞原因和解除记录 | 前置未验收时下游不可派发 |
| AO-33 | 验收闭环 | 审查意见、接受/拒绝、返工轮次和最终产物 | 实现任务在 review 后才可完成 |

### Iteration 4：协作组与指定协调者

| 编号 | 工作 | 主要改动 | 验收 |
| --- | --- | --- | --- |
| AO-40 | 协作组 | 为项目选择协调者、执行者、测试者、审查者、验收者 | Hermes 不是唯一协调者；用户可选择人工、Codex、OpenClaw 或 Claude Code |
| AO-41 | 受控计划 | 协调者生成结构化任务建议；用户确认后才创建/派发 | 不自动路由、不自动合并、不自动执行高风险操作 |
| AO-42 | 上下文交接 | 用摘要与 artifact 引用构建上下文包 | 下游拿到必要信息，不能读取密钥或完整无关对话 |
| AO-43 | 多智能体验收场景 | Hermes 规划/验收，Codex 实现，OpenClaw 调研或测试 | 完成一次可复盘的真实项目闭环 |

### Iteration 5：发布与可维护性

| 编号 | 工作 | 验收 |
| --- | --- | --- |
| AO-50 | 故障恢复 | 应用重启、网络中断、远端重连、运行超时、取消后数据一致 | 未完成任务与历史事件可恢复 |
| AO-51 | Windows 发布验证 | 开发模式、便携版和安装包在普通用户权限下可运行 | 不依赖 Visual Studio 或管理员权限 |
| AO-52 | 使用与运维手册 | Runtime 接入、项目协作、worktree 审核、故障定位 | 用户可独立完成日常配置与验收 |

## 5. 实施顺序与决策门槛

严格按照 Iteration 0 → 5 推进。后续阶段可以完成接口设计和测试样例，但不得绕过前置的数据迁移、事件模型和安全边界。

每一迭代完成后执行以下门槛：

1. 类型检查、针对性单元测试和生产构建通过。
2. 失败路径测试覆盖：取消、超时、断网、远端错误、存储异常。
3. 至少一次真实 Runtime 冒烟，结果写入验收记录。
4. 无认证信息进入 Renderer、任务日志或 Artifact。
5. 用户确认界面密度和主工作流可用后，才进入下一迭代。

## 6. 实施进展与当前下一步

- **Iteration 0**：已完成。应用、窗口、安装产物元数据和主界面品牌为 Agents One；旧 Hermes 用户数据和技术标识保持兼容。
- **Iteration 1**：已完成。Task、TaskRun、归一化事件、运行历史和对话右侧任务侧栏已接入。
- **Iteration 2**：已完成。任务中心已有列表/看板双视图；本地 Agents One 计划任务与既有 Hermes Cron 分来源管理，支持 `skip / queue / replace`。
- **Iteration 3**：已完成。项目目录、关联对话、受控上下文包、依赖解除、验收和产物回溯已贯通；上下文只传摘要与引用，不复制产物正文。
- **Iteration 4**：功能已完成。项目协作组可保存项目经理、实施、测试、复核、验收五种角色，并将项目经理同步为指定协调者；项目计划、依赖解除、受控上下文包与人工派发均保持显式确认。
- **Iteration 5**：已完成。开发构建、全量回归、Windows 普通用户权限解包构建、运行手册和隔离 Electron 项目闭环均已完成。发布签名与全仓历史 lint 基线清理作为后续发布工程治理事项，不改变本轮功能验收结论。

## 7. 2026-07-16 远程 Bridge 验收记录

以下测试在真实远程服务上执行，认证信息只在主进程受控配置中解析，未写入本地任务日志、测试输出或本文档。

| Runtime | 测试 | 结果 |
| --- | --- | --- |
| OpenClaw | `GET /capabilities`，再提交受服务端约束的只读规划 | 五项协调能力均为 `true`；`toolPolicy`、文件系统和网络均被服务端强制为 `disabled`；规划从 `running` 成功到 `succeeded`，返回结构化 plan。 |
| 远程 Hermes | `GET /capabilities`，再提交同样的只读规划 | 五项协调能力均为 `true`；只读策略被强制执行；规划从 `queued` 成功到 `succeeded`，返回结构化 plan。 |
| 远程 Hermes | 新建后立即取消一个只读规划 | 服务端返回 `cancelled`，最终状态为 `cancelled`，并确认 `cleanedUp: true`。 |
| 远程 Hermes | 包含文件、Shell、网络与凭据读取意图的安全探针 | 服务端仍强制三项 `disabled` 策略，规划成功终态；安全事件查询返回 1 条脱敏记录，未检出 Authorization、Bearer、API Key 或 Token 字段。 |

Agents One 现在会同时验证能力声明与创建响应：创建响应若没有确认 `toolPolicy`、文件系统和网络均为 `disabled`，客户端立即拒绝该计划，不会退化为普通任务。发现的兼容整改项：远程 Hermes 的创建响应未返回 `enforced.timeoutSeconds`。Agents One 会使用任务本地超时保护，当前不影响运行或取消；但该字段是 Bridge 规格的一部分，远程 Hermes 应补齐后再进行“严格协议符合”认证。

## 8. 2026-07-16 隔离 Electron 项目闭环

通过 `ENABLE_CDP=1` 的独立 `HERMES_HOME` 启动真实 Electron 主进程和 Renderer，再由 Playwright 调用受限 Preload API 完成以下流程：

1. 配置远程 Hermes、远程 OpenClaw、本地 Codex 和本地 Claude Code；所有凭据仅在沙箱主进程内使用。
2. Hermes 作为项目经理生成受控计划，产生 4 条可审阅任务草案。
3. 项目协作组指定 Hermes 为经理、Codex 为实施、OpenClaw 为测试/复核、人工为验收；该配置未触发自动派发。
4. 前置任务按合法状态机进入验收并被接受，下游实施任务从 `blocked` 自动变为 `ready`。
5. Codex 以 implementation 模式在受管 worktree 中完成不修改源工作区的验证任务，产物、工具事件、上下文包、交接和验收事件均回写项目与任务中心；实施任务由 `review_required` 进入 `accepted`。
6. Claude Code 的 analysis 与 implementation（不修改文件）均真实完成；implementation 返回独立 worktree 和产物事件。

验收脚本：`scripts/verify-agents-one-project-flow.js`、`scripts/verify-claude-code-runtime-live.js`。前者末尾截图属于附加视觉证据，在当前 Electron 字体加载环境下可超时，不参与流程判定；业务和 IPC 断言均已通过。
