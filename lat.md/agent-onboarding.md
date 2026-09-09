# Agent Onboarding

新增智能体采用仅影响 Renderer 的三步向导，将类型选择、显示信息和连接设置分开呈现，而不改变既有 Runtime 保存、凭据存储或连接探测契约。

## Three-step flow

第一步按运行域选择本地、远程或网页智能体；第二步配置头像、颜色、名称、智能体 ID 和该运行域支持的具体类型；第三步才展示连接所需字段。已接入智能体仍使用原有管理表单，不进入该向导。

## Minimal connection data

本地智能体只要求可执行文件；新建本地智能体流程不展示模型覆盖、旧版默认 Agent 和 ACP 参数，已有配置仍可兼容读取。网页智能体只要求 Provider 和隔离登录档案；远程智能体统一使用 Gateway v1。受控工作区网关地址和 Token 属于高级兼容配置，不属于推荐配对流程的必填项。

## Remote connection profiles

远程接入先选择校验码配对或自托管 Gateway，两种信任模型使用独立表单、状态和诊断语义。

校验码配对是普通用户的推荐路径，由 Agents One Connect 管理一次性短码、设备身份和 Connector 隧道。自托管 Gateway 是高级路径，由用户填写 HTTPS Gateway v1 地址和 Token；未经过 Connect 的直连 Runtime 只能显示“手动直连”，不得显示“已配对”。完整产品范围见 `docs/AGENTS_ONE_UNIFIED_RUNTIME_ACCESS_PRD_20260905.md`。

Connector-first 配对现在先做无凭据预览：展示设备指纹摘要、Runtime/能力元数据和过期时间，用户确认后才消费校验码并分发隔离 Token。取消预览不会创建本地 Runtime；预览不得返回任何 Token 或私钥。

## Existing local Hermes installation

本地 Hermes 复用现有内置 Runtime 和安装校验能力，产品只补齐已有安装的发现、选择、采用和刷新流程。

采用已有安装不得创建第二套 Hermes Adapter 或覆盖用户自建 Runtime；候选会展示来源、版本、可执行文件、配置和本地 API 状态。路径无效时不写配置，采用成功后用户可选择立即重载或在下次启动时使用所选 Hermes Home。

## Timeout presentation

底层 Runtime 继续以 `timeoutMs` 保存，界面以秒显示和编辑，三类智能体默认均为 300 秒。该值限制连接检测与对话请求的等待时间，超过后向用户呈现连接异常。
