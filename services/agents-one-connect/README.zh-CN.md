# Agents One Connect 服务（Gateway v1 / Connect 1.1）

这是托管 Connect 的本地可运行 MVP，提供：

- 一次性 pairing session 和 code exchange；
- Connector-first pairing request/preview/claim：远程智能体生成接入校验码，桌面端先查看设备与 Runtime 摘要，二次确认后才消费校验码；
- Connector 设备注册、状态和撤销；
- Desktop/Connector 双端 WSS hello；
- Gateway v1 request/response/event 隧道路由。

启动：

```powershell
$env:CONNECT_HOST = "127.0.0.1"
$env:CONNECT_PORT = "8788"
node .\bin\agents-one-connect.mjs
```

生产或测试环境可显式启用状态持久化和进程内 TLS：

```powershell
$env:CONNECT_STATE_FILE = "C:\Users\me\AppData\Local\AgentsOne\connect-state.json"
$env:CONNECT_TLS_KEY_FILE = "C:\secrets\connect.key"
# 必须是“服务端证书 + 中间证书”的 PEM full chain，叶子证书在前
$env:CONNECT_TLS_CERT_CHAIN_FILE = "C:\secrets\connect-fullchain.crt"
# 仅在启用 mTLS、需要校验客户端证书时设置；不是服务端证书链
$env:CONNECT_TLS_CLIENT_CA_FILE = "C:\secrets\client-ca.crt" # 可选
node .\bin\agents-one-connect.mjs
```

`CONNECT_STATE_FILE` 使用临时文件写入后原子替换，保存配对、设备、Runtime 授权和桌面 Token 索引；文件应放在受保护目录，并由部署系统负责备份与访问控制。`CONNECT_TLS_KEY_FILE` 与 `CONNECT_TLS_CERT_CHAIN_FILE`（兼容旧变量 `CONNECT_TLS_CERT_FILE`）同时提供时，服务直接使用 HTTPS/WSS；证书文件必须包含完整服务端证书链，`CONNECT_TLS_CLIENT_CA_FILE`（兼容旧变量 `CONNECT_TLS_CA_FILE`）只用于可选的 mTLS 客户端证书校验。不提供进程内 TLS 时仍可在可信反向代理后使用 HTTP/WS。公网入口必须使用受信任证书链，不能用自签名证书绕过桌面端校验。

当前服务已覆盖配对、设备撤销、Runtime 审批、多 Runtime 路由、版本不兼容响应、配对尝试限流和离线错误。账户系统、跨实例共享数据库、分布式限流和长期审计存储仍属于生产 Connect 部署门槛；未接入这些组件前，不应直接把单进程内存模式暴露为公网生产 Relay。

### 配对容量与过期保留

Gateway Connect 的五个配对 POST 入口共用每个 socket 来源每分钟 8 次预算，不使用客户端传入的代理头扩展额度。新配对及设备记录分别最多 256 条；容量满返回 `pairing_capacity_reached` 或 `device_capacity_reached`（HTTP 503），不会淘汰有效设备或消耗等待中的配对。反向代理部署仍需自行设置可信来源与入口流量限制。

待配对令牌到期后失效，过期状态额外保留五分钟。已配对设备不受配对 TTL 限制。撤销设备状态保留二十四小时，再清理对应记录和令牌索引。现有超额记录不会被静默删除，但会阻止新增，直到清理后低于容量。

上述容量限制用于约束资源消耗，不提供运营方身份授权或多租户配额。Gateway 配对入口公开创建记录，实服应通过可信入口限制可访问客户端；移动控制协议的 Owner/设备授权仍是独立边界。

### Gateway 状态恢复失败

状态文件损坏、版本不支持、集合或身份索引异常、文件无法读取时，Gateway 的健康检查及其他 HTTP 入口返回 HTTP 503 / `gateway_state_unavailable`，隧道升级也返回 503。服务不会把读取失败当成空授权库；拒绝请求与关闭服务均保留原文件。固定诊断不回显原 JSON 或令牌。独立移动授权服务继续按自身身份校验运行。

运营方应先保全故障文件，检查目录权限，并从可信备份恢复完整有效的授权状态，再重启服务。运行中修改文件不会自动解锁 Gateway。没有既存文件时仍按新实例初始化；不要删除旧文件来掩盖恢复失败，这会丢失既有授权。此保护针对加载失败，不代替磁盘写入故障的事务恢复或部署备份。

### 隧道连接与待处理请求

同设备、同 Runtime 的新桌面连接替换并关闭旧连接，旧连接的待处理请求返回 `desktop_replaced`（HTTP 风格状态 503）。Connector 断线或被新连接替换时，原连接上的请求立即返回 `connector_offline` 并释放容量；未在线声明的 Runtime 返回 `runtime_offline`。这些传输错误不证明远端任务没有执行，重试写操作仍须使用 Gateway 幂等键或查询原 Run。

两段隧道使用独立的不透明关联 ID，Connector 必须原样回传收到的 `requestId`，服务会恢复桌面端原 ID。迟到、未知或 Runtime 不匹配的响应不会占用新连接的请求，也不会转发给其他 Runtime。

服务关闭时停止新入口，通知待处理 Gateway 请求 `service_stopping`，并给连接一秒正常关闭窗口；未回应的 WebSocket（含未完成 hello 的连接）和残留 HTTP 连接随后被中止。关闭不会替代远端 Run 取消；再次连接后应查询任务状态。保存状态失败会在网络资源清理后报告，运营方仍需检查持久化故障。

## 手机连接服务与 Owner 初始化

手机授权服务与 Gateway/Connector 配对是独立的身份边界。普通 Gateway 配对服务能启动，并不代表手机接口已启用；必须另外配置 Owner 身份、加密授权状态和密钥。手机连接到桌面数据/执行宿主（Owner），不是直接连接某个远程 Agent 的 Token。

### 1. 准备私有配置

在服务器创建下面的 `provision-mobile.mjs`（仅运行一次）。它在当前用户 Home 的 `.agents-one-connect` 目录生成独立随机密钥，不输出密钥、不覆盖旧文件。生产部署应按实际桌面数量配置唯一的 `ownerId` / `spaceId`；示例为一台桌面。

```js
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const dir = join(homedir(), ".agents-one-connect");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const owners = [
  {
    ownerId: "desktop-owner",
    spaceId: "personal",
    label: "My desktop",
    adminToken: randomBytes(32).toString("base64url"),
    schedulerTimeZone: "Asia/Shanghai",
  },
];
writeFileSync(
  join(dir, "mobile-owners.json"),
  JSON.stringify(owners, null, 2),
  {
    mode: 0o600,
    flag: "wx",
  },
);
writeFileSync(
  join(dir, "mobile-state-key.txt"),
  randomBytes(32).toString("hex"),
  {
    mode: 0o600,
    flag: "wx",
  },
);
```

用 `node provision-mobile.mjs` 执行。已有配置应备份并沿用，不要重跑来“修复”连接。Windows 的 POSIX mode 不能替代 NTFS ACL，请限制这些文件仅部署用户可读。保持 Owner 身份、状态文件和加密密钥一起备份；重置密钥或丢失状态可能使旧授权无法恢复。

### 2. 带手机服务启动 Connect

在源码仓库根目录先安装依赖：`npm ci --ignore-scripts --prefix services/agents-one-connect`。然后用 Linux Shell 设置：

```bash
export CONNECT_HOST=127.0.0.1
export CONNECT_PORT=8788
export CONNECT_STATE_FILE="$HOME/.agents-one-connect/gateway-state.json"
export CONNECT_MOBILE_OWNERS_FILE="$HOME/.agents-one-connect/mobile-owners.json"
export CONNECT_MOBILE_STATE_FILE="$HOME/.agents-one-connect/mobile-state.json"
export CONNECT_MOBILE_STATE_KEY="$(cat "$HOME/.agents-one-connect/mobile-state-key.txt")"
node services/agents-one-connect/bin/agents-one-connect.mjs
```

或在 Windows PowerShell 中：

```powershell
$env:CONNECT_HOST = "127.0.0.1"
$env:CONNECT_PORT = "8788"
$env:CONNECT_STATE_FILE = "$HOME/.agents-one-connect/gateway-state.json"
$env:CONNECT_MOBILE_OWNERS_FILE = "$HOME/.agents-one-connect/mobile-owners.json"
$env:CONNECT_MOBILE_STATE_FILE = "$HOME/.agents-one-connect/mobile-state.json"
$env:CONNECT_MOBILE_STATE_KEY = (Get-Content "$HOME/.agents-one-connect/mobile-state-key.txt" -Raw).Trim()
node services/agents-one-connect/bin/agents-one-connect.mjs
```

`CONNECT_MOBILE_STATE_KEY` 必须是 64 位十六进制字符串（32 字节）；两个状态文件必须使用不同路径。进程通过 AES-256-GCM 保存手机授权状态。这里只监听回环地址，供配置了受信任 TLS 的反向代理转发；不要把此 HTTP 地址填到手机或公网桌面设置中。也可沿用上文进程内 TLS 的完整证书链配置。

反向代理须保留原始路径并支持全部相关 WebSocket Upgrade：Gateway Connect 使用 `/connect/v1/` 路由，手机使用 `/agents-one/mobile/` 路由（含管理与 Owner 通道）。只代理健康检查或只开放 Gateway 隧道，会造成“服务可用但手机任务通道未就绪”。不要关闭证书验证，也不要用 `localhost` 作为另一台设备的服务地址。

### 3. 配置桌面与手机

通过私密渠道把基础 HTTPS 地址和对应 Owner 的 `adminToken` 交给桌面维护者。桌面**设置 → 手机连接 → 连接服务设置**中的“Owner 管理密钥”使用此值；它不是 `CONNECT_MOBILE_STATE_KEY`、Gateway Token 或 Connector 设备 Token。不要把管理密钥交给手机，也不要把 `mobile-owners.json` 放到 Web 根目录或提交到 Git。

桌面保存并连接后开启“允许手机连接”，生成邀请；Android 的“我的”连接入口填入同一基础地址、邀请和设备名称。比较两端短语后，在桌面批准设备及最小所需权限。手机完成领取后，分别验证列表读取、Owner 在线状态和一次允许的任务操作。手机发起任务还需要桌面有效的智能体/项目/执行策略；已经配对不等于已经获得全部执行能力。

桌面需要持续运行并联网，负责实际任务与定时调度；关闭手机访问或撤销手机不会自动取消既有任务。部署更新前正常停止并备份服务状态，勿为排查离线而删除授权库。手机 APK 构建与安装说明见[根目录指南](../../README.zh-CN.md#android-手机端安装与连接桌面)。

### English operator checklist

The mobile service is separate from Gateway/Connector pairing. For one desktop Owner, save the initialization JavaScript above as `provision-mobile.mjs` and run it once with Node.js 24+. It creates `$HOME/.agents-one-connect/mobile-owners.json` and `mobile-state-key.txt` without printing secrets or overwriting files. Change the Owner/space IDs before provisioning additional desktops; keep each identity stable. Protect the directory with OS permissions (including NTFS ACLs on Windows).

From the repository root, install with `npm ci --ignore-scripts --prefix services/agents-one-connect`, then start the service behind a trusted HTTPS/WebSocket reverse proxy:

```bash
export CONNECT_HOST=127.0.0.1
export CONNECT_PORT=8788
export CONNECT_STATE_FILE="$HOME/.agents-one-connect/gateway-state.json"
export CONNECT_MOBILE_OWNERS_FILE="$HOME/.agents-one-connect/mobile-owners.json"
export CONNECT_MOBILE_STATE_FILE="$HOME/.agents-one-connect/mobile-state.json"
export CONNECT_MOBILE_STATE_KEY="$(cat "$HOME/.agents-one-connect/mobile-state-key.txt")"
node services/agents-one-connect/bin/agents-one-connect.mjs
```

The state key is 64 hexadecimal characters (32 bytes). Gateway and mobile state paths must differ. Back up the Owner configuration, encrypted mobile state and state key together; do not regenerate or delete them to troubleshoot a connection. The proxy must preserve paths and WebSocket upgrades for both `/connect/v1/` and `/agents-one/mobile/` routes. Use a trusted full TLS chain and a base URL reachable from each device; loopback HTTP is only for the local proxy hop.

Privately provide the desktop operator with the HTTPS base URL and that Owner's `adminToken`. In desktop Settings → Phone connection, this is the **Owner management key**, not the mobile state key or a Gateway/Connector token. Keep it off the phone. Enable connections, generate an invitation, enter the URL/invitation/device name in Android's Me connection area, compare phrases, and approve the required device scopes on the desktop. Execution may also require a reviewed desktop Runtime/project policy. Keep the desktop running and awake; revocation does not cancel existing tasks.
