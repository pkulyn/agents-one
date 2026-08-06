# Agents One Remote Gateway v1 - 试点智能体接入指引

适用对象：第一个用于验证 Agents One Remote Gateway v1 的全新远程智能体。  
关联规范：[AGENTS_ONE_REMOTE_GATEWAY_V1.md](AGENTS_ONE_REMOTE_GATEWAY_V1.md)。

## 目标

在不修改 Hermes、OpenClaw 或 Agents One 现有生产连接配置的前提下，为一个全新远程智能体部署统一 Gateway：

```text
https://<host>/agents-one/v1
Authorization: Bearer <one gateway token>
```

Agents One 只保存这一个地址和这一个 Token。Gateway 内部可调用该智能体自己的 API、CLI 或服务，但不得要求客户端再填写内部地址或额外凭据。

## 第一阶段：最小可对话 Gateway

必须实现：

1. `GET /agents-one/v1/capabilities`
2. `POST /agents-one/v1/runs`
3. `GET /agents-one/v1/runs/{runId}`
4. `GET /agents-one/v1/runs/{runId}/events`（SSE）
5. `POST /agents-one/v1/runs/{runId}/cancel`

最小能力响应：

```json
{
  "protocolVersion": "1.0",
  "agent": {
    "id": "pilot-agent",
    "kind": "custom",
    "displayName": "Pilot Agent"
  },
  "capabilities": {
    "conversation": { "stream": "sse", "continuation": true },
    "tasks": { "start": true, "get": true, "cancel": true },
    "artifacts": { "upload": false, "download": false },
    "outboundWorkspaceGateway": { "enabled": false }
  },
  "limits": {
    "maxConcurrentRuns": 1,
    "defaultTimeoutSeconds": 120,
    "maxTimeoutSeconds": 600
  }
}
```

验收：以一组 Token 从 Agents One 完成连续两轮对话、SSE 断线重连、取消一个运行；客户端不需要任何第二地址或第二 Token。

## 第二阶段：产物与工具事件

补充：

- `POST /agents-one/v1/artifacts`
- `GET /agents-one/v1/artifacts/{artifactId}`
- `GET /agents-one/v1/runs/{runId}/artifacts`

SSE 需至少支持：`run.started`、`assistant.delta`、`assistant.completed`、`tool.started`、`tool.completed`、`artifact.created`、`run.completed`、`run.failed`。

规则：

- 一般模型回复、思考状态和“任务完成”文字不是 Artifact。
- Artifact 必须包含服务端生成 ID、来源 Run、大小、SHA-256 和访问范围。
- 可以展示用户可见的完整工作摘要；不要推送原始思维链、高频思考快照或任何秘密。

验收：远端生成真实文件或报告时，Agents One 能看到来源、哈希和下载/预览信息；普通回复不会显示为产物。

## 第三阶段：受控访问办公电脑项目

只有在前两阶段通过后再开启能力：

```json
"outboundWorkspaceGateway": {
  "enabled": true,
  "operations": ["list", "read", "write", "move", "delete"],
  "maxOperationBytes": 262144,
  "maxGrantSeconds": null
}
```

实现 [OUTBOUND_WORKSPACE_GATEWAY_BRIDGE_REQUIREMENTS.md](OUTBOUND_WORKSPACE_GATEWAY_BRIDGE_REQUIREMENTS.md) 的队列语义，并在远端智能体中注册真实工具，例如：

```text
workspace_gateway(operation, path, content?, expectedSha256?)
```

工具必须：

1. 只接受 `workspaceRef=desktop-gateway:<grantId>`；
2. 向 Grant 队列提交结构化请求；
3. 等待桌面端主动拉取并回传 `succeeded` / `denied` / `confirmation_required`；
4. 只有收到桌面端计算的相对路径和 SHA-256 后，才向模型报告交付成功。

禁止：传递或记录 Windows 绝对路径、要求 SMB/SSH/RDP、让模型执行本机 Shell、以文本伪造操作成功、自动删除文件。

验收顺序：`list` → `read` → 新文件 `write` → 哈希冲突拒绝 → Grant 过期/撤销 → 删除需本机确认。

## 安全与运行要求

- 所有 v1 端点使用同一个 Bearer Token；Token 只保存在服务端受保护配置与 Agents One 系统凭据存储。
- 不在日志、SSE、错误、Artifact 或模型提示词中输出 Token、请求头、上游内部地址、办公电脑绝对路径、完整文件内容或环境变量。
- 只声明已完整实现并已测试的 capability；不支持就返回 `false`，不得静默降级。
- 保持现有远端服务可用。建议新增独立 Adapter 或反向代理路由，不改写原有 API/Bridge。

## 提交给 Agents One 的验收材料

1. 已部署的 Gateway 基础地址（不含 Token）。
2. `/capabilities` 脱敏响应。
3. 端到端测试表：对话、续接、取消、SSE 重连、Artifact；完成第三阶段时再增加工作区队列测试。
4. 已知限制和未声明 capability 的清单。
5. Token 通过单独安全渠道交付，不写入说明、日志或聊天。
