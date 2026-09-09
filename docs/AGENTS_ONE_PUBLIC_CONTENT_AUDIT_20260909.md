# Agents One 公开范围内容审计（OR-008）

> 审计日期：2026-09-09
> 审计对象：当前工作树中已跟踪及拟纳入 OR-003 的未跟踪文本内容
> 状态：当前树分类与 OR-003 处置完成；Git 历史仍由 OR-007 复核
> 权威计划：[Agents One 开源发布收口阶段 PRD](./AGENTS_ONE_OPENSOURCE_RELEASE_READINESS_PRD_20260909.md)

## 1. 结论

当前扫描未发现高可信的私钥 PEM、JWT、GitHub Token 或真实 OpenAI Key 形态。API key、Token、IPv4 和 `sk-` 的大量命中主要位于字段名、占位符、测试假值、回环/私网示例及 CSS/任务标识中，不能据此宣称 Git 全历史安全；OR-007 仍必须使用专用工具扫描最终拟公开 refs。

公开内容的主要风险不是已确认密钥，而是：

1. 已删除产品方向的 SSH、Kanban、Wallet、Office 与旧 Dashboard 操作文档仍在当前树中。
2. Hers/Hers-2 定向部署与交接文档包含具体合作环境语义，不应作为通用公开文档发布。
3. 进展日志、恢复文档、构建笔记、脚本和测试仍有开发机绝对路径、用户名或组织目录标识。
4. 若只在当前树删除文件，旧内容仍可能存在于 Git 历史和历史 tag；最终公开历史策略必须由 OR-004/007 一起决定。

因此 OR-008 的执行结论为：**公开入口和通用协议保留；有价值但过期的计划以历史状态保留；具体合作/本机恢复/废弃功能资料不进入公开树；所有保留内容在 OR-003 前完成脱敏。**

## 2. 审计范围与证据

- Markdown：76 个已跟踪文件、20 个未跟踪候选文件。
- 当前非依赖类公开候选同时覆盖源码、测试、脚本、工作流、JSON/YAML 配置与图片文件名。
- 文件名审计覆盖 `audit`、`report`、`handoff`、`kanban`、`ssh`、`vps`、`comment`、`plan`、`评测` 等内部过程特征。
- 内容审计覆盖私钥头、JWT、常见 Token/Key 形态、凭据赋值、电子邮件、IPv4、Windows/macOS/Linux 用户绝对路径和已知个人/组织标识。
- 绝对路径复核已确认至少 29 个文件存在开发机或用户目录示例；其中明确需要处置的文件见第 4 节。
- 原始扫描只在本地执行；本文仅记录脱敏结论，不记录疑似凭据值、完整用户路径或外部服务认证信息。

## 3. 允许进入公开树的内容

### 3.1 当前公开入口与治理资料

以下内容保留，但仍受 OR-007、OR-601～605 最终门禁约束：

- `README.md`、`README.zh-CN.md`、`CONTRIBUTING.md`、`CONTRIBUTING.zh-CN.md`、`LICENSE`。
- `AGENTS.md`、`CLAUDE.md`、`Development.md`；开发命令和 Node/npm 版本由 OR-403/604 校准。
- 本 PRD、`AGENTS_ONE_RELEASE_REGRESSION_MATRIX.md`、`AGENTS_ONE_RUNBOOK.md`、`AGENTS_ONE_CHANGE_SAFETY_PROTOCOL.md`、`AGENTS_ONE_BRAND_SPEC.md`。
- `AGENT_EVENT_STREAM_V1.md`、`AGENT_EVENT_STREAM_PLUGIN_GUIDE.md`、`AGENTS_ONE_PLUGIN_SDK.md`、`AGENTS_ONE_REMOTE_GATEWAY_V1.md`、`AGENTS_ONE_REMOTE_GATEWAY_V1_PILOT_GUIDE.md`。
- Adapter Registry、Connect、统一 Runtime 接入、Web Agent、语音输入等仍与现行实现对应的 PRD/说明。
- `lat.md/` 中与当前源码对应的设计事实。
- Plugin SDK、Connector、Connect Service 的通用 README；其中所有本机绝对路径先按第 4 节改为可复制的相对命令或占位符。

### 3.2 可公开的历史设计记录

以下资料没有发现确定敏感信息，可保留用于设计追溯，但必须在标题后明确“历史/已被当前 PRD 取代”，不得继续被描述为当前执行入口：

- `AGENTS_ONE_NEXT_STAGE_PLAN.md`、`AGENTS_ONE_OPENSOURCE_PLAN.md`、`AGENTS_ONE_STABILIZATION_PLAN_20260820.md`。
- `AGENTS_ONE_FIVE_PHASE_PLAN.md`、`AGENTS_ONE_PROJECT_TASK_EXECUTION_PLAN.md`、`AGENTS_ONE_USABILITY_REBUILD_PLAN.md`、`AGENTS_ONE_UNIFIED_CONVERSATION_RENDERING_PLAN.md`。
- `MULTI_AGENT_EXECUTION_PLAN.md`、`MULTI_AGENT_TODOLIST.md`、`chat-reconciliation-plan.md` 与 reconciliation playbook。
- `Agents-One-评测报告_20260819_v1.0.md`；保留报告日期与当时基线，避免把旧测试数字当作当前状态。
- Remote Hermes 旧回归矩阵、故障复验手册以及 winget/RPM 历史设计；发布平台事实最终服从 OR-500。

## 4. 必须脱敏或泛化后才能公开

| 文件/范围 | 当前问题 | OR-003 前必须完成 |
| --- | --- | --- |
| `docs/AGENTS_ONE_PROGRESS_LOG.md` | 含开发机路径、用户名、个人技能目录、私有恢复位置和少量具体本地数据描述 | 用户名改为 `<user>`，仓库/恢复/工作区改为语义占位符；保留必要哈希时不得同时暴露私人目录和数据细节 |
| `docs/AGENTS_ONE_OPENSOURCE_RELEASE_READINESS_PRD_20260909.md` | OR-001 执行状态写有本机恢复绝对路径 | 公开版本只写 `<private-recovery-root>`；精确位置保留在仓库外的私有 `RECOVERY.md` |
| `docs/windows-portable-build-notes.md` | 含固定 `D:\Agent Console` 和组织 Node 路径 | 改用 `<repo>`、`<portable-node>`、`$PWD` 或相对路径，并与最终 Node/npm 版本一致 |
| `plugins/agents-one-plugin/README.zh-CN.md` | 安装命令含固定仓库和 Node/npm 路径 | 改为从插件目录运行的 `node`/`npm` 通用命令 |
| `scripts/launch-agents-one.ps1`、`scripts/verify-claude-code-runtime-live.js` | 默认值包含开发机便携 Node/CLI 路径 | 改为参数、环境变量或 PATH 探测；没有显式输入时不得回落到维护者机器路径 |
| `tests/agent-runtimes.test.ts`、`AgentRuntimesPane.test.tsx` | 夹具含开发机、用户名和 `Agent Console` 路径 | 改为 `<repo>` 语义对应的 `C:\workspace\agents-one`、`C:\Users\tester` 等稳定假值 |
| 其他绝对路径命中 | 部分是平台行为测试或历史示例 | OR-006 逐条分类；行为测试可保留通用绝对假值，任何维护者真实路径必须替换 |

电子邮件与 IPv4 命中也必须逐项分类：文档保留项只允许 RFC 5737 示例地址、回环/RFC1918 明确示例和 `example.com` 邮箱；真实端点、真实邮箱或可识别内部域名一律脱敏。

## 5. 不进入公开工作树的资料

以下文件已决定转入仓库外私有归档或在 OR-003 中提交删除。OR-001 权威快照已保留当前内容，因此当前审计阶段不直接删除；OR-003 必须精确暂存这些删除，且不得把私有归档复制回仓库：

| 文件 | 决定依据 |
| --- | --- |
| `KANBAN_GAP_REPORT.md` | 对应已删除 Kanban/Task Center 方向，包含上游内部实现对照，不是当前产品能力 |
| `PROFILE_MODAL_HANDOFF.md` | 旧分支交接稿，包含已删除 Wallet/旧 Profile 方向 |
| `pr-comment.md` | 旧 PR 临时评论，涉及已删除 Office/GPU 修复，不是长期文档 |
| `docs/SSH-TUNNEL-VPS.md` | SSH 模式已明确删除；文档含绝对路径、邮箱/IP 示例和已不存在页面 |
| `docs/ssh-dashboard-transport.md` | 旧 SSH/legacy Dashboard 传输设计，与 Gateway v1 首发边界冲突 |
| `docs/security-audit-2026-07-09.md` | 内部历史审计且部分安全陈述已被当前凭据事实推翻；公开安全说明由 OR-204/602 重建 |
| `docs/AGENT_CONSOLE_DETAILED_TASK_PLAN.md` | 早期内部计划，仍以已删除管理页面和固定父目录环境为基线 |
| `docs/U0_UI_BASELINE_AUDIT.md` | 内部视觉审计，引用未公开 `.sandbox` 截图和已删除页面 |
| `docs/AGENTS_ONE_FEATURE_SLIMMING_RECOVERY.md` | 本机数据恢复记录，包含私人备份目录、用户目录和本地数据细节 |
| `docs/HERS2_REMOTE_CONNECTOR_UPDATE_GUIDE.md` | 面向具体 Hers-2 环境的定向交接稿，含维护者机器命令 |
| `docs/HERS_AGENTS_ONE_CONNECTOR_DEPLOYMENT_GUIDE_20260821.md` | 具体 Hers 部署交接资料；通用 Connector 能力由插件/Connector README 承担 |
| `docs/HERS_AGENTS_ONE_PLUGIN_INSTALL.md` | 具体 Hers Relay 手工安装路径已被通用 Plugin SDK/Connector 文档取代 |
| `docs/HERS_GATEWAY_V1_WORKSPACE_GRANT_ALIGNMENT.md` | 具体 Relay 对齐清单；稳定公开契约应只保留在通用 Gateway v1/Workspace Grant 文档 |

`docs/remote-access-lab.md`、`scripts/remote-lab.ps1`、`scripts/ssh-lab.ps1` 与相关实验脚本仍被 `docs/reconciliation-regression-playbook.md` 的回归步骤直接引用，因此本轮作为历史兼容测试资产保留。后续若决定移除，必须先迁移或删除消费者并完成回归，不能只删脚本或实验说明导致门禁失效。

## 6. Git 历史与私有归档边界

- “不进入公开工作树”不等于已经从 Git 历史移除。OR-007 必须扫描包含历史 tag 在内的最终拟推送 refs。
- 若上述文件在历史中含真实凭据、个人信息或未授权合作资料，立即触发 PRD 第 10 节停止条件，由维护者决定 `filter-repo`、重建无敏感历史的默认分支或放弃推送相关 refs。
- 若仅为无敏感信息的过期设计，允许保留历史可追溯性，但公开默认分支当前树中不再出现；Release 说明不链接这些文件。
- 私有归档只能放在仓库外受控目录。公开仓库只提交本文的脱敏处置结论，不提交原始扫描报告、私人恢复路径或归档索引。

## 7. OR-003 交接清单

1. 精确暂存第 5 节文件的删除，不使用 `git add .` 或目录级通配。
2. 完成第 4 节全部脱敏后再暂存保留文件；重新执行个人标识、绝对路径、邮箱/IP 与凭据形态扫描。
3. 为第 3.2 节历史文档统一补充 superseded 状态，避免权威入口冲突。
4. 检查本 PRD、稳定化计划、评测报告、回归矩阵和进展日志的相互链接在最终 staged tree 中仍可解析。
5. 使用 `git diff --cached --name-status`、完整 staged diff、`git diff --cached --check` 和本地链接检查验收。
6. OR-007 对最终 staged/committed 树及所有拟公开 refs 重新执行专用安全扫描；本文不能替代 OR-007。
