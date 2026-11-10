# Agent Onboarding

新增智能体采用仅影响 Renderer 的三步向导，将 One 模型 API 配置与本地、远程、网页智能体接入并列呈现，而不改变既有 Runtime 保存、凭据存储或连接探测契约。

## Agent management modes

The agent manager separates configuring self-hosted One runtimes from managing connected local, remote, and web runtimes.

The configuration destination lists only `kind: one` runtimes and uses a dedicated ZCode-inspired workspace: model settings (a provider stack with provider-scoped credentials and an active-model switch), personalization, memory, and per-agent skills. The selected default remains `config.model`, the only model sent to One execution; optional `oneModels` stores non-secret provider choices. The agent selector shows the readiness state instead of the internal runtime id. Profile editing changes the display name, accent color, and an optional avatar image (PNG, JPG, WebP, or GIF up to 480 KB, stored as a validated data URL) without altering runtime identity or transport. Subagent settings explain the current per-task collaboration boundary, while plugins, MCP servers, and skills share one extensions destination presented as tabs with scope, counts, search, and row-level switches. Skills are split into One-installed and available-to-add groups: enabling copies the shared skill into One's own directory, and deleting removes only that copy, leaving skills used by other agents untouched. Personalization shows the actual AGENTS.md in an editable document view (with a starter draft when the file is empty), and memory lists personal and project entries with search, inline editing, and a workspace-memory switch. The model settings page keeps every provider visible in a horizontal selector above the active provider's form, with connection testing and saving below the model list. Each tab keeps its existing data contract and IPC path. Existing runtime identity and transport management stay in the separate access-management flow. The access destination lists only connected local, remote, and web runtimes, with counts and live probes scoped to those runtimes; One remains parallel and configurable from its own destination, never represented as a connected agent. The application-level left navigation remains owned by the layout and is not changed by this screen. New surfaces use app-wide theme tokens so their selected, hover, and provider states remain legible in each supported theme. See [[src/renderer/src/screens/Agents/Agents.tsx#Agents]], [[src/renderer/src/components/settings/OneAgentConfigurationPane.tsx#OneAgentConfigurationPane]], [[src/renderer/src/components/settings/OneModelProvidersPane.tsx#OneModelProvidersPane]], and [[src/renderer/src/components/settings/OnePluginMcpPane.tsx#OnePluginMcpPane]].

## Three-step flow

第一步可选择配置内置 One 智能体，或按运行位置选择本地、远程、网页智能体；第二步配置头像、颜色、可自定义名称、智能体 ID 和接入类型；第三步才展示连接所需字段。One 已随应用内置，配置模型供应商、API 地址、模型 ID 和 API Key 后即可使用内置工具与执行能力。多个 One Runtime 使用独立 ID 和凭据；默认 ID 会避让已有项，重复 ID 会在探测与保存前阻止。已接入智能体仍使用原有管理表单，不进入该向导。

One 在独立的智能体配置入口中管理；智能体接入管理仅列出本地、远程和网页 Runtime。任务对话时，One 与已接入 Runtime 仍是由用户选择的平行对象，One 不默认调度其他 Runtime，见 [[sidebar-navigation#Parallel Runtime selection]]。One 类型卡片使用独立 SVG 标识，本地接入卡片改用带终端与状态提示的 SVG 标识。

## Minimal connection data

本地智能体只要求可执行文件；新建本地智能体流程不展示模型覆盖、旧版默认 Agent 和 ACP 参数，已有配置仍可兼容读取。网页智能体只要求 Provider 和隔离登录档案；远程智能体统一使用 Gateway v1。受控工作区网关地址和 Token 属于高级兼容配置，不属于推荐配对流程的必填项。

## Remote connection profiles

远程接入先选择校验码配对或自托管 Gateway，两种信任模型使用独立表单、状态和诊断语义。

校验码配对是普通用户的推荐路径，由 Agents One Connect 管理一次性短码、设备身份和 Connector 隧道。自托管 Gateway 是高级路径，由用户填写 HTTPS Gateway v1 地址和 Token；未经过 Connect 的直连 Runtime 只能显示“手动直连”，不得显示“已配对”。公共远程协议见 `docs/AGENTS_ONE_REMOTE_GATEWAY_V1.md`。

Connector-first 配对现在先做无凭据预览：展示设备指纹摘要、Runtime/能力元数据和过期时间，用户确认后才消费校验码并分发隔离 Token。取消预览不会创建本地 Runtime；预览不得返回任何 Token 或私钥。

## Existing local Hermes installation

本地 Hermes 复用现有内置 Runtime 和安装校验能力，产品只补齐已有安装的发现、选择、采用和刷新流程。

采用已有安装不得创建第二套 Hermes Adapter 或覆盖用户自建 Runtime；候选会展示来源、版本、可执行文件、配置和本地 API 状态。路径无效时不写配置，采用成功后用户可选择立即重载或在下次启动时使用所选 Hermes Home。

## Timeout presentation

底层 Runtime 继续以 `timeoutMs` 保存，界面以秒显示和编辑，本地、远程、网页类型默认均为 300 秒。该值限制连接检测与对话请求的等待时间，超过后向用户呈现连接异常。

## Web agent opt-in

网页类型始终可选并可进入配置步骤；新增和管理页顶部不展示 Provider 横幅。配置区使用“网页智能体（实验性）”总开关，默认关闭，显式确认启用后展开 Provider 和登录档案；关闭时收起字段并保留当前草稿与向导步骤。

开关复用已有策略 IPC 和持久化，用户无需设置开发环境变量。取消确认或保存失败保持关闭；紧急停用和策略读取失败仍禁止开启。已启用状态在重开时保持，只有关闭后才停止网页执行，见 [[web-agent-runtime#Release policy]]。
