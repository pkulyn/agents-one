# Agents One Plugin SDK 规划与接入标准

状态：**预览实现（0.1.4）**

日期：2026-08-10

## 目标

将“远程智能体需要逐一适配、不同 CLI 有不同展示”的问题收敛为可安装插件：智能体或 Relay 安装插件后，按统一契约暴露能力、运行、事件、产物和受控工作区结果；Agents One 只需要保存一个 Gateway 地址和一个 Token。

## 与既有协议的关系

| 层级                   | 规范/组件                                            | 责任                                                |
| ---------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| 连接、鉴权、Run、Grant | [Remote Gateway v1](AGENTS_ONE_REMOTE_GATEWAY_V1.md) | 远程机器如何安全地被调用。                          |
| 事件语义               | [Agent Event Stream v1](AGENT_EVENT_STREAM_V1.md)    | 思考摘要、工具、技能、MCP、产物和交接如何统一表达。 |
| 可安装实现             | `plugins/agents-one-plugin`                          | 将供应商原生事件转换为以上两项规范。                |

Remote Gateway 是远程插件的外层协议；Event Stream 是远程和本地 CLI 都可使用的内部事件语言。本地 CLI 不经由 Remote Gateway，因此不会被 Gateway 的权限或网络边界限制。

## 包结构

```text
plugins/agents-one-plugin/
  src/event-stream.mjs           事件校验、去重、脱敏、有界历史
  src/remote-gateway-plugin.mjs  Gateway v1 宿主
  src/cli-adapter-plugin.mjs     本地 CLI 非 Shell 启动与 JSONL/Hook 转换
  examples/                      Hermes/Hers、OpenClaw、CLI 映射示例
  test/                          可运行的协议回归测试
```

首版不替换 Hermes Dashboard、OpenClaw Bridge、Hers Relay 或现有 CLI Runtime。它们只需在各自旁边增加 Adapter；稳定后再逐步将旧私有协议切换到这个统一入口。

## 给接入方的文件清单

| 接入方                              | 必须提供/安装                               | 应阅读的规范                                                                                                 | Agents One 中的配置                                           |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Hers、Hermes、OpenClaw 等远程智能体 | `gateway` 宿主加各自原生 API/Relay 映射     | [Remote Gateway v1](AGENTS_ONE_REMOTE_GATEWAY_V1.md)、[事件插件实施指南](AGENT_EVENT_STREAM_PLUGIN_GUIDE.md) | 一个 Gateway URL，一个 Bearer Token。                         |
| Pi、Codex、Claude Code 等本地 CLI   | `cli` Adapter 加该 CLI 的 JSONL/Hook mapper | [事件插件实施指南](AGENT_EVENT_STREAM_PLUGIN_GUIDE.md)、本包 `examples/cli-jsonl-adapter.mjs`                | 本地可执行文件、工作区与 Adapter 配置；不填写 Gateway Token。 |

远程实现必须由插件的 `GET /capabilities` 声明 `eventStream.protocol=agents-one-event-stream-v1`。否则桌面端仍可按旧 Gateway 使用最终答复，但会标记为“基础反馈”，不会伪造思考、工具或技能记录。

## 插件发布物

`plugins/agents-one-plugin/agents-one-plugin.manifest.json` 是插件的机器可读声明。任何适配器发布前至少运行：

```powershell
npm.cmd pack
node --test .\test\*.test.mjs
```

接入方需要把打包得到的 tarball 安装到其 Relay 或 CLI 的用户级目录，再重启其自身进程；无需修改 Agents One 桌面端安装目录。

## 版本与升级

插件必须在 `GET /capabilities` 中声明：

```json
{
  "capabilities": {
    "eventStream": {
      "protocol": "agents-one-event-stream-v1",
      "transport": "poll"
    }
  }
}
```

未来新增字段应保持向后兼容；破坏性变化才发布 `v2`。桌面端根据能力声明提示“可升级”，不通过智能体类型猜测端点。插件升级由远端维护者或本地 CLI 用户更新包完成，更新后重新执行固定验收夹具。

### 0.1.3

该补丁版补齐 SSE 断线续传：`Last-Event-ID` 可传数字 sequence，也可传 SDK 已发布的稳定事件 ID，Gateway 只重放游标之后的事件。生产或发布验收实例必须配置稳定的 `statePath`，以原子持久化 Run、幂等键、Provider sessionId 与事件快照；仅内存运行的开发实例不得宣称通过 Host 重启门禁。Connector 升级时应删除自定义 `/runs/{id}/events` 路由，直接使用 SDK 路由，避免 SSE 响应状态污染下一次 Run 请求。

### 0.1.4

该补丁版移除 SSE 响应中显式的 `Connection: keep-alive` hop-by-hop 头，由 Node 与反向代理按请求语义管理连接；同时声明 `Cache-Control: no-cache, no-transform` 与 `X-Accel-Buffering: no`。自动回归通过连接池反向代理覆盖默认连接、`Connection: close`、SSE 后连续创建三个 Run，以及五次 `Last-Event-ID` 恢复。

### 0.1.2

该补丁版把 Hers-2 现场验收中的通用兼容修复收回 SDK：Gateway 先追加 Adapter 返回的工具、Workspace、推理与最终答复事件，再生成运行终态；能力标志只来自 Adapter 启动时的稳定声明。EventJournal 保留脱敏后的 Workspace `operation`/相对 `path` 和工具时长，请求体读取同时兼容字符串与 Buffer chunk。

Adapter 应在 `capabilities.eventStream` 中只声明真实实现的增强能力，例如：

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

未声明的能力不会出现在 `/capabilities`。升级到0.1.2后，Connector 应删除对 `/capabilities` 的拦截、对 `record.journal` 的直接写入以及对 SDK EventJournal 白名单的本地补丁，让 `getRun()` 通过标准 `events` 返回真实事件。

## 首批试点顺序

1. Hers Relay：已有 Gateway v1、Relay 和 Workspace Grant，是最合适的端到端试点。
2. OpenClaw：映射 subagent 生命周期、Bridge 工具、技能和 Artifact。
3. Hermes：把 Dashboard/API 原始事件收敛到同一事件格式，保留其原生 UI 丰富度。
4. Pi CLI：先使用 JSONL/Hook；随后扩展 Codex 与 Claude Code 的正式事件 mapper。

## 发布门槛

- Gateway Token 校验、事件稳定 ID 去重、断线恢复、脱敏、真实 Artifact 证据均通过。
- 对新插件完成“思考摘要、工具/MCP/技能、读写文件、失败、取消、重开历史”回归。
- 无事件能力的旧 Gateway/CLI 仍可返回最终答复，不因增强插件阻断使用。
