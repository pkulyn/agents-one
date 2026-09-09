# Agents One Plugin SDK（预览版）

这是 Agents One 的独立接入插件套件。它把不同智能体的原生运行过程转换成统一的 Gateway v1 与 Agent Event Stream v1，不改变智能体的模型、工具、工作区或权限本身。

## 两类插件

| 场景                                        | 使用组件            | 安装位置                |
| ------------------------------------------- | ------------------- | ----------------------- |
| Hermes、OpenClaw、其他远程 Agent            | `gateway`           | 远程 Agent/Relay 服务器 |
| Codex、Claude Code、Pi 等本地 CLI           | `cli`               | 运行 CLI 的本机         |
| 多个远程 CLI Runtime（首个为 OpenCode ACP） | `host` + `opencode` | 远程 CLI 主机           |

远程 Agent 对 Agents One 只暴露一个 Gateway 地址和一个 Token。CLI Adapter 不使用 Gateway Token，也不会通过远程服务转发本地命令。

## 快速验证

```powershell
cd plugins/agents-one-plugin
node ./bin/verify.mjs
node --test ./test/*.test.mjs
```

## 安装与升级

预览阶段可直接从仓库安装或打包为 tarball：

```powershell
cd <repo>\plugins\agents-one-plugin
npm.cmd pack
# 在远程 Relay 或本地 CLI 的插件目录执行：
npm.cmd install .\agents-one-plugin-sdk-0.1.2.tgz
```

`agents-one-plugin.manifest.json` 声明该包支持的协议与安全约束。升级插件后应重新执行 `agents-one-plugin-verify`、插件自身回归和目标智能体的真实对话/工具/工作区验收；只有破坏性协议变更才升级到 v2。

## 远程 Gateway 宿主

```js
import { createRemoteGatewayPlugin } from "@agents-one/plugin-sdk/gateway";

const plugin = createRemoteGatewayPlugin({
  agent: { id: "hers-home", kind: "hermes", displayName: "Hers" },
  token: process.env.AGENTS_ONE_GATEWAY_TOKEN,
  adapter: {
    capabilities: {
      eventStream: {
        reasoningSummaries: true,
        toolEvents: true,
        modelMetadata: true,
        usageMetadata: true,
      },
    },
    async startRun(input, { emit, publishArtifact }) {
      // 立即创建/派发原生 run；不要等待长任务结束。
      emit({
        id: "evt_started",
        type: "reasoning.summary",
        data: { reasoningSummary: "正在理解任务。" },
      });
      // Connector 应把 publishArtifact 包装成远端智能体可调用的原生工具。
      // 工具读取受控输出目录中的文件后，把真实 bytes 交给此回调；
      // SDK 会登记产物、发送 artifact.created，并提供 GET /artifacts/:id。
      await publishArtifact({
        name: "example.png",
        mime: "image/png",
        bytes: await readApprovedOutputFile(),
      });
      return { vendorRunId: "upstream-run-id", status: "running" };
    },
    async getRun(vendorRunId, record) {
      // 从原生服务读取增量事件，并返回运行状态。
      return { status: "running", events: [] };
    },
    async uploadArtifact(input) {
      // 可选：将 input.bytes（或 contentBase64）保存到受控 Artifact 存储。
      // 返回 id/name/mime/size/sha256；实现后 capabilities.artifacts.upload 自动为 true。
      return {
        id: `artifact_${crypto.randomUUID()}`,
        name: input.name,
        mime: input.mime,
        size: input.size,
        sha256: input.sha256,
      };
    },
    async getArtifact(artifactId) {
      // 可选：按不可变 id 读取输出产物，并返回 contentBase64 或 bytes。
      // 桌面端会在主进程校验大小与 SHA-256 后再进入对话界面。
      return artifactStore.get(artifactId);
    },
  },
});
await plugin.listen(8787, "127.0.0.1");
```

`capabilities.eventStream` 必须描述 Adapter 启动时已经实现的真实能力。SDK 不会根据近期运行自动打开这些标志；未实现或无法持续上报的字段应省略，不能为了通过连接测试而声明为 `true`。

`publishArtifact` 是 Connector 侧的发布能力，不会凭空变成模型工具。Hers/Hermes Connector 必须把它注册为智能体可调用的结构化工具，并只允许读取该次运行的受控输出目录。仅在最终答复里打印 `artifact.created` JSON、`MEDIA:` 文件名或远端绝对路径，不代表文件已上传，桌面端也无法据此显示图片。

可从 `@agents-one/plugin-sdk/hermes` 导入 `createAgentsOneArtifactTool({ publishArtifact, readOutput })` 生成通用工具定义；`readOutput(path)` 必须由 Connector 实现，并拒绝本次运行受控输出目录之外的路径。

使用反向代理或出站 Relay 将该服务安全暴露为 Gateway v1 地址。不要将 `AGENTS_ONE_GATEWAY_TOKEN` 写入项目文件或 Agent 提示词。

## 通用 Remote CLI Host 与 OpenCode ACP

公共底座不为每个 CLI 重复实现 Gateway、配对和 Relay。`host` 将多个 Runtime 注册到同一个 Gateway v1，并用请求中的 `runtimeId` 选择 Adapter；Connector 侧使用同一份多 Runtime 凭据和 `--runtime-adapters` 映射。

```js
import { createRemoteCliHost } from "@agents-one/plugin-sdk/host";
import { createOpenCodeAcpAdapter } from "@agents-one/plugin-sdk/opencode";

const host = createRemoteCliHost({
  token: process.env.AGENTS_ONE_GATEWAY_TOKEN,
  statePath: process.env.AGENTS_ONE_HOST_STATE,
  runtimes: [
    {
      runtimeId: "opencode-main",
      displayName: "OpenCode",
      kind: "opencode",
      adapterId: "opencode-acp",
      adapterVersion: "0.1.0",
      // 生产 Host 应只允许来自本地注册表且通过信任校验的 Adapter。
      // requireAdapterManifest 会拒绝没有 manifest 的实现。
      adapter: createOpenCodeAcpAdapter({
        executablePath: "opencode",
        workspaceRoot: process.env.AGENTS_ONE_WORKSPACE,
        // 只把明确列入白名单的 Provider 环境变量传给子进程；
        // 默认不会把 Host 的完整环境复制给 OpenCode。
        allowedEnv: ["OPENAI_API_KEY"],
      }),
    },
  ],
  trustedAdapterIds: ["opencode-acp"],
  requireAdapterManifest: true,
});
await host.listen(8787, "127.0.0.1");
```

Host 默认只监听 Loopback；`statePath` 可选，用于原子持久化 Run、幂等键、Provider sessionId 和事件快照。Host 重启时未完成 Run 会在下一次查询时进入终态对账：可恢复的 Adapter 可实现 `reconcileRun(vendorRunId, record, context)` 返回 Provider 终态/事件；无法恢复时会产生带 `host_restart_reconciliation_required` 的明确失败终态，不会伪造成功。公网暴露应由受信任的 HTTPS Gateway/反向代理承担，不能把 Loopback Host 直接绑定到公网。

OpenCode Adapter 通过 ACP JSON-RPC 启动受控 CLI，保留真实模型与用量，分别上报 `assistant.*`、`reasoning.summary`、`tool.*` 和 `artifact.created`；它不会把最终答复写进思考事件，也不会接受未经 Host 配置的 Shell 命令或工作区路径。Pi、Codex、Claude Code 的远程 Adapter 复用该 Host 契约，按后续阶段单独交付。

## 本地 CLI Adapter

```js
import { createCliAdapter } from "@agents-one/plugin-sdk/cli";
import { mapCliJsonlEvent } from "./examples/cli-jsonl-adapter.mjs";

const adapter = createCliAdapter({
  command: "pi",
  args: ["--json"],
  cwd: process.cwd(),
  mapEvent: mapCliJsonlEvent,
});
const result = await adapter.run({ input: "分析当前项目", runId: "run_123" });
```

CLI 的原始事件格式由对应 mapper 负责。没有结构化事件时，保留原始记录，不得伪造思考或工具调用。

CLI Adapter 只以参数数组启动进程，不调用 Shell，也不替换 CLI 的工具、模型或工作区权限。默认诊断日志会脱敏并限制数量；不要将原始 stdout、stderr 或环境变量直接回传给桌面 UI。

## 契约与安全

- 远程侧遵循 `docs/AGENTS_ONE_REMOTE_GATEWAY_V1.md`。
- 事件字段遵循 `docs/AGENT_EVENT_STREAM_V1.md`。
- 插件实现与验收要求见 `docs/AGENT_EVENT_STREAM_PLUGIN_GUIDE.md`。
- 只上传用户可理解的推理摘要，禁止原始思维链、Token、Cookie、环境变量、绝对路径及完整敏感文件内容。
- 真实文件、代码变更和测试报告才是 artifact；普通最终答复不是 artifact。
- 若需要桌面端“上传附件”，适配器必须实现 `uploadArtifact(input, context)`；SDK 会暴露 `POST /artifacts`，并在 `/runs` 的 `input.artifactIds` 中传入不可变附件 ID。
- 若需要桌面端显示远端生成的图片/文件，适配器可实现 `getArtifact(artifactId, context)`，或使用运行上下文的 `publishArtifact`；SDK 会暴露 `GET /artifacts/{artifactId}`，返回元数据及 `contentBase64`。
- SDK v0.1.2 支持通过 `startRun` 上下文中的 `publishArtifact({ name, mime, bytes })` 发布输出文件；它会自动计算 SHA-256、登记运行产物、写入 `artifact.created` 并提供下载接口。Connector 仍须把该回调接入远端智能体的真实工具系统。
- SDK v0.1.2 只声明 Adapter 在 `capabilities.eventStream` 中明确启用的增强能力，并在追加 provider 事件后再生成 `run.completed` / `run.failed`；Adapter 不再需要直接操作 `record.journal` 或拦截 `/capabilities`。
- 为显示真实模型和上下文占用，适配器应在 `getRun` 或事件的 `data.model`、`data.usage` 中返回 `model_name`/`modelId`、`context_window_tokens`、`context_used` 等真实字段，不要猜测或伪造。
