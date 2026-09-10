# 远程协调者 Bridge 能力要求（v1）

日期：2026-07-13
适用对象：远程 Hermes、OpenClaw 或任何希望作为 Agents One 项目协调者的 Bridge。

## 背景与安全底线

Agents One 可以把任一 Runtime 设为项目协调者，但自动“Plan”必须在技术上保证只读，不能只依赖提示词。一次真实联调中，远程 Hermes 收到规划请求后自行调用了工具并尝试在远端工作区写入计划；任务已取消，未修改本地项目文件。

因此，在远程 Bridge 提供并**服务端强制执行**本规范前，Agents One 只允许远程 Hermes/OpenClaw 承担人工对话式协调或由用户显式派发的任务，不开放自动 Plan。Bridge 不得在能力缺失时把只读规划静默降级为普通 Agent 任务。

## 术语与枚举

- **只读规划**：仅生成结构化任务建议，不调用工具、不读写工作区、不管理进程、不访问凭据。
- **项目隔离**：一个 plan、artifact 和 security event 均属于一个 `projectId`；服务端必须从认证主体校验其访问权限，不能只信任客户端传入的 ID。
- `suggestedRuntimeKind` 的合法值固定为：`hermes`、`codex`、`claude-code`、`openclaw`。未知值必须被拒绝或标记为不可执行建议。
- `toolPolicy` 的合法值：`disabled`。`disabled` 明确表示“服务端禁止所有工具”，不是“未设置策略”。
- `filesystem` 的合法值：`disabled`。
- `network` 的合法值：`disabled`、`read-only-fetch`。使用 `read-only-fetch` 时，响应必须返回实际读取的来源清单；不得执行网络写操作。

## 能力发现

首选端点为 `GET /capabilities`。若 Bridge 为兼容既有部署将能力嵌入健康检查，`GET /health` 的响应体也可包含同一 `capabilities` 字段；Agents One 会优先读取专用端点，只有专用端点不存在时才回退健康端点。

```json
{
  "protocolVersion": "1",
  "capabilities": {
    "orchestration": true,
    "readOnlyPlanning": true,
    "cancellation": true,
    "artifacts": true,
    "securityEvents": true
  },
  "limits": {
    "maxConcurrentPlans": 2,
    "maxConcurrentPlansPerProject": 1,
    "defaultTimeoutSeconds": 120,
    "maxTimeoutSeconds": 300,
    "maxOutputChars": 20000,
    "artifactTtlSeconds": 604800
  }
}
```

`readOnlyPlanning: true` 的含义必须是服务端强制执行，而不是系统提示词约定：

- 禁止 shell、代码执行、文件读取/写入、删除、移动、Git 写入、配置修改和进程管理。
- 禁止访问凭据、环境变量值、未授权工作区、完整会话历史和任意原始请求头。
- `network: "disabled"` 时禁止全部网络访问；`read-only-fetch` 时仅可 GET/HEAD 到服务端白名单范围，且必须记录来源。
- 规划正文只能作为响应或不可变 artifact 返回，不能写入远端磁盘。
- 无法强制任一声明约束时，必须返回 `409` 或 `422`，不得创建普通 Agent run。

## 创建只读规划

`POST /orchestration/plans`

请求必须包含 `Idempotency-Key`，用于避免桌面端重试创建重复规划。

```json
{
  "projectId": "project-uuid",
  "objective": "项目目标",
  "context": {
    "requirements": ["..."],
    "artifactReferences": [{ "id": "artifact-1", "label": "测试摘要" }]
  },
  "constraints": {
    "toolPolicy": "disabled",
    "filesystem": "disabled",
    "network": "disabled",
    "maxOutputChars": 20000,
    "timeoutSeconds": 120
  }
}
```

规则：

- `timeoutSeconds` 未传时使用 capabilities 的 `defaultTimeoutSeconds`；超过 `maxTimeoutSeconds` 时返回 `422`。服务端到时必须停止执行并终态化为 `timed_out`。
- 同一 `projectId` 默认同时只允许一个活动 plan；服务端总并发由 `maxConcurrentPlans` 决定。超限返回 `429`，响应应携带 `Retry-After`。
- 服务端必须校验 `artifactReferences` 的项目归属和访问权；不能访问的引用返回 `403` 或 `422`。

成功时返回 `202`：

```json
{
  "id": "plan-run-uuid",
  "projectId": "project-uuid",
  "status": "running",
  "enforced": {
    "toolPolicy": "disabled",
    "filesystem": "disabled",
    "network": "disabled",
    "timeoutSeconds": 120
  },
  "createdAt": "2026-07-13T08:00:00Z"
}
```

## 查询、取消与审计

### 查询计划

`GET /orchestration/plans/{id}` 返回下列状态之一：

`queued`、`running`、`cancelling`、`succeeded`、`failed`、`cancelled`、`timed_out`。

`succeeded` 的响应包含结构化计划、有限日志、来源列表和 artifact 引用。`cancelling` 不是终态；桌面端必须继续轮询至终态或本地超时。

### 取消计划

`POST /orchestration/plans/{id}/cancel` 必须幂等。

- 能同步确认停止时，返回 `200`、`status: "cancelled"`、`cleanedUp: true`。
- 仍在终止时，返回 `202`、`status: "cancelling"`；后续 `GET` 必须最终确认 `cancelled`、`timed_out` 或 `failed`。
- 服务端必须清理临时文件、子进程、工具会话和网络连接。若清理失败，返回 `cleanupErrors` 的脱敏摘要，并记录安全事件；不得谎称 `cleanedUp: true`。

### 查询安全事件

`GET /orchestration/security-events?projectId={projectId}&cursor={cursor}` 返回按时间追加的、已脱敏事件，用于验收和事故排查。

```json
{
  "items": [
    {
      "id": "event-uuid",
      "projectId": "project-uuid",
      "planId": "plan-run-uuid",
      "type": "policy_denied",
      "summary": "Filesystem access was denied by read-only policy.",
      "createdAt": "2026-07-13T08:00:02Z"
    }
  ],
  "nextCursor": null
}
```

该接口不得返回 Authorization、Token、API Key、Cookie、环境变量值、完整请求头、完整提示词或未授权项目数据。

## 计划与产物结果

完成结果中的计划必须是结构化 JSON：

```json
{
  "summary": "...",
  "tasks": [
    {
      "title": "...",
      "requirement": "...",
      "acceptanceCriteria": "...",
      "dependencies": [],
      "suggestedRole": "implementer",
      "suggestedRuntimeKind": "codex"
    }
  ],
  "risks": ["..."],
  "sources": [],
  "artifacts": [
    {
      "id": "artifact-uuid",
      "projectId": "project-uuid",
      "kind": "plan",
      "label": "Read-only plan",
      "sha256": "...",
      "expiresAt": "2026-07-20T08:00:00Z"
    }
  ]
}
```

artifact 必须不可变、带项目隔离、由认证主体授权访问，并在 capabilities 声明的 TTL 后清理。Agents One 只将上述 JSON 作为**待用户审阅的提案**，不会自动创建任务、自动派发、自动合并代码或自动执行高风险操作。

## 错误语义

| 状态码           | 含义                                 | 客户端行为                                |
| ---------------- | ------------------------------------ | ----------------------------------------- |
| `401` / `403`    | 认证或项目授权失败                   | 停止，不重试，不显示凭据细节。            |
| `404`            | plan 或能力端点不存在                | 降级为人工协调，不发普通任务。            |
| `409`            | 不能强制执行所声明的只读策略         | 停止并显示安全诊断。                      |
| `422`            | 请求、约束、超时或 artifact 引用无效 | 要求用户/调用方修正输入。                 |
| `429`            | 并发配额耗尽                         | 按 `Retry-After` 退避，或由用户稍后重试。 |
| `5xx` / 网络错误 | Bridge 暂不可用                      | 保留最后状态，按本地超时与取消策略处理。  |

## 验收条件

1. 分别尝试文件读取/写入、shell、进程管理、网络写和凭据读取；服务端均拒绝并可从 security-events 查询到脱敏记录。
2. 传入 `timeoutSeconds` 后，任务在对应时限终止并变为 `timed_out`；无请求时使用声明的默认值。
3. 同项目并发第二个 plan 返回 `429`；幂等重试同一 `Idempotency-Key` 不创建第二个 run。
4. 同步取消立即返回 `cancelled`；异步取消经过 `cancelling` 后可轮询到终态，并正确报告清理结果。
5. artifact 不能跨项目读取，具有不可变标识和 TTL；日志、事件和 artifact 不包含认证或环境变量秘密。
6. Agents One 仅在 capabilities 同时声明 `orchestration`、`readOnlyPlanning`、`cancellation`、`artifacts`、`securityEvents` 时启用远程自动 Plan。
