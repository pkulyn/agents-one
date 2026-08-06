# Agents One Remote Gateway v1

日期：2026-07-28  
状态：**协议规范草案（v1）**  
适用对象：Agents One 桌面端，以及 Hermes、OpenClaw、Claude Code、Pi Agent 或后续任意**远程**智能体的 Gateway Adapter。

## 1. 目标

Agents One 对每个远程智能体只配置：

1. 显示信息：名称、头像、智能体 ID、类型；
2. 一个 Gateway 基础地址；
3. 一个 `Bearer Token`。

聊天、任务、流式事件、产物、协调能力和办公电脑出站工作区访问都由该 Gateway 的能力声明决定。桌面端不再要求用户分别填写 Hermes API Key、Dashboard Token、OpenClaw Bridge Token、Workspace Gateway Token 或私有路径。

Gateway 内部仍可使用多个上游服务和内部凭据，但它们是**远端部署细节**，不得暴露给 Agents One、用户提示词或模型上下文。

## 2. 设计原则

- **单地址、单凭据**：每个已接入的远程智能体只有一组客户端连接配置。
- **能力协商而非类型分支**：客户端根据 `capabilities` 启用功能，不根据“这是 Hermes/OpenClaw”猜测私有端点。
- **统一运行模型**：普通问答、正式任务、协作角色运行都表示为 `run`，拥有相同的状态、取消、事件和产物模型。
- **适配器隔离**：Hermes Dashboard/API、OpenClaw Bridge、CLI daemon 等差异由远端 Gateway Adapter 处理。
- **最小授权**：Token 绑定一个远程智能体和有限 scope；工作区授权另以短时 Grant 表达，不能用 Token 替代。
- **客户端主动出站**：远程智能体访问办公电脑项目只能通过短时 Grant 队列；办公电脑不开放文件服务器、SSH、SMB、RDP 或任意入站端口。
- **不信任模型文本**：文件哈希、运行状态、产物、权限和验收依据必须来自 Gateway 或本机执行器的结构化结果，不能仅采信模型声明。

## 3. 术语

| 术语            | 含义                                                              |
| --------------- | ----------------------------------------------------------------- |
| Gateway         | 对 Agents One 暴露本规范 API 的远程适配层。                       |
| Runtime         | 一个可对话、可运行任务的远程智能体实例。                          |
| Run             | 一次问答、任务或协作角色执行的统一运行记录。                      |
| Artifact        | 不可变的输入或输出文件/结构化交付物，含哈希与权限边界。           |
| Workspace Grant | 绑定任务、Runtime、项目根目录、权限和过期时间的短时本机访问授权。 |
| Gateway Token   | 桌面端调用单个 Gateway 的 Bearer 凭据；不等同于 Grant。           |

## 3.1 本地 CLI 的边界：不接入 Remote Gateway

本规范是远程连接和跨机器安全边界协议，不是本地 CLI 的执行协议。安装或已配置在办公电脑上的 Codex CLI、Claude Code CLI、Pi Agent CLI 等必须继续由 Agents One 主进程以本地 Runtime Adapter 直接启动和管理：

- 保留 CLI 原生的会话续接、模型选择、工具调用、子智能体、终端输出、权限机制和工作目录语义；
- 使用参数数组启动子进程，不通过 HTTP Gateway 转发，也不要求 Gateway Token 或 Workspace Grant；
- Agents One 只负责捕获原生事件、整理成可读的思考摘要/工具卡片/产物/状态，并保留可折叠的原始终端记录用于回查；
- 用户在 Agents One 中选择的“只读/完全访问”应映射到各 CLI 自己支持的权限参数或配置，而不是用远程 Gateway 的文件操作白名单替代 CLI 能力；
- 本地 CLI 的真实文件、Git diff、测试输出和子智能体结果仍直接从本机 Runtime 采集，不能伪装成远程 Artifact。

为保证 UI 一致性，Agents One 可以在内部使用统一的 `Runtime Adapter` 模型（`probe`、`start`、`get`、`cancel`、事件、产物），但这只是**展示与编排层的归一化**，不是把本地 CLI 降级为 Remote Gateway。适配器必须是非损失的：无法结构化呈现的原生输出仍可在“原始记录”中查看。

## 4. 客户端配置模型

统一配置字段如下：

```json
{
  "id": "openclaw-nas",
  "name": "OpenClaw NAS",
  "kind": "openclaw",
  "location": "remote",
  "gatewayUrl": "https://gateway.example.com/agents-one/v1",
  "enabled": true
}
```

Token 永远单独存入系统受保护存储，作为：

```http
Authorization: Bearer <agents-one-gateway-token>
```

规则：

- `gatewayUrl` 已包含版本根路径；客户端不追加 `/oc-bridge`、`/hermes-api` 或 `/workspace-gateway`。
- Token 不写入 Runtime JSON、项目文件、对话、导出日志、截图或错误正文。
- Dashboard、Hermes API、OpenClaw Bridge 和 Gateway 内部的次级凭据只保留在远端服务的受保护配置中。
- 本地 CLI Runtime（Codex、Claude Code、Pi Agent）不使用本规范；它们继续使用本机进程适配器。

## 5. 基础约定

### 5.1 地址与版本

一个 v1 Gateway 的基础地址示例：

```text
https://gateway.example.com/agents-one/v1
```

版本在路径中固定。破坏性变更必须启用 `/v2`，不得静默改变 v1 字段含义。

### 5.2 内容、时间与幂等

- 请求/响应使用 `application/json; charset=utf-8`，文件上传下载按 Artifact 规则例外。
- 时间为 RFC 3339 UTC，例如 `2026-07-28T10:00:00Z`。
- 创建 Run、Artifact、Grant 和取消请求应接受 `Idempotency-Key`。
- ID 由服务端生成，客户端传入的显示 ID 不能作为授权依据。

### 5.3 通用错误模型

所有非 2xx 响应使用：

```json
{
  "error": {
    "code": "workspace_grant_expired",
    "message": "The workspace grant has expired.",
    "retryable": false,
    "details": {}
  },
  "requestId": "req_..."
}
```

错误正文不得包含 Token、Cookie、上游 URL、办公电脑绝对路径、完整提示词、完整文件内容、环境变量或内部堆栈。

| HTTP          | 语义                                                 |
| ------------- | ---------------------------------------------------- |
| `400` / `422` | 输入、能力或状态不合法；客户端要求修正，不静默降级。 |
| `401` / `403` | Token 或资源授权失败；停止并隐藏凭据细节。           |
| `404`         | Gateway 不支持该资源/版本；仅可回退到已声明能力。    |
| `409`         | 冲突、运行状态不允许或文件哈希不匹配。               |
| `410`         | Grant/Artifact 已过期或被撤销。                      |
| `429`         | 配额限制；响应提供 `Retry-After`。                   |
| `5xx`         | Gateway 暂不可用；客户端保留状态并按本地超时重试。   |

## 5.4 CGNAT 与无公网 IP：出站 Agent Connector

Remote Gateway v1 不要求远程智能体机器拥有公网 IP，也不要求路由器端口映射。对于家庭电脑、移动网络或 CGNAT 环境，推荐部署 **出站 Agent Connector**：

```text
家庭电脑 Runtime / Gateway Adapter
        │  主动发起 WSS + mTLS（或 Connector Token）
        ▼
公网 Agents One Relay
        │  HTTPS / SSE / WebSocket（Gateway v1）
        ▼
Agents One 桌面端
```

规则：

- 家庭电脑只向公网 Relay 建立出站长连接，不监听互联网入站端口，不配置 NAT 穿透、不开放路由器端口。
- Agents One 桌面端只连接 Relay 暴露的标准 `gatewayUrl`，仍只保存一个 Gateway Token；客户端不直接连接 Connector，也不知道家庭电脑 IP、DDNS 或局域网路径。
- Connector 使用独立的设备身份（推荐 mTLS 设备证书，或可轮换的 Connector Token）向 Relay 注册。这是 Relay 与设备之间的内部凭据，不是桌面端 Gateway Token，也不进入模型上下文。
- Relay 将 Gateway Token 授权、`agentId`、Connector 身份和当前在线会话绑定；Connector 断线时，Relay 必须将新 Run 拒绝为 `503 agent_offline`，而不是假装已派发。
- Connector 只能收发本规范的 Run、事件、Artifact 和受控工作区结构化消息；Relay 不得把它实现成任意 TCP 端口转发、Shell 通道或家庭电脑文件代理。
- Connector 重连必须使用指数退避、会话 ID 和事件序号续传；旧会话恢复后不能重复执行 Run 或重复写入 Artifact。

Connector 模式是 Gateway v1 的推荐部署 Profile；公网静态 Gateway、企业 VPN/私有网络可继续使用直接 Profile。无论使用哪一种，Agents One 客户端的配置结构不变。

## 6. 能力发现

`GET /capabilities`

```json
{
  "protocolVersion": "1.0",
  "agent": {
    "id": "openclaw-nas",
    "kind": "openclaw",
    "displayName": "OpenClaw NAS"
  },
  "capabilities": {
    "conversation": { "stream": "sse", "continuation": true },
    "tasks": { "start": true, "get": true, "cancel": true },
    "artifacts": { "upload": true, "download": true },
    "orchestration": { "readOnlyPlanning": true },
    "outboundWorkspaceGateway": {
      "enabled": true,
      "operations": ["list", "read", "write", "move", "delete"],
      "maxOperationBytes": 262144,
      "maxGrantSeconds": null
    }
  },
  "limits": {
    "maxConcurrentRuns": 2,
    "maxInputBytes": 10485760,
    "maxArtifactBytes": 10485760,
    "defaultTimeoutSeconds": 120,
    "maxTimeoutSeconds": 600
  }
}
```

客户端规则：

- `protocolVersion` 的主版本不是 `1` 时，不创建运行。
- 未声明的能力视为不支持；不得用私有 URL 猜测或尝试调用。
- `outboundWorkspaceGateway.enabled` 为 `true` 是远程参与本地项目的必要条件，不代表用户已授予某个项目权限。
- 任何显示名称/头像仅是展示建议；桌面端可保留用户自己的自定义显示信息。

## 7. 统一 Run API

### 7.1 创建运行

`POST /runs`

```json
{
  "runtimeId": "hermes-home2",
  "mode": "task",
  "conversationId": "conversation-uuid",
  "projectId": "project-uuid",
  "input": {
    "text": "请完成当前任务。",
    "artifactIds": ["artifact_..."],
    "workspaceRef": "desktop-gateway:grant_..."
  },
  "execution": {
    "timeoutSeconds": 300,
    "permission": "write",
    "role": "implementer",
    "contextPolicy": "project-shared"
  }
}
```

`runtimeId` 是可选的稳定运行时 ID。当一个 Gateway/Relay 复用给多个远程智能体时，服务端必须使用它将 Run 路由到对应的 Connector；例如桌面端显示名可以是 `Hers-2`，但这里应传入其配置 ID `hermes-home2`。单智能体专用 Gateway 可以忽略该字段并使用 Token 绑定的默认智能体。若目标 Connector 未注册或不在线，服务端应返回结构化的 `agent_offline`，客户端不得把它伪装成普通 `failed`。

适配器实现必须同时支持两种读取位置：请求顶层的 `runtimeId`，以及 `startRun(input, context)` 的 `context.runtimeId`。SDK 会将二者保持一致地传入；适配器应优先使用 `context.runtimeId`，再回退到 `input.runtimeId`，并把该 ID 交给 Relay 的 Connector 路由层。显示名称（如 `Hers-2`）不得用于路由。

`mode` 枚举：`conversation`、`task`、`coordination`、`verification`。`permission` 枚举：`read`、`write`；它只在带有效 `workspaceRef` 时有意义。

响应 `202`：

```json
{
  "id": "run_...",
  "status": "queued",
  "conversationId": "conversation-uuid",
  "createdAt": "2026-07-28T10:00:00Z"
}
```

### 7.2 查询与取消

- `GET /runs/{runId}` 返回 `queued`、`running`、`cancelling`、`succeeded`、`failed`、`cancelled`、`timed_out` 或 `review_required`。
- `POST /runs/{runId}/cancel` 必须幂等。异步取消返回 `202` / `cancelling`，客户端继续查询至终态。
- Run 终态必须包含结构化 `artifacts`、`usage`（若允许）和脱敏错误摘要；模型的一般文本答复不是 Artifact。

## 8. 流式事件

事件字段、脱敏边界、模型上下文元数据以及 Hers/OpenClaw/CLI Adapter 的适配要求以 [Agents One Agent Event Stream v1](AGENT_EVENT_STREAM_V1.md) 为准。本节保留 Gateway 的传输约定。

`GET /runs/{runId}/events` 使用 SSE。每个事件包含单调递增 `sequence`，客户端可凭 `Last-Event-ID` 续传。

```json
{
  "id": "evt_...",
  "sequence": 42,
  "type": "tool.completed",
  "createdAt": "2026-07-28T10:00:05Z",
  "data": {
    "tool": "workspace_gateway.write",
    "summary": "Created docs/notes.md (312 bytes).",
    "artifactId": "artifact_..."
  }
}
```

允许事件：

- `run.started`、`run.status`、`run.completed`、`run.failed`；
- `assistant.delta`、`assistant.completed`；
- `reasoning.summary`：仅允许用户可见的完整摘要，不能发送原始思维链或高频快照；
- `tool.started`、`tool.completed`、`tool.failed`；
- `artifact.created`；
- `workspace.requested`、`workspace.completed`、`workspace.blocked`；
- `handoff.created`、`handoff.completed`：用于多智能体协调的真实交接。

Gateway 必须对重复 SSE 重连事件保持相同 `id`/`sequence`。Agents One 依据它们去重，不能把增量快照误保存为多条对话记录。

## 9. Artifact API

- `POST /artifacts`：上传输入附件，返回不可变 `id`、名称、MIME、大小、SHA-256 和到期时间。
- `GET /artifacts/{artifactId}`：按项目与认证主体读取元数据或受限内容。
- `GET /runs/{runId}/artifacts`：查询该运行真实产生的文件、代码变更、报告或测试结果。

Artifact 必须带来源 Run、来源 Runtime、相对路径（若适用）、SHA-256 和访问范围。普通文本回复、思考摘要、状态提示不能伪装为 Artifact。

## 10. 受控本机工作区 API

本节将现有 `workspace-gateway` 统一为同一 Gateway 的子资源。所有请求仍由办公电脑**主动拉取**；Gateway 不能连接办公电脑或获知本机绝对路径。

| 操作           | 统一端点                                               |
| -------------- | ------------------------------------------------------ |
| 能力声明       | `GET /capabilities` 的 `outboundWorkspaceGateway` 字段 |
| 注册 Grant     | `POST /workspace-grants`                               |
| 远程工具入队   | `POST /workspace-grants/{grantId}/requests`            |
| 桌面端主动拉取 | `POST /workspace-grants/{grantId}/pull`                |
| 回传执行结果   | `POST /workspace-grants/{grantId}/results`             |
| 查询单项结果   | `GET /workspace-grants/{grantId}/results/{requestId}`  |
| 撤销           | `POST /workspace-grants/{grantId}/revoke`              |
| 审计           | `GET /workspace-grants/{grantId}/audit`                |

### 10.1 桌面端注册 Grant

```json
{
  "grantId": "workspace-grant_...",
  "taskId": "run_...",
  "runtimeId": "hers",
  "permission": "write",
  "expiresAt": "2026-07-29T08:30:00.000Z",
  "maxOperationBytes": 262144,
  "operations": ["list", "read", "write", "move", "delete"]
}
```

Gateway 返回：

```json
{
  "accepted": true,
  "grantId": "workspace-grant_...",
  "expiresAt": "2026-07-29T08:30:00.000Z"
}
```

- `grantId` 由桌面端生成并作为 `workspaceRef=desktop-gateway:<grantId>` 交给 Run；Gateway 不得替换它。
- 请求不包含 `workspaceRoot` 或任何办公电脑绝对路径。Gateway 只保存不透明 Grant ID。
- Gateway 返回的 `expiresAt` 不得晚于桌面端请求时间，也不得超过能力声明中的 `maxGrantSeconds`。

### 10.2 桌面端拉取与结果回传

桌面端长轮询：

```json
POST /workspace-grants/{grantId}/pull
{ "maxWaitSeconds": 20 }
```

每次只能返回一项：

```json
{ "request": null }
```

或：

```json
{
  "request": {
    "id": "workspace-request_...",
    "operation": "write",
    "path": "docs/result.md",
    "content": "# Result",
    "expectedSha256": "optional-64-character-hex"
  }
}
```

桌面端完成受控操作后调用 `POST /workspace-grants/{grantId}/results`，提交 `requestId`、`status`、脱敏摘要以及可选的相对路径、字节数和 SHA-256。拉取接口不得返回批量 `requests`；这样桌面端可以按顺序执行、审计并对删除逐次确认。

请求、授权、路径校验、哈希冲突、删除本机确认和审计规则沿用 [OUTBOUND_WORKSPACE_GATEWAY_BRIDGE_REQUIREMENTS.md](OUTBOUND_WORKSPACE_GATEWAY_BRIDGE_REQUIREMENTS.md)。本规范额外要求：

- 远端 Runtime 必须注册一个真实工具，将 `workspaceRef=desktop-gateway:<grantId>` 转换成上述结构化队列请求；不能让模型输出 Windows 路径、Shell 或伪造“已完成”。
- Gateway Tool 必须在得到 `succeeded` 和本机返回的 SHA-256 后，才能向模型报告文件交付成功。
- `delete` 在 v1 必须返回 `confirmation_required`，直到桌面端完成逐次确认。不得自动删除。

## 11. 多智能体与协调

协作不是单独的客户端私有协议。主负责智能体、实施、测试和验收均通过 `/runs` 运行，并在 `handoff` 事件与 Artifact 引用中共享**已授权**上下文。

- 协调者只能基于真实 Run 状态、Artifact 和工作区结果派发/推进后续阶段。
- 下游验收 Run 必须引用实施 Run 的 Artifact 或本机工作区结果哈希；没有真实交付时，状态必须为 `blocked` 或 `review_required`。
- 远程协调者的只读规划继续遵守 [REMOTE_COORDINATOR_BRIDGE_REQUIREMENTS.md](REMOTE_COORDINATOR_BRIDGE_REQUIREMENTS.md)，并应从本规范的 `/capabilities` 声明其 `orchestration.readOnlyPlanning` 能力。

## 12. 鉴权与安全要求

### 12.1 Gateway Token

一个 Gateway Token 至少绑定：`subject`、`agentId`、允许 capabilities/scopes、到期时间和撤销状态。建议 scope：

```text
conversation:run task:run task:cancel artifact:read artifact:write
workspace:grant workspace:request workspace:result orchestration:plan
```

Token 永远不进入模型提示词、SSE 事件、Artifact、审计正文或客户端普通配置 JSON。

### 12.2 禁止能力

即使 Gateway 代理的是强大 Runtime，统一协议也不得提供：任意 Shell、PowerShell/cmd、进程启动、注册表、环境变量、凭据读取、任意网络请求或本机绝对路径操作。需要这些能力的远程服务只能在其自身安全边界内实现，不能借 Workspace Grant 穿透到办公电脑。

## 13. Hermes/OpenClaw 兼容迁移

### 13.1 Hermes Adapter

远程 Hermes 新增例如：

```text
https://host/agents-one/v1
```

该 Adapter 内部可转发 Hermes API、Dashboard/WebSocket、现有 `/hermes-api/workspace-gateway`，并将它们归一化为本规范。桌面端只保存 Adapter Token；API Key、Dashboard Token 由 Adapter 在远端安全存储和轮换。

### 13.2 OpenClaw Adapter

远程 OpenClaw 新增相同结构的 Gateway。Adapter 内部可调用 `/oc-bridge` 与独立 `/workspace-gateway`，但对桌面端只暴露一个 Token。必须注册 `workspace_gateway` 运行时工具；仅部署 FastAPI 队列服务不构成完整实现。

### 13.3 客户端迁移顺序

1. Agents One 增加 `统一 Gateway` 连接模式和 v1 capabilities 探测。
2. 保留现有 Hermes/OpenClaw 私有配置为“兼容模式”，不修改、不删除已有 Token、任务、项目或对话历史。
3. 用户完成单地址连通测试后，桌面端将对应 Runtime 标记为“统一 Gateway 已启用”。
4. 所有真实回归通过后，隐藏旧的多地址字段；旧配置只作为可回退的只读兼容记录。

**禁止**把旧字段自动合并、覆盖或删除。迁移必须可回滚，且需要用户明确保存新的统一配置。

## 14. v1 一致性验收

一个 Gateway 要宣称符合 v1，至少必须通过：

1. 仅用一组地址/Token 成功获取 `/capabilities`、创建 Run、接收 SSE、取消 Run 和读取 Artifact。
2. SSE 重连不重复显示 assistant、工具或思考摘要；事件可定位到同一 Run。
3. 不支持的 capability 被明确拒绝，不回退到私有端点或非受控执行。
4. 使用同一 Token 完成 Workspace Grant 注册、队列请求、主动拉取、结果回传、过期和撤销；注册与日志均不包含本机绝对路径。
5. 远程模型通过注册工具成功执行 `list/read/write` 测试，结果携带本机计算的相对路径和 SHA-256；不能仅靠模型文本声称完成。
6. `delete` 未经本机逐项确认绝不执行；路径穿越、符号链接、超限、哈希冲突、跨任务 Grant 和越权 Token 全部被拒绝。
7. Hermes 与 OpenClaw 的原有接口在适配器部署期间保持可用；完成 v1 配置的 Agents One 客户端不再需要第二个网关地址或第二个 Token。

## 15. 非目标

v1 不负责：自动代码合并、任意远程 Shell、跨网段文件共享、代替 Git 审核、绕过企业终端策略、长期驻留本机代理、或未经确认的删除操作。
