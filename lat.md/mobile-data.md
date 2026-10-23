# Mobile data

移动端读取与管理桌面原记录，版本在权威存储的同一同步写入中递增；未知字段和完整历史不能因手机或桌面视图窗口而丢失。

## Original recent schedule execution read

Schedule及列表DTO可选recentExecution对象从同一原计划快照提供最新执行白名单投影，复用完整历史的脱敏与字段校验。对象内execution为null表示确实无历史，整个字段缺失表示旧服务未提供，不能混淆。

选择与原历史接口相同的triggeredAt降序及ID升序，不按数组位置、完成时间或成功状态推断最新记录。读取不改原计划、历史、运行状态、表达式或授权；冻结分页包含原最近执行值。安卓列表及详情通过 [[mobile-data#Mobile data#Android schedule original execution metadata]] 展示。

## Android schedule original execution metadata

安卓列表与详情复用 ScheduleMetadata 展示原 nextRunAt 及最近执行状态、触发时间和摘要，时间遵循 Owner 时区；不在手机计算下次运行或推断完成。

缺失 recentExecution 显示未提供，明确 execution:null 才显示没有历史。最近记录 scheduleId 不匹配则隐藏其状态、时间及摘要。C列表摘要最多一行，详情展示完整原脱敏摘要。中英资源同时提供，可读频率遵循 [[mobile-data#Mobile data#Android readable original schedule frequency]]；手机真机验收仍未进行。

## Android readable original schedule frequency

安卓列表和详情以本地语言说明原分钟/小时间隔及五字段 Cron，复杂规则明确五个条件同时满足；原表达式和 Owner 预览为权威输入，不在手机调度。

显示解析遵循桌面步长在通配字段最小值或范围起点开始、并集及周日 0/7 规则。旧零间隔按原引擎的最小 1 单位说明；超出 JS 精确整数的间隔或不支持的语法显示原表达式。常见每日、周一至周五、每周规则显示 locale 时间；复杂规则列出每个字段的有限集合，不误用日期/星期 OR。详情保留原表达式，列表最多两行省略；正文及请求值不改。

## Android schedule advanced draft preservation

计划编辑默认折叠高级表达式、超时和并发，保留当前设置摘要；草稿由原父表单持有，折叠、展开和切换输入方式不能改写原值。

基础间隔输入支持原分钟/小时表达式；原 Cron 显示可读说明和原文，高级区编辑原表达式。中英提供输入提示、可访问展开状态和当前超时/并发摘要。计划表单直接显示失败或冲突文案；Owner 预览与候选值完全相等后才允许保存，不因高级区隐藏放松检查。

## Android original schedule detail management

计划详情显示原项目和执行策略，并按原 allowedActions 与当前 Owner scope 提供编辑、暂停、恢复、触发、清队列和删除；请求使用详情的原ID及revision。

项目用授权目录名称或原ID，策略须同时匹配policyId/runtimeId/projectId，缺目录不推断权限，非强制策略不标已批准。动作复用现有表单和确认/回执；恢复可合并补跑，触发不改启用，清队列不停止当前Run，删除保留结果对话。受理回执不乐观改 enabled、pending、Run或删除定义；等待原读取/事件确认。编辑重新读取原定义及revision，不用列表或详情旧快照替代当前表单版本。

## Android schedule definition original policy binding

验证原项目名称、policy身份、模式及无人值守批准说明只来自同时匹配原绑定的强制策略。

## Android schedule definition missing or foreign policy

验证目录缺失、外项目策略和未验证策略不会标为已批准，原项目及策略ID仍可核对。

## Android schedule definition Chinese labels

验证中文目标与策略说明保留原项目和policy ID，不翻译用户配置身份。

## Android schedule detail action scope and busy gate

验证详情动作同时需要原allowedActions与当前scope，忙时禁止再次提交，清队列使用原管理动作名。

## Android detail management original revision and receipts

验证真实MainActivity详情确认后发送原ID及详情revision；取消不写，受理不造启用、队列、执行或删除结果。

## Android detail edit rereads original definition

验证详情编辑重新读取最新原名称、正文、表达式及revision，冲突保留新读取草稿并在弹窗内可见。

## Android visible original Owner and space

对话、定时及详情顶部显示原 Owner 名称、空间身份和状态；来源选择按完整 ownerId/spaceId 区分同名来源，复用已有授权目录和权威 bootstrap 导航。

当前 bootstrap 覆盖目录中同身份的显示值，选择仍经原 ViewModel 的读取鉴权和来源重置；错误不乐观改表头。同步异常显示连接待确认，不能以上次在线值表示当前就绪。忙时禁止再选；未连接和示例模式不造来源。来源目录失败在选择弹窗内可见；空间使用原 ID，不造未提供的名称。来源切换后旧历史与筛选依既有原状态生命周期失效。

正式 Connect 当前设备凭证绑定单一 Owner/space，目录返回该授权项且 nextCursor:null，非作用域查询被拒绝。多来源控件宿主测试验证客户端来源隔离，不代表同一凭证在正式服务跨 Owner 授权；不能据通用 Page 包装推断正式目录有分页。

## Android status header preserves brand

The read-only status header keeps the Agents One brand even when several devices share a label; exact source selection remains in the account device picker.

## Android status header handles connection loss

Busy state never makes connection status interactive; an Owner connection failure replaces the online indicator with the compact offline state.

## Android status header with missing source

Unpaired and demo screens do not invent a connected Owner; a paired device with no selected source cannot claim that the Owner is online.

## Android status header with long computer names

Long computer names do not replace the Agents One brand or introduce header dropdown actions, including in the Chinese layout.

## Android real source change clears old list binding

验证真实 MainActivity 选择同 Owner 的另一空间和同名另一 Owner 后，原列表请求使用新身份，旧数据与筛选重置。

## Android failed source selection retains original authority

验证新的 bootstrap 失败时不会更改表头或替换原列表，来源保持旧的权威快照。

## Android advanced draft survives folding

验证高级表达式、超时与并发编辑后折叠再展开仍保留原草稿，默认高级输入隐藏且摘要可见。

## Android advanced original Cron remains exact

验证原 Cron 前导零和空白以及未知并发值不被折叠或切换输入方式重写。

## Android advanced Chinese controls

验证中文基础与高级标签、当前设置摘要及展开收起行为保持正确。

## Android advanced create requires current Owner preview

验证真实 MainActivity 创建表单保留高级值和原策略身份，预览后改草稿必须重新预览才能发送原创建请求。

## Android advanced edit conflict preserves original draft

验证真实编辑请求发送原 Cron、超时、并发及 revision，冲突保留原草稿且在对话框内显示失败原因。

## Android frequency interval original semantics

验证分钟/小时间隔的中英数字和单复数、原大小写及前导零、旧零值最小单位，与输入原文保留。

## Android frequency common Cron and Sunday alias

验证每分钟、每日、周一至周五及每周日说明使用 locale 时间，0、7 和 0/7 并集为同一周日。

## Android frequency complex AND with original step anchors

验证复杂规则明确 AND、通配和范围步长分别从原字段最小值及范围起点开始，日期与星期同时满足。

## Android frequency unsupported expression preserves original

验证非法、未知、超过安全精度的规则回退到本地标签及原表达式，不描述为已知有效调度。

## Android frequency weekday steps and full unions

验证星期步长、周日别名和完整范围并集不改变原规则实际含义。

## Android schedule running and Owner calendar

验证正在运行的原记录不会展示为成功，触发和下次运行时间按 Owner 时区跨日期显示。

## Android schedule unknown versus known empty

验证旧服务缺失字段与明确空历史显示不同提示，原 nextRunAt 为空时不在手机推算。

## Android schedule foreign recent record hidden

验证另一计划的最近执行状态、时间及摘要不可混入当前计划显示，且不可伪装成已知空历史。

## Android schedule Chinese original metadata

验证中文计划执行状态、时间和空下次运行提示使用本地资源，原失败摘要保持原文。

## Android schedule real list and detail metadata

验证通过实际 MainActivity 与 ViewModel 只读通道载入的原计划，在列表和详情挂载相同元数据且不发业务写入。

## Schedule recent execution original projection

验证乱序历史及同时间执行的最近投影与原历史首条完全一致，保留原运行中状态与身份，不补完成时间，平台路径和凭证脱敏且文件不变。

## Schedule recent execution empty and corrupt source

验证已知空历史提供execution:null，重复执行身份、最新非法状态或不可排序时间拒绝，不伪造成功或空历史。

## Schedule recent execution authorized frozen pages

验证授权原计划冻结分页保留原最近执行，桌面更新后新详情读取当前原记录；无schedule:read权限拒绝且手机读取不改原文件。

## Schedule recent execution original Relay integration

验证真实HTTP与Owner WebSocket读取原桌面计划文件的最近执行，保持运行中状态及原身份，与历史首条相同；不公开原prompt、路径或未知键，原文件不变，Relay认证存储不留结果且撤销拒绝。

## Original conversation list excerpts

Conversation读DTO的可选lastMessagePreview来自已授权公开投影的最后非空消息，折叠空白、最多120个Unicode码点。手机仅内存展示一行省略预览，不改原正文、已读位置、权限或历史；空记录用null。

原Runtime的私有audience及非durable消息继续被来源投影排除，平台文本先按原规则脱敏。冻结分页保持创建时预览，原详情、快照及事件读取当前权威内容；不将业务预览加入通知或日志。

## Conversation preview Unicode and original body preservation

验证预览限制长度而不截断emoji，跨行空白折叠，最后空消息跳过，完整原正文不被改写且DTO通过schema。

## Conversation preview visibility and platform redaction

验证Runtime公开投影只从durable且user可见消息取预览，audit及短暂记录不进入摘要，平台凭证和路径仍先脱敏。

## Conversation preview authenticated frozen original reads

验证Owner认证列表输出原消息预览，冻结后桌面修改不改变下一页的旧快照，详情读取新原文；无read授权拒绝且读取不改原源文件和已读序号。

## Android original conversation preview single line

验证实际手机列表在窄屏对原授权预览只排一行并省略溢出，内存DTO仍保留完整已返回预览，不假装进入详情或加载正文。

## Android authenticated transient runtime avatars

手机列表按可见Runtime的原内容标识读取头像，客户端校验原身份、长度、SHA256及MIME内容标识，JSON最多1MiB。图片只在可见控件内存中存放，两个并发读取上限；解码先限制8192边长与16777216像素，再采样到256边长。

来源身份包含连接generation、客户端、设备、grant及Owner/space/dataEpoch，读取前后重新匹配当前目录。控件换来源或标识立即丢弃旧图，失败显示原名称首字符与原颜色，认证撤销清空连接；不添加图片磁盘缓存或改变任务提交状态。

## Android avatar authenticated original bytes

验证实际HTTP客户端按原Owner/space/runtime/内容标识认证GET，只接纳通过完整身份、长度及内容校验的原字节，不携带业务写入回执头。

## Android avatar content integrity rejection

验证错Runtime或内容ID、MIME、长度、hash、非规范编码及未知字段均拒绝，不能将其他图片或外部地址混入原头像。

## Android avatar response limit and redirect refusal

验证图片JSON超过1MiB即停止接纳，重定向不跟随、非法路径在HTTP前拒绝，均不重试请求或转送设备凭证。

## Android avatar Native pixel and decode bounds

验证Native Bitmap保留原PNG像素，较大图先读尺寸再采样，错MIME、损坏数据、过大字节或超限尺寸不能解码展示。

## Android avatar source replacement discards late result

验证实际Compose控件切换Owner来源后，旧挂起图片读取结果不能覆盖新来源占位，仍显示原智能体名称首字符。

## Android avatar original image fallback presentation

验证实际Compose控件显示解码原图后，原Runtime删除头像标识立即恢复原名称占位，不保留旧图。

## Android avatar real list original runtime binding

验证实际MainActivity列表及ViewModel只向当前Owner/space读取原Runtime与内容标识，原头像可见且不改变任务busy/error状态。

## Android avatar connection loss rejects late bytes

验证实际列表头像读取期间清除连接后，晚到图片不能恢复原Owner或Runtime目录，不安装旧图。

## Android avatar revoked device clears connection

验证实际头像读取被设备撤销拒绝时清空连接与目录，不把图片失败写成任务错误。

## Android credential late refresh connection admission

凭证续期在响应后复核当前连接generation、客户端及原凭证对象，改变连接即取消，不能保存晚到的旧凭证。验证头像触发续期期间忘记连接后取消发生在存储前，凭证仍清除且未知界面偏好保留。

## Runtime avatar authenticated content route

Runtime目录仅提供原头像内容标识与原颜色，设备通过Owner/space认证读取当前Runtime的图片JSON。标识绑定MIME及原字节，内容附长度与SHA256；读取不解析外部地址、不修改配置、不创建Artifact或任务。

允许PNG、JPEG、WebP及GIF的规范base64数据，原配置值最多700000字符、原字节最多525000；签名与MIME必须匹配。这里只做源格式校验，安卓端仍须校验内容、按尺寸限制解码及在内存展示。旧标识或消失Runtime返回404，撤销设备拒绝读取。

## Runtime avatar original content identity

验证头像JSON保留原图片字节、长度与SHA256，内容标识同时绑定MIME及字节，原内容改变后标识也改变。

## Runtime avatar bounded source admission

验证源投影拒绝路径、外部URL、SVG、错误签名、非规范base64和过大数据，接近大小上限仍可正常校验；格式接纳不代表安卓图片解码成功。

## Runtime avatar current catalog binding

验证目录只公开头像标识与原颜色，读取须匹配当前Runtime及原内容，旧标识、缺失Runtime或重复身份不能取图；配置与执行权限不因头像读取改变。

## Runtime avatar Owner authorization

验证原Owner头像读取拒绝撤销设备、跨Owner来源和非法参数，保留原历史文件及Runtime执行状态。

## Runtime avatar authenticated Relay integration

验证独立HTTP服务与Owner WebSocket实际传输原头像字节及内容校验元数据，未认证、跨来源、缺失Runtime、过时标识和已撤销设备不能取图；Relay认证存储不保留图片。

## Android transient list filters

安卓对话和定时任务分别维护内存中的项目及状态筛选；对话额外选择当前或归档记录。关键词仅通过 POST 正文传输，筛选、翻页及过期游标重读沿用相同条件，成功响应才替换列表条件。

项目目录按冻结分页完整读取，目录失败独立反馈并可重试。同一 Owner、space 及 dataEpoch 的刷新保留筛选；切换来源重置。实时事件与恢复快照遵循当前筛选，默认列表排除归档对话。列表展示原更新时间、原项目名称和任意精度序号的未读状态，业务数据不落盘。

## Android appearance and tool presentation

手机可选择跟随系统、浅色或深色，仅保存appearance界面偏好键。橙色按钮和全页使用同一有效主题；工具摘要默认折叠，展开状态仅在内存中绑定消息身份与来源代际，普通消息沿用原Markdown。

## Android conversation project management

手机为授权Runtime对话提供原项目或无项目选择，使用打开时原revision提交单字段PATCH。当前权限、活动Run与项目目录重新核对，冲突保留草稿；成功回执不乐观修改归属，等待原Owner读取或事件。

QuickChat没有workspace字段，因此没有此入口。已有运行会话的绑定由原桌面拒绝规则控制，手机说明可在目标项目新建对话，不绕过原会话上下文约束。

## Android readable execution policy

手机用原Runtime名称、项目名称、只读分析或受控项目修改及无人值守批准说明策略，仍选择原policy对象并提交原ID。单条策略也展示权限，缺目录不可选择；目录变更后原策略草稿必须仍属于当前允许集合。

## Android readable policy original identity

验证实际英文策略控件展示原目录名称与权限含义，隐藏不透明策略ID标签，点击仍返回原策略对象。

## Android Chinese policy write explanation

验证中文策略控件清楚显示受控项目修改及已批准定时执行，选择不会替换原策略身份或权限字段。

## Android policy changed catalog admission

验证策略字段改变后旧草稿不能继续提交，用户重新选择当前对象才恢复；项目目录缺失时选项与提交禁用。

## Android runtime and policy frozen directory completeness

验证初次手机加载读取Runtime与策略的全部冻结分页，后页不会遗漏；跨页快照版本变化拒绝整组目录，不安装部分结果。

## Android readable policy create and advance workflow

验证实际新建和推进表单通过可读策略控件提交原policy/runtime/project身份，单条推进策略也显示权限说明。新建回执不伪造列表行，原读取提供对话；accepted推进不伪造正文或完成状态。

## Android project change original CAS

验证实际手机项目选择仅提交原Owner/space、原对话ID、原revision及projectId字段；回执成功仍保留旧归属，重新读取原记录后才显示新项目。

## Android project clear Chinese null contract

验证中文项目对话框选择无项目提交显式null，原对话仍保持既有归属直到权威记录更新，不将省略字段误当清空。

## Android project conflict draft preservation

验证桌面改变原revision后手机仍提交打开时版本，冲突保留草稿和对话框，不悄悄升级版本覆盖桌面修改。原冲突提示和请求编号须在模态框内可见。

## Android project change current authority admission

验证当前活动Run、无项目目录成员、非法ID、不支持来源或已撤销管理权限拒绝手机项目变化；即使传入旧空Run记录也核对当前选中记录。

## Android appearance preference preservation

验证非法主题回退跟随系统，外观设置单键写入保留未知字段和连接信息；清除连接及新建ViewModel保持外观偏好，强制主题覆盖系统主题。

## Android English appearance selection

验证实际Compose英文外观选项可以在深色、浅色及跟随系统之间选择，更新原选项值。

## Android tool summary transient expansion

验证工具摘要默认不展开正文，点击后显示完整Markdown，原消息内容更新保留展开选择；收起及来源代际变化后隐藏正文。

## Android Chinese tool and appearance labels

验证中文界面的外观和工具展开收起控件均有中文文案，工具展开后可见原工具正文。

## Android filter request and cursor fidelity

验证原项目目录完整分页，GET 条件与 POST 搜索的布尔归档类型正确，游标过期重新读第一页时保留项目、状态、关键词及归档条件。

## Android unread sequence precision

验证超过 Long 范围的原消息序号仍精确比较，未读徽标在原已读位置达到最后消息序号后消失，不因浮点舍入错误显示。

## Android failed filter preserves original list authority

验证筛选失败不替换原列表的关键词、筛选或游标；项目目录失败有独立反馈，不阻断授权的对话及定时任务读取。

## Android filter source reset and list isolation

验证对话和定时任务各自保留条件，同一来源刷新保留选择，切换 Owner 后重置筛选及关键词，避免来源数据混用。

## Android archived event exclusion

验证归档实时事件从默认对话列表移除记录，事件游标失效后的快照恢复也排除归档行，观察过程不提交业务变更。

## Android filter draft admission

验证实际 Compose 项目与归档选择仅修改对话框草稿，用户点击应用后才提交原项目 ID 和筛选条件。

## Android Chinese schedule filter isolation

验证中文定时任务筛选有状态选择且无对话归档入口，已失效项目禁止应用；目录可重试，选择全部项目解除无效选择。

## Android native message Markdown

Android 消息通过固定 CommonMark 与 GFM 扩展解析为内存展示结构，用原生 Compose 提供链接、标题、列表、强调、删除线、代码和表格，正文不落盘。解析在后台执行，过期内容不覆盖当前消息，列表滚动与原已读观察保持不变。

只在用户点击普通 web/mailto 链接时打开系统应用；HTML 显示为文字、图片仅显示替代文字，不执行脚本或自动下载。代码和表格在消息宽度内横向滚动，超过展示结构边界时回退完整原文。

## Android Markdown structure and source preservation

验证标题、强调、有序列表、引用、GFM 表格与链接有对应原生展示结构，代码中的中文、缩进和换行原样保留。

## Android Markdown link admission and inert HTML

验证只有用户激活的普通 HTTP/HTTPS/mailto 链接有动作，其他 scheme 和带凭据链接不执行，HTML 与图片不会触发隐式请求。

## Android Markdown complete fallback and incremental input

验证未闭合流式代码仍展示已返回内容；深层或过大展示结构回退完整原文，不丢失末尾或伪装成截断成功。

## Android Markdown Compose link interaction

验证实际 Compose Text 链接只在点击后调用浏览器动作，无法打开时显示可操作错误反馈，解析不提前打开链接。

## Android Markdown narrow large font horizontal access

验证窄屏及大字体时，代码和表格有独立横向滚动能力，后面的内容仍可到达，消息宽度不扩张页面。

## Android Markdown Chinese link failure feedback

验证中文界面使用中文链接失败提示并显示可选中复制的完整目的地址；点击错误不能丢失链接去向。

## Android Markdown current streamed content authority

验证流式更新覆盖待解析内容后，只展示最新完整回复及其末尾，旧解析结果不覆盖当前内容。

## Android immediate turn feedback and bounded activity

Android shows a sent message from process memory immediately, reconciles it with the Owner's authoritative message sequence, and displays only bounded runtime-published progress and tool summaries.

Automatic operation-receipt refreshes are coalesced to at most once per 30 seconds, below the Owner's 32 frozen-snapshot limit over five minutes. Avatar images use an 8 MiB process-memory LRU cleared on Owner, grant, or connection changes; conversation text and optimistic echoes are never written to phone storage. A definitely failed echo can be restored to the composer; an ambiguous write stays marked for reconciliation and is never replayed automatically.

The optional Run activity field contains at most 50 redacted published events projected by [[src/main/mobile-control/run-activity.ts#projectMobileRunActivity]]. The phone renders progress summaries and tool names/kinds, not hidden reasoning, raw provider frames, arguments, or full tool output. Existing desktop Owner execution checkpoints remain the authority for task data; older services can omit activity. Chinese UI uses the platform serif family as its FangSong-like fallback while English keeps Manrope; the exact Chinese typeface may vary by Android device.

## Restart closed writer authority

[[src/main/mobile-control/closed-project-write.ts#discoverClosedProjectWrites]]仅凭Main实际观测worker关闭后持久化的私有证明恢复遗留写锁能力，并要求旧Main进程确认退出、配置档及数据代际、项目目录、审计与锁身份均保持一致。

恢复不修改原Run状态或历史，不重发未知写入，不补造产物；缺少证明、PID仍在运行或访问受限时继续阻塞。确认当前文件观察后，仅释放对应原锁并保留未知审计。

## Restart closed writer recovery and current observation

验证重启能力要求明确确认及最新文件观察令牌；外部编辑使旧令牌失效，释放只删除原锁并保留未知审计及用户文件。

## Restart recovery rejects live or unverifiable host process

验证旧Main进程仍存活、PID复用或进程探测权限不足时，不创建重启恢复能力，也不删除锁。

## Restart recovery scope and proof corruption refusal

验证审计、锁、关闭证明、数据代际或原项目授权改变后无法恢复，遗留锁保留待人工核对。

## Restart recovery refuses redirected private proof

验证私有存储被junction重定向、恢复写门禁生效或配置档切换后，旧恢复能力拒绝执行并保留锁。

## Original cancellation receipt without terminal invention

验证[[src/main/mobile-control/original-run-control.ts#OriginalMobileRunControl]]先持久accepted再向Main提交原Run取消，同键并发和重启重放不重复控制；applied仅确认受理，只有观测到实际Native cancelled时生产适配层才完成原历史。

## Original cancellation unknown outcome retention

验证未知控制回执或控制后账本完成失败保留待核对，同键不再发送；已受理动作不能因网络或磁盘异常伪装成确定拒绝。

## Original cancellation known rejection and terminal replay

验证Main明确拒绝写入rejected并可重放，可靠历史终态的取消幂等完成而不发送Native控制；无实时Native且无终态证据拒绝。

## Original cancellation scope and source admission

验证普通Run需要conversation:advance，schedule:cancel不能取消普通Run；计划原Run仍由原调度器处理，Owner改变、撤销、来源缺失和外来Runtime身份均在副作用前拒绝。

## Original cancellation malformed control refusal

验证原取消控制器独立校验路由、Owner与mutation身份；无法持久accepted时不得调用Main，拒绝伪造参数或异步失效来源。

## Production original Run cancellation routing and scope

验证生产Owner将手机账本、计划Run与普通原Run分别送既有协调器、调度器及Main原取消入口；普通Run快照/GET/SSE动作按conversation:advance过滤，仅计划取消权限不会收到普通cancel能力。

Owner提供原Run控制器时conversation:advance能力包含停止原任务，executionAvailable仍要求实际新任务执行批准。新建和推进继续原批准门禁；Native控制fixture不替代真实CLI/手机取消验收。

## Android original Run stop action

验证真实Android Run卡只为授权cancel显示停止入口，按正确Run ID提交一次，busy禁用重复点击且其他Run无按钮；applied回执不将仍running的Run伪装成cancelled。

## Android Run cancellation admission and receipt identity

验证缺少Owner控制权限或Run动作不允许时拒绝提交，取消回执必须指向同一run资源；外来引用不确认取消、不改变真实运行状态。

权限变更先移除内存Run的cancel动作，再按新授权恢复快照，旧动作不能在恢复等待期间继续显示。

## Restore excludes portable mobile authority and rotates epochs

验证真实备份排除mobile-control账本/产物目录及本机执行批准文件，恢复事务为manifest内每个profile生成独立新世代，其他档案保持；原本机账本与权限文件保留，旧游标不可用于新Owner。

[[src/main/agents-one-backup.ts#restoreAgentsOneBackupFrom]]将本机生成世代文件与原数据一起记入恢复事务；备份payload无法提供世代。[[src/main/mobile-control/data-generation.ts#mobileOwnerLedgerPath]]仅在恢复后选择新账本namespace，新epoch及产物namespace不再重放恢复前checkpoint。仍沿用本机配对凭据，不复制源电脑执行批准。

## Restore marker journal rollback identity

验证prepared恢复日志回滚已存在世代；新建世代文件只有与prepared日志中本机预生成SHA256相同的普通单链接文件才能自动移除，改变或缺少来源证明则保留救援目录。

其他新业务文件继续遵循原未知来源拒绝删除规则，新增摘要记录不能扩展到配置或原历史路径。旧恢复日志仍兼容。

## Committed restore generation preservation

验证committed恢复日志保留新世代，伪造世代摘要记录和携带世代路径的自洽备份均拒绝。权限数据不会通过旧开发备份绕过新输入校验；需重新导出符合当前规则的备份。

## Legacy ledger namespace preservation

验证未发生恢复的旧Owner继续使用原文件哈希namespace，首次缺少世代文件仅只读返回legacy；合法世代稳定读取且不写文件，恢复后选择包含世代的namespace。

## Generation marker rejects corruption and file redirection

验证损坏、超限、硬链接及目录重定向的世代文件均拒绝，不能降级为legacy使旧权限复活。仅实际缺失文件可使用legacy，目录与文件均核对真实路径。

## Production Owner restore generation isolation

生产Owner scope包含[[src/main/mobile-control/data-generation.ts#readMobileDataGeneration]]结果，生命周期缓存和每次读/流交付guard校验当前世代；恢复后旧handler失效，新Owner获得新epoch，旧游标410与旧产物404。

该组合在原文件及真实导出/恢复入口上验证，恢复前准备的旧下载流也拒绝后续交付。Native产物对象仍为fixture；没有对用户数据执行恢复或重启桌面，不替代手机及跨网络验收。

## Original Run evidence projection

验证[[src/main/mobile-control/run-read.ts#OriginalMobileRunRepository]]优先读取Main真实状态，明确终止事件可作为历史证据；普通正文和中间error不证明成功或失败，缺少证据显示待核对。

公开投影仅有固定Run字段，不提供原错误、配置、路径或执行批准。artifact_published可在终止事件后出现，不能遮蔽终止证据。读取不写原会话；手机执行账本优先且不重复投影。

## Original scheduled Run evidence

验证原定时任务以runtimeRunId、conversationId和Runtime关联Run，只接受明确终态；历史终止证据冲突、重复关联或Main返回外来Runtime时拒绝更新，保留旧观察。

## Original Run branch identity

验证原Run重复出现在分支时须具备明确父关系及相同消息身份，沿祖先返回原会话；无关ID冲突和环拒绝，隐藏消息不成为手机Run来源。

## Original Run stable revision and guard

验证独立只读观察版本跨Owner重建保持稳定，并发刷新合并；档案锁、Owner改变与原来源删除不得继续提供旧Run。版本账本不改原会话字节。

## Original Run controller read and scope

验证无执行批准也能通过授权Run GET及过滤快照读取原状态；缺少conversation:read拒绝，未知Run返回404。产物元数据仍单独受artifact:read控制。

生产[[src/main/mobile-control/desktop-runs.ts#createDesktopMobileRunReader]]绑定固定profile的完整原历史和定时任务读取以及Main getAgentRuntimeRun。桌面与定时任务原Run均进入[[src/main/mobile-control/desktop-artifacts.ts#createDesktopMobileArtifacts]]来源集合；仅实际Main产物能力可以取得文件。

## Production original desktop Run artifact assembly

验证生产Owner从完整原文件读取普通桌面Run，无手机执行账本也可取得其原产物，元数据按权限过滤且源字节保持。Native发布对象使用fixture，不代表真实CLI产物或真机下载完成。

## Original Run async stream and deletion

验证SSE异步刷新原Run状态，事件携带同一Run ID和单调序列；删除原来源产生run资源删除事件。直接重连Owner在打开流前补齐缓存，不发布虚假删除；取消空闲流正常结束。

ResourceDeletion开发契约新增kind=run，已同步生成schema/OpenAPI及客户端资源。旧预览APK不能据此被认定兼容新事件，需要新APK与真机验收。

## Android original Run deletion

验证Android删除指定Run时保留原对话、正文及其他Run，不提交业务变更或全快照恢复；删除引用不匹配时拒绝且不推进游标。下载交付绑定持续核对Run产物是否仍在内存中。

## Android deleted Run artifact delivery invalidation

验证原Run删除事件到达后，已准备文件的current绑定失效，禁止后续外部交付；原对话保持打开，暂存仍按交付清理机制删除。该宿主测试不替代真实手机文件provider验收。

## Codex configuration fingerprint stability

有效配置指纹规范化对象键顺序，保留数组顺序，并绑定实际选择的显式或隐式模型；RPC响应全部层级内容变化会使旧绑定失效，私密原文不进入公开响应。

## Owner effective Codex configuration approval binding

Main可信证据可附加codexConfigurationHash并持久保存；重载每次复核证据，摘要变化、丢失或格式错误拒绝旧批准。受限策略不投影该摘要，未知批准字段继续保留。

该字段是生产验证器的前置契约，未提供完整工具边界证明时不能据此批准执行。现有生产工厂仍拒绝未验证策略；其他执行器不要求Codex专用字段。

## Owner Codex configuration guard revocation

桌面后端将批准时配置值捕获到Main闭包，无项目也传递到原分派；每次检查当前批准、Runtime状态和配置、Owner profile，批准对象后来修改不能改变旧闭包的期望值。

## Codex fresh configuration admission

原Codex启动先读取有效配置RPC并校验Main批准，成功后才准备项目工具；原生spawn前再次复核批准。首次失败不创建工具上下文，最终失败清理私有目录与MCP后拒绝执行。

## Codex configuration authority strict callback

配置批准回调必须同步返回undefined；异步返回或异常均固定文案拒绝，不外泄异常私密内容。没有手机inspection标记的配置回调在原Runtime分派和原生入口均被拒绝。

## Codex mobile model capability projection

[[src/main/mobile-control/codex-model-capabilities.ts#projectCodexMobileModelCatalog]]保留明确选择的原模型，将多智能体元数据设为null；原Codex手机inspection已使用此Main投影，投影本身不是完整生产授权证明。

Responses Lite的工具声明位于input.additional_tools，不能用顶层tools缺失认定工具目录为空。0.159.3原v2元数据即使关闭multi_agent开关仍可启动子智能体；v1仍暴露嵌套代理工具。必须验证实际custom_tool_call和各嵌套入口。私有隔离实验使用原gpt-6-sol元数据与合成provider，没有替代真实Owner任务验收。

## Codex invocation model and project context

[[src/main/mobile-control/codex-mobile-context.ts#prepareCodexMobileContext]]已接入原Codex手机inspection路径，原模型目录投影绑定源字节与Main私有文件；项目工具须Main同步实时guard，原生保持只读。

仅项目读取启用code host和Main loopback MCP；无项目保持host关闭。临时令牌只进入本次子进程环境，原Runtime/模型/provider/session沿用。生产Main支持已审查inspection及单独同意的只读无人值守；项目写入仍受限。

## Combined Main Codex inspection evidence

[[src/main/mobile-control/codex-policy-verifier.ts#prepareDesktopCodexPolicy]]组合已审查原生字节、原配置RPC、已审查模型工具协议、Main只读项目工具与实际OS只读探针，生成五分钟Main内存证明；磁盘批准不能制造证据。

证明绑定环境、原配置、模型元数据及项目根身份。只读无人值守需独立准备和明确同意，项目写入未开放；预审不产生模型任务，不凭单项Filesystem结果或版本字符串授予权限。

## Combined verifier refusal before approval

未经准备、未知原生/模型、非Codex本地CLI、未证明OS只读及项目写入选择不能形成有效Main证明；普通只读证明不能批准未单独准备的无人值守选择。

## Prepared Codex authority remains current

[[src/main/mobile-control/codex-policy-verifier.ts#verifyDesktopCodexPolicy]]每次授权重查当前profile、恢复锁、程序和环境字节指纹、模型元数据和项目根身份；证据过期或绑定改变时旧批准受限。

## Desktop review binds final confirmed proof

真实设置预审成功后Main记录选择、批准文件版本、证据指纹与有效期；最终确认必须有相同预审，并再次读取原配置和探测，证明变化时拒绝原确认，重新预审后才可批准。

## Review preparation frame and input revalidation

桌面审批输入严格校验并复制后才启动原配置/OS检查，不接收任何调用方证据；等待异步检查后再次核对原主窗口frame、profile和home，失效不能落盘批准。

## Owner refresh never approves changed intent

Owner状态和请求在当前Main工厂复核已保存选择，重启可重新建立短期证明，但新证明必须匹配原批准绑定。刷新不会写批准文件、自动批准不同配置、调用模型或重新派发任务。

## Proactive proof refresh preserves accepted access

已有且仍有效的证明在新检查异步进行时继续接受实时绑定检查，过期前一分钟重建证据；更新同一指纹不写Owner批准。配置变化或新检查失败则旧策略受限，不替换Owner意图。

## Owner proof refresh independent of phone

桌面Owner每分钟独立复核当前档案已批准选择，在五分钟证据过期前刷新；手机离线不因证明计时自行失去已接受Run的项目读取。停用Owner清理定时器，恢复锁和连接切换期间跳过。

## Codex private invocation catalog lifecycle

无项目上下文关闭host、移除代理协议及父进程遗留的临时令牌；完成后只删除本次拥有的模型目录文件，重复清理幂等。

## Codex project tool authority remains live

项目读取使用Main批准回调并在实际MCP请求重查权限；撤销后不能读取文件或通过派发前复核。Main固定根支持非Git项目，普通桌面Git检查保持原样。

## Codex catalog replacement invalidates dispatch

源模型缓存或私有投影文件改动阻止派发；清理不得删除未知替换字节，避免将恢复核对变成数据丢失。

## Codex missing project authority prevents preparation

缺失/异步项目授权回调或不支持的模型必须在创建目录和工具传输前拒绝，不能利用任务正文扩大权限。

## Codex failed project context closes prepared resources

上下文准备中授权撤销须关闭已准备的传输并清理本次私有目录，不能留下可调用的临时工具端口。

## Codex invocation directory cannot redirect private writes

Main目录祖先联接不能把私有目录写到外部；原目录身份被替换后，派发与未知文件删除均拒绝。

## Codex Runtime owns tool context lifecycle

[[src/main/codex-runtime.ts#startCodexProcess]]传入原项目Main授权，启动前复核上下文并使用专属环境，终态/启动错误/取消完成前释放工具与私有目录。

## Codex failed context blocks native spawn

准备或最后复核失败时不得启动原生CLI；已经准备的上下文须清理，原会话不能降级普通启动重试。

## Owner project tool guard binds current approval

原Owner后端生成绑定policy/runtime/project的Main闭包；原对话协调器与绑定原计划只在内部传递，撤销、Runtime变化或档案切换立即拒绝项目工具。

## Codex capability projection preserves model identity

投影只保留原选定模型和其他未知元数据，记录原目录、原元数据及投影目录哈希；仅移除模型选定的代理协议，不能改变model/provider/session或自动产生verified批准。

## Codex capability metadata never falls back

缺失、重复、未知模型或未审查能力字段必须拒绝，不能回退另一模型、默认元数据或开放额外工具。

## Codex capability input is bounded and private

模型目录大小、UTF-8和JSON结构须校验；错误只返回固定文案，不能泄露私有目录内容或系统路径。

## Controlled project text inspection

[[src/main/mobile-control/project-inspection.ts#createProjectInspection]]仅接收Main固定根和实时授权回调；限量只读UTF-8文件，检查根与打开句柄身份，拒绝链接、路径逃逸和已知受保护配置。

## Controlled project directory inspection

目录读取只扫描固定项目内单层目录，限制总条目数，隐藏已知私有路径及链接；每次调用前后核对授权与根身份。

## Project inspection returns bound UTF8 text

项目文件只返回相对路径、完整有界文本和实际读取字节的SHA256，不返回截断后伪装完整的内容或本机绝对路径。

## Project inspection rejects path escapes and secrets

拒绝穿越、绝对路径、Windows ADS/设备名/尾随点空格和已知私有配置，防止工具参数扩大项目授权。

## Project inspection rejects linked outside data

硬链接和目录联接不能绕过项目根约束；目录结果省略链接，外部文件不得读取。

## Project inspection rechecks revoked authority and root

每次文件访问及返回前重查Main授权和根目录身份；撤销或根替换后不能返回已读数据。

## Project inspection bounds content and encoding

超出256KiB、非法UTF-8或含NUL的文件拒绝返回，避免无界读取、二进制误读和不完整快照。

## Project inspection directory bounds and privacy

目录最多扫描200项，隐藏已知私有配置；超限拒绝整个结果，不能把部分扫描当成完整目录。

## Main project inspection MCP transport

[[src/main/mobile-control/project-inspection-mcp.ts#startProjectInspectionMcp]]在Main绑定临时loopback端口与随机令牌，只提供项目只读工具；目录、令牌和服务器生命周期不进入手机数据契约。

该组件已接入原Codex启动与关闭生命周期，完整执行批准仍待完成。关闭传输会结束连接；初始化、目录和工具调用均重查授权。不会加载用户MCP、配置或工具程序。

## Project MCP token precedes project access

loopback工具服务器须先校验随机Bearer令牌并拒绝浏览器Origin，之后才能调用Main授权或访问项目。

## Project MCP reads only explicit project tools

无状态MCP只公布read_project_text和list_project_directory；任意写工具、资源读取或未知方法不能成为额外文件访问入口。

## Project MCP rejects stale and malformed requests

工具参数扩展、穿越、撤销和超过16KiB的请求均拒绝；响应错误不能携带Main异常、凭证或本机根路径。

## Original source event publication

生产Owner在Bootstrap、恢复快照和已授权事件订阅期间完整观察原数据，按公开投影hash发布原对话、消息、计划、执行变更；没有订阅时不新增后台观察进程。

[[src/main/mobile-control/source-events.ts#MobileSourceEventPublisher]]保留原身份和完整可见消息，首轮观察静默建立基线。[[src/main/mobile-control/owner-ledger.ts#MobileOwnerLedger#observeSourceEvents]]将后续事件与检查点同批原子提交，重连和重启不会重新广播未变化历史。已存事件仍保留七天或十万条。原消息索引及只读版本观察在批提交前独立保存，失败后重试沿用这些稳定身份。

## Source event checkpoint and identity

验证首次观察不广播既有历史，后续原消息修改保留有符号ID、完整正文、稳定seq与递增修订，重启或重复观察不重复发事件。

## Source execution revisions and deletions

验证修改计划不会重发未变化执行历史，单轮结果有独立修订；原资源消失发布resource.deleted及原归属ID，不保留手机失效条目。

## Source failure preserves event checkpoint

验证读取损坏或Owner守卫失效不将原资源误判为删除，非法事件不改变检查点，损坏持久删除投影拒绝启动且不改原账本。

## Source event delivery scope and read acknowledgement

验证删除事件按资源类别过滤授权，消息upsert仅登记已获授权设备的已提供seq，其他设备不能据此确认已读。

## Source event atomic persistence retry

验证原子文件替换失败时事件序号与完整来源检查点同时回滚，修复存储后重试发布一次，重启后仍可重放。

## Original schedule control admission

手机创建、编辑、恢复和触发共用原调度锁、原定义和Owner回执。原runner重新校验策略，并在手机绑定Native派发前保存身份、队列消费和游标；丢失证据保留记录并阻止新派发。只读无人值守需要独立Main证明和桌面同意。

见 [[src/main/task-schedules.ts#writeMobileTaskSchedule]]、[[src/main/mobile-control/schedule-preview.ts#validateMobileSchedulePreview]] 与 [[src/main/mobile-control/schedule-execution.ts#authorizeOriginalMobileSchedule]]。创建原计划默认启用；编辑保留原enabled、队列、历史与未改变表达式的到期游标。失败入队或派发不消耗游标。非派发暂停/清队列/删除仍可在策略受限时使用。

## Original schedule non-dispatching control admission

手机暂停在原调度锁内校验版本与授权、持久接受意图，再修改原enabled；活动Run、等待队列、到期游标、完整历史和未知字段保持，不调用Runtime取消。见 [[src/main/task-schedules.ts#controlMobileTaskSchedule]]。

## Schedule native admission barrier

手机绑定计划等待Main的persistBeforeDispatch持久化原Native ID和prepared记录，并消费一项队列工作后才允许外部派发；测试在外部效果发生点检查原文件，未知字段和完整历史保持。

## Schedule due cursor admission

到期启动将原到期时间和下次游标与Native身份同时持久保存，进程退出不能让已经登记的同一次到期重新派发。

## Schedule admission persistence failure

登记写入失败阻止Native启动并恢复内存中的队列、游标和历史；其他计划后续写入不能顺带提交失败登记。

## Schedule uncertain dispatch recovery

登记后启动结果不明或重启丢失进程内Run时保留活动身份与未完成历史，标记待核对；幂等重试只取回执，新触发和恢复拒绝，队列与游标不再次消费。

## Schedule recovery read state

手机读取待核对计划呈现blocked与unknown_state，保留原活动ID和历史；恢复、触发不公布为可执行动作，不由读取伪造运行成功或失败。

## Schedule terminal checkpoint recovery

手机绑定原计划先保存真实Native终态检查点，再提交原结果对话；进程内Run丢失后只重试结果持久化，不再执行任务。结果未提交不清空活动身份、不运行下一轮。

## Schedule terminal checkpoint write failure

真实终态检查点写失败时不提交结果对话、不发布完成事件、不消费等待队列，保留原运行记录供后续核对。

## Schedule terminal commit replay

结果对话写成功但原计划终态提交失败后，按原Native ID识别已有结果消息，重试不重复追加；仅持久完成原计划后清理临时检查点并发布完成事件。

## Schedule terminal checkpoint identity

恢复检查点必须匹配原活动Native ID、Runtime ID、终态与有效完成时刻；错配或损坏不写原结果、不重发，并保留原证据。

## Schedule recovery conversation identity

手机绑定计划按原执行身份确定结果对话ID；部分提交后重试复用原对话，校验Runtime与原用户消息，不覆盖已保存结果或用户修改。

## Original schedule native Run cancellation

既有cancelRun路由按原native ID查唯一原调度归属，在原调度锁内持久接受意图后取消。schedule:cancel独立于计划管理或对话取消；回执与真实终态分离，队列和定义保持由原runner管理。

见 [[src/main/task-schedules.ts#cancelMobileTaskScheduleRun]]。归属不存在或不唯一不能控制进程；旧终态运行取消不影响下一轮。未知回执/完成回执失败保留待核对，重试仅取原回执，不再发送外部控制。

## Schedule control receipt replay

同设备同幂等身份的并发和重启重试返回原回执；改变正文或版本拒绝，不再次修改原定义。[[src/main/mobile-control/schedule-control.ts#DesktopMobileScheduleControl]]串行完成控制与回执。

## Paused schedule discard and deletion

清队列只允许已暂停计划且不取消活动Run；删除要求暂停、没有活动Run和pending，只删除定义，保留原结果对话。

## Schedule control scope and revision

schedule:manage、设备有效期、原Owner/space和If-Match必须有效，拒绝未授权或过时操作，不先生成接受回执。

## Schedule control guard inside lock

等待原调度锁后、持久接受前和原写入前都重新检查当前授权，不因请求到达时有效而在配置切换后写入。

## Schedule control uncertain persistence

意图持久失败不改原数据；原写入或完成回执失去证据后标待核对，不因重试重新执行控制事务。

## Schedule control production capabilities

生产工厂只装配实际完成的暂停、清队列和删除动作，并与当前设备scope取交集；恢复、创建、编辑及立即执行仍需完整执行政策和调度执行接入。

## Schedule control data integrity

损坏原计划文件、重复计划或execution身份不能由手机控制顺手修复，保持原字节并显式失败。

## Schedule original concurrent control

不同Owner处理器修改同一原计划仍共享调度器版本锁，过时版本失败且只出现一次原写入。

## Schedule control binding and management lock

连接管理变更、恢复锁、活动profile或相同profile的home改变后，控制事务不能向旧目录或新目录写入。

## Shared conversation versions

桌面重命名、保存和移动管理共享持久 revision，过时修改在写入前失败，不覆盖新标题、项目或消息；读取旧记录不触发迁移。

## Original schedule read projection

[[src/main/mobile-control/schedule-read.ts#DesktopMobileScheduleReadRepository]]固定Owner档案读取原计划与完整历史，白名单公开原ID、版本、项目和对话关联，不公开本地路径或未知扩展，也不据读取批准执行。

## Schedule read corruption failures

手机严格读取遇到损坏、无效定义或重复原ID时返回requires_owner_action并保留文件字节；桌面既有兼容视图仍可保留和忽略未知来源记录。

## Schedule execution source integrity

历史中的trigger和时间必须来自原执行记录；缺少触发来源或非法时间不能伪造为手动触发，接口明确拒绝映射。

## Frozen schedule history pages

计划与执行历史分页使用冻结快照，游标绑定原计划、设备和授权版本；更新后仍读取同一快照，跨计划或设备重用返回410。

## Schedule read capabilities and scope

只组装读取适配器时只公布schedule:read；范围校验先于读取，原活动Run和enabled决定显示状态，读取成功不能证明schedulerOnline。

## Original scheduler lifecycle status

Main只读状态要求原runner定时器存在、绑定档案为当前活动档案且没有恢复写锁；停止和停止等待后立即离线，不能由计划读取或执行授权推断在线。

## Owner scheduler status composition

生产Owner注入原调度器当前状态，每次状态读取重新获取；没有实际状态来源的Controller保持false。在线与具体计划执行授权分别公布。

## Android authenticated artifact transfer

Android core从绑定Owner/space的opaque产物ID以当前凭证下载，固定origin、不重定向、不重试、identity编码；分块写调用者暂存流，长度、MIME和SHA256全部通过后才可发布。

## Android artifact integrity failure

错误长度、MIME、摘要、压缩响应与重定向都不能视为成功；调用方必须丢弃未完成暂存文件，不能按远端文件名决定本地路径。

## Android artifact admission before HTTP

没有download动作、过期或不符合共享Artifact契约的对象在HTTP请求前拒绝；核心组件不自行持久化业务对象或凭证。

## Android artifact interrupted transfer

下载途中断开只留下调用方未发布的暂存内容，不返回成功也不自动重发；完整长度与摘要验证才构成下载成功。

## Android artifact staging cleanup

用户主动交付产物使用随机名暂存于专属私有cache目录，下载或校验失败清理部分文件；系统取消、交付结束或模型清理删除暂存，不保存任务数据。

## Android artifact cache ownership

启动清理只删除明确归属的旧随机暂存文件，保留未知文件和同一进程内其他正在交付的文件；不递归清理其他cache目录。

## Android artifact filename handling

远端文件名仅作系统保存建议名称，移除路径、控制字符并限制长度；原名称从不作为应用暂存文件名或网络地址。

## Android artifact action admission

保存和打开必须同时具备artifact:read与对象download动作，忙碌或交付中阻断重复；ViewModel刷新权威元数据并在下载前后核对Owner、epoch、设备、授权版本和导航身份。

## Android artifact readonly system opening

已验证产物通过专属FileProvider content URI与临时只读grant交给系统查看器；没有查看器时可保存，旧绑定禁止打开，系统文档保存使用规范化显示名。

语言配置上下文可能不再包含Activity，根Composition显式提供MainActivity的ActivityResultRegistryOwner，确保中文和英文页面都能注册系统保存与打开回调。

## Android artifact fresh metadata delivery

交付前刷新原产物元数据并验证ID与Run关联，实际下载使用新元数据；连接遗忘后清理文件，旧绑定不能继续发布。

## Android artifact preparation failure cleanup

下载校验或写入失败不得调用系统交付回调，部分暂存文件立即清理，错误通过现有客户端状态公布。

## Android artifact preparation identity admission

缺少artifact:read时不请求元数据，原产物与Run身份变化时不请求文件内容；作用域与来源身份不能由UI按钮绕过。

## Android artifact stale completion cleanup

下载期间导航或Owner绑定改变后，已完成网络结果也不发布；旧暂存被删除，不向新详情打开旧文件。

## Android artifact system picker cancellation

真实页面按钮通过明确绑定的Activity注册表启动系统保存Intent，使用刷新后的产物名称；系统取消回调清理暂存且不留下业务错误。

## Original artifact immutable delivery

Main按原Run/产物capability捕获明确声明的文件或inline产物，私有索引绑定Owner、space与epoch；副本字节和摘要原子提交，重启仍能交付同一内容，后续源文件修改不会覆盖已公布副本。

## Original artifact capability admission

捕获要求原对话与实际Main Run身份一致，路径只由Main既有产物解析入口授权；普通消息路径和普通回复不创建文件产物。

## Original artifact identity revocation

每次元数据读取或交付复核原对话仍拥有该Run，删除原记录或Owner失效立即阻断；新的epoch不能借用旧产物索引。

## Original artifact stream revocation

Owner按64KiB以内逐块读取实际副本，每块复核来源与abort；中途撤销停止并关闭文件，下载结束再次核验总长度与摘要。

## Original artifact source integrity

只捕获普通单链接源文件，源提供的长度与摘要必须吻合；下载响应开始前核验副本完整性，损坏副本不被当作成功下载。

## Original artifact linked directory rejection

源路径包含目录junction或符号链接时拒绝读取，Main路径解析授权也不能绕过真实路径检查；原目录字节保留。

## Original artifact index isolation

重启加载索引验证Owner绑定、opaque身份及公共schema，损坏索引失败关闭；输出显式选取公共元数据，不外发私有路径和未知字段。

## Original artifact final checkpoint and control routes

手机任务终态在原结果checkpoint内附加真实产物元数据，存储重试沿用同一checkpoint且不重新执行；原快照、元数据GET与下载通道按artifact:read组合，实际字节只由Main交付。

## Original artifact event scope projection

Run事件的conversation:read权限不能扩大为artifact:read；没有文件读取scope的设备收到原Run状态但不收到产物元数据。

## Shared desktop schedule preview calculation

[[src/main/task-schedules.ts#previewTaskSchedule]]复用桌面间隔与本地民用时间Cron计算未来五次UTC时刻，拒绝零间隔或非法表达式，重复夏令时分钟不计两次。

## Schedule preview is a bound calculation

预览只计算时间，不检查或批准执行政策，也不创建或触发计划；签名回执绑定输入摘要、时区、时刻摘要、设备、授权与五分钟期限，不能视为执行授权。

## Schedule search filters stay bound

计划按原名称搜索，并按项目与原状态过滤；冻结游标绑定全部筛选条件，改变条件必须重新查询。

## Actual Codex filesystem proof

Main在独立私有目录以实际Codex invocation及内建:read-only权限执行读写探针；文件系统证据不能直接升级为包含MCP/apps/hooks的完整执行策略。

## Sandbox probe strict result and policy separation

验证只接受结构严格的读取成功、两侧写入拒绝结果，同时完整执行策略标志始终为false，命令成功不能单独批准Owner权限。

## Sandbox probe write detection

验证即使输出声明拒绝，目标文件实际创建时仍拒绝证明，防止伪结果误导批准。

## Sandbox probe malformed and failed execution

验证坏JSON、超大输出、额外字段与失败退出不能验证权限；stderr私有配置和凭据不进入证明响应。

## Sandbox probe process termination

验证超时沿用进程树终止且等待实际close后返回，启动失败明确限制；临时文件只在实际路径位于私有root时清理。

## Owner policy approval persistence

独立策略文件保存桌面批准及 Runtime、项目 capability、执行边界的绑定；每次使用重验可信 Main 证明，旧批准和 persisted enforced 不能自行放行。

## Policy approval reload and unknown fields

验证批准经原子落盘后重启可读取，未知根/行字段保留；磁盘声明的 enforced 无法替代当前证据，证明撤销会限制原策略。

## Policy binding revocation

验证 Runtime 配置、项目 capability 或实际执行边界改变使旧批准失效，名称颜色变更不撤销执行批准；证据过期不继续授权。

## Policy unsupported proof refusal

验证缺失、错误或不匹配证明及未经证明支持的 unattended 请求被拒绝，不能依靠权限模式名称批准执行。

## Policy compare and durable refusal

验证批准及撤销采用原版本 CAS，临时文件落盘后再次核对证明及恢复写锁，失败保留原字节并清理临时文件。

## Policy corrupt storage preservation

验证损坏、不兼容或结构无效的批准文件失败关闭，不当作空库覆盖，保留字节供恢复。

## Policy production profile and project capability

验证生产工厂只用绑定活动档案的 Runtime、注册项目及实际授权 realpath，项目目标变化或档案切换不复用旧批准。

## Public desktop selection catalog

移动目录从固定 Owner 档案读取原 Runtime、项目与策略，白名单投影公开字段；实际执行后端复核策略绑定，目录本身不作为执行授权，操作时仍再次核对。

## Catalog privacy and original identity

验证原 Runtime/项目 ID 和名称保留，endpoint、authRef、工作区路径、配置 hash、原头像 data URL 等私有字段不进入公开目录。

## Catalog execution authority recheck

验证策略授权失败、项目绑定不符或 Runtime 停用时不提供执行操作，项目允许策略 ID 仅引用已复核策略；公开能力缓存不能替代权限证明。

## Catalog health evidence freshness

验证健康标记只使用五分钟内有效健康探测，过期、未来时间及缺失探测不称为健康；Web Agent 类别依据实际 transport。

## Catalog ambiguous identity refusal

验证重复原身份和无效公开字段拒绝目录响应，避免选择器错误映射项目或 Runtime。

## Catalog frozen pages and device actions

验证目录分页沿用绑定设备与授权版本的冻结快照，桌面编辑不改变后续页；可执行操作与设备 scopes 和已接入业务处理器取交集。

## Catalog fixed Owner profile

验证实际 Main Runtime 目录只在绑定 Owner 档案活动时读取；档案切换后先拒绝，不能借当前档案注册表显示另一档案的 Runtime。

## Empty original conversation creation

手机新建接口先保存原 ID 操作意图，再复核桌面执行授权并创建空原对话；Runtime 外观来自桌面定义，创建不启动 Runtime，首条消息使用独立 Turn 接口。

## Empty original creation replay

验证新建记录保留桌面名称头像颜色、空消息和初始版本，重试或重启返回同一已保存回执；变化请求正文不得复用原操作 ID。

## Creation authorization revalidation

验证失效或未证明的执行策略不能创建原对话；持久意图前及原记录保存前各核对授权，第二次失效会留下拒绝回执且原文件不变。

## Uncertain creation never duplicates

验证原记录写入后确认丢失保留同一原 ID 并标记待核对；重试不能再次调用创建或生成替代对话。

## Desktop dispatch claim

普通桌面对话在 Main 首次派发前以已保存版本同步登记真实 Run，校验 Runtime、原生会话和项目身份；占用返回版本由当前 Writer 采用，不重复追加用户消息。

## Desktop claim storage isolation

验证桌面占用保留原用户消息，身份不符、旧版本或手机争用失败时原文件字节不变；桌面仍负责自身结果保存。

## Desktop claim blocks duplicate dispatch

验证两个请求同时推进一个已保存原对话，仅一个能够登记占用并启动 CLI；第二个请求在外部派发前因版本冲突失败。

## Unknown history fields

写入保留根、记录、消息和执行元数据的未知字段及不可识别历史，响应仍使用已知安全字段投影。

## Full history preservation

默认桌面视图有界，Owner 可明确读取完整历史；重命名或追加消息不会删除视图窗口之前的权威正文。

## Safe management and project binding

置顶和归档不取消当前 Run；运行中或无跨项目续接证据的原生会话不能修改执行项目，项目移除在同一写入中更新版本。

## Corrupt storage fails closed

损坏或结构不兼容的既有文档不得被当作空库覆盖，保持原字节供恢复，避免狭窄管理操作破坏全部历史。

## Profile isolation and notifications

提交后通知包含原档案与原会话身份和版本，通知失败不改变落盘结果；一个档案的手机管理不能重定向到其他活动档案。

## Quick Chat storage protection

Quick Chat 保持默认有界视图，同时保留权威完整消息和未知字段；管理与桌面保存使用同一持久版本规则。

## Durable operation receipts

Owner 控制账本在返回 accepted 前原子写入并刷新文件；同设备、动作和幂等键仅允许相同请求重放，已应用结果不被后续拒绝覆盖。

## Uncertain operations after restart

重启时未完成意图进入 reconciliation_required，不自动重放外部执行，也不伪装为失败或成功；异常信息仅返回契约错误代码。

## Device operation isolation

回执命名空间使用结构化设备、动作与幂等键，避免合法标识中的冒号产生碰撞；查询仅投影当前设备的回执。

## Stable message sequence

原消息 ID 对应稳定递增顺序，正文更新仅递增消息版本；侧车索引保存哈希和顺序，不复制原消息正文，失败写入不消耗顺序。

正文翻页只复制当前会话的索引，未变化的索引和已返回边界不重新写入账本；初次大规模索引与长事件日志的性能验收仍需在生产接入时完成。

## Returned read boundaries

已读位置仅接受同设备同会话实际返回过的边界，不能通过未返回的中间序号跳过消息，也不能向后移动或影响其他设备。

## Bound cursor validity

Owner 游标签名绑定设备、授权版本、空间、数据 epoch 和五分钟有效期；调用参数不能覆盖这些绑定，篡改与过期均要求重新取快照。

## Owner event stream resume

Owner events路由从设备绑定快照锚点或当前epoch的Last-Event-ID重放已有持久事件，恢复不提交业务操作，结束连接不取消原任务。见 [[src/main/mobile-control/event-stream.ts#MobileOwnerEventStream]]。

## Event authorization projection

每个事件按设备当前scope筛选，并重新计算本设备已读位置与可用动作；其他设备的permission事件不能外发。

## Event expired resume rejection

错误epoch、未来序号、跨设备快照游标和超保留边界必须在SSE响应开始前返回410，不静默跳过缺失历史。

## Event abort and grant expiry

空闲订阅可由请求abort及时结束，过期或撤销设备不再获得新事件；Owner授权租约与生命周期仍在外层逐帧复核。

## Frozen recovery snapshot anchor

恢复快照按设备授权冻结原对话、计划及已装配Run的投影，分页沿用同一版本与事件锚点，不混入后续修改；完整原数据事件发布与Android快照恢复仍待接入。

## Owner event retention

Owner 控制事件使用独立持久 epoch 与空间序号，保留七天或十万条；超出保留范围返回游标过期，非法事件不改变持久序号。

## Ledger storage integrity

控制账本保留未知根字段，损坏结构、错误绑定和非法已读序号失败关闭，不能生成空账本覆盖原状态。

## Ledger failed persistence

原子替换失败时回滚内存回执和索引，不对调用者宣称 accepted；后续写入继续使用原序号，字典保持不继承对象属性。

## Original source projection

Main 读取原 Runtime、Quick Chat、native session 和 collaboration，可见正文保留原身份；排除私有思考、audit-only消息和工具参数，平台摘要清除凭据与本机路径。

## Fixed profile native reads

Owner 固定档案的只读 SQLite 连接、JSON 缓存和覆盖记录不借用桌面活动档案，读取不会改写原历史或引发迁移。

## Native continuation identity

原生续接与本地错误沿用桌面已有有符号数值消息ID，手机响应契约允许这些只读身份；思考、工具参数和附件本机元数据不随正文外发。

## Linked source identity

有明确链接的协作与Hermes原生会话沿用原对话身份，避免重复列表；不同provider的同名session ID不构成native链接证据。

## Original store control patches

手机管理调用原存储版本化入口，保持消息和未知字段；旧版本请求不能覆盖桌面更新，权限检查不创建替代会话。

## Legacy source restrictions

未取得管理和执行证据的原生会话、协作记录显式返回requires_owner_action；可见原记录保持可读，后续验收不能以只读兼容替代完整功能。

## Source corruption and collisions

原文件损坏或不同来源共享同一未链接身份时明确失败，不静默返回空历史或覆盖某一来源。

## Frozen conversation pagination

五分钟列表快照固定排序、过滤与标题，翻页不受桌面同期更新影响；游标绑定设备、授权版本和查询，过期要求重新获取。

## Frozen message pagination

正文默认最近50条，再按同快照向前翻页，原消息ID与顺序不变，后台新回复不插入旧分页造成重复或漏读。

## Control read visibility

控制API只能将当前手机已返回的可见消息边界标记已读，其他手机保持独立状态，未返回的旧页不能提前标记。

## Original conversation mutation receipts

同锁patch前持久化控制意图，应用后写入回执；重试先查原回执，桌面后续版本变化不使已成功的幂等操作再次执行。

## Control scope and revision validation

Owner控制器再次验证路由身份、schema、scope、绑定与If-Match，未经授权或过时的请求不能写业务历史，也不能生成成功回执。

## Original content search

搜索使用原可见消息和标题，列表按项目与归档条件过滤，不建立手机持久历史副本。

## Relay to original history integration

隔离测试通过真实配对、授权、出站Owner通道和原桌面存储验证读写闭环；Relay授权文件不含正文，撤销立即拒绝后续读取。这不替代真实设备、CLI和远程Adapter验收。

## Shared schedule versions

定义编辑、runner状态变化与手机控制共享原TaskSchedule的revision，手机If-Match在原profile调度锁内比较，竞争者只能有一个成功写入。

## Schedule history preservation

原调度写入保留未知根、定义、执行字段与窗口之前的历史；桌面仍显示最近100次执行，Owner明确全量读取不迁移旧记录。

## Schedule edit cursor preservation

编辑名称、提示词和其他非时间字段保留lastDueAt/nextRunAt，只有表达式改变才重算时间，避免修改文案推迟既定执行。

## Schedule storage corruption

损坏或不兼容的原计划文件不能在创建时当作空库覆盖；错误不改变原字节，也不派发外部Runtime。

## Schedule queue capacity

队列达到20项时queue与replace均在外部派发或取消前明确返回queue_full，不静默吞掉新的触发意图。

## Schedule replacement cancellation admission

replace策略仅在原Runtime确认接受取消后增加待执行计数；取消false或抛错保持原文件、版本与事件不变。确认取消后保留原活动运行与历史，由原runner收尾后再派发；过时版本不得重复取消。

## Schedule preview verification

验证确认时完整有效draft、设备/grant/purpose、原预览时间、时区与过期边界。间隔预览按原时间复算，metadata不影响确认，任何业务字段改变必须重新预览，业务明文不进入签名令牌。

## Schedule policy selection scope

原受验证且无人值守已同意的政策trigger动作在schedule:manage或schedule:trigger设备可选，不依赖对话创建/推进scope。只读调度设备不能获得trigger动作，实际派发单独要求schedule:trigger。

## Schedule trigger and manage scopes are separate

schedule:manage不足以手动派发，schedule:trigger设备独立获得trigger动作；定义管理动作仍要求manage，当前受验证策略决定触发能力是否发布。

## Schedule cancellation original identity

以原Runtime Run ID取消并保留原定义、运行状态与待执行数量；原回执跨重启复用且不再次发送取消。

## Schedule cancellation scope and source admission

非取消scope、撤销设备、其他Owner、失效档案/锁、未知ID和归属冲突均须在持久接受和外部取消前拒绝。

## Schedule cancellation terminal history

已在原历史终态的旧运行取消幂等完成，不对计划下一轮的活动Run发送控制。

## Schedule cancellation rejection evidence

确认拒绝的Runtime回执保存为rejected，保持原运行状态；同请求重试返回原拒绝且不重复控制。

## Schedule cancellation uncertain acknowledgement

回执未知、句柄缺失/身份不匹配或外部控制抛错保留待核对状态，重试不得再次取消。

## Schedule cancellation persistence gate

持久接受失败禁止外部控制；取消后完成回执失败保留原接受意图待核对，不把存储错误当成取消被拒绝。

## Schedule cancellation public route composition

没有对话执行协调器时原定时Run仍可通过既有cancelRun路由取消；公开动作与schedule:cancel、manage范围分别绑定。

## Schedule creation and original binding

手机创建保存原启用定义及策略绑定，原回执重试返回同一结果且不再写入。创建定义本身不立刻派发Runtime。

## Schedule editing original revision

编辑沿用原锁和revision，不改变未编辑表达式的到期游标；过时版本在接受意图前拒绝，防止覆盖桌面变更。

## Schedule denied writing has no intent

预览不匹配、策略撤销或活动运行阻止编辑时不得接受Owner意图、改变原定义或派发任务。

## Schedule definition uncertain commit

接受后的原定义写入失败保留待核对回执，随后重试不得重新创建或修改原计划。

## Schedule resume and manual trigger authority

恢复原绑定计划须当前授权；暂停计划可手动触发而不改变enabled。手机触发复用受控Main派发，原运行与定义版本由原调度器保存。

## Schedule runner rechecks original policy

原runner逐次验证绑定政策，撤销后队列和到期派发受阻。即使另一个计划触发全库提交，也不丢弃被拒绝计划的等待数量或到期游标。

## Schedule desktop edit cannot remove policy

桌面编辑保留原手机政策绑定；变更mode造成政策不匹配时不能降级为普通Runtime执行。

## Schedule production authority remains unproven

实际生产工厂缺少当前可信证明或无人值守同意时不能批准绑定计划；现有或损坏审批文件不会变成授权证明，读取与非派发管理仍可使用。正式inspection无人值守证明独立于普通检查授权。

## Schedule unattended consent is mandatory

原审批存储的当前证明与无人值守同意均为必需；实际backend拒绝runtime/project身份交换，撤销后不继续授权。

## Main unattended inspection consent binding

已审查Codex inspection的无人值守选择使用独立Main证明与调度持久语义指纹，需单独准备并经桌面明确批准；普通只读批准不产生无人值守同意。每次原派发仍核验当前策略、配置与项目约束。

## Schedule deletion safety

版本化删除必须处于暂停、无活动Run、无待执行项状态；只移除计划定义，保留已产生的对话和结果历史。

## Separate schedule cancellation and discard

取消活动Run不丢弃待执行队列，终态仍由原runner协调；discard_pending只允许暂停后执行，并在同锁写入中更新版本。

## Execution persistence before dispatch

Main可信调用方在取得native Run ID后等待控制意图和原消息持久化，再进入Adapter；准备快照不共享内部对象。此关口不单独提供跨文件事务、崩溃恢复或后台终态保存。

## Persistence failure blocks local dispatch

执行前持久化抛错或异步失败时不启动CLI、不登记running状态、不发started事件；成功的异步持久化必须完成后才派发。

## Persistence failure blocks remote dispatch

远程Runtime的工作区Grant、探测与任务HTTP均位于同步持久关口之后；保存失败时不能先在远端产生授权或任务副作用。

## Task validation precedes durable admission

Runtime和任务权限验证先于持久关口；缺少完全访问确认等非法输入不能创建已接受意图，也不能启动Adapter。

## Codex original thread continuation

Codex第二轮使用原持久thread ID执行显式exec resume，权限、工作目录和staged目录留在父命令；绝不以最新会话或拼接正文代替原生续接。

## Codex continuation argument boundary

续接图片按resume子命令约定传递，会话ID和正文位于参数结束符后，防止以--开头的用户内容被解释为CLI选项。

## Codex long output session identity

原生thread身份在stdout流中独立捕获，支持分块JSON；输出尾窗裁剪不能删除已取得的续接ID，身份扫描不保留无界正文。

## Codex mismatched continuation identity

provider报告不同于请求的续接thread ID时明确失败，不把新身份写回原对话，也不自动改成新会话重试。

## Codex session evidence source

续接身份只取provider的stdout事件；stderr或自然语言不能改绑会话，合法无ID事件流保留本轮明确请求的原身份。

## Restricted history contract visibility

受限历史使用契约needs_attention状态并保留只读原因，attention筛选映射到该状态；正在运行的受限记录仍使用active，合法旧来源不能使整页响应失败。

## Original turn admission

Main在原同步写入口比较当前revision和活动Run，追加唯一用户消息与native Run身份；旧版本或已有活动任务在外部派发前拒绝。

## Current original result commit

最终回复按run ID幂等写入当前原对话并清除其活动Run，保留桌面同期的标题、置顶和归档；不同终态正文或Run归属冲突要求核对。

## Execution commit history preservation

受理与最终回复使用明确全量原历史，不因桌面消息窗口裁剪旧消息；未知根、对话和旧消息字段沿用原存储保留规则。

## Accepted background execution

[[src/main/mobile-control/execution-coordinator.ts#MobileExecutionCoordinator]]在Main持久关口保存原用户消息后返回accepted；后台观察与手机连接生命周期独立，完成写入保留桌面同期管理修改。

## Turn idempotency and continuation

重复提交先返回原回执而不再派发；第二轮继续使用原Runtime和provider session ID，并追加到同一原对话。

## Final write recovery without dispatch

真实终态正文先写入Owner临时checkpoint，原历史提交成功后才发布终态；重启只重试该原写入，成功后删除临时正文，不重新执行外部任务。

## Missing execution reconciliation

暂时无法观察Run时保留已有任务并重试读取；native句柄确实丢失则进入reconciliation_required，保留原消息且禁止重复派发。

## Cancellation acknowledgement boundary

取消动作的applied只表示已收到控制回执；Run保持cancelling直到观察到真实终态，取消前已有的可见provider回复仍写入原历史。

## Unknown cancellation outcome

取消请求发送后没有可靠回执时，操作保持待核对；相同请求重放该状态，避免重复发送未知结果的外部控制。

## Owner execution authorization

后台入口再次检查有效Grant、路由Owner/space、版本、项目和Owner策略，持久关口前重新验证策略；旧full_access及无原生续接证据的记录要求桌面处理。

## Atomic execution intent

Turn、native Run身份和操作回执同次原子落盘；状态迁移失败回滚。Run更新事件带单调runEventSeq并保存快照，后续状态不能改写旧事件。

## Execution crash recovery

无最终checkpoint的未终态执行在重启后发布有序待核对事件，不能自动恢复外部派发；未知账本字段保留。

## Checkpoint integrity

最终checkpoint绑定原Run、Turn、Runtime、对话及结果消息身份；正文冲突或损坏绑定失败关闭，不能写入原历史或覆盖原文件。

## Bound execution policy bridge

[[src/main/mobile-control/desktop-execution.ts#createDesktopExecutionBackend]]复用真实Main派发器，策略绑定活动Owner档案、原Runtime执行配置和项目；外观变化不影响该配置哈希。

## Unverified execution refusal

仅Owner提供且已证明执行边界的inspect/project_write策略可转为analysis/safe_write；手机不能提供完全访问确认。生产策略存储与inspection组合证明已接入，project_write执行约束尚待完成。

## Main cancellation evidence

Main新增控制返回区分远端取消回执尚待终态确认、取消通道结果不明和缺失Run；既有boolean取消接口保持兼容。

## Observed session identity mismatch

续接任务若观察到不同provider session ID，保留原会话身份与用户消息并进入待核对；不将替代会话的正文提交为原对话结果。

## Execution integration readiness

生产Owner组合inspection政策已装配；隔离私有配置中，原Owner、Runtime注册和对话存储已通过真实新建、两轮续接、断开后执行、取消和回执重试。窗口接口与隧道传输仅为测试替身，仍需真实APK、设备及跨网络验收。

## Serialized desktop checkpoints

[[src/renderer/src/screens/RuntimeChat/runtimeConversationWriter.ts#RuntimeConversationWriter]]串行保存同一页面检查点，冻结待写消息并沿用成功响应的revision；待写期间不采用外部刷新，避免用新版本提交旧正文。

## Desktop checkpoint conflict refusal

桌面保存附带最后观察到的原revision，冲突不自动按手机新版本重试；原标题由权威记录保留，不按每轮首条消息重新命名。

## Renderer checkpoint profile isolation

相同对话ID在不同档案不能共享检查点基线；切换目标profile必须重新读取原版本，并以目标profile提交。

## Main owned commit isolation

Main任务的原结果提交归属通过activeRuntimeRunOwner标明，Renderer检查点拒绝写入此记录；运行身份改变也必须失败关闭。

## Main owned storage checkpoint refusal

原存储在Main归属的活动任务期间拒绝旧Renderer保存，只有Main可信提交能清除归属；Renderer IPC不能指定该Main字段，版本化管理入口仍可改变标题等管理字段。

## Desktop dispatch waits for checkpoint

RuntimeChat在启动外部Runtime前等待用户消息保存成功；存储失败时不能继续派发，页面保留失败提示和未保存回复。

## Desktop observes Main owned results

桌面页面只轮询和显示Main任务，原结果落盘后显示其权威消息；关闭页面只停止该观察者，不重复写终态或取消后台任务。

## Original commit notifications

Main在原存储提交后发送只含profile、原ID、revision与类型的IPC通知；Layout按活动档案刷新列表和原页面，页面拒绝旧版本与异档案响应。

## Desktop initial checkpoint protection

首次检查点没有已观察基线时，先读取原记录并拒绝同ID正文或项目/权限变化；既有对话即使被删除也携带版本要求，原存储不得把它当作新建重新创建。

## Deleted checkpoint does not recreate

桌面删除原对话后，携带既有revision的旧检查点返回resource_not_found，不重新创建旧消息或改变原文件字节。
## Codex native mobile inspection

移动Codex analysis的Main专用选项关闭原生shell、MCP配置加载、hooks、apps、插件、浏览器、图像生成和子智能体等入口；无项目范围保护的原生view_image也关闭。普通桌面调用保持原参数；完整批准仍需实际二进制、model/provider及配置环境证明。

## Codex mobile inspection process arguments

验证移动Main选项在新建和准确原session续接的真实进程参数中生效，保留显式原model、read-only沙箱与原ID，不使用last；普通桌面未提供选项时沿用已有参数。

## Codex mobile inspection mode rejection

验证inspection选项拒绝safe_write、implementation和full_access，在进程启动及输入目录写入前失败，防止误将只读证明用于写入模式。

## Codex effective configuration read

手机受限CLI在同一环境和实际cwd只读核对原有效配置，保留原隐式模型与所选provider；忽略工具配置不应改变模型。受限启动拒绝凭据/helper/未知provider字段，不把原配置、错误或hash发给手机；这一步不产生完整执行证明。

[[src/main/mobile-control/codex-effective-config.ts#readCodexMobileConfiguration]]只发送initialize和config/read，不创建线程。[[src/main/mobile-control/codex-effective-config.ts#projectCodexMobileConfiguration]]只投影验证后的标量，显式Runtime模型优先；没有有效模型不猜测默认。新线程和准确原session续接都复用该配置，普通桌面调用不读取此投影。

## Codex native invocation identity

手机inspection在Windows x64解析已审阅npm入口或显式原生exe，配置RPC与任务派发复用实际native路径；核查后及派发前重读文件字节和环境身份。只读身份不能代替完整工具/配置政策批准；未知wrapper与更新后身份改变明确拒绝。

[[src/main/mobile-control/codex-invocation-identity.ts#captureCodexInspectionIdentity]]分块hash入口、package与原生执行文件，不执行wrapper脚本。[[src/main/mobile-control/codex-invocation-identity.ts#assertCodexInspectionIdentity]]重新比较同路径内容与当前环境，原生路径和指纹只在Main使用；普通桌面继续原wrapper调用。其他平台及未审阅入口需新增独立证据。

## Codex native byte and environment identity

验证身份包含实际native字节与当前环境hash，不公开环境凭据或生成verified批准；从PATH选择后改变环境即失效。

## Codex same path replacement refusal

验证原生文件同名替换，即使长度及时间戳保留，也因字节hash改变而失效，不能依赖路径或mtime替代身份。

## Codex unknown wrapper and invalid runner refusal

验证缺失文件、目录、未授权相对路径及未知npm入口在执行前拒绝，不调用其脚本，不退回普通启动。

## Codex dispatch identity change refusal

验证配置读取与派发使用已核对native路径，配置返回后或派发前身份改变均阻止模型进程启动；普通桌面不新增该核查。

## Codex implicit model and provider preservation

验证保留原隐式模型、显式Runtime优先级和所选provider；其他provider、通知、MCP与hook设置不被复制到受限启动参数。

## Codex unsupported provider rejection

验证凭据header、key helper、未知provider效果、缺失模型、自定义catalog和带凭据或查询的URL明确失败，错误不回显输入。

## Codex configuration RPC isolation

验证同一cwd/环境的独立配置子进程只初始化和读取有效配置，不发起模型turn，结束后清理该子进程且不公开凭据。

## Codex configuration RPC failure bounds

验证配置RPC失败、畸形UTF8/JSON、超限输出和退出均返回固定错误，不公开stderr；静默受超时约束，进程清理完成后才返回。

## Main mobile inspection ownership

验证只读执行边界由Main专用派发选项传递，非Codex或非analysis在Run受理前拒绝；合法调用在原同步持久关口之后向真实Codex进程传入边界，不扩展手机任务正文或IPC权限。
## Local execution approval management

桌面手机设置通过独立主窗口IPC管理原Owner策略文件，按原Runtime/项目ID核查能力、预审、条件批准或撤销。存储和生产Owner共用固定档案组合验证工厂；当前仅已审查inspection可批准，未验证范围仍受限。

## Execution approval management projection

验证核查不写文件，批准后状态与策略使用同一存储修订；Renderer只收到原ID/名称、mode、可用状态，不收到执行配置、路径、凭据或权限指纹。

## Execution review cannot authorize stale proof

验证核查成功后证据撤销、过期或无人值守能力不支持时，实际批准重新验证并拒绝，不能以界面保存的verified代替当前执行能力。

## Execution management write scope and CAS

验证旧版本、恢复锁或档案改变时批准/撤销不改变原文件；失效策略仍可用当前版本撤销，不取消已受理任务。

## Execution management rejects forged authority

验证管理接口在写入前拒绝路径、未知动作/字段、伪造proof、畸形版本及继承属性请求，不接受Renderer授予执行权限。

## Execution management trusted frame

验证管理IPC只接受当前桌面主窗口的主frame，其他窗口、子frame及关闭的窗口不得调用策略管理器。

## Execution production settings storage

验证设置入口通过真实固定档案工厂读取原批准文件，默认完整验证未完成时显示受限并拒绝新批准；档案切换/恢复锁不写文件，撤销保留未知根字段并条件递增原修订。

## Execution UI unverified refusal

验证设置显示实际限制，未取得当前完整执行证明时确认框与批准按钮保持不可用，核查不隐式写入批准。

## Execution UI explicit CAS approval

验证桌面用户先核查并显式确认后才提交选择与当前版本，不把proof发回Main；等待中的双击不能重复提交。

## Execution UI expiry and selection invalidation

验证核查过期后批准不可用，变更智能体/项目/mode后清除核查与确认；项目写入必须选择原项目。

## Execution UI profile response isolation

验证切换档案重置选择与确认，前一档案迟到的验证响应不得恢复原目录或批准能力。

## Execution UI revoke inactive approval

验证已有失效策略仍可由桌面确认撤销，提交当前策略修订；撤销不是取消原有任务。
## Reviewed Codex native version gate

手机 inspection 在配置 RPC 前核对已测试 native 字节哈希，未知版本直接拒绝。该限制仅绑定已测试程序，不代表模型、项目工具或生产策略已获验证，普通桌面执行不受影响。

See [[src/main/mobile-control/codex-invocation-identity.ts#assertReviewedCodexInspectionNative]].

### Unknown native refused before configuration RPC

未知 native 必须在读取原配置与启动模型之前拒绝，避免未审阅程序通过只记录身份的步骤进入执行路径。

### Native version evidence is not execution approval

版本门禁仅接受唯一匹配 native 路径的已审阅哈希；缺失、未知或重复身份拒绝，并且接受结果不产生 verified 执行权限。
## Original Native cancellation history completion

验证普通桌面任务收到实际 Native cancelled 后，Main 将真实事件和会话身份写入原历史；平台取消通知不进入模型上下文。

## Original cancellation completion admission

验证 running 回执、其他终态、身份不一致、Main 所有权和歧义分支不会写入；已有桌面结束消息保留。

## Original cancellation result fidelity and failure

验证取消前真实可见回复及执行元数据保留，持久化失败向既有控制核对路径传播。

## Original cancellation current storage preservation

验证不依赖 Renderer 的普通桌面取消通过原 store 当前记录 CAS 完成，保留并发标题与置顶编辑，同 Run 不重复落盘。
## Actual Codex project write filesystem proof

[[src/main/mobile-control/codex-project-write-probe.ts#probeCodexProjectWriteFilesystem]]在私有临时项目实际测试Native写入、项目外拒绝与联接逃逸拒绝；文件系统证据不开放完整执行策略。

## Project write probe actual bytes and policy separation

验证仅在实际项目内目标字节匹配且项目外原数据保留时返回文件系统通过；完整策略证明始终为false。

## Project write probe outside and junction detection

验证子进程伪报拒绝时，父进程检查项目外及跨根目录联接的实际磁盘结果并拒绝能力。

## Project write probe inside capability refusal

验证项目内写入的实际内容不符时不将回执或退出码当成具备写入能力。

## Project write probe strict response and diagnostics

验证非法、超长、扩展或失败响应拒绝，公开结果不包含可能泄露本机路径或凭据的诊断。

## Project write probe termination and invalid admission

验证超时终止后等待进程实际关闭才清理，非法时限不启动探测进程。
## Controlled project text write primitive

[[src/main/mobile-control/project-text-write.ts#createProjectTextWriter]]仅变更固定项目内有明确版本的文本；提交前审计原文、核对授权和身份，须由外层Native沙箱与批准机制约束。

## Project text write creation and original audit

验证实际创建与替换UTF-8文件，提交前审计原文与hash，回执仅相对路径和摘要，暂存文件正常清理。

## Project text write stale revision and concurrent replacement

验证过期hash、覆盖已存在文件及审计后可观察并发修改拒绝，不丢弃桌面编辑。

## Project text write authority and audit refusal

验证撤销、异步授权和审计失败时不变更目标文件，无法确认授权时保留暂存证据。

## Project text write path and link boundaries

验证路径逃逸、配置密钥、内部暂存名称、硬链接和junction拒绝，项目外数据不变化；原inspection隐藏内部暂存。

## Project text write root and parent identity

验证根替换或提交前父目录联接到项目外时拒绝，不对未知替代目录执行清理。

## Project text write size encoding and staging integrity

验证256KiB上限、非法UTF-8/NUL文本及暂存身份/字节变更拒绝，未知替代文件保留。
## Native text write commit handshake

独立worker准备变更后同步等待Main提交许可，缺少许可时不替换目标文件；构建生成可由普通Node运行的独立bundle。

## Main audited Native project write runner

[[src/main/mobile-control/project-write-runner.ts#ProjectWriteRunner]]绑定固定项目与已审核Native，原文审计和committing持久保存后才许可写入；非终态重启不重派。

## Main write audit and restart replay

验证原文与committing记录先于提交许可，applied在Main重建后同键重放不启动子进程，不同正文同键拒绝。

## Main write interruption retains uncertainty

验证许可后失败保留待核对及原文，重建或重放不会重复已可能执行的写入。

## Main write revocation inside authorization

验证授权回调内部同步取消也必须在许可前拒绝，等待Native进程关闭且保留原文件。

## Main write malformed prepared and audit failure

验证错误worker准备消息终止子进程，审计受恢复锁保护失败时不得发出写入许可。

## Main write private receipt admission

验证扩展回执不能泄露私有原文，审计目录不能位于Native可写项目内。

## Main write acknowledgement persistence failure

验证Native许可后回执无法落盘时保留原committing与原文，重建后拒绝重复派发。

## Main write timeout close boundary

验证超时发出进程树终止后等待实际close，才能结束操作并记录未提交失败。
## Project write lease across Main instances

验证不同namespace与审计目录共享固定项目锁，Native实际close前第二个runner不能派发；确定终态后释放本次锁。

## Project write lease unknown ownership and uncertainty

验证锁被未知身份替换时保留且阻止后续派发；许可后不确定结果保留锁供桌面核对。

## Explicit Main project write MCP entry

Main显式注入同根runner才公布write_project_text，writeId绑定幂等动作；默认inspection保持两只读工具，任务关闭取消并等待在途执行。

## Project write MCP explicit catalog and receipt privacy

验证写工具需同项目Main绑定，返回白名单字段不含原文或绝对根；工具声明真实副作用属性。

## Project write MCP input token and revocation admission

验证令牌、参数和授权失效在写入前拒绝；配置与底层异常不能进入公开工具回复。

## Project write MCP lifecycle cancellation and body bounds

验证任务工具关闭时取消并等待已接受写入，明确写模式支持有界较大正文，超过2MiB传输上限拒绝。

## Project write MCP concurrent close boundary

验证多个关闭调用等待同一在途写入实际结束，重复关闭不能提前宣布完成。

## Codex explicit project writer context

[[src/main/mobile-control/codex-mobile-context.ts#prepareCodexMobileContext]]支持Main显式注入同根写入runner；每次工具请求校验私有目录、原模型目录与投影，默认仍只读，生产批准另行验证。

显式writer上下文仅对write_project_text设置Native单工具approval_mode=approve，以通过Native二次审批；工具保留真实副作用声明，Main每次授权、审计和受控worker仍执行。只读上下文不添加此配置。

## Codex writer requires fixed project authority

验证没有固定项目、同步Main guard或同根writer时，在创建私有上下文文件前拒绝写工具绑定。

## Codex context rejects changed catalogs before write admission

验证显式writer可通过实际HTTP入口调用，但模型目录替换后不再派发写入，未知投影内容不能被清理覆盖。

## Concurrent Codex disposal waits for write shutdown

验证Native error/close、取消与abort回调重入共享dispose完成Promise；关闭立即撤销工具，但须等在途worker结束才删除自有catalog并返回。

## Codex fixed Run writer private storage

[[src/main/mobile-control/codex-project-write-context.ts#createCodexProjectWriteRunner]]按实际Main Run和固定profile建立审计命名空间，私有目录逐层拒绝联接且必须位于项目外；宿主共享项目锁协调不同profile。

## Codex Run writer rejects unsafe private paths

验证手机自选Run、项目包含审计目录或私有目录联接时拒绝准备，不向项目创建审计目录。

## Codex Run writer shares host coordination across profiles

验证审计保存于固定profile，所有profile共用宿主项目锁目录，防止两个profile绕过同项目互斥。

## Codex mobile write model stays read only

验证Main受控写通道绑定runner，但模型Native主进程仍使用read-only，不直接获得workspace-write或绕过权限参数。

## Codex mobile write requires Main guards before spawn

验证写任务缺少固定Run、项目guard、配置guard或与inspection冲突时，在配置读取、上下文准备与Native分派前拒绝。

## Main allocated Run binds project writer dispatch

验证Main分配Run后先持久接受意图，再向Native wrapper传入同一Run的受控writer，缺少项目和guard时不派发。

## Owner controlled write dispatch retains approval binding

验证Owner backend传递Main受控写标志，当前批准mode、workspace和配置变化会撤销原guard，缺少配置证明不能授权Codex写任务。

## Controlled write cancellation during Native preparation

验证受控写Run在Native准备期间收到取消时立即撤销工具授权；晚到的Native进程必须先关闭，再提交实际cancelled终态。

## Actual built worker approval proof

[[src/main/mobile-control/codex-project-write-worker-proof.ts#probeCodexProjectWriteWorker]]实际执行构建worker创建/替换、原文审计、幂等和撤销拒绝；[[src/main/mobile-control/codex-project-write-worker-proof.ts#readCodexProjectWriteBinding]]绑定已加载Main、worker和Node字节。

## Main controlled write proof and worker approval binding

验证受控写需模型只读OS、项目写OS和实际worker协议证明，批准持久绑定worker摘要，代码替换后旧批准受限且原文件保留。

## Incomplete write probes never approve

验证缺少固定项目、写OS或worker证明失败以及worker摘要不匹配时不能创建批准。

## Approved worker bytes bind Native dispatch

验证Main固定批准worker摘要与实际拷贝字节不同则在Native分派前拒绝，保留失败审计并释放确定自有锁。
## Confirmed write byte snapshots

已持久applied的Main写入回执产生原Run文本文件快照，内容来自已验证命令，不读取终态时可能已变化的项目文件；只公开新内容，不公开原文或绝对路径。

进入串行队列时固定命令值，保持AbortSignal实时撤销；退出结果和取消终态仍保留此前已确认写入。原Run持久结果形成后由既有手机仓库复制并独立校验长度和摘要。

[[src/main/mobile-control/project-write-runner.ts#ProjectWriteRunner#artifacts]] 导出副本，由实际Codex完成结果并入原Run，沿用既有Main inline产物捕获和手机下载。单Run保留99个不同路径/摘要版本，额外一条不可下载说明表示超限。失败、未知与未确认写入不产生文件。

## Applied write snapshots preserve version and replay identity

确认写快照独立于排队后调用者修改和之后的外部编辑，导出副本不能修改内部记录，同命令重放与重建runner恢复同一内容及标识且不再派发。

## Unknown write snapshots remain unavailable

worker提交授权后失败的未知写不发布可下载内容，保留uncertain审计等待桌面核对，避免将请求内容误报为确认结果。

## Write snapshot memory limit is explicit

不同确认版本超过上限后保留99个文件快照和不可下载的超限说明，不丢弃此前有效快照，也不重复派发已确认命令。
## Main unattended controlled write approval binding

无人值守受控写要求独立的完整OS、worker与构建证明和明确桌面同意；交互批准不能替代计划批准，worker变化使旧批准失效。

[[src/main/mobile-control/codex-policy-verifier.ts#prepareDesktopCodexPolicy]] 将原scheduler admission/checkpoint契约绑定到独立fingerprint；原调度器复用实际backend与固定Main Run writer，手机不控制执行路径或worker。
## Closed worker explicit owned lease release

Main只保留本runner实际观察worker close后的不确定锁句柄，独立恢复授权和用户确认通过后先持久放行意图再删除身份/字节一致的自有锁，原未知指令仍拒绝重派。

[[src/main/mobile-control/project-write-runner.ts#ProjectWriteRunner#releaseRetainedWrite]] 不把未知结果改成成功，不合成产物，不释放重启后未知或外来锁；桌面入口需另行接入此Main能力。

## Closed worker uncertain outcome observation

受控读取当前文件摘要，只描述与请求/原文吻合、其他变化或不可读取，不以摘要推断某次写入发生；核对token绑定当前审计与观察摘要。

[[src/main/mobile-control/project-write-runner.ts#ProjectWriteRunner#reviewRetainedWrites]] 导出相对路径和摘要，不导出原文、绝对路径或解除锁函数。

## Closed worker recovery confirmation and stale review

恢复要求独立授权、显式确认和当前核对token；外部编辑使旧token失效，放行后不确定审计保留且原指令不重派。

## Recovery preserves replaced locks and journals

实际worker关闭后锁字节或审计记录变化会拒绝恢复，保留他方内容与字段，避免旧能力删除外来数据。

## Recovery persistence failure retains lease

备份恢复写锁阻止放行意图持久化时保留原锁与不确定状态，不先解除排他锁。
## Desktop retained write recovery scope

正式Main将关闭后的保留锁关联原Run、项目和档案，仅原Run终态且当前桌面主frame授权有效时核对/解除；原任务运行或丢失、恢复写锁和档案切换均拒绝放行。

[[src/main/mobile-control/project-write-recovery.ts#manageMobileWriteRecovery]] 接收不透明恢复id和当前token，不接收任意文件/进程路径；factory独立核对登记项目和home身份。此入口不提供手机HTTP恢复，也不处理重启后未知锁。

Windows登记项目路径比较按系统大小写语义规范化，目录身份仍需吻合，避免同一登记项目因大小写被误判。当前桌面主frame权限在排队的runner放行开始及删除自有锁前再次核对。

## Recovery async scope and restore admission

Main在原Run异步读取后再次核对档案、桌面frame与恢复写锁，旧请求不能跨档案/窗口放行原锁。

## Recovery IPC trusted frame

只有当前桌面主窗口的主frame可进入恢复IPC，子frame或已关闭窗口不获得恢复能力，异步操作保留当前frame核对。

## Recovery UI explicit confirmation and one submit

手机连接设置展示原Run与文件核对状态，用户明确勾选后才提交当前token，等待中双击不重复放行。

## Recovery UI old profile response isolation

档案切换后丢弃旧响应，运行中的阻塞任务只展示说明，不显示解除操作。


## Android error feedback request identity

错误反馈仅呈现本地错误码文案和契约格式的原requestId，编号按页面独立保存在内存，不显示远端message/details。新错误无编号时清除旧编号；切换来源或epoch时清空，迟到错误服从原导航及连接检查。


## Android error feedback opaque request identity

未知错误显示可操作的本地通用提示和原始请求编号，不把未知错误码当作用户文案，便于定位失败请求。


## Android error feedback Chinese and malformed identity

中文反馈保留合法原编号；控制字符、远端自由文本和超长编号不展示，避免错误反馈泄露任意内容。


## Android known restriction bilingual coverage

全部九种契约RestrictionReason有独立中英提示，表达登录、配置、策略撤销和未知状态等原因；宿主界面验证已知原因不回退笼统错误。


## Android request identity section isolation and no ID retry

真实MainActivity与ViewModel在相同未知错误码下分别关联对话和计划编号，无编号重试不复用旧号，成功来源刷新清空编号。


## Android request identity rejects late history error

返回列表后迟到的计划历史异常不得发布错误码或请求编号，保证任务导航不出现旧详情故障。


## Android global action request identity and dismissal

全局错误显示原请求编号；本地协议校验故障不捏造编号，关闭反馈隐藏编号，读目录流程不产生业务写入。


## Android conversation form inline failure feedback

新建、重命名与项目修改表单在滚动内容中显示当前错误码本地文案和合法原请求编号。失败保留草稿与原身份版本，不触发成功关闭；打开新表单清除旧全局错误，不改变写入和回执核对。


## Android create rejected receipt visible draft retry

实际新建表单呈现Owner拒绝回执的本地提示和原编号，不泄露远端message；标题及原策略绑定保留，用户确认重试后仍不捏造原对话列表。


## Android create uncertain outcome inline feedback no replay

新建请求结果不确定时，模态框显示待核对提示并保留草稿；再次确认只查询原提交回执，不重发业务创建请求。


## Android responsive task management actions

计划列表管理操作按可用宽度换行，保持原权限、动作、确认及忙状态。两个列表的搜索与筛选进入原滚动区域，搜索草稿由父组件在内存保留；来源、epoch或查询改变时重置。


## Android conversation actions narrow large font

实际MainActivity在360dp和资源fontScale=2.0下验证重命名、置顶和归档按钮可见、至少48dp及完整文字，实际触摸重命名并取消不写业务。文字边界允许1px浮点取整差异，最多两行且不省略。


## Android conversation actions Chinese landscape large font

实际MainActivity在中文横屏及200%字号下核验管理按钮边界和文字，触摸打开原重命名表单并取消，验证布局与中文动作一致。


## Android schedule actions narrow large font

原授权计划列表在360dp和200%字号下验证编辑、暂停与手动触发的完整文字和48dp触控边界，滚动后真实触摸触发进入原确认且取消不写。未提交搜索文字在滚动返回后仍保留，未发送搜索请求。


## Android schedule actions Chinese landscape large font

中文横屏及200%字号下验证原计划编辑、暂停和手动触发动作可访问，触摸进入原确认并取消，保留原身份、权限及提交语义。


## Android device bilingual navigation

设备测试在专用未配对debug安装启动实际MainActivity，通过账户页切换简体中文和英文，核对实际底部导航资源更新；恢复原语言，不建立连接。


## Android device IME pairing draft

设备测试实际触摸配对地址框并等待系统IME可见，经设备按键输入和返回收起键盘后核对草稿保留、配对按钮禁用及没有claim；需要可用软键盘，不以宿主测试替代。


## Android device activity recreation

设备测试重建实际MainActivity，再打开账户页检查语言、地址表单及未配对状态；这是Activity重建，不代表进程死亡或升级恢复。


## Task time desktop agent catalog

配对后的新任务目录由当前桌面已配置智能体和原项目生成，在手机选择智能体、项目及模式；不要求桌面预创建批准组合，也不写新的审批文档。


## Task selection current configuration binding

默认任务选择的opaque ID绑定智能体执行配置及项目真实目录身份；名称外观变化不失效，配置或目录身份变化须刷新重选，不能沿用旧选择。


## Task selection disabled and inactive refusal

默认目录及授权每次核对当前档案、恢复写锁、原智能体启用与授权状态、项目映射；已禁用、删除、需重新授权或档案切换时拒绝执行。


## Legacy execution policy compatibility

已有严格执行策略及未知持久字段不迁移、不删除，旧ID继续调用原策略的当前证明检查；新默认选择不能改变旧批准的验证路径。


## Android independent desktop task choices

新版手机以独立下拉框选择电脑端智能体、原项目和执行模式，并提交原目录对象的ID；界面不要求用户识别或预批准opaque策略。


## Android task choice invalidation and recovery

当前项目或选择失效时禁用提交，保留表单并允许重选有效组合；中文显示原资源名称及模式，不将旧有效对象替换为虚构授权。


## Distinct desktop task mode contract

desktop_analysis及desktop_execute表示复用桌面正常analysis/safe_write执行模式，与旧inspect/project_write的验证沙箱语义明确区分；未知模式仍拒绝。


## No-project policy publication

无项目任务也发布自动、只读与完全访问选项；自动遵循 Runtime 默认权限，完全访问需显式确认且不可用于无人值守定时触发。Owner 每次授权仍复核当前 Runtime 和策略身份。


## No-project task permission selection

Android 新建任务默认选择自动权限，并允许在当前桌面 Owner 发布且验证过的无项目策略间切换；选择失效时不得静默降为只读。

## Projectless automatic and full-access execution

The Owner accepts the generated desktop-task automatic policy without a project workspace and requires explicit confirmation for each full-access turn; legacy project-write approvals remain project-scoped.

[[src/main/mobile-control/execution-coordinator.ts#MobileExecutionCoordinator#checkApproval]] validates the generated policy identity, runtime, workspace binding, and full-access confirmation before dispatch. Automatic `safe_write` without a project is valid only for the generated desktop-task policy; legacy project-write approvals still require a project. A conversation already marked `full_access` can continue only with a currently authorized generated full-access policy carrying `fullAccessConfirmed`.

### Projectless automatic dispatch

Generated desktop-task `desktop_auto` policy may dispatch as `safe_write` with no project workspace, while an unscoped legacy write policy remains denied.

[[tests/mobile-execution-coordinator.test.ts]] verifies that the automatic mode reaches the desktop dispatcher without fabricating a project or workspace.

### Confirmed full-access continuation

A full-access conversation turn is dispatched only when the generated Owner policy supplies and forwards explicit full-access confirmation.

[[tests/mobile-execution-coordinator.test.ts]] verifies the confirmation flag reaches the dispatcher when continuing a full-access conversation.

### Rejects unconfirmed full access

The Owner rejects full-access dispatch without confirmation and does not let legacy unscoped write policies borrow the generated task-policy exception.

[[tests/mobile-execution-coordinator.test.ts]] verifies both denial paths before external dispatch.

## Explicit full-access conversation creation

An empty mobile conversation records full access only when the Owner supplied a generated desktop-task policy and explicit confirmation.

[[src/main/mobile-control/conversation-creation.ts#DesktopConversationCreation#authorize]] keeps legacy policies limited to analysis/project-write modes and persists the selected access mode without changing Runtime or project records. [[tests/mobile-conversation-controller.test.ts]] verifies the projectless automatic creation path and confirmed full-access metadata.


## Production task selection creates original conversation

生产Owner组合通过新目录选择在原会话仓库创建空会话，并返回原操作回执；不创建审批文件，不提前派发模型任务。


## Pairing defaults to declared phone operations

桌面配对核对短语后默认授予服务声明的手机操作范围，连接设置不加载执行审批表单；已有设备授权不自动重写，撤销访问仍保留。


## Android original conversation task mode recovery

既有会话的智能体与项目保持原绑定，手机可选择执行模式。目录变化使已选模式失效时保留输入区及草稿、禁用发送，不能静默回退为另一模式；明确重选后恢复发送。

## Independent ledger worker RPC

Main 通过有界 RPC 将移动账本操作串行交给独立 utility process；启动握手完成前不提供账本服务，关闭只发送一次 worker RPC。
## Approved C native layout

Android遵循已批准C R02的暖白与橙色、设备来源栏、编号对话列表、定时时间索引、细线导航、全屏新建与编辑及设备偏好分组。原生键盘与触控适配保留，宿主UI测试不能代替真机截图验收。

Manrope字形随包提供，中文按设计规范使用系统回退。语言/外观使用底部面板，继续对话的模式选择收起，管理动作归入详情标题栏更多菜单；异常草稿不因显示调整丢失。定时列表按Owner提供的nextRunAt升序排列，不由手机计算时间。

## Original conversation continuation availability

原始Runtime对话只有在设备具有推进权限、执行协调器已装配、当前策略匹配智能体和项目且有效时提供advance动作；读取不改变历史，真正发送仍在执行边界重新授权。
## First prompt failure preserves original conversation

新建先持久创建原会话，再向同一会话提交首条任务。首条发送失败保留输入草稿及原会话身份，重试只提交turn，不重复创建；空标题从任务首行推导且先验证正文长度。

## Current mobile stream source observation cost

当前实时流每秒刷新原运行与附件并观察全部来源；每个订阅独立执行。无变化可避免账本写入，但不能避免此前的历史读取、投影和摘要计算。

[[src/main/mobile-control/event-stream.ts#MobileOwnerEventStream]] 由控制器绑定 [[src/main/mobile-control/source-events.ts#MobileSourceEventPublisher]] 的完整来源观察。原仓库列表载入完整对话消息及计划历史，因此读取成本随历史量增长。账本提交仍克隆完整状态并同步序列化、fsync；30秒回执读取限制不改变来源观察周期。该描述记录现有行为，不表示性能或增量同步已验收。

## Current Android event consumer scheduling

当前Android实时消费者使用32条事件缓冲，等待前台busy结束，并在事件后串行刷新派生查询；缓冲溢出触发游标恢复，不能据此断定Owner网络已断开。

消息与运行事件应用、收据及筛选列表读取在同一观察循环中。HTTP派生查询异常可以中断观察；恢复需区别授权失败、限流、游标失效与真实Owner离线。本节仅描述当前执行顺序，手机记录及提交回显仍是进程内状态。

## Android C refinement delivery boundary

The 2026-10-15 Android UI refinement preserves C R02 styling, static Agents One branding, collapsed project navigation, enabled/paused schedules, device labels, explicit permission choices, encrypted offline avatars and compact original Run activity.

The cumulative implementation is built in the mobile-sync-p0 worktree because this checkout contains an older Android synchronization baseline. Release evidence and compatibility instructions remain private. Actual cloud deployment, APK installation and current desktop resource loading are separate acceptance gates; source or package builds do not establish those gates.

## Android visible message read boundary

验证只有当前对话中实际展示给用户的消息才能推进已读位置；初次滚到最新可见消息后，向上回看不能让已读位置倒退。


## Android event drain independent from user actions

前台任务动作处于 busy 且详情读取挂起时，已到达的合法事件仍按序验证并立即更新对应可见状态，动作结束后不补发重复业务请求。


## Android derived reads are single flight and coalesced

多个筛选变化在一个慢速 Owner 查询期间合并为一次尾随读取；单飞工作器不阻塞 SSE 消费，查询使用发起时的查询与筛选条件并核对连接代际。

`MobileViewModel.refreshEventSearches` 承担回执、对话筛选和计划筛选的派生读取，dirty 修订号阻止读取期间的新变化被清除。


## Android receipt trailing refresh and scoped failures

回执继续遵守 30 秒最小刷新间隔；节流窗口内的最后一次 dirty 会被定时唤醒，普通查询失败只写入对应查询错误并退避重试，不能关闭健康事件流。


## Android bounded event overflow recovery

事件队列容量保持 32；超过容量会使当前流进入有退避的快照恢复，再从恢复高水位开启新流，不丢弃权限检查、不误报为 Owner 离线，也不创建无界内存队列。


## Android cache-first offline restoration

Android restores only encrypted pages under the last validated endpoint, device, Owner, space, data epoch, and grant namespace before attempting credential refresh; an unreachable Owner leaves those pages visibly offline and read-only.

The Robolectric ViewModel integration test verifies cached conversation and schedule details restore from encrypted Room, cache-only conversation creation/continuation/pinning/renaming and schedule mutation/revocation attempts do not reach the Owner client, a confirmed missing Owner clears the display pointer while preserving encrypted rows, and a changed grant revision does not restore the old namespace.

The last Owner pointer is AES-GCM protected and its AAD binds endpoint, device ID, and grant revision. Cache-only state strips execution capabilities and rejects writes. A confirmed authentication failure, changed grant revision, or Owner no longer listed clears the display pointer without deleting other user preferences or desktop-authoritative records. Startup cache reads precede network refresh so a transient outage does not hide previously authorized pages.


## Android first-page backpressure recovery

A transient initial list failure retains the authorized copy and retries with capped backoff even for an unrestricted list and without a new event.

The healthy stream and other sections remain usable; success persists the page and clears its error and stale marker.


## Android clean C task navigation

C列表使用静态品牌与连接状态、线式搜索及键盘提交；项目是默认折叠的原项目目录，展开沿用原项目筛选及冻结分页。定时启用/暂停按原enabled字段分类，保留原运行状态，不改计划。


## Android authorized offline avatar copies

原Runtime与项目目录及验证头像在既有加密Room授权namespace中保存。读取绑定endpoint、设备、grant、Owner、space、epoch和原内容标识；离线只读目录不授予执行权限，未知图保持原名称占位。


## Android compact activity and composer stop

思考与工具用可展开图标行展示已公开进度，只有运行图标动画。空草稿时同一发送按钮取消当前有cancel权限的原Run；有草稿时保留文本，不并发重派或把回执假作终态。


## Android full access never defaults

Full access must be explicitly selected and never supplies an automatic default. A no-project choice requires a matching current Owner policy.

The Owner must publish and reauthorize that policy for each operation; missing or stale policies prevent admission.


## Per turn activity precedes original response

Android inserts each Run disclosure before its original assistant reply using run or turn identity, preserving message sequences and rendering each Run once.


## Legacy activity chronological fallback

Legacy replies without a Run link use the published Run start time; an explicitly linked reply from another Run is not reused as a fallback anchor.


## Pending input precedes live activity

Local pending user input keeps its own identity and appears before the live activity that follows it; reconciliation still uses the original message receipt contract.


## Creation navigates before network acceptance

Submitting a new conversation immediately shows the original input in a local submission view. Only an applied Owner receipt supplies conversation identity; failures retain the original input and unknown writes only reconcile their original key.


## Android temporary read failure recovery

A read-only requires_owner_action HTTP 5xx is temporary refresh failure, not approval or proof that the Owner is offline. Observation retries with existing backoff while retaining Run progress and never submitting business mutations.


## Android genuine Owner restriction preservation

An explicit Owner restriction with HTTP 403 remains actionable and does not become a transient retry loop. Authentication, policy and protocol failures retain their original handling.


## Android current Run read feedback recovery

A fresh accepted Run event for the selected conversation clears only its temporary read failure. Unrelated or stale events cannot clear another conversation error or suppress a genuine restriction.


## Android auxiliary read conflicts keep healthy events

Read-only revision_conflict/409 responses use bounded section retries while healthy SSE continues consuming task progress. Existing receipts and Run identities remain intact; no business mutation is replayed.


## Android snapshot conflict bounded recovery

Snapshot recovery retains original content on concurrent revision conflict and retries with bounded backoff, accepting one consistent snapshot anchor before resuming events. Genuine Owner restrictions remain terminal.


## First prompt survives slow initial snapshot

新建会话受理后，在首次详情发布前登记同一条本地待提交消息，运行快照延迟不能产生空白等待页；首次 Turn 仍使用原创建回执和版本，只提交一次。


## Actual model qualified catalog display

Android 优先显示实际模型；仅在配置模型的尾部标识完全一致时补充已知供应商前缀，不以其他模型或智能体名称猜测供应商。


## Android task creation without a project

新建对话和定时任务默认选择当前目录中可执行的“无项目·自动”策略。目录刷新时按相同策略身份与运行时、项目、模式绑定重新取对象；没有 Owner 授权策略时保持禁用，不能伪造权限。


## Android single offline notice

Owner 离线时，在页面顶部只显示一条简短提示；缓存列表与详情可继续阅读。连接类同步错误不重复显示请求编号和操作横幅，非连接类错误及原诊断记录仍保留。

## Mobile sync protocol evolution

Optional protocol features preserve v1 readers while making sync recovery and exact user-message echo explicit before durable Android caching is enabled.

### Optional feature negotiation and legacy fallback

Bootstrap protocol feature IDs are separate from authorization scopes; clients ignore unknown IDs and use new fields only when the current Owner advertises the relevant feature.

### Snapshot anchors and filtered event gaps

Snapshot high-water and opaque cursor identify one Owner cut; filtered space event sequences may jump, while revisions, tombstones and cursor recovery prevent gaps or stale replay.

### Exact client message echo identity

A client message ID correlates one optimistic user row across its request, canonical Owner message and event; it remains separate from the operation idempotency key.

### Cross-platform schema fixture compatibility

Generated schema fixtures cover old and feature-aware v1 payloads so the TypeScript validator rejects malformed fields without requiring optional fields from legacy Owners.

### Legacy Kotlin reader compatibility

The Android decoder accepts legacy DTOs and ignores newly added optional response fields while preserving message and operation identities separately.


## Android conversation and project category isolation

The standalone conversation category shows only unarchived conversations without a project; project tasks remain under their original expandable project and are never rewritten or deleted.

## Android bottom navigation restores standalone conversations

Returning from schedules or account selects standalone conversations and restores their matching list instead of relabeling the last project page. Detail back navigation retains its original category.

## Android project detail retains its category on back

Opening an original project task and returning preserves the expanded project group; a subsequent bottom-navigation return to conversations resets to the standalone list.

## Android task directory source boundary

安卓任务目录排除通用 Conversation 接口中的 quick_chat 快捷聊天，保留任意日期的真实任务。列表、搜索、分页与升级前加密缓存使用同一筛选，保持原游标与重复 ID、筛选字段校验；原始记录和缓存不被删除。标题、分类及底部导航统一显示任务（Tasks）。

## Android task source event and snapshot admission

实时事件与过期游标快照恢复同样遵循任务来源边界，快捷聊天不得绕过列表筛选重新进入目录；原始 native_session、runtime_conversation 与 collaboration 继续按当前项目和归档条件展示。
