# Hers Relay 对齐 Gateway v1 Workspace Grant 清单

## 目标

Hers Relay 继续只向 Agents One 提供一个 Gateway 地址和一个 Bearer Token。桌面端主动出站拉取受控文件操作；家庭电脑和 Relay 均不能连接办公电脑、获知办公电脑绝对路径或获得任意 Shell。

## 当前必须修正的协议差异

1. `GET /capabilities` 的 `outboundWorkspaceGateway` 不能只返回 `enabled: true`，必须完整声明：

```json
{
  "enabled": true,
  "operations": ["list", "read", "write", "move", "delete"],
  "maxOperationBytes": 262144,
  "maxGrantSeconds": null
}
```

`maxGrantSeconds` 为 `null` 或省略时表示 Grant 默认不自动到期；桌面端会以 `expiresAt: null` 注册，并在任务结束、取消或明确撤销时调用 revoke。若 Relay 继续返回有限值（例如 600），桌面端仍会优先请求不自动到期，并在旧 Relay 返回 `grant_expired` 时尝试重新登记当前 Grant；Relay 应尽快支持显式撤销的非过期 Grant。

2. `POST /workspace-grants` 不得要求 `workspaceRoot`。注册体只接收不透明的 `grantId`、任务/Runtime ID、权限、到期时间、单次大小和操作集合。办公电脑绝对路径永不出站。

3. 必须保留桌面端提交的 `grantId`。Relay 不得另生成不同 ID；注册响应中的 `grantId` 必须与请求一致，因为同一 ID 会进入 `/runs` 的 `workspaceRef`。

4. `POST /workspace-grants/{grantId}/pull` 必须返回单项 `{ "request": null }` 或 `{ "request": {...} }`，不能返回 `{ "requests": [] }` 批量结构。

5. 当注册请求的 `expiresAt` 为 `null` 时，Relay 不应自动设置 600 秒到期；该 Grant 只能在显式 revoke、任务/会话权限撤销或安全策略拒绝时失效。若请求提供具体时间，Relay 返回的 Grant 到期时间不得晚于桌面端请求时间，也不得超过 `maxGrantSeconds`。到期或撤销后，入队、拉取和结果查询均应拒绝。

6. `POST /runs` 收到 `workspaceRef=desktop-gateway:<grantId>` 时，Connector/Hermes 必须注册真实的 `workspace_gateway` 工具。模型调用该工具后：
   - Relay 向 `/workspace-grants/{grantId}/requests` 入队结构化请求；
   - 等待桌面端回传结果；
   - 只有收到 `succeeded` 和本机 SHA-256 后才能报告写入成功；
   - 不得猜测 Windows 路径、输出伪完成结果或改用远端 Shell 代替本机操作。

7. `delete` 请求收到 `confirmation_required` 后必须暂停，等待用户在办公电脑逐次确认；不得重试绕过确认。

## 长任务与轮询

- `/capabilities` 的 `limits.defaultTimeoutSeconds` 建议为 1800，`maxTimeoutSeconds` 建议不低于 3600。
- `/runs` 必须接受桌面端传入的 `execution.timeoutSeconds`，并在服务端超时后标记 `timed_out`。
- `GET /runs/{runId}` 应支持长任务持续轮询；短暂 Relay/Connector 断连不能把仍在运行的任务立即标记失败。
- 任务完成、失败、取消或超时后必须保持终态可查询，至少保留 24 小时。

## 对齐后的自测顺序

1. capabilities 完整声明。
2. 注册 Grant，确认 ID 不变且无 `workspaceRoot`。
3. 空队列 pull 返回 `request: null`。
4. 远端 Runtime 对 `list/read` 发起真实工具请求并读取桌面结果。
5. 写入新测试文件，核对相对路径、字节数和 SHA-256。
6. 用错误 `expectedSha256` 验证冲突拒绝。
7. 撤销和过期后确认请求被拒绝。
8. delete 返回等待本机确认，不自动删除。
9. 运行超过 5 分钟的任务，确认 Run 状态和会话可连续查询。

完整规范以 [AGENTS_ONE_REMOTE_GATEWAY_V1.md](AGENTS_ONE_REMOTE_GATEWAY_V1.md) 第 10 节为准。

## 真实工具绑定验收门槛

能力声明、Grant 注册成功和 Run 返回 `succeeded` 都不能单独证明本机工作区已经接通。Hers 的正式验收必须同时满足：

1. 一轮真实 Run 至少产生一项由桌面端收到并执行的 `list`、`read` 或 `write` 请求。
2. 每项请求均有服务端生成的 request ID，以及桌面端回传的真实结果；写入结果必须包含相对路径、字节数和本机计算的 SHA-256。
3. Relay/Connector 必须把 `workspaceRef=desktop-gateway:<grantId>` 注入为 Hermes 可调用的 `workspace_gateway` 工具。模型调用工具后，Connector 负责入队请求、等待桌面结果并把结果返回模型。
4. 远端答复中出现“已完成”“全绿”或虚构的文件摘要，不属于验收证据。没有真实请求和结果时，Agents One 会将该轮标记为失败。
5. 端到端脚本 `node scripts/verify-hers-workspace-gateway.js` 必须观察到实际操作并在授权目录生成、核验测试文件，才算通过。

### 2026-07-29 真实联调结果

- 桌面端已能通过 Hers 的 HTTPS Gateway 注册和撤销 10 分钟 Grant，且自签名证书只在明确 TLS 自签名错误时进行兼容重试。
- 连续两轮真实 Run 均返回 `succeeded`，但桌面端观察到的操作数为 `list=0, read=0, write=0`，测试文件未生成。
- 远端答复曾声称“Workspace Gateway E2E 全绿”，但无 request ID、桌面执行结果或本机哈希，因此被验收脚本正确判定为失败。
- 当前阻塞点位于 Hers Relay/Connector：接口队列和能力声明存在，但尚未把 `workspace_gateway` 注册为 Hermes 的真实运行工具。

### 2026-07-30 工具绑定复测结果

- Relay 的 `POST /workspace-grants` 已返回 `201`，保留桌面端生成的 `grantId`，并返回 `active`；标准注册端点工作正常。
- Run 严格按 v1 将 `workspaceRef=desktop-gateway:<grantId>` 放入 `input.workspaceRef`。Hers 已能看到 `workspace_gateway` 工具，但工具返回 `No workspace grant is associated with this session`，桌面端仍未收到任何操作请求。
- 诊断确认 `POST /workspace-grants/register` 为 `404`，不属于 v1 接口；将 `workspaceRef` 错放到 Run 顶层会被 Relay 以 `400` 拒绝。
- 临时使用裸 `grantId` 时，工具开始发起操作，但将刚注册且未到期的 Grant 判定为 `403 grant_revoked`。这表明 Relay 到 Connector 的 `workspaceRef` 解析和 Grant 状态存储尚未对齐，而不是桌面端目录执行器故障。

Hers Relay/Connector 需要同时修复：

1. 从 `POST /runs` 的 `input.workspaceRef` 读取值，并只接受 `desktop-gateway:<grantId>` 格式。
2. 去掉 `desktop-gateway:` 前缀后，使用剩余的原始 `grantId` 查询与 `POST /workspace-grants` 相同的共享 Grant 存储。
3. Run 创建、Connector 工具调用和 `/workspace-grants/{grantId}/requests` 必须读取同一 Grant 实例与状态；不能使用进程内副本、旧会话缓存或另一套数据库。
4. 只有显式调用 revoke、到期或安全策略拒绝时才能转为 revoked；创建 Run 或绑定会话不得撤销 Grant。
5. 工具入队前应记录脱敏审计事件 `workspace_ref_bound`、`request_queued` 或明确的拒绝原因，便于区分“未绑定”“未知 Grant”“已撤销”和“已过期”。

### 2026-07-30 第二轮修复后复测

- 独立状态探针确认 Relay 的共享 Grant 存储工作正常：新 Grant 注册为 `active`，向同一 ID 的 `/requests` 入队返回 `202`，桌面端 `/pull` 能取得真实 `list` 请求。
- 真实 Run 中的 `workspace_gateway` 仍返回 `403 grant_revoked`，而该 Run 使用的是刚注册的新 Grant；桌面端仍未收到任何来自 Connector 的请求。
- 结论进一步收敛：Connector/Hermes 工具仍持有上一轮已撤销的 Grant ID，或把 Grant 绑定保存为进程级/会话级单例，没有在每次 Run 开始时用当前 `input.workspaceRef` 覆盖。

远端修复必须满足：

1. 每次创建 Run 都解析本轮 `input.workspaceRef`，并创建绑定到该 Run ID 的独立工具上下文。
2. 禁止使用全局 `ACTIVE_GRANT_ID`、首次绑定后不更新的闭包，或从旧 Hermes 会话恢复已撤销的 Grant。
3. 工具每次入队必须取当前 Run 上下文的 Grant ID；Run 终止后清除此绑定。
4. 新一轮自动测试必须看到当前 Grant 的 `workspace_ref_bound` 审计事件，且事件中可核对当前 Run ID 和脱敏 Grant ID 片段。

### 2026-07-30 Run 级绑定修复后复测

Run 级 Grant 绑定已经生效：真实 Hers Run 产生了桌面端可拉取和执行的 `list=1`、`read=1` 请求，说明 `input.workspaceRef`、当前 Run 与 Connector 工具上下文已经连通。本轮未通过完整验收，剩余问题均位于 Relay 的 v1 数据模型：

1. `POST /workspace-grants` 收到标准字段 `"permission": "write"` 后，响应仍为：

   ```json
   {
     "permissions": {
       "read": true,
       "write": false,
       "delete": false
     }
   }
   ```

   Relay 必须把 `permission=write` 映射为 `permissions.write=true`；不得只保存 `operations` 而丢失授权级别。当前真实 `write` 请求因此被 `403 permission_denied:write_required` 拒绝。

2. 桌面端按 v1 回传：

   ```json
   {
     "requestId": "...",
     "status": "succeeded",
     "summary": "...",
     "data": {
       "entries": []
     }
   }
   ```

   Relay 的结果查询却返回 `"result": null`，导致 Connector 将成功的 `list/read` 解释为 null。协议探针确认，只有额外提交非标准的 `"result": {...}` 字段才会被保存。Relay 应把标准 `data` 原样保存并在结果查询/工具返回中提供给 Connector；桌面端不会为单个 Relay 改用私有结果格式。

3. `POST /workspace-grants/{grantId}/results` 对 `"status": "denied"` 仍返回 `400 invalid_status`。v1 必须接受 `succeeded`、`denied`、`confirmation_required`、`failed`，并把状态与脱敏摘要返回给发起工具调用的智能体。

4. Connector 不应调用未声明的 `hash` 操作。文件 SHA-256 已包含在桌面端 `read/write` 的成功结果中，应直接使用该证据。

自动验收脚本已增加注册权限保真和结果载荷往返断言。当前它会在 Grant 注册阶段直接报告：

```text
Hers Relay did not preserve permission=write when registering the Workspace Grant.
```

待上述三项 Relay 合约修复后，重新运行：

```powershell
node scripts/verify-hers-workspace-gateway.js
```

正式通过必须同时看到 `list/read/write` 非零、生成 `agents-one-gateway-e2e.txt`，并核对本机 SHA-256。

### 2026-07-30 最终修复后正式通过

Hers 修复权限映射、标准结果载荷和状态枚举后，完整自动联调正式通过：

- 当前 Run 正确绑定本轮短时 Grant。
- 桌面端实际执行 `list=1`、`read=1`、`write=1`。
- 授权目录生成 `agents-one-gateway-e2e.txt`，内容为 `Agents One Gateway v1 E2E passed`。
- 独立文件核验：32 字节，SHA-256 为 `1d2d9765d1c2a8aaa2c7bb8db02c2efebc18e85a284de81dc0d81378e0e346c5`，与 Run 验收输出一致。
- 标准 `data` 结果载荷可以被 Relay 保存并返回 Connector，Hers 能基于真实 `list/read` 结果继续执行。
- 失败路径探针通过：`denied` 结果回传 HTTP 200，查询状态保持为 `denied`。
- 测试结束后 Grant 已主动撤销，没有依赖自然过期。
- 桌面端 Gateway/Runtime 回归测试 22 项全部通过。

### 2026-07-30 删除逐次确认对齐

Hers 的真实删除测试返回了：

```text
grant_revoked: The workspace grant has been revoked or expired.
Detail: permission_denied:delete_required
```

这里不能通过新增长期 `delete` 权限解决。Gateway v1 的 Grant 权限枚举只有
`read` 与 `write`；桌面端注册 `permission: "write"` 且 `operations` 包含
`"delete"` 时，远端可以提交删除请求，但不能自行决定删除。

Relay/Connector 必须按以下顺序处理：

1. 当前 Grant 为 `write`、未过期、未撤销，且 `operations` 包含 `delete` 时，将删除请求正常入队。
2. 不得在入队前返回 `permission_denied:delete_required`，也不得要求私有的 `delete=true`、`full_access` 等权限字段。
3. 桌面端拉取请求后弹出本机逐次确认，只显示智能体名称和项目内相对路径。
4. 用户允许后，桌面端再次校验 Grant、路径边界和 `expectedSha256`，执行删除并回传最终 `succeeded`。
5. 用户拒绝、授权过期、文件变化或路径不安全时，桌面端回传最终 `denied`；Relay 将该结果原样返回给 Hers。
6. 等待本机确认期间，Relay 保持请求有效，不得将其改写为 `grant_revoked`。

Agents One 桌面端已经接入原生确认框，并保留“默认拒绝、一次一授权”的安全策略。
Relay 完成上述对齐后，Hers 才会真正触发办公电脑上的删除确认。

结论：Hers 已通过 Agents One Remote Gateway v1 Workspace Grant 首轮真实读写验收，可在受控短时授权下参与办公电脑本地项目。

### 2026-07-30 同一对话多轮 Grant 验收

Workspace Grant 是 **Run 级短时授权**，不能作为会话级永久绑定。桌面端会在每轮运行开始时注册新 Grant，并在该轮进入终态后主动撤销。为同时满足会话连续性和工具重新挂载：

1. 每轮带 `input.workspaceRef` 的请求使用 `mode=task`。
2. 同一任务对话继续携带相同或 Relay 返回的 `conversationId`，由该字段恢复 Hermes 对话上下文。
3. Relay/Connector 必须在每个 Run 上重新解析当前 `input.workspaceRef`，不得复用上一轮已撤销的 Grant。
4. 没有 `workspaceRef` 的普通续聊可以继续使用 `mode=conversation`。

真实双轮验收已通过：

- 第一轮：新 Grant A，`list=1`、`read=1`，完成后撤销 A。
- 第二轮：相同 `conversationId`、新 Grant B，`read=3`、`write=2`。
- 第二轮同时完成已有文件编辑和新 Markdown 文件创建，两个文件均由办公电脑本地执行器落盘并独立计算 SHA-256。

可重复运行：

```powershell
node scripts/verify-hers-workspace-continuation.js "<workspaceRoot>"
```

此脚本不会输出 Gateway Token，并使用专用测试文件名，避免修改业务文档。
