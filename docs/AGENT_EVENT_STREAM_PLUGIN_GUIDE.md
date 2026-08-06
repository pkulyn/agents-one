# Agents One Agent Event Stream v1 插件实施指南

## 1. 目的

本指南给 Hers、OpenClaw 及后续远程智能体的维护者使用。安装或实现适配插件后，智能体不只返回最终文本，还能把用户可理解的思考摘要、工具/技能/MCP 调用、受控工作区操作、真实产物和交接过程发送给 Agents One。

完整字段规范见 [Agent Event Stream v1](AGENT_EVENT_STREAM_V1.md)；远程接入、鉴权、运行和工作区授权仍遵循 [Remote Gateway v1](AGENTS_ONE_REMOTE_GATEWAY_V1.md)。

## 2. 最小接入面

插件只需要在 Gateway 内增加一个事件适配层，不需要把 Agents One 桌面端暴露给模型，也不应改变原生智能体的工具权限。

```text
原生 Runtime / CLI / Dashboard
        |
        | 原始事件、日志或 SDK 回调
        v
Event Adapter Plugin
  - 去重、摘要、脱敏
  - 分配稳定 eventId / sequence
  - 保存运行级事件窗口
        |
        v
Agents One Remote Gateway v1
  GET /capabilities
  GET /runs/{runId}   (轮询兼容的 events 快照)
  GET /runs/{runId}/events  (可选 SSE)
```

桌面端当前会从 `GET /runs/{runId}` 读取有界 `events` 窗口；因此先实现轮询快照即可获得完整展示。SSE 或 WebSocket 是体验增强项：必须支持从 `Last-Event-ID` 或 `afterSequence` 恢复，且最终的 `GET /runs/{runId}` 仍保留最近事件窗口。

## 3. Gateway 必须返回的内容

### 3.1 能力声明

```json
{
  "protocolVersion": "1.0",
  "plugin": {
    "id": "agents-one-plugin-sdk",
    "version": "0.1.0",
    "kind": "remote-gateway"
  },
  "capabilities": {
    "conversation": { "stream": "sse" },
    "tasks": { "start": true, "cancel": true },
    "eventStream": {
      "protocol": "agents-one-event-stream-v1",
      "transport": "poll",
      "reasoningSummaries": true,
      "toolEvents": true,
      "modelMetadata": true,
      "usageMetadata": true
    },
    "outboundWorkspaceGateway": {
      "enabled": true,
      "operations": ["list", "read", "write", "move", "delete"],
      "maxOperationBytes": 262144,
      "maxGrantSeconds": null
    }
  }
}
```

`plugin` 是 SDK 插件识别信息。桌面端连接测试会显示 `已识别 Agents One 插件 v...`；迁移期也兼容同结构的 `pluginInfo`，但新插件必须使用 `plugin`。

只有在插件实际能够持续输出对应事件时，才可以声明 `reasoningSummaries`、`toolEvents`、`modelMetadata` 或 `usageMetadata`。最终答复、"已返回新的答复"、运行状态都不能伪装成思考事件。

### 3.2 Run 状态快照

`GET /runs/{runId}` 的原有字段保持不变，只追加可选字段：

```json
{
  "id": "run_01J...",
  "status": "running",
  "conversationId": "conversation_01J...",
  "model": {
    "provider": "ark",
    "id": "glm-5.2",
    "contextWindowTokens": 1000000
  },
  "usage": { "inputTokens": 1200, "outputTokens": 320 },
  "events": [
    {
      "id": "evt_01J_tool_03",
      "sequence": 3,
      "type": "tool.completed",
      "createdAt": "2026-07-31T10:00:02.000Z",
      "data": {
        "summary": "已检索项目记忆。",
        "tool": {
          "callId": "call_03",
          "kind": "mcp",
          "name": "powermem_recall",
          "inputSummary": "检索当前项目记忆",
          "outputSummary": "找到 3 条相关记录"
        }
      }
    }
  ]
}
```

规则：

- `id` 由 Gateway 生成并永久绑定该事件；重试或重连必须复用原 ID。
- `sequence` 在同一 `runId` 内严格递增；最多返回最近 200 条或服务端设定的有界数量。
- `createdAt` 使用 ISO 8601 或 Unix 毫秒。
- 完成运行应至少保留 `reasoning.summary`、关键工具结果、真实产物和 `assistant.completed`，让用户在重开历史后仍能看懂过程。
- `assistant.completed` 必须在 `run.completed` 前持久化，且 `data.text` 必须同时可由终态快照的 `output` 读取。桌面端会在终态缺少答复时额外轮询 3 次；仍缺失则显示明确的插件协议诊断，而不会把一个模糊的 `failed` 当成最终答复。
- 不能提供过程事件时不要伪造；不声明 `eventStream` 即可，桌面端将继续显示最终答复。

## 4. 事件映射规则

| 原生行为 | 标准事件 | 说明 |
| --- | --- | --- |
| 一段完成的用户可见推理摘要 | `reasoning.summary` | 只保留最后的完整摘要；不要发送逐 token 或不断扩写的快照。 |
| 普通工具、浏览器、代码执行 | `tool.started` / `tool.completed` / `tool.failed` | `kind: tool` 或 `terminal`；仅携带摘要。 |
| 技能加载、技能执行 | `tool.*` | `kind: skill`，`name` 为技能名。 |
| MCP 调用 | `tool.*` | `kind: mcp`，例如 `powermem_recall`。 |
| 受控工作区 list/read/write/move/delete | `workspace.*` | 仅传项目相对路径；删除以桌面确认后的结果为准。 |
| 创建文件、代码变更、报告、测试结果 | `artifact.created` | 必须存在可核验交付物，普通文本答复不创建 artifact。 |
| 调用常驻智能体或完成交接 | `handoff.created` / `handoff.completed` | 用于协作时间线。 |
| 最终答复 | `assistant.completed` | 放入 `data.text`，不要重复作为 artifact。 |

## 5. 各智能体插件要点

### Hers Relay

- 读取家庭电脑 Hermes Dashboard/Connector 的原始事件，转换时保留原事件 ID、顺序和 `conversationId`。
- Dashboard 的 Thought 只在形成完整的用户可见摘要后发送 `reasoning.summary`；不得将“远程智能体已返回新的答复”伪装为思考内容。
- 工具、技能、MCP、终端和 Workspace Grant 结果分别按上表映射；Workspace 路径必须是 Grant 根目录下的相对路径。
- Relay 中模型身份是运行元数据，用户在 Agents One 配置的智能体名称与头像仍由桌面端优先显示，插件不能用系统提示词把 Hers 改称 Hermes。

### OpenClaw Gateway

- 将 subagent 生命周期映射为 `handoff.created/completed`；将 Bridge 工具和技能映射为 `tool.*`，并附带可见摘要。
- 如果上游只提供阶段日志，发送低频、语义完整的 `reasoning.summary`；不要为了“看起来很忙”重复发送相同内容。
- 真实生成的文档、代码变更和测试报告须通过 `artifact.created` 上报相对路径、哈希和摘要。

### Pi、Codex、Claude Code 本地 CLI Adapter

- 保持 CLI 原有二进制、参数、工作区、权限和交互能力；Event Stream 只约束 Adapter 到 UI 的输出。
- JSONL/SDK 若发送完整快照，Adapter 应覆盖同一个临时展示项，最终只持久化最新完整摘要，不能逐条追加。
- `write`、`edit`、`apply_patch` 等只有在实际命令返回结果后发送一次 `tool.completed`；若产生真实文件/变更，再额外发送 `artifact.created`。
- 原始终端输出可保留在折叠诊断日志中，但不作为思考内容。

## 6. 禁止事项

- 不发送原始系统提示词、私有思维链、访问令牌、Cookie、环境变量、绝对路径或完整敏感文件内容。
- 不将运行开始、心跳、重试或“正在整理答复”这类空状态堆积为思考记录。
- 不生成未经验证的“产物已发布”事件。
- 不因无法产生事件而阻断现有最终答复；事件能力是渐进增强。

## 7. 插件验收清单

每个插件提交前应提供或执行下列固定场景：

1. 一次 `reasoning.summary`，重连重放时不会产生第二条历史记录。
2. 一次 MCP 或技能调用，展示开始、结束和脱敏后的输入/输出摘要。
3. 一次文件读写：只出现相对路径、结果和哈希/变更摘要，日志中没有 Token 或绝对路径。
4. 一次 `artifact.created`：对应文件或变更确实可由 Gateway artifact API 或受控工作区证据验证。
5. 一次失败：`tool.failed` 或 `workspace.blocked` 显示可操作错误摘要，不泄露内部堆栈。
6. 一次断线恢复：重新获取运行快照后按稳定事件 ID 去重、按 sequence 补齐。
7. 模型和上下文容量可获得时返回真实 `model`/`usage`；不可获得时省略字段，而不是伪造默认值。

## 8. 部署顺序

1. 先在一个测试 Gateway 上启用 `transport: poll` 和 `events` 快照。
2. 用上述验收场景验证桌面端时间线、历史重开和脱敏。
3. 再增加 SSE/WebSocket 续传，以改善长任务实时性。
4. 最后将 Hermes 与 OpenClaw 的旧私有事件格式迁移到此 Adapter，不改变既有 `runtimeId`、Token 或会话历史。
