# Agents One Connector CLI（P1 预览）

这是面向所有远程智能体的 Connector CLI，不是 Hers 专用组件。Hers 只是第一批适配器；后续可接入 OpenClaw、远程 CLI、企业 Agent 和其他 Gateway v1 Runtime。

## 当前能力

```powershell
agents-one-connector pair --connect https://connect.example --code ABCDE-FGHIJ --runtime-id hers-home2 --name Hers
agents-one-connector request-pairing --connect https://connect.example --runtime-id hers-home2 --name Hers --wait
agents-one-connector complete-pairing
# 等价写法：pair --generate-code
agents-one-connector status
agents-one-connector diagnose --connect https://connect.example
agents-one-connector revoke
agents-one-connector runtimes
agents-one-connector register --runtime '{"runtimeId":"opencode-main","displayName":"OpenCode","kind":"opencode"}' --publish
agents-one-connector enable --runtime-id opencode-main --publish
agents-one-connector probe --runtime-id opencode-main --runtime-adapters ./runtime-adapters.mjs
agents-one-connector publish
agents-one-connector run --adapter ./my-agent-adapter.mjs
# 多 Runtime：一个 Connector 进程承载多个已配对 Runtime，按 frame.runtimeId 路由
agents-one-connector request-pairing --connect https://connect.example --runtimes '[{"runtimeId":"opencode-main","displayName":"OpenCode","kind":"opencode"},{"runtimeId":"pi-main","displayName":"Pi","kind":"pi"}]'
agents-one-connector run --runtime-adapters ./runtime-adapters.mjs
# 首个 Hermes 参考适配器
agents-one-connector run --adapter ./adapters/hermes-loopback.mjs
```

- `pair` 生成本地 Ed25519 设备密钥，并向 Connect 兑换一次性配对码；私钥不上传。
- `request-pairing` 在远程智能体端生成接入校验码；将输出的 10 位码输入 Agents One 后，再运行 `complete-pairing` 获取设备凭据。
- Agents One 输入校验码时先调用无凭据预览；只有用户确认设备指纹和 Runtime 清单后，Connect 才会完成 claim。预览不会返回 Gateway Token、Device Token 或私钥。
- `status` 只显示设备 ID、Runtime ID、地址和状态，不打印 Token 或私钥。
- `revoke` 请求 Connect 撤销设备，并在本地标记为 revoked。
- `runtimes`、`register`、`enable`、`disable`、`update`、`remove` 管理设备上的 Runtime 清单；`--publish` 将变更提交给 Connect。Connect 只接受已由桌面批准的 Runtime ID，Connector 不能自行扩大授权。
- `probe` 对单个 Runtime 执行独立健康探测；`publish` 发布本机已经注册且获批的 Runtime 描述。
- `diagnose` 仅执行 Connect 健康检查。
- `run` 以前台用户级进程运行本机适配器，连接断开时按指数退避自动重连；适配器需导出 `default(request) -> { status, body }` 或命名的 `onRequest`。
- `--runtime-adapters` 接受一个导出 `runtimeAdapters` 对象的 ES Module，例如 `{ "opencode-main": onOpenCode, "pi-main": onPi }`；Connector 只按服务端授权的 `runtimeId` 转发，不会因本地模块声明而扩大授权范围。单 `--adapter` 仍兼容旧配置。
- `adapters/gateway-v1-loopback.mjs` 是通用 Gateway v1 Loopback Adapter，只访问本机 `AGENTS_ONE_LOOPBACK_GATEWAY`（默认 `http://127.0.0.1:8642`），不会把本地端口暴露到公网；Hers 只是首个验证对象。旧的 `hermes-loopback.mjs` 仅保留为兼容别名。

Windows/Linux 用户级安装脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-user.ps1 -AdapterPath C:\agents\hers-adapter.mjs -Startup
```

Linux 可使用 `scripts/install-user.sh --adapter ./hers-adapter.mjs --startup`，在支持 systemd user 的发行版注册用户服务。

当前仍是预览：凭据目录已使用用户级目录和 Unix `0700/0600` 权限，Connect 已支持可选状态持久化和进程内 TLS，但正式发布前仍需接入 Windows DPAPI/Linux Secret Service、Connect 账户/多实例/分布式限流/审计、Artifact 分块和签名升级回滚。Connect 的单进程内存模式不能作为公网生产安全存储。
