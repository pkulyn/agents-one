# 办公电脑出站工作区网关 Bridge 协议（v1）

日期：2026-07-28  
适用对象：远程 Hermes、OpenClaw Bridge，以及 Agents One 桌面端。

## 目标与边界

让远程智能体可以参与办公电脑上的本地项目，但办公电脑**不开放入站端口**、不提供 SMB/RDP/SSH 文件共享，也不执行远端传来的 shell、进程或网络命令。

桌面端只会在用户对某个正式任务明确选择“完全访问”后，使用现有 HTTPS + Bearer 会话向远程 Bridge **主动发起**请求。Bridge 仅保存待处理的结构化文件请求；桌面端拉取请求、在本地严格校验后执行、再把脱敏结果回传。

`workspace-grant` 不是目录路径、不是通用凭据，也不能跨任务或跨智能体复用。Bridge 永远不知道本机绝对目录。

## 能力发现

Bridge 在既有根地址下增加：

`GET /workspace-gateway/capabilities`

桌面端默认在 Runtime 服务地址后追加 `/workspace-gateway`。如果网关由独立 HTTPS 服务托管，可单独配置完整地址（例如 `https://host/workspace-gateway`）；客户端会识别已有路径，不会重复追加。该独立网关可以使用与普通对话 Bridge 不同的受保护 Bearer Token。

成功响应：

```json
{
  "capabilities": {
    "outboundWorkspaceGateway": true,
    "operations": ["list", "read", "write", "move", "delete"],
    "maxOperationBytes": 262144,
    "maxGrantSeconds": null
  }
}
```

规则：

- 必须使用现有 Bridge Bearer 认证和项目/任务授权。
- `outboundWorkspaceGateway` 只有在 Bridge 已实现下述所有认证、队列隔离、显式撤销与审计规则时才能为 `true`。
- 未声明或响应不完整时，Agents One 不启用远程本地写入，继续使用“只读证据包”或“远程映射”。不得静默降级。

## 桌面端注册工作区授权

`POST /workspace-gateway/grants`

```json
{
  "id": "workspace-grant-uuid",
  "taskId": "agents-one-run-id",
  "runtimeId": "remote-hermes-or-openclaw",
  "permission": "write",
  "expiresAt": null,
  "maxOperationBytes": 262144,
  "operations": ["list", "read", "write", "move", "delete"]
}
```

响应 `201` 或 `200`：

```json
{ "accepted": true }
```

Bridge 必须：

- 从认证主体、`runtimeId` 和当前任务核验注册权限；不能只信任客户端 ID。
- 只保存上面的授权元数据，**不能要求、记录或推导本机目录路径**。
- 每个 grant 同时只允许一个已认证的远程运行上下文提交请求。
- `expiresAt: null` 的授权不会自动到期；取消、显式 revoke 或桌面端安全策略终止后拒绝新请求并清除排队命令。有限到期时间仍可按部署策略使用。
- 为每个 grant 记录脱敏审计事件：注册、请求入队、结果回传、撤销、拒绝原因。

远程智能体收到的任务提示中只会得到 `desktop-gateway:<grant-id>`。Bridge 应将这个引用作为受控工具上下文，而不是让模型自行猜测本机路径。

## 本机主动拉取与结果回传

桌面端每次主动请求：

`POST /workspace-gateway/grants/{grantId}/pull`

```json
{ "maxWaitSeconds": 20 }
```

没有待办时：

```json
{ "request": null }
```

有待办时：

```json
{
  "request": {
    "id": "workspace-request-uuid",
    "operation": "write",
    "path": "docs/release-notes.md",
    "content": "# Release notes\n",
    "expectedSha256": "optional-previous-content-hash"
  }
}
```

桌面端结果回传：

`POST /workspace-gateway/grants/{grantId}/results`

```json
{
  "requestId": "workspace-request-uuid",
  "status": "succeeded",
  "summary": "Wrote docs/release-notes.md.",
  "data": {
    "path": "docs/release-notes.md",
    "sha256": "actual-result-hash",
    "bytes": 18
  }
}
```

Bridge 应把成功结果回写给发起该工具调用的远程智能体，供其形成真实交付契约；不得把 `summary` 伪装成文件操作已成功。

## 允许的请求模型

| 操作 | 请求字段 | 本机端行为 |
| --- | --- | --- |
| `list` | `path`（可为 `.`） | 仅列出当前目录最多 200 个非链接条目。 |
| `read` | `path` | 仅读取 UTF-8 文本，受 `maxOperationBytes` 限制，回传实际 SHA-256。 |
| `write` | `path`、`content`、可选 `expectedSha256` | 创建或覆盖一个 UTF-8 文件；已有文件建议始终携带期望哈希，冲突即拒绝。 |
| `move` | `path`、`destinationPath`、可选 `expectedSha256` | 仅在根目录内移动，不允许覆盖目标。 |
| `delete` | `path`、可选 `expectedSha256` | 先回传 `confirmation_required`；只有桌面端用户另行确认后才删除。 |

桌面端必须拒绝：绝对路径、`..` 越界、符号链接路径、二进制/超大内容、未授权操作、过期授权、无效哈希和所有未定义字段/操作。

**永不支持**：shell、PowerShell、cmd、进程启动、Git 命令、注册表、网络请求、环境变量、凭据读写、任意代码执行或原始文件系统路径。

## 提交请求接口（远程 Bridge 内部工具）

远程智能体所调用的 Bridge 工具可以是内部函数，或公开为：

`POST /workspace-gateway/grants/{grantId}/requests`

请求体为上一节的 `request` 对象。Bridge 必须在入队前：

- 认证当前远程运行确属该 grant 的 `runtimeId` 和 `taskId`；
- 生成服务端请求 ID；客户端提供的 ID 不可信；
- 限制每个 grant 的排队数量（建议 20）与单次正文大小；
- 禁止同一个 grant 并行执行冲突写操作；
- 将请求原样保留给本机执行器，但不得插入隐藏字段或改写 `expectedSha256`。

工具返回“已排队”不等于文件已写入。模型必须等待 `/results` 的 `succeeded` 和实际哈希，才能声明交付完成。

## 撤销、超时与审计

`POST /workspace-gateway/grants/{grantId}/revoke`

```json
{ "reason": "Task completed or cancelled." }
```

撤销幂等，必须清除未拉取的请求。桌面端在任务成功、失败、超时、取消或程序退出时都会调用。Bridge 还必须在 `expiresAt` 后主动清理。

日志和错误中不得出现：Bearer Token、API Key、Cookie、工作区绝对路径、完整文件正文、环境变量或请求头。对远程智能体的可见错误只说明“请求被拒绝/冲突/需要本机确认”。

## 联调验收

1. Bridge 声明能力后，桌面端可注册 grant 并轮询到空队列；注册内容不含 `D:\`、用户名或本机根目录。
2. 对同一项目执行 `list`、`read`、`write`、`move`；每次结果带相对路径和实际 SHA-256。
3. `../`、绝对路径、链接路径、超大正文、错误 `expectedSha256` 和过期 grant 全部被拒绝，文件不变。
4. `delete` 只得到 `confirmation_required`；本机用户确认前文件不得删除。
5. 取消任务后 Bridge 的排队请求被清空；后续 pull 或 requests 均被拒绝。
6. Hermes 与 OpenClaw 各完成一份真实本机项目文件交付，平台时间线能看到“授权、请求、结果、产物”，验收角色只能引用真实 SHA-256 证据。
