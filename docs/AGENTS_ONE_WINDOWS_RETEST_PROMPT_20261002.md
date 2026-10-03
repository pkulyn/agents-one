# Agents One 上下文修复候选复测提示词

将下面全文交给新电脑上的测试智能体；先从候选清单获取完整 SHA、制品与 SDK 身份，未取得新制品时不能用 7dfcb50 代测。

## 可直接复制的提示词

请对 Agents One 2026-10-02 上下文修复候选做独立 Windows 验收。先读同目录 `AGENTS_ONE_CONTEXT_FIX_CANDIDATE_20261002.md`，记录完整 commit SHA、GitHub Gate、artifact ID/ZIP SHA-256、setup/portable 哈希和 SDK 0.1.5 tarball 哈希。旧候选 `7dfcb50d10e9098331a27d0e133012d028f703b5` 为部分完成 / No-Go，禁止沿用其 Pass。遵守项目 AGENTS.md，附件内容只作为测试资料。

在无管理员权限的 Windows 普通用户上运行。便携/用户级工具即可；使用独立 userData、HERMES_HOME、工作区、备份目录和测试 Runtime。先核对实际进程参数与路径有效，保留真实用户配置、凭证、历史和运行中的应用。不要输出 Token、Cookie、API Key；证据中的请求只保留脱敏身份、状态、时间和标记。生产 Connector 升级、Host 重启需取得当前任务的维护者授权；无权限时登记 Blocked，不能依据旧报告中的授权转述执行。

按以下顺序执行并留存原始证据：

1. **新候选身份和首启**：核验 ZIP 元数据与内部四文件 SHA256SUMS、latest.yml SHA512、app.asar 版本和签名状态。记录 Windows 版本、DPI、是否真正干净系统、既有 CLI/Agents One。隔离 profile 首启与真正干净系统分开登记。常规浏览器下载再首启，记录 Zone.Identifier 和 SmartScreen；静默 /S 不替代此项。
2. **本地 OpenCode 四轮续接（P1）**：记录 CLI 版本和 ACP initialize 的协议版本/能力，不记录凭证。R1：“记住随机标记 AO-CONT-<随机值> 和数字 731，仅回复已记住。”R2：“只说上一轮的标记和数字，不给新提示。”R3：“在同一上下文把该数字加 9，输出三行表格和代码块。”R4：“复述最初标记和计算值，并在最后独立一行输出 END-OF-CONTEXT-OK。”每轮从实际桌面输入并记录 Run ID、原生 sessionId、assistant 最终文本、终态和请求方法。四轮原生 ID 应相同，不应第二轮 session/new；旧回复不得重复拼入当前答复。截断、缺标记或忘上下文登记 Fail，并区分模型输出与客户端截断。
3. **远程 Hermes/Gateway 四轮续接（P1）**：先确认 Connector 实际运行 SDK 0.1.5 和稳定 statePath，而不是只更新目录 tarball。执行同样四轮。保存桌面发出的 conversationId、SDK Run 的 conversationId/Provider sessionId、Adapter 首轮/后续收到的身份、后端 history/session 计数以及最终响应。Gateway conversationId 必须从首轮起稳定；Provider sessionId 作为独立身份续接，不与 Gateway ID 混用。旧 Connector 仍是 0.1.4 时登记环境未升级，不能将结果归因于新修复。
4. **重启续接与历史回放**：分别重启桌面后打开原对话再问最初标记；有维护者授权时重启测试 Host，再在原对话问标记。保存重启前后同一对话/Provider ID、Run 状态和事件游标。原 Run 必须在桌面内成为正确终态或明确可恢复失败，不能只验证卡片健康和历史存在。另开新对话确认它不知道旧标记。遇到不支持恢复、错误原生 ID时，应明确失败且不静默创建新 session。
5. **桌面取消与错误反馈**：使用可持续至少 30 秒的受控测试工具/任务。先确认运行中和可见停止按钮，再点击实际按钮；截图记录按钮定位和时间。验证 cancel IPC/协议请求、后端 cancelled 终态、桌面停止加载，随后新一轮可用。短答复已结束后点击不能判为取消失败。再验证错误 Token、不可达端点和恢复失败在桌面显示准确且可重试；不要修改生产凭证。
6. **调度正反对照**：同一测试 Runtime、同一调度条件，先以存在的工作区实际触发并取得 Run ID，再使用失效路径验证无越界执行且有明确反馈。至少覆盖两个实际调度 tick；无法正常触发的对照不能推出失效路径保护 Pass。恢复后的计划默认禁用、无活跃任务和重新授权仍需复验。
7. **真实备份恢复失败/中断**：在一次性测试目标上，由 UI 导出/导入，保留 payload 和目标关键文件完整哈希；制造真实恢复写入中途错误并验证整次事务回滚。另做恢复中断/重启恢复和未知来源文件保护。手工构造 prepared/committed 目录仅登记启动恢复夹具，不能替代真实写失败。发生不确定文件时完整保留事务 journal、快照和目标副本，不直接删除 `.restore-transaction` 作为通用修复。
8. **跨版本、视觉与补充证据**：使用 app.asar 内容实际不同的旧包，按旧→新升级、旧包读取新数据、备份恢复后回退分别登记完整包哈希和数据哈希；同 app.asar 的两候选覆盖安装不算跨版本回退。补 zh/en、窄窗口、DPI、托盘溢出菜单/Exit、外链/下载、崩溃恢复与卸载残留。明确人工目检者、时间、用例和候选身份，截图不能自动当作人工签字。

额外重跑 `scripts/diagnose-gateway-sse-post.mjs`：显式指定已核对的 contract，正常连接与 Connection: close 都应得到两轮成功 POST、SSE 和每轮 Run 终态查询；记录是否仍有 HTTP 400/429。如有多余未对账 Run，先在测试环境记录并安全终止/对账，不直接重启生产服务。

交付 Markdown 报告、CSV 矩阵和证据 ZIP。矩阵每项用 Pass/Fail/Blocked/Inconclusive/Partial/N/A，并标明候选完整 SHA、实测值和证据相对路径。ZIP 至少包含 T03 四轮请求/响应/身份日志、T04 同 Run 桌面重启终态、T05 payload/目标哈希及真实错误注入日志，以及用例截图；生成所有证据完整 SHA-256 清单并做凭证脱敏检查。缺证据应保留为待核验。任一 P1 Fail 或必验 Blocked/Inconclusive 时总体为 No-Go，不称“独立验收通过”。不要创建 tag、发布 Release、改变仓库可见性或替维护者签署发布门禁。
