# Web Agent Runtime

Web Agent Runtime 是已落地的本地 Runtime：由 Agents One 托管隔离的网页会话，让用户在任务对话中使用豆包、ChatGPT 与 Grok 网页版，并在需要登录或验证时转入应用内接管。

当前公开支持范围见 `KNOWN_ISSUES.md`。新增 Provider 必须通过独立适配器、隔离登录分区、域名白名单和 DOM 回归夹具接入。

## Release policy

全部内置网页 Provider 默认关闭，且不得因探测、计划任务、历史 Runtime 配置或设置页加载而自动访问第三方网页。用户可在网页智能体配置区显式确认开启，无需开发环境变量；策略仅新增启用值和确认时间，不记录网页凭据并保留未知配置字段。

`AGENTS_ONE_DISABLE_WEB_AGENTS=1` 是优先级更高的本机紧急停用开关。设置页的一键停用会取消活动网页任务并销毁全部 Provider 窗口；即使策略关闭，用户仍可删除 Runtime 或清除对应隔离分区的登录数据。当前不连接远端 kill-switch 或遥测服务，因此策略检查不会上传 Cookie、Token、提示词或账号信息。

## Runtime boundary

该 Runtime 复用现有对话、附件暂存和事件展示，只新增 `local-web` 执行分派，不改变其他本地 CLI、Local API 或 Gateway v1 Runtime。

网页会话默认没有工作区或 Shell 权限，只能读取本轮由用户明确选择且已进入主进程受控暂存区的附件。通用 Web Preview 不承担登录态、后台任务、上传或下载职责。

## Provider isolation

每个 Provider 和账号 Profile 使用独立 Electron Session Partition、会话映射、DOM 夹具和发布开关，页面规则不得进入通用 Runtime 控制层。

Provider 适配器分别负责登录探测、会话恢复、附件上传、提示词发送、回复观察、取消和下载识别。页面结构无法可靠识别时必须停止并请求用户接管，不能猜测点击或自动重发。

## Doubao cold-page and submission recovery

豆包新会话在冷加载时允许最多 15 秒挂载编辑器和模式控件；可信发送点击只有在页面明确证明草稿仍完整保留、没有对应用户消息或生成状态且发送控件仍可用时，才允许一次同页 DOM 恢复提交。

[[src/main/web-agent/providers/doubao.ts#DoubaoProviderAdapter#createConversation]] 在进入模式选择前完成新会话页面健康确认，避免把慢挂载误报为模式不支持。[[src/main/web-agent/providers/doubao.ts#DoubaoProviderAdapter#sendPrompt]] 保留完整提交回执门禁；恢复动作不因网络错误、慢回执或未知页面结构触发，并且每轮最多执行一次。

## ChatGPT login hydration

ChatGPT 登录跳转完成后，输入框可能晚于页面导航挂载；适配器在同一隔离页面上等待最多 30 秒，再判定页面结构不受支持。

[[src/main/web-agent/providers/chatgpt.ts#ChatGPTProviderAdapter#ensureChatReady]] 只在输入框尚未识别时继续轮询，登录或验证状态仍立即交给用户处理。超过等待窗口仍没有可见输入框时保持失败关闭，不猜测提交目标。

## ChatGPT mode confirmation

ChatGPT 新会话发送前必须通过可见的 Chat/Work 控件确认选中模式；侧栏或页面文案不能作为模式证据。

[[src/main/web-agent/providers/chatgpt.ts#ChatGPTProviderAdapter#modeState]] 识别按钮、标签页或单选控件上的选中语义，包括 `aria-pressed`，并检查嵌套标签。[[src/main/web-agent/providers/chatgpt.ts#ChatGPTProviderAdapter#ensureMode]] 点击后再次核对状态；无法确认时停止发送，只有明确的 Work 额度或可用性提示才允许切换到 Chat。

## ChatGPT submit receipt

ChatGPT Work 的多段输入必须按渲染出的段落文本确认，并使用当前编辑器所属表单的发送控件；仅在网页给出用户消息、清空草稿或其他明确回执后才认定已发送。

[[src/main/web-agent/providers/doubao.ts#DoubaoProviderAdapter#sendPrompt]] 对 contenteditable 优先读取 `innerText`，保留段落分隔；`textContent` 会把相邻 `<p>` 直接拼接，误判已写入的草稿。当前 ChatGPT Work 发送按钮为编辑器表单内的 `button[type="submit"][aria-label="发送"]`；旧标签仍可兼容。确认失败不自动重发，避免重复提交。

## ChatGPT response container

新版 ChatGPT Work 将助手正文放在 `data-markdown-text-style="assistant-message"` 节点中；回复观察必须识别该明确属性，避免网页已完成但任务一直等待。

[[src/main/web-agent/providers/doubao.ts#DoubaoProviderAdapter#readResponse]] 将此节点纳入可见助手候选，仍复用原有 Markdown 提取、最后一条回复选择、提交前快照对比和完成判断。侧栏文字与用户输入不作为助手回复。

## ChatGPT completion evidence

新版 ChatGPT Work 会先显示计划或短句，再继续搜索与撰写；只有网页的回复状态明确显示完成，才能把当前助手正文作为最终答复保存。

[[src/main/web-agent/providers/chatgpt.ts#ChatGPTProviderAdapter#readResponse]] 对新版助手正文读取 `aria-live="polite"` 的完成状态；缺少完成回执时继续观察，避免 1.2 秒文字稳定窗口截断长简报。旧版消息容器沿用既有稳定判定。

## ChatGPT full-page retry

ChatGPT 已接收提示词后若整页会话加载失败，回复观察只点击网页自带“重试”一次，并等待原会话回复，不再次提交提示词。

[[src/main/web-agent/providers/chatgpt.ts#ChatGPTProviderAdapter#readResponse]] 仅在整页错误文案、可见重试按钮及无输入框同时成立时恢复；重复错误返回 Provider 错误，避免无人值守任务一直等待。

## Response table preservation

ChatGPT 的回复表格必须在网页提取时保留行列结构，并转成 Renderer 已支持的 GFM 表格，避免不同单元格的文字连成一段。

[[src/main/web-agent/providers/doubao.ts#DoubaoProviderAdapter#readResponse]] 只将语义 `<table>` 的单元格序列化为 Markdown；列内的强调和可用链接继续保留，文字中的竖线转义。其他 Provider 的普通段落和列表沿用原逻辑。

## Grok adapter

Grok 通过独立 `grok` Provider 接入，复用已验证的提交回执、Markdown 回复提取、附件与下载流水线，但保留自己的登录、模式、导航和取消规则。

Grok 网页入口为 `https://grok.com/`，登录中间页仅放行 `accounts.x.ai` 及明确列出的身份提供方；会话只持久化 Grok 自有域名下的具体 `/c/{id}` 地址。匿名首页虽有输入框，但提交会进入注册墙，因此出现 Sign in/Sign up 时必须判为未登录。

xAI 登录页会拒绝 Electron 默认附带的应用与 `Electron/...` 产品标识。Grok 的独立 Partition 因此使用与内置 Chromium 实际版本一致的标准 Chrome User-Agent；不得从系统 Chrome 复制 Cookie、凭据或个人 Profile，也不得把该兼容设置扩散到其他 Provider。

Google OAuth 仍由 Google 自己拒绝 Electron 内嵌授权页；识别到 `accounts.google.com` 的“不安全浏览器”拒绝页时，适配器必须给出明确提示并让用户返回选择邮箱或 X 登录，不得自动代填凭据、复制外部 Chrome 会话或绕过 Google 安全策略。

当前页面契约使用 `textarea[aria-label="Ask Grok anything"]`、`data-testid="chat-submit"`、`data-testid="assistant-message"` 与 Stop 控件。Grok 没有豆包/ChatGPT 的 Work/Chat 切换，适配器固定使用聊天模式；任何选择器、上传回执或回复状态无法确认时均失败关闭。

## Event semantics

Web Agent Runtime 只上报实际可观察的网页事实，并继续遵守 Agent Event Stream v1 的去重与持久化规则。

回复增量只作临时显示，最终答复只持久化一次；上传和下载可映射为工具与产物事件。登录、验证码和页面异常是控制状态，不能伪装成推理摘要或智能体答复。
