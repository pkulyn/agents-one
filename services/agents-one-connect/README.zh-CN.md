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
