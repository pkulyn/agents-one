# OpenClaw Bridge 联调说明

本说明用于向远程 OpenClaw 管理员索取**不含密钥**的联调信息。Hermes One 当前采用 HTTP Bridge Adapter；Runtime 设置页只保存基础地址、超时和启用状态，禁止把 Token、API Key、密码或带凭据 URL 写入配置与日志。

## 需要提供的信息

1. Bridge 基础地址，例如 `https://openclaw.example/bridge`，不要携带查询参数、片段或 `user:password@` 凭据。
2. 认证方式：无认证、内网/IP 白名单、反向代理会话、mTLS，或需要 HTTP Header。
3. 每个下列接口的一份脱敏请求/响应样例，以及错误响应样例。
4. 是否允许安全的测试任务，以及可接受的测试提示词。

Bearer Token 已受支持：先保存远程 OpenClaw Runtime 的基础地址，再在 Settings -> Runtimes 的 `Bridge token` 密码输入框粘贴 Token 并保存。Token 由主进程使用现有 secrets provider 保存；Runtime JSON、列表、任务提示词、产物和日志都不包含该值，Renderer 只能获知“已配置/未配置”状态。

## 基础约定

- 所有响应均为 `application/json`。
- 路径相对于配置的基础地址追加。例如基础地址是 `https://host/bridge`，健康检查为 `GET https://host/bridge/health`。
- 成功状态使用 HTTP `2xx`；权限、限流、参数错误和服务端错误使用恰当的非 `2xx` 状态码。
- 任务 ID 必须是字符串；Hermes One 会对任务 ID 进行 URL 编码。

## 1. 健康检查与能力

```http
GET /health
Accept: application/json
```

推荐响应：

```json
{
  "status": "ok",
  "message": "OpenClaw Bridge ready",
  "capabilities": {
    "chat": true,
    "taskDispatch": true,
    "streaming": false,
    "cancellation": true,
    "tools": true,
    "memory": false,
    "orchestration": false,
    "mailbox": false,
    "artifacts": true,
    "workspaceAccess": false
  }
}
```

`capabilities` 可省略；省略时客户端会采用保守默认值。能力字段均为布尔值。

## 2. 创建任务

```http
POST /tasks
Content-Type: application/json
Accept: application/json
```

请求体：

```json
{
  "prompt": "请回复：OpenClaw Bridge 测试成功。",
  "profile": "optional-profile",
  "sessionId": "optional-session-id"
}
```

`profile` 与 `sessionId` 可以为空或省略。响应至少包含 `id` 和 `status`：

```json
{
  "id": "task_123",
  "status": "queued",
  "output": "",
  "sessionId": "optional-session-id"
}
```

## 3. 查询任务

```http
GET /tasks/{taskId}
Accept: application/json
```

响应格式与创建任务相同。支持状态：`queued`、`pending`、`running`、`succeeded`、`success`、`completed`、`done`、`failed`、`error`、`cancelled`、`canceled`、`timed_out`、`timeout`。

完成或失败时可返回：

```json
{
  "id": "task_123",
  "status": "succeeded",
  "output": "OpenClaw Bridge 测试成功。"
}
```

或：

```json
{
  "id": "task_123",
  "status": "failed",
  "error": "Safe diagnostic text without credentials"
}
```

## 4. 取消任务

```http
POST /tasks/{taskId}/cancel
Accept: application/json
```

响应仍返回完整任务对象，且 `status` 为 `cancelled` 或 `canceled`。取消不应删除任务记录，便于 Task Center 后续审计。

## 当前边界

- 第一版通过轮询 `GET /tasks/{taskId}` 跟踪任务；SSE/WebSocket 事件流可后续增量接入。
- Bridge 不能把完整认证头、Token、环境变量或内部堆栈回显到 `output` / `error`。
- 不要将现有 Claw3D 看板或只读任务 JSON 直接当作 Bridge API；它们不是可安全派发任务的协议。
