# Owner tunnel tests

移动控制通过独立出站 WSS 通道接入桌面 Owner；签名上下文和授权确认保护路由，网络断开不重放已接受任务。合成处理器测试只证明传输与鉴权，不证明真实业务执行。

## Generated business allowlist

控制通道仅接受生成契约中的 Owner 业务路由，写 schema、scope、revision 与幂等要求同共享契约一致，不开放 Gateway、IPC 或命令路径。

## Authenticated routing

真实 HTTP 请求经过独立 Host 鉴权、签名和设备/空间绑定后转发到 Owner WebSocket；断线立即恢复离线，不能跨空间读取。

## Scope and write gates

只读授权、缺少版本或幂等身份、未知写字段与重复查询参数在派发前拒绝，防止手机扩大执行权限或覆盖并发修改。

## Long history response

读取长消息页使用独立于请求与事件的有界响应预算，超过单请求帧长度的合法最终正文完整到达手机，不把传输限制变成静默截断。

## Grant confirmation

桌面确认当前授权快照前不能报告就绪或接受移动请求；授权短期租约和心跳防止失联时继续授权。

## Refresh ACK window

已确认连接在有效租约内刷新授权时保持在线展示；请求最多等待新ACK五秒，容量与在途请求合计128，再签名转发。初次未确认、租约到期、取消和换连接不可复用旧状态，避免20秒心跳造成周期性503。

## Refresh wait revocation

刷新等待后重新复核设备权限、凭证到期和当前连接，撤销期间等待的请求不可进入桌面处理器，不重放任何任务写入。

## Revocation during streaming

撤销关闭当前设备 SSE 并停止新请求；传输取消仅结束响应，业务层已接受的任务继续属于 Owner。

## Host credential separation

Host 凭据与管理员、手机及 Gateway 凭据分离；加密授权状态重启后维持固定签名公钥，避免从手机或隧道临时接受新信任。

## Protected desktop binding

桌面仅在已启用的绑定档案中通过认证管理面取得 Host 凭据和固定 Ed25519 公钥，保存在 OS 保护存储，保留未知字段且不发送给 Renderer。

## Persistent event HTTP integration

真实本地HTTP事件请求经过Connect授权、签名WSS和Owner持久账本返回SSE；快照锚点与Last-Event-ID恢复准确原事件身份，并按设备scope投影Owner状态。该集成不替代原数据事件发布或手机生命周期验收。

## Main lifecycle and scope isolation

Main 在凭证保护与恢复处理后启动出站通道，退出时停止。连接变更、恢复锁及 profile 名称或目录切换使旧异步响应和流立即失效，同一数据域重连复用账本处理器，不取消原任务。

生产装配见 [[src/main/mobile-control/desktop-owner.ts#startDesktopMobileOwner]] 和 [[src/main/mobile-control/owner-lifecycle.ts#MobileOwnerLifecycle]]。生产工厂复用原始创建、Main执行协调器、批准存储和目录；完整工具权限证明提供者尚未接入，默认无有效策略，不广告新建/推进。恢复仅重试已证明的最终结果落盘，失败保留账本；传输关闭不停止已受理任务观察，应用退出才dispose协调器。

锁定或凭证轮换只停止传输；同一数据域重连复用账本处理器，切换数据域或退出应用时释放它。

## Independent transport dispatch safety

独立传输 worker 在分派到 Main 前重新检查设备授权，拒绝已撤销请求并保留响应 DTO。

## Independent transport stream credit

SSE 和下载只在收到拉取请求后读取下一块，取消流时中止原请求而不重复派发业务操作。

## Independent transport bounded IPC

超出 IPC 字节上限的 DTO 在授权探测和业务执行前被拒绝。

## Independent transport response cleanup

初始响应超出 IPC 上限时释放流资源并中止请求，避免泄漏活跃响应。

## Main failure diagnostics privacy

处理失败诊断仅记录请求身份、安全错误码和固定异常类别，不保存正文、堆栈或异常文本。

## Production original data assembly

生产工厂在隔离目录上装配真实原数据仓库、账本和控制器，验证读取保留原对话/消息 ID 及内容、原文件字节不变，并只声明已装配能力。测试替换凭证服务和 socket，不代表真实云端或手机联调。

工厂测试还验证没有Owner批准的新建请求在写入原始记录或调用真实派发器前拒绝；完整工具权限证明仍是执行开放的前置条件。

## Current execution availability

控制器每次生成Owner状态均复核当前执行可用性，验证无证明、取得证明及证明失效三种状态下能力及时变化，不因执行模块已装配而广告执行权限。

## Artifact transfer

Artifact 逐块鉴权、限制帧大小并核验总长度与 SHA256；Relay 不保存文件，撤销或传输错误终止下载，手机仍需根据权威元数据独立校验。

## Interrupted mutation

已转发的修改因 Owner 断线或超时失去响应时返回待核对，禁止换键重派；只有业务层持久回执能证明操作是否接受和完成。

## Signed context and replay

固定 Ed25519 公钥验证方法、路径、查询、正文、条件版本、幂等头、设备、空间、有效期与 nonce；改字段或重复 nonce 必须拒绝。

## Bounded Relay clock lead

真实隔离Relay时钟比桌面快18秒时，合法签名授权仍完成握手并读取bootstrap。未来签名上界允许最多额外45秒偏差，未签名HTTP时间不能成为鉴权依据。

## Clock lead lease and expiry limits

允许小幅未来偏差不延长本地授权租约；租约最多30秒，已过期和未来超过75秒的签名均拒绝，撤销及nonce重放防护保持原关口。

## Pairing background refresh availability

后台status轮询不禁用邀请或其它前台操作。前台操作可在刷新未完成时提交，迟到的旧刷新结果不能覆盖前台确认的连接状态。

## Absent native history schema

state.db存在但没有Hermes sessions表时，手机按无原生历史库处理，保留其它Runtime对话与缓存overlay。只读验证不创建表或修改任何原数据库与历史文件。

## Transient management failure

管理HTTP暂时不可用不主动关闭同一数据域内已有签名隧道；首次连接、明确停用、权限或协议错误仍拒绝。授权租约独立到期，配置切换及恢复锁立即失效，不能把网络容错变成持久授权。

## Legacy collaboration task identity

旧桌面协作以taskId保存Runtime会话身份；Runtime匹配且无显式conversationId时连接原会话，若有sourceSessionId还须匹配原provider会话。跨Runtime或provider冲突仍拒绝，保持只读且不迁移原记录。

## Windows binding path identity

Equivalent Windows absolute home paths use one stable connection key and a bounded list of legacy path spellings. Read recovery preserves the encrypted file and original Host identity, isolates other profiles and refuses unreadable newer records.

## Profile-root migration recovery

Profile-root migration preserves the protected mobile binding; ambiguous records stay untouched, and the original key remains available for rollback.

The old Hermes profile key is preferred. If it cannot identify the record, Agents One copies a unique encrypted binding only when `default` is the sole profile. See [[src/main/mobile-connection.ts#MobileConnectionManager]].

## Half open authorization recovery

A verified local lease expiring without a WebSocket close event terminates only the owned socket and invokes bounded reconnect. Pending transport is aborted, and accepted operations are never replayed.

## Lease watchdog refresh and clock rollback

Valid signed updates refresh a monotonic transport deadline capped by the remaining thirty-second local authorization. Refresh keeps a healthy socket, while wall-clock rollback cannot keep an expired half-open socket alive.

## Lease watchdog terminal trust boundaries

Explicit Host revocation, Owner replacement and application stop remain terminal; watchdog recovery does not override trust decisions or revive a stopped tunnel.

## Relay bounded delayed ACK

Relay tolerates ACK latency up to ten seconds within the original thirty-second signed lease. A confirmation cannot extend that lease or retry a mutation.

Per-update queue, write and receipt diagnostics distinguish local writes from remote receipt.

## Relay missing and superseded ACK

An ACK for an older update never confirms a newer authorization. A missing current ACK closes the socket at the bounded deadline; permission revocation still invalidates existing streams immediately.
