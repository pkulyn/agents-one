# Hers-2 远端 Connector 升级指引

> 可直接转发给 Hers-2 的 Connector / Relay 维护者。
>
> 目标：让 Agents One 桌面端支持 Hers-2 的附件上传、真实模型显示、上下文占用显示和完整事件记录。

## 1. 先确认身份与边界

请先确认以下信息，不要把 Gateway Token 发到聊天记录或提交到代码仓库：

- 稳定 Runtime ID：必须使用 `hermes-home2`（如果实际配置 ID 不同，以配置 ID 为准）。`Hers-2` 只是桌面显示名，不能用于路由。
- Gateway v1 地址，例如：`https://<relay-host>/agents-one/v1`
- 当前 Connector / Plugin SDK 版本。
- Connector 的启动、停止和回滚方式。

工作区文件夹分享使用同一个 Gateway 地址。公网或跨网络部署必须使用 HTTPS；仅在本机、回环地址或 RFC1918 私网 IPv4（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）联调时，Agents One 才允许使用 HTTP。

网页预览是 Agents One 桌面端本地功能，不依赖远端 Connector；本次远端升级不需要为网页预览增加接口。

## 2. 安装新版 Plugin SDK

桌面端项目维护者先在 Agents One 项目中打包 SDK，并通过现有安全渠道把压缩包传给 Hers Relay 主机：

```powershell
cd D:\Agent Console\Agents-One\plugins\agents-one-plugin
D:\efunds\nodejs\npm.cmd pack
```

生成的文件类似：

```text
agents-one-plugin-sdk-0.1.2.tgz
```

在 Hers Relay 主机上，使用 Node.js 20 或更高版本，以当前 Connector 的运行用户执行：

```powershell
node --version
npm --version
npm install .\agents-one-plugin-sdk-0.1.2.tgz
npx agents-one-plugin-verify
```

如果 Connector 在 Linux/NAS 上运行，将上面的 PowerShell 路径改为对应的 shell 路径即可。不要使用管理员权限安装，也不要把 Token 写入 `.env`、日志或安装包名称之外的公共文件。

升级前请备份当前 Connector 配置和启动脚本；升级失败时先回滚 SDK 和启动入口，再检查日志。

## 3. Connector 必须实现的适配接口

### 3.1 按稳定 Runtime ID 路由

`adapter.startRun(input, context)` 至少要同时兼容以下两个位置：

```js
const runtimeId =
  context.runtimeId || input.runtimeId || input.input?.runtimeId;

if (runtimeId !== "hermes-home2") {
  throw new Error(`Unknown runtimeId: ${runtimeId}`);
}
```

必须把 `context.runtimeId` 交给实际 Hermes Connector 路由层。不要使用桌面显示名 `Hers-2` 替代稳定 ID。

### 3.2 实现附件上传

在传给 `createRemoteGatewayPlugin` 的 adapter 中增加：

```js
async uploadArtifact(input) {
  // input.bytes 是 Buffer；input.contentBase64 是兼容字段。
  // 请保存到受控、按租户/运行隔离的 Artifact 存储中。
  const bytes = Buffer.isBuffer(input.bytes)
    ? input.bytes
    : Buffer.from(input.contentBase64 || "", "base64");

  // 必须校验名称、MIME、大小和 SHA-256，校验失败直接拒绝。
  // 实际存储逻辑由 Hers 侧实现，此处仅示意接口。
  const artifact = await artifactStore.put({
    name: input.name,
    mime: input.mime,
    bytes,
    sha256: input.sha256,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });

  return {
    id: artifact.id,
    name: artifact.name,
    mime: artifact.mime,
    size: artifact.size,
    sha256: artifact.sha256,
    expiresAt: artifact.expiresAt,
  };
}
```

实现后，SDK 会自动暴露 `POST /artifacts`，并在能力声明中返回：

```json
"artifacts": { "upload": true, "download": false }
```

桌面端上传流程是：本机安全暂存附件 → `POST /artifacts` → 获得不可变 `id` → 在 `POST /runs` 的 `input.artifactIds` 中引用。Connector 不会收到办公电脑的原始路径。

当前桌面端限制：单个上传附件不超过 10 MB；图片通常会先压缩到 5 MB 以内；文本文件限制为 256 KB。Connector 仍应在服务端再次校验大小、MIME 和哈希。

### 3.3 把输出文件发布为真实 Artifact

SDK v0.1.2 会在 `startRun` 上下文中提供 `publishArtifact`。Connector 必须把它包装成 Hers/Hermes 智能体可调用的结构化工具；工具只读取本次运行的受控输出目录，并把真实字节交给 SDK：

```js
async startRun(input, { emit, publishArtifact }) {
  const agentsOneArtifactTool = {
    name: "agents_one_publish_artifact",
    description: "把本轮生成的文件登记为 Agents One 输出产物。",
    inputSchema: {
      type: "object",
      required: ["name", "mime", "path"],
      properties: {
        name: { type: "string" },
        mime: { type: "string" },
        path: { type: "string" },
      },
    },
    async execute({ name, mime, path }) {
      // 必须校验 path 位于本次运行的受控输出目录；不要允许任意绝对路径。
      const bytes = await readApprovedRunOutput(input, path);
      return await publishArtifact({ name, mime, bytes });
    },
  };

  // 按 Hers/Hermes 的原生工具注册方式，把 agentsOneArtifactTool
  // 注入本轮运行；不要把 Gateway Token 暴露给模型。
  return await startNativeHermesRun(input, { tools: [agentsOneArtifactTool] });
}
```

`publishArtifact` 会校验大小和可选 SHA-256，自动计算最终 SHA-256，把产物加入 Run 快照，写入稳定的 `artifact.created` 事件，并让 `GET /artifacts/{id}` 返回真实 `contentBase64`。如果 Connector 在轮询阶段才发现原生产物，也可使用 `getRun(vendorRunId, record, { publishArtifact })` 的第三个参数发布。

SDK 已提供等价 helper：`import { createAgentsOneArtifactTool } from "@agents-one/plugin-sdk/hermes"`。传入 `publishArtifact` 和 Connector 自己实现的安全 `readOutput` 后，即可得到上面的通用工具定义。

仅在最终答复里打印一段 `artifact.created` JSON、`MEDIA:文件名` 或远端绝对路径不算上传；桌面端拿不到文件字节时必然无法显示图片。若 Hers 已有独立 Artifact 存储，也可继续实现 `getArtifact(artifactId)`，但事件中的 `id` 必须与下载接口使用同一个不可变 ID。

### 3.4 返回真实模型和上下文用量

`adapter.getRun` 的返回值或事件的 `data` 中必须尽可能带真实元数据：

```js
return {
  status: "succeeded",
  output: finalText,
  model: {
    provider: "ark",
    id: "实际模型 ID",
    contextWindowTokens: 1000000,
  },
  usage: {
    inputTokens: 1200,
    outputTokens: 320,
    totalTokens: 1520,
    contextUsedTokens: 39849,
    contextWindowTokens: 1000000,
  },
  events,
};
```

如果 Hermes 原生字段使用 snake_case，也可以返回 `model_name`、`modelId`、`context_window_tokens`、`context_used`、`context_max`；Agents One 会兼容这些别名。但不能猜测模型名、上下文窗口或用量；拿不到就省略字段。

### 3.5 保留真实事件

至少保留并返回以下事件：

在 Adapter 启动配置中稳定声明已经实现的事件能力，不要根据本进程是否观察到过事件动态切换：

```js
capabilities: {
  eventStream: {
    reasoningSummaries: true,
    toolEvents: true,
    modelMetadata: true,
    usageMetadata: true,
  },
}
```

```js
emit({
  id: "evt_reasoning_1",
  type: "reasoning.summary",
  data: { summary: "正在检查任务要求。" },
});

emit({
  id: "evt_tool_1",
  type: "tool.completed",
  data: {
    tool: {
      kind: "mcp",
      name: "实际工具名",
      inputSummary: "脱敏后的输入摘要",
      outputSummary: "脱敏后的结果摘要",
    },
  },
});

emit({
  id: "evt_answer_1",
  type: "assistant.completed",
  data: {
    text: finalText,
    model: { provider: "ark", id: "实际模型 ID", contextWindowTokens: 1000000 },
    usage: { contextUsedTokens: 39849, contextWindowTokens: 1000000 },
  },
});
```

要求：

- `assistant.completed` 必须在终态前持久化，且终态快照同时有 `output`。
- 事件 ID 在重试和重连时保持不变，`sequence` 单调递增。
- 只发送用户可理解的推理摘要，不发送原始思维链、Token、Cookie、环境变量、绝对路径或完整敏感文件内容。
- 不要把“远程智能体已返回新的答复”“正在整理答复”等空状态伪装成思考事件。

## 4. 能力声明验收

重启 Connector 后，用 Gateway Token 请求：

```bash
curl -sS \
  -H "Authorization: Bearer <GATEWAY_TOKEN>" \
  "https://<relay-host>/agents-one/v1/capabilities"
```

至少应看到：

```json
{
  "protocolVersion": "1.0",
  "plugin": {
    "id": "agents-one-plugin-sdk"
  },
  "capabilities": {
    "tasks": { "start": true, "get": true },
    "artifacts": { "upload": true, "download": true },
    "eventStream": {
      "protocol": "agents-one-event-stream-v1",
      "transport": "poll",
      "modelMetadata": true,
      "usageMetadata": true
    }
  }
}
```

只有真正实现了对应能力，才能声明 `modelMetadata`、`usageMetadata` 或 `artifacts.upload=true`。

## 5. 端到端验收顺序

### 5.1 附件

用一个无敏感内容的小文件测试 `POST /artifacts`。请求体核心字段：

```json
{
  "name": "connector-smoke.txt",
  "mime": "text/plain",
  "size": 5,
  "sha256": "<64 位 SHA-256>",
  "contentBase64": "aGVsbG8="
}
```

成功应返回 HTTP `201`，并包含非空 `id`、`name`、`mime`、`size`、`sha256`。随后创建运行时确认请求体包含：

```json
{
  "runtimeId": "hermes-home2",
  "input": {
    "text": "请读取附件。",
    "artifactIds": ["刚才返回的 artifact id"]
  }
}
```

### 5.2 输出 artifact 下载往返

这是本次图表现场 smoke test 的关键步骤。Hers-2/Relay 需要先在一次运行中生成一个真实小文件（推荐 PNG 或 TXT），并在事件中返回：

```json
{
  "type": "artifact.created",
  "data": {
    "artifact": {
      "id": "artifact_chart",
      "label": "test-chart.png",
      "mime": "image/png",
      "size": 1234,
      "sha256": "<64 位 SHA-256>"
    }
  }
}
```

随后用同一个 Gateway Token 请求：

```bash
curl -sS \
  -H "Authorization: Bearer <GATEWAY_TOKEN>" \
  "https://<relay-host>/agents-one/v1/artifacts/<artifactId>"
```

成功应返回 HTTP `200`，并包含同一 `id`、`name`、`mime`、`size`、`sha256` 以及 `contentBase64`（或 `content_base64`）。若适配器内部返回 `bytes`，新版 Plugin SDK 会自动转换为 `contentBase64`。

桌面端收到运行终态后会自动调用这个下载接口；随后主进程校验 Base64、大小和 SHA-256，将文件暂存到本机，再由原生对话界面显示图片或文件芯片。Renderer 不应直接访问 Relay 或持有 Token。

### 5.3 模型和上下文

运行结束后请求 `GET /runs/{runId}`，确认同一快照包含：

- `output` 或 `assistant.completed.data.text`；
- `model.id`、`model.provider`、`model.contextWindowTokens`；
- `usage.inputTokens` 或 `usage.contextUsedTokens`；
- `usage.contextWindowTokens`。

然后在 Agents One 中重新连接或重新打开 Hers-2 对话，确认：

1. 纸夹按钮可点击并能添加附件。
2. 输入栏显示真实模型名，而不是“未提供模型”。
3. 输入栏显示上下文占用环形指示器。
4. 思考摘要、工具调用和最终答复仍能正常显示。

## 6. 故障定位

| 现象                                                 | 检查项                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上传附件按钮仍禁用                                   | `/capabilities` 是否有 `artifacts.upload=true`；SDK 是否真的加载了包含 `uploadArtifact` 的版本；Relay 是否转发了 `/artifacts`。                                                                                                         |
| 点击附件后上传失败                                   | 检查 HTTP 状态、Bearer 鉴权、Base64 解码、大小限制、SHA-256 和 Artifact 存储权限。                                                                                                                                                      |
| 显示“未提供模型”                                     | `GET /runs/{id}` 或事件中没有真实 `model`；检查适配器是否把原生模型字段映射出来。                                                                                                                                                       |
| 上下文环形指示器不显示                               | 缺少 `contextWindowTokens`/`context_max`；只有 `inputTokens` 没有窗口容量时，客户端不会猜测百分比。                                                                                                                                     |
| 工具记录重复                                         | 重连时事件 ID 或 sequence 被重新生成；必须复用原始事件 ID。                                                                                                                                                                             |
| 任务跑到错误的智能体                                 | 检查 `runtimeId` 是否为稳定 ID `hermes-home2`，不要使用 `Hers-2` 显示名。                                                                                                                                                               |
| 文件夹分享提示需要 HTTPS                             | 若是公网/跨网络地址，请把 Gateway 改成 `https://...`；若是局域网联调，请确认使用的是 `10.x`、`172.16-31.x` 或 `192.168.x` 私网 IPv4，而不是公网域名或公网 IP。                                                                          |
| 文件夹分享提示 `grant_not_found`                     | 先重新发起一次新的任务/对话。新版桌面端会在当前 Grant 仍有效时自动重新登记；若仍失败，请确认 Relay 的 `/workspace-grants` 与 `/runs.input.workspaceRef` 使用同一 Grant 存储，并且 Connector 已加载新版 SDK。                            |
| 工作区授权显示 600 秒                                | Relay 的 `outboundWorkspaceGateway.maxGrantSeconds` 应改为 `null` 或省略，并接受桌面端注册请求中的 `expiresAt: null`；`null` 表示仅显式 revoke 才失效。旧 Relay 返回 `grant_expired` 时桌面端会尝试自动重新登记，但建议同步升级 Relay。 |
| 工作区出现 `Workspace path must be project-relative` | Connector 应使用项目相对路径；项目根目录请传 `.` 或 `/`，桌面端会把 `/` 归一化为已授权项目根目录，不要传 Windows 绝对路径。                                                                                                             |
| 工作区出现目录不存在                                 | 重新选择仍存在的本机项目目录；桌面端不再在错误记录中显示本机绝对路径。                                                                                                                                                                  |
| 出现 `HTTP 404: run_not_found`                       | 通常是 Relay 重启/热更新后丢失了正在执行的 Run。不要自动重放旧消息；先确认 Relay/Connector 已稳定，再重新发送消息，避免重复执行文件写入。                                                                                               |

完成升级后，请回传以下四项结果即可：

1. `GET /capabilities` 中 `artifacts.upload` 的值；
2. 一次 `/artifacts` 上传返回的字段（请脱敏 Token）；
3. 一次终态 `/runs/{id}` 中的 `model` 和 `usage`；
4. Agents One 桌面端复测截图或现象。
