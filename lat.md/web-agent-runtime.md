# Web Agent Runtime

Web Agent Runtime 是已落地的本地 Runtime：由 Agents One 托管隔离的网页会话，让用户在任务对话中使用豆包、ChatGPT 与 Grok 网页版，并在需要登录或验证时转入应用内接管。

完整产品范围、状态机、安全边界、测试和实施拆分见 `docs/AGENTS_ONE_WEB_AGENT_RUNTIME_PRD_20260828.md`。新增 Provider 必须通过独立适配器、隔离登录分区、域名白名单和 DOM 回归夹具接入。

## Runtime boundary

该 Runtime 复用现有对话、附件暂存和事件展示，只新增 `local-web` 执行分派，不改变其他本地 CLI、Local API 或 Gateway v1 Runtime。

网页会话默认没有工作区或 Shell 权限，只能读取本轮由用户明确选择且已进入主进程受控暂存区的附件。通用 Web Preview 不承担登录态、后台任务、上传或下载职责。

## Provider isolation

每个 Provider 和账号 Profile 使用独立 Electron Session Partition、会话映射、DOM 夹具和发布开关，页面规则不得进入通用 Runtime 控制层。

Provider 适配器分别负责登录探测、会话恢复、附件上传、提示词发送、回复观察、取消和下载识别。页面结构无法可靠识别时必须停止并请求用户接管，不能猜测点击或自动重发。

## Doubao cold-page and submission recovery

豆包新会话在冷加载时允许最多 15 秒挂载编辑器和模式控件；可信发送点击只有在页面明确证明草稿仍完整保留、没有对应用户消息或生成状态且发送控件仍可用时，才允许一次同页 DOM 恢复提交。

[[src/main/web-agent/providers/doubao.ts#DoubaoProviderAdapter#createConversation]] 在进入模式选择前完成新会话页面健康确认，避免把慢挂载误报为模式不支持。[[src/main/web-agent/providers/doubao.ts#DoubaoProviderAdapter#sendPrompt]] 保留完整提交回执门禁；恢复动作不因网络错误、慢回执或未知页面结构触发，并且每轮最多执行一次。

## Grok adapter

Grok 通过独立 `grok` Provider 接入，复用已验证的提交回执、Markdown 回复提取、附件与下载流水线，但保留自己的登录、模式、导航和取消规则。

Grok 网页入口为 `https://grok.com/`，登录中间页仅放行 `accounts.x.ai` 及明确列出的身份提供方；会话只持久化 Grok 自有域名下的具体 `/c/{id}` 地址。匿名首页虽有输入框，但提交会进入注册墙，因此出现 Sign in/Sign up 时必须判为未登录。

xAI 登录页会拒绝 Electron 默认附带的应用与 `Electron/...` 产品标识。Grok 的独立 Partition 因此使用与内置 Chromium 实际版本一致的标准 Chrome User-Agent；不得从系统 Chrome 复制 Cookie、凭据或个人 Profile，也不得把该兼容设置扩散到其他 Provider。

Google OAuth 仍由 Google 自己拒绝 Electron 内嵌授权页；识别到 `accounts.google.com` 的“不安全浏览器”拒绝页时，适配器必须给出明确提示并让用户返回选择邮箱或 X 登录，不得自动代填凭据、复制外部 Chrome 会话或绕过 Google 安全策略。

当前页面契约使用 `textarea[aria-label="Ask Grok anything"]`、`data-testid="chat-submit"`、`data-testid="assistant-message"` 与 Stop 控件。Grok 没有豆包/ChatGPT 的 Work/Chat 切换，适配器固定使用聊天模式；任何选择器、上传回执或回复状态无法确认时均失败关闭。

## Event semantics

Web Agent Runtime 只上报实际可观察的网页事实，并继续遵守 Agent Event Stream v1 的去重与持久化规则。

回复增量只作临时显示，最终答复只持久化一次；上传和下载可映射为工具与产物事件。登录、验证码和页面异常是控制状态，不能伪装成推理摘要或智能体答复。
