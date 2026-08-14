# Agents One Agent Event Stream v1

## 1. 目标与边界

`Agents One Agent Event Stream v1` 是远程智能体插件向 Agents One 提供运行过程的统一事件协议。它以 Hermes Dashboard 的交互反馈为体验基线，并统一呈现思考摘要、工具、技能、MCP、终端、受控工作区、产物与交接事件。

协议的目标是让用户看到可理解、可追溯的工作过程，而不是只在任务结束后看到一段最终答复。

本协议适用于：

- Gateway v1 远程智能体：Hers、OpenClaw、后续第三方 Gateway。
- 本地 CLI Adapter：Codex CLI、Claude Code CLI、Pi Agent CLI 的本地适配器可将原生事件映射为同一模型。

本协议**不要求**本地 CLI 放弃其原生参数、工具、交互或工作区能力。CLI 保持由本地 Adapter 直接启动和管理；协议只规范 Adapter 向桌面 UI 输出什么事件。

## 2. 安全原则

- 只发送对用户可见的 `reasoning.summary`，不发送私有原始思维链、高频快照或提示词。
- 工具参数、输出、路径、令牌和文件内容必须摘要化、截断与脱敏。
- `assistant.delta` 只用于实时显示，桌面端不将其逐条持久化为历史记录。
- `artifact.created` 只代表文件、代码变更、报告、测试结果等可核验交付物；普通文本答复不是产物。
- 每个事件在同一运行中必须有稳定 `id`；重连重发同一 `id` 时桌面端按更新处理，不能重复追加。

## 3. 能力声明

Gateway 的 `GET /capabilities` 或运行时 capability 响应应声明：

```json
{
  "capabilities": {
    "eventStream": {
      "protocol": "agents-one-event-stream-v1",
      "transport": "sse",
      "reasoningSummaries": true,
      "toolEvents": true,
      "modelMetadata": true,
      "usageMetadata": true
    }
  }
}
```

`transport` 可取 `sse`、`websocket` 或 `poll`。`reasoningSummaries`、`toolEvents`、`modelMetadata`、`usageMetadata` 只在 Adapter 已真实实现时声明为 `true`，且声明必须在进程启动后保持稳定，不能根据最近是否观察到某类事件动态变化。无法提供过程事件的旧 Gateway 可以省略这些增强标志，Agents One 将保留最终答复兼容路径，并明确标注缺失记录，不会伪造思考或工具调用。

## 4. 事件信封

```json
{
  "id": "evt_01J...",
  "sequence": 12,
  "type": "tool.completed",
  "createdAt": "2026-07-31T10:00:01.000Z",
  "data": {
    "summary": "已读取项目规则。",
    "tool": {
      "callId": "call_01J...",
      "kind": "mcp",
      "name": "powermem_recall",
      "inputSummary": "检索项目记忆",
      "outputSummary": "找到 3 条相关项目记忆",
      "duration": 42
    }
  }
}
```

字段要求：

| 字段        | 要求                                 |
| ----------- | ------------------------------------ |
| `id`        | 必填；同一运行内稳定且可去重。       |
| `sequence`  | 推荐；单调递增，用于断线恢复时排序。 |
| `type`      | 必填；必须是第 5 节中的已知类型。    |
| `createdAt` | 必填；ISO 8601 或 Unix 毫秒。        |
| `data`      | 可选；只放经脱敏的用户可见摘要。     |

运行状态查询 `GET /runs/{runId}` 可在响应中附带有界的 `events` 数组，供轮询兼容模式消费。SSE/WebSocket 实现应支持从最近事件 ID 或 sequence 继续，且在最终状态响应中保留最近事件窗口，避免短暂断连丢失过程记录。

## 5. 标准事件类型

| 类型                                                                | 用途                       | UI 呈现                  |
| ------------------------------------------------------------------- | -------------------------- | ------------------------ |
| `run.started` / `run.status`                                        | 任务开始或阶段状态         | 轻量进度条目             |
| `reasoning.summary`                                                 | 用户可读的完整思考摘要     | 可折叠“思考”条目         |
| `assistant.delta`                                                   | 实时文本片段               | 临时流式文本，不逐条保存 |
| `assistant.completed`                                               | 最终答复                   | 正常智能体答复           |
| `tool.started` / `tool.completed` / `tool.failed`                   | 工具调用过程               | 工具分组与成功/失败结果  |
| `artifact.created`                                                  | 文件、报告、代码或测试产物 | 产物分组                 |
| `workspace.requested` / `workspace.completed` / `workspace.blocked` | 受控工作区操作             | 受控工作区分组与权限状态 |
| `handoff.created` / `handoff.completed`                             | 任务交接、子任务派发       | 协作时间线               |
| `run.completed` / `run.failed`                                      | 运行终态                   | 运行结果，不作为普通产物 |

工具 `kind`：`tool`、`skill`、`mcp`、`terminal`、`workspace`。例如，Pi 的原生 `read` 映射为 `tool.completed` + `kind: "terminal"` 或 `"tool"`；Hers 通过 Workspace Grant 的写入映射为 `workspace.completed`，并附带相对路径摘要。

工具事件可携带非负整数 `duration` 或 `durationMs`。Workspace 事件应在 `data.operation` 中使用 `list/read/write/move/delete`，并在 `data.path` 中只提供 Grant 根目录下的相对路径；绝对路径和包含 `..` 的路径不得进入持久事件。

`reasoning.summary` 只能承载独立、完整且用户可读的工作摘要。不得发送“远程智能体已返回新的答复”“任务已开始执行”等状态文案，不得复用 `assistant.completed` 的最终答复，也不得拆分或高频推送原始思维快照。没有可靠摘要时应省略该事件。

## 6. 模型与上下文元数据

Gateway 运行响应或事件 `data` 可附带：

```json
{
  "model": {
    "provider": "ark",
    "id": "glm-5.2",
    "contextWindowTokens": 1000000
  },
  "usage": {
    "inputTokens": 120,
    "outputTokens": 42,
    "contextWindowTokens": 1000000
  }
}
```

Agents One 用该信息显示当前模型和上下文占用。没有可靠数据时显示“由智能体管理”，不应写死默认模型或虚构容量。兼容层会识别 `model_name`、`modelId`、`context_window_tokens` 等常见别名，但插件必须优先提供上面的标准字段。

## 7. 插件适配要求

### Hers Relay 插件

- 将家庭电脑 Hermes 的 Dashboard/工具事件转换为本协议事件，并保留原始事件 ID、顺序、模型信息和 conversationId。
- Workspace Grant 的 list/read/write/move/delete 分别映射 `workspace.*`；删除仍以桌面确认结果为准。
- 不得把“远程智能体已返回新的答复”作为思考事件替代品。
- 每轮运行在模型信息可得时必须上报真实 `provider`、`id`、`contextWindowTokens` 与可用的 token 用量；不能取得时显式省略，不得回填默认模型或猜测容量。

### OpenClaw Gateway 插件

- 将 subagent、技能、Bridge 工具与产物映射为 `handoff.*`、`tool.*`、`artifact.created`。
- 对没有原生过程事件的模型，至少输出明确的阶段摘要，不能高频重复输出快照。

### 本地 CLI Adapter

- Codex、Claude Code、Pi 保持原生 CLI 调用参数、权限与交互机制。
- Adapter 负责将 stdout/JSONL/SDK 事件归一化为本协议，保留真实模型、工具名、文件路径摘要及取消/退出状态。
- 原生完整终端输出可作为可折叠诊断日志保存，但不应伪装成思考过程。

## 8. 验收夹具

每个插件至少提供以下可自动测试的 fixture：

1. `reasoning.summary`：只有一条完整摘要，重连后不重复。
2. `mcp` 或 `skill` 调用：开始、结束、输入/输出摘要正确显示。
3. 文件操作：相对路径、结果、哈希或变更摘要正确显示，不泄露绝对路径或令牌。
4. 模型上下文：能报告时显示真实值；不能报告时显示“由智能体管理”。
5. 断线恢复：重复事件 ID 不产生重复历史；漏掉的 sequence 能补齐。

## 9. 版本演进

协议版本通过 `protocol: "agents-one-event-stream-v1"` 协商。新增字段必须保持可忽略；新增事件类型必须由新版本协议声明，旧客户端遇到未知类型应安全跳过并保留原始诊断日志。
