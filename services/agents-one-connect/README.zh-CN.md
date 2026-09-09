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
