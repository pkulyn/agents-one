# Mobile Connect deployment

手机连接采用独立移动授权和桌面出站Owner隧道。单实例部署必须保存加密授权状态与固定密钥，并保持服务及生成契约的相对路径。

## Portable handoff boundary

交付程序包括Connect源码、移动schema/openapi、Owner隧道验证器与ws纯JS依赖；不依赖服务器安装桌面应用、智能体插件或Android SDK。私人计划和真实凭据不进入交付包。

## Public ingress

专用HTTPS子域名只代理移动接口与健康检查。WebSocket升级头和SSE无缓冲必须保留，Node监听回环；旧Gateway接口不在手机联调的公网开放范围。

公网TLS使用设备信任的完整证书链，地址不能依赖重定向或交互认证。代理须保留授权、幂等、版本和事件恢复请求头。

## Persistent identity recovery

Owner与空间配置、管理员密钥、授权状态文件和stateKey作为一致集合备份。首次初始化拒绝覆盖已有文件；损坏状态不能用清空授权或重生密钥代替恢复。

同一个状态文件仅由一个服务实例写入；多租户账户、共享数据库、分布式限流和长期审计不属于本次单Owner开发联调验收。

## Deployment and phone acceptance

隔离本地冒烟验证源码哈希、鉴权和重启持久化。公网健康响应不能证明桌面在线、WSS转发、真实手机业务或定时任务执行，均需部署后逐项验证。

桌面端保存HTTPS根地址和管理密钥后生成邀请，手机只输入根地址与邀请并比对短语。任务仍由在线桌面执行，Relay不会代替离线桌面运行任务。

## Desktop preview package retention

Local delivery retains the current desktop, one SQLite-compatible fallback and the latest verified data backup. Disposable build staging and isolated profiles are removed after validation; release copies exclude historical asar backups.

New Main and worker changes still require matched compiled resources and packaged startup verification. Necessary app.asar.unpacked files remain included. Cleanup checks explicit real paths and application exit, preserves source data and small evidence, and never downgrades accepted SQLite state to old JSON.

## Single current desktop entry

Local desktop delivery exposes one stable current directory and one shortcut. Verified repairs and optimizations accumulate in that entry; dated packages are internal staging or rollback evidence, never competing user choices.

The current entry and delivery manifest must resolve to the same verified package. Preserve the shortcut arguments and external user profile. Validate complete compiled resources before promotion, do not overwrite running resources or interrupt active tasks, and verify the running program after the required restart. Source changes alone do not count as an updated user delivery.
