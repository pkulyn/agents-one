# Agents One Connect + Agents One Connector 开发方案

日期：2026-08-21
状态：**开发方案 v1.1，P0 已完成，P1/P2 完成 MVP，P3-P5 已启动**

## 1. 目标与边界

目标是让大多数远程智能体（Hers 为首个适配器）实现“安装一个 Agents One Connector 插件、扫码/输入一次性短码、立即接入 Agents One”，同时满足：

- Hers 所在服务器或个人电脑不需要公网 IP、域名、入站端口、ngrok 或端口映射；
- Agents One 与 Hers 均只建立出站连接；
- 上层继续使用 Gateway v1 的 capabilities、Run、事件、Artifact、取消和 Workspace Grant 语义；
- Connector 设备、桌面 Gateway Token、Workspace Grant 三类凭据分离；
- 断线、重连、撤销和重复投递均可审计、可恢复、不可重复执行。

本方案不把 Connect 做成任意 TCP/Shell/文件代理，也不改变本地 Codex、Claude Code、Pi CLI Runtime 的执行方式。

## 2. 总体架构

```text
Agents One Connector（Windows/Linux 用户级进程）
        │ 主动 WSS + 设备身份
        ▼
Agents One Connect（托管控制面 + Gateway v1 隧道路由）
        ▲
        │ HTTPS/WSS + 受限 Gateway Token
        │
Agents One Desktop
```

Connect 是官方运营的托管 Relay Profile。企业用户仍可替换为自托管 Relay；桌面端的 Gateway v1 逻辑不变。

### 2.1 组件职责

| 组件       | 职责                                                                  | 明确不做                                    |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------- |
| Connector  | 访问本机 Loopback Gateway v1、生成设备密钥、主动 WSS、映射 Gateway v1 | 不监听公网、不提供 Shell、不保存桌面 Token  |
| Connect    | 配对、设备注册/撤销、在线状态、按 Runtime 路由隧道帧                  | 不做任意 TCP 转发、不猜测路径、不绕过 Grant |
| Agents One | 创建配对会话、扫码确认、保存 Gateway Token、展示 Runtime 状态         | 不保存 Connector 私钥、不把 Token 放入对话  |

## 3. 配对与身份模型

### 3.1 配对流程

1. Agents One 向 Connect 创建短时 pairing session，绑定用户、目标 Runtime 和过期时间。
2. Connector 启动 `pair` 命令，连接 Connect 并显示二维码/一次性短码；二维码只含 pairing session 引用，不含长期 Token、私钥或工作区路径。
3. Agents One 扫码/导入二维码，展示目标名称、设备信息和短校验码，用户明确确认。
4. Connector 本地生成 Ed25519 或等价设备密钥对，提交公钥和一次性 pairing proof。
5. Connect 原子地将 device、runtimeId、desktop installation 和 pairing session 绑定，返回设备证书/刷新凭据。
6. Agents One 获得仅绑定该 Runtime 的 Gateway Token，并写入系统受保护存储；Connector 只保存设备凭据。

同时支持 Connector-first 反向流程，避免依赖扫码：

1. 远程智能体运行 `agents-one-connector request-pairing`，在智能体端生成 10 位接入校验码；
2. 用户在 Agents One 智能体接入界面输入该校验码并确认 Runtime 名称；
3. Agents One 向 Connect 提交 claim，Connect 返回仅桌面端使用的 Gateway Token；
4. Connector 使用短期 request token 轮询批准结果，取得自己的 device token 后建立 WSS；
5. 短码、request token 和 Gateway Token 均不进入对话内容，且过期/完成后不可重放。

### 3.2 凭据规则

- pairing code：默认 5 分钟、一次使用、限速、失败次数上限；完成或取消立即失效。
- Connector device credential：每台设备独立，可撤销、轮换，不等于 Gateway Token。
- Gateway Token：绑定 `subject`、`agentId`、scope、过期时间、撤销状态和桌面安装实例。
- Workspace Grant：按任务/项目短时授权，与以上两类凭据完全分离。
- 所有私钥只在 Connector 主机生成；Windows 使用 DPAPI/用户凭据存储，Linux 使用用户权限目录并限制权限。

## 4. WebSocket Tunnel 与 Gateway v1

WebSocket 只是传输层，Gateway v1 是应用协议层。隧道必须保留 Gateway v1 的方法、路径、状态码、Run ID、事件 sequence、幂等键和错误语义。

控制帧最小结构：

```json
{ "type": "request", "requestId": "req_1", "method": "GET", "path": "/capabilities", "body": null }
{ "type": "response", "requestId": "req_1", "status": 200, "body": {} }
{ "type": "event", "runId": "run_1", "sequence": 7, "event": {} }
```

要求：

- 仅允许 Gateway v1 白名单路径和帧类型；
- Run/取消/Artifact 请求幂等；
- 断线后按 `runId + sequence` 恢复，不重复执行；
- 大文件走 Artifact 分块/独立下载，不塞入单个 JSON 帧；
- Connect 不修改 Gateway v1 的 `workspaceRef`、`runtimeId`、`conversationId`；
- `eventStream.transport` 根据实际能力声明 `websocket` 或 `poll`，不得伪造 SSE 能力。

## 5. 分阶段开发计划

### P0：协议与纯函数核心（已完成）

- 定义 pairing session、设备注册/撤销、隧道 request/response/event 类型；
- 实现短码规范化、过期判断、白名单路径和隧道帧校验；
- 编写不依赖 Electron、网络和真实密钥的单元测试；
- 验收：恶意路径、过期码、重复配对、非法帧和未知消息全部 fail-closed。
- 实际结果：共享模块 `src/shared/agents-one-connect.ts` 已实现；配对码摘要、过期/配对/撤销、HTTPS/WSS Endpoint 校验、Gateway v1 隧道帧和路径白名单已覆盖；定向测试 4 项、Node/Web TypeScript 和改动范围 ESLint 均通过。

### P1：Connector CLI MVP（进行中）

- 新增通用 `@agents-one/connector-cli` 包及 `pair/status/revoke/diagnose` 命令；Hers 通过通用 Gateway v1 Loopback Adapter 首先接入，不占用 Connector 产品名称；
- 访问本机 Loopback Hermes，不暴露公网 API；
- 生成/保存设备密钥，建立 WSS 心跳和指数退避重连；
- Windows/Linux 仅用户级安装，不安装系统服务、不要求管理员权限；
- 验收：无公网 IP、仅出站 443 的主机可以保持在线并完成 `/capabilities`。
- 已实现的首个切片：`plugins/agents-one-connector`（`@agents-one/connector-cli`）已提供 `pair/status/revoke/diagnose` 命令、Ed25519 设备密钥生成、一次性配对码兑换、撤销请求和用户级凭据目录；CLI 单元测试 2 项通过。
- 已推进的第二个切片：Connector 已通过 WSS 建立 Connector 侧握手、心跳发送和 Gateway v1 request/event 回调；与本地 Connect MVP 完成一次真实隧道请求回归。
- P1 已补充：`run` 运行模式、指数退避自动重连、优雅停止和可插拔本机 Adapter。
- P1 未完成：Windows DPAPI/Linux Secret Service 保护、生产级 Loopback Hermes 适配（当前仅有参考适配器）、用户级自动启动与升级。

### P2：Connect 服务端 MVP

- 提供 pairing session、扫码/短码兑换、设备注册、设备列表、撤销和在线状态；
- 提供按 `runtimeId` 路由的 WSS 隧道；
- 实现 Gateway v1 request/response/event 映射、连接限流和审计；
- 验收：两个客户端连接时只能收到自己的 Runtime 帧，撤销后立即拒绝新 Run。
- 已实现 MVP：`services/agents-one-connect` 提供配对会话、一次性 code exchange、设备状态/撤销、Connector/Desktop 双端 hello、Gateway v1 request/response/event 路由和撤销断开；服务端端到端测试通过。
- MVP 限制：当前为内存存储和本地 HTTP/WS 测试服务，尚未接入账户认证、持久化数据库、生产 TLS、限流、审计存储和多实例路由。

- 已补充配对状态查询接口：桌面端可在不暴露 Gateway Token 的情况下轮询会话状态；配对会话仍只保存在 Connect 内存中，生产化前必须迁移到持久化存储并加账户/设备授权。

### P3：Agents One 桌面端接入

- 新增“通过 Connect 接入”表单和二维码/图片导入入口；
- 配对确认、设备信息展示、重新授权、撤销、离线和证书错误状态；
- 受保护存储写入 Gateway Token，不把短码/Token写入 Runtime JSON；
- 验收：扫码后自动出现 Hers Runtime，刷新/重启后仍可恢复，撤销后卡片状态正确。
- 已实现首个切片：主进程新增 Connect 会话创建、状态查询、Connector-first 校验码 claim 和完成配对 IPC；智能体接入表单同时支持生成配对码和输入远程智能体生成的 10 位接入校验码，并把 Connect Runtime 写入受保护 Token 存储。二维码图片和设备撤销 UI仍待补齐。

### P4：WebSocket 隧道完整能力

- 普通对话、任务、SSE 等价事件流、取消、Artifact 上传/下载、Workspace Grant；
- 长任务重连、事件去重、背压、帧大小限制和二进制分块；
- 端到端 Gateway v1 契约测试：HTTP 直连与 WebSocket 隧道使用同一组黄金用例。
- 已实现基础切片：桌面 Gateway v1 请求可通过 Connect WSS 请求/响应帧访问 Connector，Connector `run` 模式具备指数退避重连；事件、Artifact 分块、幂等恢复和背压仍待完成。

### P5：用户级运行与自动升级

- Windows：用户目录安装、Task Scheduler 或用户登录启动（不安装系统服务）；
- Linux：用户目录安装、systemd --user 或前台守护模式；
- 升级包签名/哈希校验、分阶段升级、失败回滚、版本兼容矩阵；
- 升级不覆盖设备私钥，不改变 Runtime ID，不丢失未完成 Run 状态。
- 已实现基础切片：CLI `run --adapter <module>` 支持前台用户级守护和 SIGINT/SIGTERM 停止；Windows/Linux 安装器、用户登录启动、签名升级和回滚尚未完成。

### P6：安全与发布验收

- pairing abuse、Token 重放、设备冒用、隧道越权、路径穿越、断线重复执行和大帧内存压力测试；
- Windows/Linux 普通用户干净环境安装、升级、回滚和卸载；
- 五条 Runtime 黄金路径、备份恢复、Workspace Grant 和三轮全量回归；
- 默认只开放托管 Connect；自托管 Relay 和公网 IP 直连保留为高级 Profile。

## 6. 首个发布门槛

Connect + Connector MVP 在以下条件全部满足前不得作为默认远程接入：

- 配对码不可重放，设备可撤销，Gateway Token 不泄露；
- 无入站端口主机可稳定保持 WSS 在线；
- `/capabilities`、对话、任务、取消、事件和离线状态通过；
- 断线恢复不会重复 Run 或重复 Artifact；
- Windows/Linux 用户级安装不需要管理员权限；
- 升级失败可回滚且不丢设备身份；
- 自托管 Relay 仍可作为回退路径。

## 7. 当前实现状态

- 已完成：Gateway v1 三种部署 Profile、SNI/证书要求、托管 WebSocket 配对方向文档。
- 已完成：P0 协议与纯函数核心；文档与协议验收门槛已固定。
- 当前进行：P3 桌面端二维码/设备状态、P4 隧道完整事件与 Artifact、P5 用户级安装和升级。
- 尚未完成：Connect 生产账户认证/持久化/TLS/限流/审计、多平台安全密钥存储、Loopback Hermes 完整 capabilities/事件/Artifact 验收、二维码图片、设备撤销 UI、幂等恢复和自动升级回滚。
