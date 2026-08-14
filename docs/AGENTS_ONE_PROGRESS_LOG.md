# Agents One 项目进展日志

## 2026-08-13：Agents One 可迁移备份与恢复

- 产品边界：设置页“数据”已从 Hermes CLI 的导入导出切换为 Agents One 自有 `*.agents-one-backup`。备份覆盖配置档案、项目登记、任务/定时任务、Runtime/Quick Chat/原生会话、协作记录、SQLite 状态、记忆、技能、附件和 Runtime 输入证据；项目实际文件、worktree、日志、缓存与安装引擎不进入归档。
- 凭据边界：`.env`、账户/认证/钱包文件、Token、API Key、SSH keyPath、代理和原始 `config.yaml` 不导出。安全配置采用白名单迁移并合并进目标配置，保留目标机凭据与未知键；新的或变化的远程端点默认停用并要求重新授权，本机可执行路径/工作目录变化时清空并停用。
- 数据完整性：归档使用版本化 manifest、逐文件大小与 SHA-256；SQLite 通过 `VACUUM INTO` 生成含已提交 WAL 的单文件快照。导出先在目标旁生成临时归档并走完整导入校验，成功后才原子替换旧备份。
- 恢复安全：导入先拒绝路径穿越、链接/特殊文件、Windows 设备名与 ADS、超限归档、清单外文件、哈希错误、畸形核心 JSON、不安全配置和损坏 SQLite。恢复按“备份内托管数据快照”清理目标残留，同时保留目标独有凭据、未知文件及备份外配置档案；写前建立持久 `.restore-transaction` 日志和回滚快照，进程内失败立即恢复，断电/崩溃后会在打开窗口或写连接前自动回放，回滚失败保留救援目录。
- 运行一致性：应用取得 Electron 单实例锁，导出等待计划调度写入结束且拒绝活动聊天/Runtime；恢复先销毁旧 Renderer 形成全局写入闸门，再停止计划、活动运行、Dashboard、SSH 隧道、所有 Profile Gateway 和数据库连接，核心文件写入也统一受进程内闸门保护。迁移后的计划任务统一停用并清空 pending/active run，聊天不保留旧进程 run id；`desktop-staging` 只重绑定明确的附件 path，聊天正文保持原样；完成或中途失败后自动重启，避免其他实例、异步尾写或旧内存状态覆盖新快照。
- 兼容补齐：Quick Chat 从仅 localStorage 升级为按 Profile 的主进程持久化，并一次性迁移旧本地数据，确保快速聊天也能进入备份。Renderer、Preload、IPC 和中英文文案均改用结构化预检/确认/结果契约，不再声称备份 Hermes。
- 项目记忆：PowerMem 健康检查与长期事实写入成功，新记忆 ID 为 `743037391287091200`；即时语义复核仍优先召回既有备份/恢复事实，符合 `infer` 后台索引尚未完成的表现，本地进展日志与设计文档继续作为当前权威记录。
- 自动验证：备份专项 18/18 通过，覆盖真实 SQLite/WAL、凭据金丝雀、路径与归档攻击、哈希/JSON/SQLite 损坏、配置合并、远程重新授权、计划停用、托管快照删除、跨机附件重绑定、prepared/committed 崩溃日志恢复和完整往返；全量 Vitest 203 个文件、2006 项通过、13 项跳过，Node/Web TypeScript、Electron Vite 生产构建、`lat check` 与 `git diff --check` 全部通过。独立安全复核确认无遗留 P0/P1。完整设计和安全边界见 [Agents One 备份恢复设计](../lat.md/backup-recovery.md)。

## 2026-08-13：Task Center 执行器完整退役

- 全量可达性审计确认 Task Center 已无 Layout、IPC、Preload 或现役业务消费者；新建任务、项目任务和定时任务都直接进入普通 Runtime 对话。生产代码唯一残留是旧计划的读取、取消和结果回填分支，继续保留会形成双状态机与 5 秒轮询大文件的回归风险，因此 Task Center 已可判定为冗余执行层。
- 删除 `src/main/task-center.ts`、共享 Task Center 类型、专用单元测试和约 700 行孤儿样式，同时删除只验证旧 Project/Task Center 导航的 U1 历史脚本。定时任务只调用 `start/get/cancelAgentRuntimeTask`；设置页也移除了“任务中心选择实现”的过期 Pi 权限说明。
- 计划存储升级为 v5。旧 `activeTaskCenterTaskId` 不再是活动信号，也不会阻塞编辑、删除或重新触发；旧 `queued/running` 计划运行被幂等收口为明确失败并提示重新触发。已经完成的旧运行继续保留原状态、摘要、对话链接和历史指针，但程序不再打开 Task Center 数据库。
- 数据保护审计覆盖当前默认 Profile：`task-schedules.json` 为空且没有旧引用；`task-center.json` 有 19 条历史记录、0 条 `queued/running`，其中 10 条 `review_required`，3 个历史 worktree 仍被引用。当前文件及 worktree 均未删除或重写；最新 6,662,348 字节历史库已复制到 `D:\Agent Console\artifacts\agents-one-pre-task-center-retirement-20260813`，源文件和快照 SHA-256 均为 `0865F1CC909D4408B123A92EEE8649F9F5474E3E82E792DBF9A7B9653C658AA4`。
- 性能结论保持克制：当前无旧引用时正常调度本来就不会读取历史库，所以即时提速有限；核心收益是消除约 1,500 行死代码/测试/样式、双持久化和潜在的主线程大文件解析卡顿。任务对话内多智能体协作属于现役能力，与 Task Center 无关，完整保留。
- 项目记忆已同步更新 `lat.md/main-process.md`；PowerMem 健康检查和写入成功，新长期记忆 ID 为 `742997757165305856`。两次即时语义复核仍优先召回 8 月 6 日/12 日旧阶段事实，属于 `infer` 后台索引尚未完成，本地日志和恢复记录继续作为当前权威事实源。
- 自动验证：Task Center 退役边界、计划主进程和管理页首轮定向回归 3 个文件 20/20 通过，扩展调度/会话回归 26/26 通过；全量 Vitest 201 个文件、1973 项通过、13 项跳过。Node/Web TypeScript、Electron Vite 生产构建、`lat check` 和 `git diff --check` 全部通过。一次 99 项并行回归中的既有 RuntimeChat 时序用例偶发超时，单项复跑通过，随后全量回归也通过。

## 2026-08-12：定时任务收敛为普通 Runtime 任务对话

- 体验根因：旧调度会先保存一条只有用户提示词的 Runtime 对话，再把真正执行交给内部 Task Center；打开对话后没有可追踪的 Runtime run，只有等 30 秒调度轮询发现终态才一次性追加结果，因此思考、工具与进度长期空白，并存在两套任务状态和频繁全量对账开销。
- 执行模型：新调度直接调用与新建任务相同的 `startAgentRuntimeTask(..., conversation=true)`，继续使用用户配置的 Pi/Claude Code/Codex 原生技能、MCP、插件、Hooks、Shell、工作目录与文件权限；`runtimeRunId` 同时写入计划执行和持久 Runtime 对话，不再为新执行创建 Task Center 任务。
- 实时对话：Runtime 对话新增 `activeRuntimeRunId`。打开已触发的计划对话时，RuntimeChat 立即进入 loading 状态并恢复同一运行的轮询，沿用普通任务的思考、工具、进度、取消、最终回复和 session 持久化；终态清除活动运行字段。后台对账仍作为无人打开对话时的幂等结果投递兜底，避免重复回复。
- 通知与性能：Windows 系统通知由“执行完成后”前移到触发瞬间，正文为“XXX定时任务已触发，智能体已开始接手并推进任务”；完成事件只刷新页面。调度对账从 30 秒缩短到 5 秒，但新任务不再每轮读取 Task Center 全表，仅存在旧记录需要恢复时才加载，减少运行中卡顿来源。
- 兼容与恢复：旧 `activeTaskCenterTaskId/taskCenterTaskId` 继续只读兼容和一次性结果回填，不迁移、不删除历史；应用中途重启导致进程内 Runtime run 丢失时，计划和对话明确记录失败并允许用户在同一对话重发，不再永久停留“执行中”。数据变更仅新增可选字段，旧文件可直接读取，回退代码会忽略未知字段。
- 安全评估：未修改 Runtime id、智能体配置、凭据、头像名称、项目归属或既有消息；消费者仅限计划存储、Runtime 对话存储、Layout 恢复、RuntimeChat 与调度通知。主要风险为重复终态投递、活动状态不清除和旧记录失联，已通过 run-id 幂等、终态清除及遗留回填路径约束。
- 项目记忆：长期方案已明确“普通任务、项目任务和本地定时任务共享终端原生能力契约”；PowerMem 健康检查、写入与语义检索均成功，新记忆 ID 为 `742678542881390592`。
- 自动验证：调度、会话存储、RuntimeChat 与管理页定向回归 4 个文件 63/63 通过，覆盖启动事件、直接 Runtime 并发、实时恢复、后台/前台终态竞争幂等和重启失联；Node/Web TypeScript 检查、生产构建与 `lat check` 通过。变更文件 ESLint 为 0 error，仅保留代码库既有的 RuntimeChat `send` 与 Schedules 弹窗 Hook warning。

## 2026-08-12：定时任务结果投递到可见对话

- 现场证据确认“定时任务测试”并非未触发：计划时间为 11:20，调度器在 11:20:18 创建 Pi 运行，Pi 在 11:22 前生成完整问候和自我介绍，11:22:48 被对账为成功；但 `runtime-conversations.json` 未更新，因此用户侧没有任何可见回复。
- 每轮计划执行现在在派发前创建独立 Runtime 对话，并将 `conversationId` 写入该轮 `TaskScheduleRun`；终态对账把经过共享结构化输出解析器提取的最终回复（或明确失败信息）、执行事件和产物追加到同一对话，不再把 JSONL 前 500 字误当结果。
- 主进程完成事件通过受控 Preload 通道通知 Renderer；当前窗口显示完成/失败提示，窗口未聚焦时显示系统通知。定时任务页每 10 秒自动刷新并在完成事件到达时立即刷新，任务卡展示两行结果摘要和“打开最近执行对话”入口。
- 兼容旧数据：每条本地计划只回填最近一次已完成但没有 `conversationId` 的执行，恢复用户这次测试结果；回填不发送过期通知，重复对账不重复追加消息。远程旧记录仍不派发、不迁移。
- 自动验证：计划调度、会话持久化、结果解析和管理页 4 个测试文件共 17/17 通过，覆盖新执行投递、完成事件、管理页打开对话、旧执行一次性恢复及幂等性；Node/Web 类型检查通过。

## 2026-08-12：新建任务只打开默认智能体

- 根因：Shell 在 Runtime 目录异步加载前先创建一个空 Hermes 占位；默认智能体解析为 Pi/Codex/Claude 等 Runtime 后，“新建任务”旧逻辑继续追加新 Runtime 会话，没有替换未使用的 Hermes 占位，因此顶部同时出现两个“新对话”。
- 修复：新增统一的新任务状态转换，空且未运行的当前占位由默认智能体原位接管；已有会话、历史内容和运行中任务一律保留并正常新增标签。默认 Runtime 解析完成后会主动接管初始占位，侧栏“新建任务”、标题栏“+”和项目任务入口复用同一规则。
- 同源边界：只有内置 Hermes 使用旧 Profile 对话；用户自定义 Hermes Runtime 若被设为默认，继续保留自己的 Runtime id、连接和持久化通道。
- 改动限于 Renderer 会话状态转换和测试，未修改默认智能体的 localStorage 键、Runtime 注册、配置文件、历史记录或主进程传输。
- 验证：Layout 会话状态、标签栏和默认智能体选择 3 个测试文件共 25/25 通过，Web 类型检查、生产构建、目标文件 ESLint、Prettier、`lat.md check` 与 `git diff --check` 均通过；在真实开发界面以已配置默认 `pi` 复核，页面加载后及连续点击“新建任务”后均保持 1 个 Runtime 对话、0 个额外标签、无 Hermes 会话残留。

## 2026-08-12：定时任务收敛为本地 CLI 能力

- 功能边界调整：桌面定时任务只允许已启用且 `location=local`、`transport=cli` 的 Runtime。主进程在新建、重新启用、手动触发和后台轮询四处执行同一校验，非本地 CLI 任务不会被派发。
- 远程能力退役：定时任务页不再读取、创建或管理 Hermes 服务端 Cron，也不再展示“执行位置”；远程智能体如需服务端计划任务，由用户在对话中让智能体自行建立。
- 创建表单移除“执行方式”，默认沿用安全的分析任务契约；智能体下拉仅列出本地 CLI Runtime，并明确提示桌面应用需保持运行。旧的远程关联记录不删除、不迁移，仍保留在原数据文件中，但不会继续执行。
- 管理页改为单一“本地 CLI 任务”面板，统一标题、分区、卡片、状态与空状态字号，增加安全删除确认和 720px 以下响应式收敛。
- 自动验证：定时任务 Renderer/主进程 6/6 用例通过，Node/Web 类型检查和 `git diff --check` 通过；1024×768 的管理页与创建弹窗 U5 步骤通过并完成截图。完整 U5 在后续 768 宽聊天检查遇到既有的双 `.chat-input-area` 严格定位冲突，与本次定时任务变更无关。
- PowerMem 已写入本次能力边界事实（memory `742573171885998080`）；服务健康、写入成功。由于 `infer` 后台处理，紧接写入的两次语义检索尚未召回该条目，本地进展日志仍作为当前可审计事实来源。

## 2026-08-10：Claude 本地 CLI partial-stream 轨迹修复

- 复盘真实协作运行 `runtime-conv-9b498ccb-debc-427a-9b0d-df04ecbbdea4`：Claude 的持久会话包含多段 thinking，Agents One 也保存了 9 次工具调用及其 5 次成功、4 次失败结果，但旧输出过滤器丢弃 `--include-partial-messages` 产生的 `stream_event`，因此 thinking 只能依赖最终 assistant 帧，工具参数也无法在 partial 阶段重建。
- 解析修复：Claude 本地 Adapter 只放行 `thinking/tool_use` block 的 start/stop，以及 `thinking_delta/input_json_delta`；普通文本增量、签名和 SessionStart/system 噪声继续丢弃。Runtime 按 block index 累积思考和工具 JSON，按稳定 callId 更新既有工具调用，并把调用时工具名带到后续 tool_result，避免笼统显示“Claude Tool”。
- 兼容与边界：最终 `assistant.content[].thinking/tool_use` 和 `user.tool_result` 仍是权威兜底；partial 与最终帧按 callId/内容快照去重。新增状态只存在于单次 Runtime 的内存中，不改变 CLI 参数、Runtime 配置、用户凭据、Gateway、会话格式或既有历史。
- 真实只读冒烟：Claude Code 2.1.224 在 `plan` 模式读取项目 `package.json`，退出码 0；捕获 526 个 `thinking_delta`、20 个 `input_json_delta`、2 个 thinking block 和 1 个 tool block，验证新适配覆盖当前真实输出结构，冒烟未修改工作区文件。
- 自动验证：Claude Runtime、RuntimeChat、消息适配和 MessageList 5 个相关测试文件 85/85 通过；Node/Web TypeScript 检查、变更文件 ESLint、生产构建、`lat check` 与 `git diff --check` 均通过。

## 2026-08-10：单智能体授权、远程环境边界与运行状态显示修复

- 现场复盘任务 `runtime-conv-c388a8af-1be5-4abb-ad33-7d7dd131ea14`：用户只要求 Hers 执行 PowerMem 备份方案，Hers 却自行输出协作提案；客户端仅校验提案 JSON 和 runtimeId，未再次核验当前用户请求是否明确授权协作，因此自动创建了协作记录。
- 协作现在以当前用户请求的明确意图为硬边界：普通任务、“开始执行”、任务复杂度或模型自认为适合分工都不构成授权；这类运行不再收到协作控制协议，即使模型自行输出合法提案标签，客户端也会剥离控制块且不自动启动。明确要求多智能体、协作或角色分工的请求仍保留自动编排。
- 远程 Runtime 的原生工具/路径与 Agents One 桌面本地项目正式区分：未关联项目的远程角色默认在“智能体所在设备”执行，不再自动套用“只读证据包”并要求选择本地文件夹；只有明确选择 Workspace Grant、远程映射或证据包时才进入相应预检。
- 等待回复的三点气泡移除了无实际信息的旋转彩虹 Agents One 标识；输入栏模型标签在新 run 尚未上报 metadata 时沿用该对话最近一次真实 provider/model，收到新模型后再更新，不再短暂清空为“未提供模型”。
- 改动边界仅限共享协作意图解析与 Renderer 派发/展示；未修改 Runtime 注册、身份外观、Gateway 协议、凭据、历史记录或持久化格式。定向回归 54/54、Node/Web 类型检查、生产构建、`lat check` 与 `git diff --check` 均通过。默认并发全量测试仅有 2 个既有 Gateway 重启 50ms 定时用例偶发失败；对应测试文件立即独立复跑 17/17 通过，判定为并发时序抖动，与本次改动无关。

## 2026-08-06：旧管理功能瘦身完成

- 已在分支 `agents-one-slim-task-dialog` 完成两步可回退删除：`2a69749` 退役独立 Task Center、Project Center、旧对话任务侧栏和控制面 IPC；`200686b` 退役 Hermes Kanban 页面、命令、IPC、本地/SSH 桥接、样式与翻译。
- 任务对话内多智能体协作完整保留，包括协作建议、角色配置、顺序编排、工作区访问、人工介入、产物和历史恢复；项目文件夹分组、Runtime、Gateway v1、Workspace Grant、媒体产物和定时任务均保留。
- 定时任务继续复用 `src/main/task-center.ts` 作为内部执行/恢复引擎，但 Renderer 和 Preload 不再暴露旧任务中心；旧 `project-control.json`、`task-center.json` 和 `task-collaborations.json` 未删除、未迁移。
- 自动验证：生产构建通过；全量 Vitest 189 个文件、1885 项通过、13 项跳过；核心边界定向回归 67 项通过、4 项跳过；`lat check` 通过。全量测试完成汇总后仅外层进程退出超时，无失败用例。
- 删除后用户数据复核：六个文件 SHA-256 与备份一致；`remote-session-cache.json` 仅顶层 `updatedAt` 因运行中应用刷新而变化，histories 和 38 条 sessions 内容一致。恢复提交、标签、哈希与命令见 [功能瘦身备份与恢复记录](./AGENTS_ONE_FEATURE_SLIMMING_RECOVERY.md)。
- 已将“退役旧管理面、保留任务对话协作、基线标签与拆分提交”同步写入 PowerMem；当前会话未加载 MCP 注册，按项目兜底规范通过本地 stdio server 完成，未输出或持久化 API Key。

## 2026-08-06：旧管理功能瘦身前恢复基线

- 产品边界确认：保留项目文件夹分组、任务对话和任务对话内多智能体协作；计划退役独立 Task Center、Project Center 项目/协作管理控制面与 Hermes 原生 Kanban。
- 代码恢复点预留为标签 `agents-one-pre-slim-20260806`；瘦身将拆成独立提交，发生核心回归时优先逐提交 revert，也可从标签建立恢复分支。
- 已将当前桌面数据逐文件复制到 `D:\Agent Console\artifacts\agents-one-pre-slim-20260806-1120\desktop-data` 并记录 SHA-256。备份覆盖项目控制、项目文件夹、远程会话缓存、Runtime 对话、会话覆盖层、Task Center 和任务协作数据；原文件未移动、未修改、未删除。
- 当前真实数据包括 8 个旧控制面项目、12 个项目任务、104 条事件、10 个产物引用、16 条 Task Center 记录和 7 条任务对话协作记录。瘦身只停止旧控制面入口和写入，不自动删除历史数据。
- 完整恢复命令、数据哈希、保留边界和停止门槛见 [功能瘦身备份与恢复记录](./AGENTS_ONE_FEATURE_SLIMMING_RECOVERY.md)。

## 2026-08-06：Hers-2 输出图片发布契约与运行指示位置修复

- 现场确认图片失败不是 PNG 格式问题，而是远端智能体只在最终答复中打印了 `artifact.created` 元数据和 `MEDIA:` 文件名，没有把真实字节上传到 Connector Artifact 存储；桌面端无法从文件名或远端路径还原图片。
- Plugin SDK 升级到 v0.1.1：运行上下文新增 `publishArtifact({ name, mime, bytes/contentBase64 })`，统一完成大小与 SHA-256 校验、Run 产物登记、`artifact.created` 事件和 `GET /artifacts/{id}` 下载；已生成 `plugins/agents-one-plugin/agents-one-plugin-sdk-0.1.1.tgz`。Hers-2 Connector 必须把该回调注册为智能体可调用的真实工具，打印 JSON 不算上传。
- RuntimeChat 改为优先读取最新 Runtime Catalog 中的头像、名称和颜色，已打开的对话在保存显示信息后也能刷新；工具调用历史前不再放 Agents One 标志，彩虹动态圆环只保留在下方实时运行指示位。
- 自动验证：Plugin SDK 8/8、桌面端定向回归 64/64、Node/Web 类型检查和生产构建全部通过。现场复测前需升级并重启 Hers-2 Connector，同时确认 `hermes-home2` 的头像已单独保存。

## 2026-08-04：统一复用成熟对话界面开发方案形成

- 已完成内置 Hermes 与 RuntimeChat 两套消息渲染链路的现状审查，确认后续由各 Runtime 适配统一事件，前端复用现有 `MessageList`、`MessageRow`、`AgentMarkdown` 和媒体组件。
- 明确 Hers-2 本次图表测试返回的是办公电脑本机路径，第一阶段优先打通 `MEDIA:C:\...` 在 RuntimeChat 中的原生呈现；跨机器 artifact 下载作为后续阶段。
- 详细方案、TODO、验收矩阵和停止门槛见 [统一对话渲染与成熟界面复用开发方案](./AGENTS_ONE_UNIFIED_CONVERSATION_RENDERING_PLAN.md)。

## 2026-08-04：Phase 1 RuntimeChat 接入原生对话渲染器

- RuntimeChat 已切换到现有 `MessageList`，统一复用原生的思考、工具、错误、Markdown、媒体和附件呈现；Runtime 专属控制面板继续保留。
- 新增纯适配器 `runtimeChatMessageAdapter.ts`，兼容当前只有 summary 的 Runtime 事件，并为工具调用/结果建立稳定的本轮 callId 配对。
- Hers-2 返回的本机 `MEDIA:C:\...` 路径会继续交给 `MessageRow` 媒体解析链路，不再由 RuntimeChat 自己渲染 Markdown。
- 验证：RuntimeChat 与适配器定向测试 24/24；Web 类型检查通过；受影响文件 lint 0 errors。全量测试超过 120 秒未完成。

## 2026-08-04：Phase 2 细化 Runtime 事件与本机媒体路径

- 去除 RuntimeChat 传入原生 `MessageList` 的重复“正在处理”进度文案；保留原生思考/工具行作为唯一运行中反馈。
- Gateway 原始事件的工具类型、调用 ID、输入摘要、输出摘要、错误详情已进入统一时间线，工具/技能结果可在原生折叠行中展开查看具体内容。
- 主进程统一处理 `file:///`、引号和 JSON 双反斜杠 Windows 路径，补齐本机 `MEDIA:` 读取回归。
- 放宽远程任务终态判定：已交付 `MEDIA:`、`artifact.created` 或 Gateway 产物时，不再因没有 workspace audit 被误判失败；普通工作区修改仍保留审计门槛。
- 验证：Phase 2 定向测试 51/51、Node/Web 类型检查通过；lint 0 errors，仅保留 RuntimeChat 原有 Hook 依赖 warning。

## 2026-08-04：Phase 2 本地 CLI 结构化事件适配

- OpenClaw Gateway、Codex `item.started/item.completed`、Claude Code `tool_use/tool_result`、Pi `toolCall/toolResult` 现在统一写入工具名、kind、输入、输出和 callId；旧 summary 仍保留兼容展示。
- 新增四类 Runtime 结构化事件 fixture，确保原生工具折叠行能展开到具体调用参数和结果内容，并验证 OpenClaw 的模型/usage 元数据保留。
- 验证：Runtime 定向测试累计 54/54；Node 类型检查通过；R-05 事件 fixture 已完成。

## 2026-08-04：Phase 2 R-07/R-08 模型元数据与远程产物暂存

- 本地 Codex、Claude Code、Pi 的 model/usage 事件已在主进程统一归一化：支持 Codex `turn.completed`、Claude `result/modelUsage`、Pi assistant message，并保留 provider 回传的上下文窗口。
- 新增统一 Gateway `GET /artifacts/:id` 下载适配器：限制下载大小，校验 Base64、声明大小和 SHA-256；远程 artifact 在进入 `AgentRuntimeRun` 前由主进程暂存到短期媒体目录。
- 暂存后的产物复用现有本机媒体/产物路径，渲染器不持有 Gateway 凭据，也不直接访问远端文件系统。远程 artifact 在原生消息中的图片/文件组件绑定列入 R-09。
- 验证：R-07/R-08 定向测试 44/44；Node 类型检查通过。

## 2026-08-04：Phase 2 R-09 artifact 原生界面绑定启动

- Runtime 对话执行记录现在同时保留 events、artifacts、model、usage，历史重开时不会只剩最终文本。
- 图片 artifact 通过原生 `MEDIA:` 段进入既有 `MessageRow`/`MediaImage`；非图片 artifact 通过既有 `AttachmentChip` 的 `path-ref` 形式展示，未新增第二套 artifact 渲染器。
- 已补适配器回归；真实 Electron 窗口中的远程图片读取、文件芯片操作和历史重开仍是 R-09 的人工验收项。

## 2026-08-04：Phase 3/4/5 本机自动回归收口

- Phase 3：图片 artifact 统一转为原生 `MEDIA:`，普通文件转为原生 `path-ref` 附件芯片；远程 artifact 在主进程完成下载、大小/Base64/SHA-256 校验和短期暂存，Renderer 不接触远端凭据或绝对路径。
- Phase 4：模型名称只取真实 Runtime 元数据或本地配置；上下文占用只在真实 `contextUsedTokens + contextWindowTokens` 同时存在时显示；Runtime Markdown 链接复用共享 `web-preview:navigate` 事件和原生 Web Preview 面板。
- Phase 5：删除 RuntimeChat 已不再使用的旧进度、执行记录和任务面板 CSS，保留权限、工作区、协作、产物和人工介入控制。
- 自动验证：RuntimeChat/适配器/Gateway/媒体/主进程 hydration 定向测试 66/66；U5 真实 Electron 1024x768 与 768x800 双视口共 15 张截图通过，覆盖对话、项目、任务列表/看板、定时任务、智能体和设置页面。
- Hers-2 真实 Connector 现场 smoke test 已通过：`artifacts.upload/download=true`、`modelMetadata/usageMetadata=true`、`maxGrantSeconds=null`；`artifact.created` 与 `GET /artifacts/{id}` 的 mime、size、SHA-256 一致，HTTP 200，Base64 解码正确，7 个事件 sequence 单调递增。

## 2026-08-04：补齐 Plugin SDK 远端 artifact 下载路由

- 发现 Plugin SDK 原先只在 `/capabilities` 声明 `artifacts.download`，却未实现 `GET /artifacts/{artifactId}`，会导致真实远端图表下载稳定返回 404。
- 已补齐该路由：支持 `getArtifact(artifactId, context)` 返回 `contentBase64` 或 `bytes`，统一输出元数据与 `contentBase64`，并增加 SDK 回归测试。
- Plugin SDK 测试 6/6 通过，已重新生成干净包：`plugins/agents-one-plugin/agents-one-plugin-sdk-0.1.0.tgz`。Hers-2 现场 smoke test 前必须使用此包升级 Relay/Connector。

## 2026-08-04：工作区成功操作不再显示空泛 workspace_gateway 错误

- 针对 Connector 在同一轮已完成 list/read/write 后仍附带一个无错误详情的 `tool.failed`/`workspace.blocked` 事件，桌面端不再把它渲染为误导性的“工具 workspace_gateway”。
- 只有同一轮已经出现成功工作区事件时才过滤该空泛标记；包含 `error`、`detail`、`code`、具体输入或路径信息的真实失败仍保留，便于排查授权、路径和网络问题。
- 验证：Agent Runtime 与 Event Stream 定向测试 22/22 通过，Node/Web 类型检查通过。

## 2026-08-04：Relay 丢失运行记录时停止无效重试

- `GET /runs/{runId}` 返回 `HTTP 404 run_not_found` 现在被识别为终态，不再伪装成网络抖动并重试 120 秒。
- 运行会立即提示 Relay 重启/热更新或状态清理导致的原因；客户端不会自动重放旧消息，避免远程工作区写入被重复执行。
- 验证：统一 Gateway 与 Runtime 定向测试 33/33，Node/Web 类型检查通过。

## 2026-08-04：Hers-2 工作区授权改为显式撤销与根路径兼容

- 工作区 Grant 默认以 `expiresAt: null` 注册，不再由桌面端设置 600 秒倒计时；运行结束、取消或显式撤销时仍会调用 revoke，避免留下无人管理的远程授权。
- 对旧 Relay 返回 `grant_expired` 的情况增加当前 Grant 自动重新登记兼容；Relay 应升级为接受 `expiresAt: null`，并将 `maxGrantSeconds` 改为 `null` 或省略。
- 远端 `list` 请求传入 `/` 时归一化为已授权项目根目录 `.`；目录丢失时改为脱敏、可操作的提示，不再泄露 Windows 绝对路径。
- 验证：Workspace Gateway 与统一 Gateway 定向测试通过；新增永久 Grant、根路径和目录丢失回归覆盖。

## 2026-08-04：Hers-2 工作区 Grant 联调恢复与模型名称展示优化

- 工作区网关 URL 校验允许 `localhost`、回环地址和 RFC1918 私网 IPv4 的 HTTP 联调；公网 HTTP 仍拒绝，必须改用 HTTPS，避免 Bearer Token 明文出站。
- Relay 在轮询时返回明确 `grant_not_found`/未知 Grant 的情况下，桌面端会用当前仍有效的 Grant 自动重新登记一次；已撤销或已过期的 Grant 不会被自动复活。
- RuntimeChat 模型标签取消原先 `10vw / 150px` 的硬限制，改为响应式最大宽度并允许长模型名换行，同时保留完整无障碍标签。
- 验证：remote-workspace-gateway 11/11、RuntimeChat 20/20；Node/Web 类型检查通过。

## 2026-08-04：Hers-2 RuntimeChat 输入与运行元数据补齐

- 统一 Gateway 的远程附件链路已闭环：能力探测区分 `artifacts.upload`，桌面端安全暂存并上传附件到 `/artifacts`，再将不可变 `artifactIds` 写入 `/runs.input`；插件 SDK 增加可选 `adapter.uploadArtifact` 端点。
- RuntimeChat 的模型与上下文显示支持 Event Stream 常见字段，包括 `model_name`、`modelId`、`context_used`、`context_max`；只展示远端真实回传值，不猜测模型或上下文窗口。
- 网页预览改用对话壳的右侧面板布局，并增加 WebView 加载失败提示与重试按钮。
- 验证：RuntimeChat、Agent Event Stream、Remote Gateway、Agent Runtime 定向回归与插件 SDK 测试通过；Node/Web 类型检查通过。

## 2026-08-02：Gateway 失败事件保留详细诊断

- 共享事件模型现在保留 Gateway 事件中的 `code`、`error`、`detail` 字段，避免 `agent_offline` 被通用的 `failed` 覆盖。
- 失败原因按详细错误码优先呈现，并将 `agent_offline` 映射为可执行的 Connector 注册/在线检查提示。
- 当同一运行同时包含详细失败事件和通用 `run.failed` 终态时，界面过滤重复的通用失败记录，只保留可诊断原因。
- 验证：Gateway 定向回归测试 12/12 通过，Node/Web 类型检查通过，完整构建通过。
- 边界：该修复改善客户端诊断，不会自动启动远端 Connector；若远端仍返回 `agent_offline`，需先让对应 Runtime ID 的 Connector 在线并完成注册。

## 2026-08-02：共享 Gateway 路由补充 runtimeId

- 根因：自定义远程智能体 `Hers-2` 的界面名称与远端 Connector 身份不同。桌面端调用统一 Gateway `/runs` 时此前没有携带运行时 ID，共享 Relay 无法把任务路由到 `hermes-home2`，最终返回 `agent_offline`。
- 修复：桌面端现在始终把已配置 Runtime 的稳定 `runtimeId` 放入 `/runs` 请求；显示名称仍可自定义，不能作为路由身份使用。单智能体专用 Gateway 可忽略该字段。
- 协议约束：共享 Gateway 必须按 `runtimeId` 绑定对应 Connector；Connector 未注册或离线时返回结构化 `agent_offline`，不能只返回无诊断信息的 `failed`。
- 验证：Gateway 定向回归测试 12/12、Node/Web 类型检查和完整构建均通过。

## 2026-08-02：Remote Gateway 适配器显式传递 runtimeId

- 现象：桌面端已向 `/runs` 传入 `hermes-home2`，但共享 Gateway 仍返回 `agent_offline`，说明远端适配器可能只读取旧的 `startRun` 上下文而没有检查请求体顶层路由字段。
- 修复：SDK 调用 `adapter.startRun(input, context)` 时显式提供 `context.runtimeId`，同时保留顶层请求字段以兼容旧适配器；协议文档明确适配器的读取顺序和 Relay 路由要求。
- 远端要求：Hers/Relay 更新插件后，必须用稳定 ID `hermes-home2` 注册并保持 Connector 在线；仅 `/capabilities` 健康或“统一 Gateway 已连接”不能证明目标 Connector 在线。

## 2026-08-02：补齐 runtimeId 的双位置兼容

- 现象：部分已部署适配器只读取 `input.runtimeId`，而 v1 标准字段位于请求顶层，可能造成共享 Gateway 收到请求却无法定位目标 Connector。
- 修复：桌面端 `/runs` 同时发送顶层 `runtimeId` 与嵌套 `input.runtimeId`；SDK 在调用适配器前按“顶层优先、嵌套回退”归一化，并传入 `context.runtimeId`。不改变 v1 规范，兼容旧适配器。
- 验证：Gateway 定向回归测试 12/12、插件 SDK 测试 3/3、Node 类型检查通过。

## 2026-07-31 - Gateway 插件识别与事件呈现收口

- 桌面端 Gateway v1 探测现可识别标准 `plugin`，并兼容 SDK 迁移期的 `pluginInfo`；连接测试将显示已识别的插件版本。
- Workspace Gateway 能力同时兼容标准嵌套声明和早期扁平声明，避免已具备 Workspace Grant 的远程智能体被错误收起文件夹和权限控件。
- 移除了桌面端把“远程智能体已返回新的答复”写入执行过程的合成事件；最终答复只显示为答复气泡，不再伪装为“思考”。历史中的同类合成事件也会在界面过滤。
- 任务输入栏会在 Gateway 实际回传 `model`、`usage.contextWindowTokens` 后显示真实模型和上下文占用；不再猜测模型或上下文长度。
- 仍待远程插件完成：Hers/OpenClaw 必须回传真实的 `reasoning.summary`、工具生命周期事件、模型与用量元数据。若无法取得真实事件，不应声明富事件能力或伪造思考记录。

本日志记录开发、体验迭代、测试验证和重要产品取舍。路线图仍以
[Agents One 可用性重构计划](./AGENTS_ONE_USABILITY_REBUILD_PLAN.md) 和
[Agents One 项目与任务中心实施计划](./AGENTS_ONE_PROJECT_TASK_EXECUTION_PLAN.md)
为准；本文件用于后续总结、回顾和升级优化。

## 2026-07-26：按需转为多智能体协作的入口与隔离存储

### 产品决定

Agents One 保持“对话优先”：新建任务（包括项目中的任务）默认都是单智能体对话。多智能体协作是少数、由用户明确发起的工作方式，而不是自动路由或默认编排。

### 已完成

- 项目标题右侧新增任务入口：可选择“新建任务”或“新建多智能体协作任务”。原有项目区总 `+` 仍只负责“新建空白项目 / 使用现有文件夹”，职责不混淆。
- 任务右键菜单在“重命名”后新增“转为多智能体协作”，可把已有单智能体任务按需升级。
- 协作弹窗支持指定协调者、实施、测试、复核四个角色，并默认将原任务智能体带入协调者；未选择的角色保持“暂不指定”。
- 协作分工单独保存至本地 `task-collaborations.json`，只以任务 ID 关联，**不改写** Runtime 注册、既有对话正文、项目文件夹或历史索引。
- 左侧项目/任务记录会以轻量“协作”标识区分已配置协作分工的任务；该标识查询失败时只隐藏标识，不影响任何历史记录或任务操作。
- 已配置协作的任务在右侧“对话任务”栏展示实际角色分工，并按智能体的自定义名称显示。该栏只用于回看分工与当前执行信息，不会因打开任务而自动创建、派发或重跑工作。
- 首版仅保存明确分工和项目关联，不自动派发、不自动共享敏感上下文、不自动合并任何代码；后续协作执行和项目侧进度面板须在此元数据稳定后单独实现。

### 验证

- `TaskCollaborationDialog` 定向测试覆盖“继承原任务智能体为协调者”和“保存明确角色分工”；`ConversationSidePanel` 覆盖协作分工展示且不自动创建/派发任务。
- `npm.cmd run typecheck`：Node/Web 类型检查通过。

### 风险控制

- 本次改动仅增加协作元数据和 Renderer 入口；不触及智能体接入、凭据、默认 Runtime、会话持久化和项目恢复逻辑。
- 若协作元数据文件损坏或不可读，协作功能显示为空配置，不会影响原任务的打开、发送或历史显示。

## 2026-07-25：自定义 Hermes 接入档案补全

### 背景与边界

“新增智能体”中的 Hermes 曾沿用通用 Runtime 的 `HTTP / CLI` 表单，缺少 Hermes 实际需要的连接模式、Dashboard 凭据和对话传输选择，容易与系统默认 Hermes 的连接设置混淆。本次仅扩展**用户自定义 Hermes Runtime**的配置、受保护凭据与按模式探测；不改动系统默认 Hermes 连接、既有 Runtime、项目、任务或会话数据。

### 已完成

- 自定义 Hermes 支持三种模式：**本地**、**远程**、**SSH 隧道**；SSH 模式保存主机、用户、端口、远端 API 端口和私钥路径。
- 远程/SSH Hermes 提供 API 密钥、Dashboard 地址、Dashboard 令牌，以及三种对话传输策略：**自动**、**Dashboard**、**基础模式**。
- Hermes 不再显示与其语义冲突的通用 `HTTP / CLI` 连接方式下拉框；该下拉框继续仅服务其他 Runtime。
- API 密钥和 Dashboard 令牌不写入 Runtime 定义或 `desktop.json`，分别保存在受保护的环境变量/凭据通道中；Runtime JSON 只保存非敏感连接元数据。
- 连接测试按模式分流：本地检测本机 Hermes 健康端点，远程使用已配置 API 密钥检测远端健康，SSH 使用隧道连接参数检测可达性。

### 验证

- `npm.cmd test -- tests/agent-runtimes.test.ts src/renderer/src/components/settings/AgentRuntimesPane.test.tsx`：20 个用例通过，覆盖三种 Hermes 模式、三种传输方式、API/Dashboard 凭据不落盘和远程探测。
- `npm.cmd run typecheck`：Node/Web 类型检查通过。
- `git diff --check`：通过；仅报告现有工作区文件的 CRLF 提示，无空白错误。

### 后续注意

- 系统默认 Hermes 的实际 Dashboard/基础模式收发仍由既有全局连接管理器负责；自定义 Hermes 的对话执行适配应单独设计与验证，不能为了复用表单而回写或覆盖默认连接配置。

## 2026-07-24：Runtime 顶部任务标签外观与标题统一

### 现象

Hermes 任务对话在窗口顶部能显示头像和任务标题，但 Pi、Codex、Claude Code、OpenClaw 等 Runtime 对话被统一渲染为通用机器人图标和“新对话”。侧边栏已经正确识别用户自定义的名称与头像，顶部标签栏却没有复用同一份展示数据。

### 改动边界

本次仅修改 Renderer 层的顶部标签显示与恢复历史对话时的内存映射；不修改 Runtime 注册、`desktop.json`、IPC、会话存储或任何历史数据。

### 已完成

- 顶部标签栏改为按当前 Runtime 的用户配置解析显示名称、颜色和头像；Runtime 有自定义头像时显示头像，否则保持带 Runtime 色彩的通用图标。
- 顶部标签标题优先使用 Runtime 对话已保存的标题；新任务发送首条用户消息后继续沿用该消息作为标题。
- 恢复 Runtime 历史对话时，把持久化的标题、颜色和头像带入临时 `ChatRun` 与 Runtime 展示目录，避免历史标签重新回退成“新对话”。
- Hermes 仍使用其 Profile 外观，未改变原有表现。

### 验证

- `npm.cmd test -- src\\renderer\\src\\screens\\Layout\\ActiveSessionsBar.test.tsx`：4 个用例通过，包含 Runtime 自定义名称、头像和任务标题回归场景。
- `npm.cmd run typecheck`：Node/Web 类型检查通过。

### 后续注意

- 顶部标签、左侧项目/任务列表与对话正文应共用 Runtime 外观解析策略；新增智能体不得再单独写一套图标或标题回退逻辑。

## 2026-07-24：远程工作区启动避免误入首次安装页

### 现象

重启开发版后，已配置远程 Hermes 的用户被带到“Welcome to Agents One / Get Started”首次安装页。该页面会提示安装本地组件，不符合远程工作区的启动语义，也容易让用户误以为需要重新登录或重新安装。

### 根因与改动边界

启动流程把连接配置读取、远程健康检查放在同一个宽泛的 `try/catch` 内。远程健康检查本身已允许失败后继续进入主界面，但只要其中任一步 IPC 暂态失败，外层就直接回退 Welcome。此次仅调整 Renderer 启动流程的失败降级，不改动远程配置、凭据、Runtime 注册或会话数据。

### 已完成

- 主启动检查异常后，额外调用主进程 `checkInstall` 作为兜底；远程模式下该检查只验证已保存的远程连接配置，不检查本地 Hermes 安装。
- 兜底识别到已配置的远程工作区后直接进入主界面，而不是首次安装页。
- 本地开发版启动时显式继承现有 `C:\\Users\\chenfl\\AppData\\Local\\hermes` 数据目录，避免开发环境的目录解析差异影响人工验收。

### 验证

- `npm.cmd run typecheck`：Node/Web 类型检查通过。
- `git diff --check`：通过。

## 2026-07-24：变更安全门禁与最小化修改原则

### 事件与教训

在统一 Runtime 对话输入栏布局的过程中，原本应局限于 Renderer 的视觉改动不当牵连了 Runtime 默认注册和历史外观解析，造成 Pi Agent 不可达、设置页不可编辑、智能体头像/名称回退等回归。用户明确要求：任何后续优化必须坚持最小化原则，能不动的代码先不动；确需跨层修改时，先做清晰的影响评估与风险预案。

### 已固化的执行规则

- 新增 [Agents One 变更安全守则](./AGENTS_ONE_CHANGE_SAFETY_PROTOCOL.md)，定义 UI、Runtime、持久化与历史数据的默认边界。
- 项目级 `AGENTS.md` 增加强制门禁：UI-only 改动默认不得触碰 Runtime 注册、配置写入、迁移、IPC 和历史对账；跨层变更必须先说明影响数据、消费者、失败模式、回退路径和验收清单。
- 配置写入必须读取并保留未知键；用户管理的 Runtime、头像、名称、项目和会话不可因局部功能改动被覆盖或重建。
- 后续采用“小补丁 - 定向测试 - 重启冒烟 - 再继续”的节奏，不将视觉调整与运行时逻辑、数据迁移混在同一不可拆分变更中。

### 当前限制

- 项目要求使用的 `lat` 命令在当前终端不可用，因此本次无法执行 `lat search` / `lat check`；已直接在项目级执行规则和进展日志中留下可审计记录。恢复该工具后，应补做知识库索引与校验。

## 2026-07-20 至 2026-07-21：产品信息架构与真实使用打磨（追溯补录）

说明：本节为 2026-07-22 根据连续对话、截图反馈、代码状态和既有验收文档补录。此前部分内容已散见于 U5 验收文档、发布矩阵和代码测试记录，但没有集中形成进展日志。

### 背景

前期实现已经证明 Hermes、OpenClaw、Codex、Claude Code 与 Pi Agent 可以作为 Runtime 接入，但用户在真实使用中发现：界面仍残留 Hermes Desktop 的旧信息架构，任务、项目、对话、智能体管理之间边界不够清晰；CLI 类智能体虽然能执行，但交互体验不如直接在 Terminal 使用。

### 产品方向确认

- **对话优先没有改变**：用户所谓“任务”本质上仍是原来的对话工作流；任务列表就是高价值对话列表。
- **项目是对话/任务的容器**：一个项目围绕同一目标组织多轮对话、多个智能体和产物，不再把“项目”做成孤立功能页。
- **任务中心收敛为计划/定时任务与验收视图**：不再让用户为了查看一次对话结果频繁跳转。
- **聊天是轻量浮窗**：用于临时问答，必要时把内容追加到当前任务/对话，而不是打开完整任务工作台。
- **智能体协作替代重复的智能体管理入口**：接入配置在设置中维护，主界面关注项目协作角色和当前可用智能体。

### 已完成的关键调整

- 主导航和左侧栏继续向“新建任务/任务列表/项目列表/聊天/智能体协作”收敛，去掉与当前阶段重复或不可用的旧入口。
- 项目列表支持“新建空白项目”和“使用现有文件夹”；选择后会把对应目录作为上下文文件夹进入新建任务/对话。
- 修复新建项目后任务错误进入普通任务列表的问题；项目任务应显示在对应项目分组下。
- 统一 Hermes、OpenClaw、Codex、Claude Code、Pi Agent 的对话窗口布局和输入框能力，尽量复用 Hermes 默认对话体验。
- 对话右侧栏从压缩主对话区改为右侧任务/产物信息面板，侧边栏按钮移入输入框下方工具栏，避免遮挡消息气泡。
- 默认智能体从旧 `default profile` 改为可从已接入智能体中选择；左下角展示默认智能体头像和名称，新建任务默认使用该智能体。
- 智能体头像、名称、颜色改为统一外观元数据，任务列表和项目任务中的头像/名称应与用户设定保持一致。
- 智能体接入类型扩展为可自定义，支持 Pi Agent CLI 这类新增本地 CLI Runtime。
- 调整权限控制：对话输入区由“只读/实现”改为“权限”，保留“只读”和“完全访问”；完全访问用于本地 CLI 智能体，删除类操作仍应有确认。
- 取消每次对话弹出的完全访问安全提示，改为在权限状态和高风险动作上做明确控制。
- 完成 Agents One 新品牌方向调整：应用名从 Hermes One 全面调整为 Agents One；补齐彩虹 O 圆环方案、任务栏图标、桌面快捷方式图标与欢迎页资产的多轮视觉修正。

### Runtime 与真实使用测试

- Hermes：远程对话、附件传递和 Dashboard/API 恢复后继续可用；重复回复、会话分裂和历史列表混乱已多轮修复。
- OpenClaw：远程 Bridge 健康、对话和 artifact 能力已接入；修复了后续对话超时、布局不一致和产物预览相关问题。
- Codex：本地 CLI 对话和任务执行可用；继续保持受控工作区、项目目录和运行过程反馈。
- Claude Code：本地 CLI 作为 Runtime 参与对话与项目任务；与 Codex 共用本地 CLI 工作区/附件/产物处理方向。
- Pi Agent：新增本地 CLI Runtime 接入；完成连接测试、连续对话、权限控制、工具过程展示和格式清理的多轮修复。

### 测试与验证

- 多轮执行针对性组件/主进程测试，覆盖 Runtime 接入、对话持久化、项目列表、远程文件夹选择、智能体设置和 RuntimeChat。
- 多轮执行 `npm.cmd run typecheck`，确保 Node/Web 类型检查通过后再重启开发版。
- 多次重启 Agents One 开发版并由用户进行手工截图验收。
- 安装包、便携版和发布候选版本继续冻结，等待 UI 与核心路径人工体验验收稳定后再恢复。

### 遗留与注意

- 由于本节为追溯补录，部分中间测试命令和截图没有逐条落入文档；后续每轮关键修复完成后应即时追加本日志。
- PowerMem 工具当前未在 Codex 会话中暴露；可用后应同步写入“对话优先的信息架构”“项目作为任务/对话容器”“CLI Runtime 事件分流”等长期记忆。

## 2026-07-22：Pi Agent CLI 执行过程展示收口

### 背景

用户在真实测试中发现 Pi Agent CLI 的执行过程存在大量重复思考快照、空参数工具调用和无意义完成记录。对比 Terminal 端同类任务后确认：Pi Agent CLI 的 `thinking` 输出是流式 snapshot，Terminal 更接近“覆盖/折叠当前状态”，而 Agents One 之前把每个 snapshot 当成独立历史事件 append，导致界面噪音。

### 产品判断

- 执行过程不是原始日志面板，应面向用户展示可读、可复查的关键步骤。
- `thinking` 只作为过程摘要，不进入正式对话正文；默认折叠，避免占用主阅读区域。
- 大模型普通回复不算产物；只有文档、代码、diff、测试报告、链接或不可变 artifact 才算产物。
- 空参数工具调用、started/completed 这类无决策价值事件默认隐藏。

### 已完成

- Pi Agent `thinking` snapshot 改为合并/替换逻辑：半截与完整版本只保留最长版本。
- 前端对旧记录也执行去噪：过滤短半句、`Pi 思考：` 前缀、`任务已开始执行`、`任务执行完成`、普通最终回复提示。
- “思考”分组默认折叠，只保留最近 2 条完整摘要。
- `write` 仅展示目标文件路径和写入结果，不再展示“写入 N 个字符”等中间噪音。
- 空参数工具调用（例如 `read: {}`）在主进程不再保存；旧记录展示层也会过滤。
- 保留有效工具过程：List Files、Read File、Write File、Terminal、Search 等按工具分组展示。

### 验证

- `npm.cmd test -- --run tests/agent-runtimes.test.ts src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx`
  - 2 个测试文件通过
  - 18 个用例通过
- `npm.cmd run typecheck`
  - Node 类型检查通过
  - Web 类型检查通过
- 开发版 Agents One 已重启并完成用户截图确认：Pi Agent 过程展示基本达到预期。

### 后续注意

- 如果继续接入新的 CLI 智能体，必须将 provider event stream 分为 `thinking snapshot`、`tool_call`、`tool_result`、`final message` 和 `artifact`，不能全部 append 到对话历史。
- 后续若 PowerMem 工具可用，应同步写入本轮“Pi Agent snapshot 处理策略”和“执行过程展示原则”，便于跨会话召回。
- 发布前仍需用 Hermes、OpenClaw、Codex、Claude Code、Pi Agent 各跑一次连续对话与附件/项目目录回归。

## 2026-07-23：记录丢失问题排查与修复

### 现象

用户反馈之前的项目记录和昨天跟 Hermes 的对话记录再次消失。截图中左侧只剩项目 `test` 下的 Pi 对话，以及少量 Claude/OpenClaw 任务记录。

### 根因

- 远程 Hermes 的正文历史并未全部丢失：本地 `remote-session-cache.json` 中仍有 16 条 `histories`。
- 但同一缓存文件里的 `sessions` 索引被覆盖为空数组，导致左侧列表无法展示这些历史。
- 代码层面原因是 `remoteListCachedSessions(limit, offset)` 会把当前远端返回页直接写回缓存；当远端列表 API 临时返回空、分页返回空、或请求失败时，可能把完整索引覆盖成空/残缺。
- 项目栏此前主要依赖“对话的工作目录分组”，用户刚选择的项目文件夹如果没有稳定注册表，也容易在对话索引异常时看起来像项目消失。

### 已完成修复

- 修改远程会话缓存策略：
  - 空 `sessions` 不再覆盖已有非空索引；
  - 只有第一页且非空的远端列表结果才刷新缓存索引；
  - 当远端列表为空但 `histories` 存在时，从历史正文自动重建侧边栏会话索引；
  - 重建出的索引会写回缓存，避免下次启动继续空列表。
- 对当前开发环境缓存做了一次数据修复：
  - 已备份原文件为 `remote-session-cache.json.bak-*`；
  - 已从 16 条 Hermes 历史正文恢复出 16 条会话索引，包括 `agents one建立新项目测试`、`agents one连接测试` 等记录。
- 新增项目文件夹注册表：
  - 新建/选择项目文件夹后写入 `desktop/project-folders.json`；
  - 侧边栏项目分组会合并“注册项目文件夹”和“已有对话工作目录”；
  - 没有对话的项目文件夹也能稳定显示。

### 回归验证

- `npm.cmd test -- tests/project-folders.test.ts tests/remote-session-cache-recovery.test.ts tests/remote-sessions.test.ts tests/runtime-conversation-store.test.ts`
  - 4 个测试文件通过
  - 19 个用例通过
- `npm.cmd run typecheck`
  - Node 类型检查通过
  - Web 类型检查通过

### 后续注意

- 远程会话缓存必须区分“远端明确删除”和“列表 API 临时空结果”。在没有明确删除信号前，不允许用空列表清空本地索引。
- 项目入口必须有独立持久化来源，不能只依赖某条对话是否仍在列表中。
- 后续如果接入 PowerMem，应同步写入“远程 Hermes 历史正文和会话索引分离，空列表不得覆盖本地缓存”的长期经验。

## 2026-07-23：项目列表启动后闪退修复

### 现象

用户反馈 Agents One 刚启动时项目栏曾短暂显示 3 项项目记录，随后其中 2 项闪一下消失，只剩 `test` 项目。

### 根因

- 左侧项目分组首先根据已缓存的任务/对话工作目录渲染，能读到多项项目。
- 运行时配置加载完成后，前端会再次归一化列表；旧逻辑会把“任务工作目录等于该智能体配置 workspace”的记录视为默认工作区并隐藏。
- 该规则原本用于避免把开发目录误显示为项目，但它会让真实已有记录在二次加载后消失，形成“记录丢失”的错觉。
- 同时，重复会话折叠逻辑此前只按“智能体 + 标题”判断相近记录，没有纳入项目目录，存在跨项目同名任务被误合并的风险。

### 已完成修复

- 取消“工作目录等于 runtime 默认 workspace 就隐藏项目”的自动过滤。
- 已存在任务/对话的 `contextFolder` 一律保留并参与项目分组。
- 项目是否显示不再依赖 runtime 配置加载时机，避免启动时先显示后消失。
- 重复会话折叠键加入项目目录，避免不同项目下同名任务互相吞并。

### 验证

- `npm.cmd run typecheck`
  - Node 类型检查通过
  - Web 类型检查通过
- `npm.cmd test -- tests\project-folders.test.ts tests\runtime-conversation-store.test.ts`
  - 2 个测试文件通过
  - 3 个用例通过

### 后续注意

- 不应通过隐式规则自动隐藏已有项目记录；如果用户认为某个项目是误归类，应后续提供显式的“隐藏项目/移出项目/清理旧记录”操作。
- 新建或选择项目文件夹后仍应写入 `project-folders.json`，项目列表需要同时合并“注册项目”和“已有任务工作目录”两个来源。

## 2026-07-23：远程 Hermes 历史缺少用户消息修复

### 现象

用户发现部分 Hermes 历史对话打开后只有智能体答复、工具过程或思考记录，看不到用户当时发出的消息。

### 根因

- 远程 Dashboard/API 返回的历史并不总是包含完整 user 行；部分旧会话只返回 assistant/reasoning/tool 记录。
- Agents One 前端已有本地 `desktop_session_continuations` overlay，用来保存用户 prompt 和本地流式对话副本。
- 但 `remoteGetSessionMessages` 在远端拉取成功后直接把远端 canonical 历史写入 `remote-session-cache.json`，没有合并本地 overlay，导致本地已保存的用户消息被远端不完整历史覆盖。
- 同 id 会话合并时，`desktop-overlay` 还可能覆盖远端恢复出的 `messageCount`，造成列表元数据不完整。

### 已完成修复

- 远程历史加载成功后，统一调用 `mergeSessionContinuationWithCanonical` 合并本地 overlay，再写入远程缓存。
- 远程拉取失败回退到本地缓存时，也会先合并 overlay，避免继续显示缺 user 的缓存。
- `fillPlaceholderCachedSessionTitles` 改为使用同一合并逻辑，标题优先来自恢复后的用户消息。
- 同 id 的 `desktop-overlay` 与 `remote-cache` 合并时，保留更完整的 `messageCount`、`startedAt` 和非 overlay 来源，避免 overlay 降级远程恢复结果。
- 对当前开发环境执行一次数据修复：
  - 已备份 `remote-session-cache.json` 为 `remote-session-cache.json.bak-user-merge-*`；
  - 已从 SQLite overlay 合并修复 4 条历史，包括 `这是agents one连接测试...`、`文档见附件`、`读取附件中的 Marker...`、儿童床垫研究记录。

### 不可恢复项

本地和远端都没有 user overlay 的极早期旧记录无法准确恢复原始提问。本轮检查剩余 3 条 userless 历史：`从之前的会话看...`、`Hermes U5 第一轮通过。`、`老大好！连接正常...`。后续应在 UI 上标注为“历史缺少原始提问”，但不应伪造用户消息。

### 验证

- `npm.cmd test -- tests\remote-session-cache-recovery.test.ts tests\remote-sessions.test.ts tests\session-continuation-store.test.ts`
  - 3 个测试文件通过
  - 25 个用例通过
- `npm.cmd run typecheck`
  - Node 类型检查通过
  - Web 类型检查通过

### 后续注意

- 远程 Hermes 历史永远不能被视为唯一可信来源；本地 overlay 是恢复用户消息和附件上下文的必要层。
- 任何“同步远端历史后写缓存”的路径，都必须先合并本地 continuation overlay。
- 对真实不可恢复的旧记录，只能做残缺标记或隐藏，不能把 assistant 标题伪造成用户输入。

## 2026-07-23：Runtime 对话输入栏与 Hermes 布局统一

### 现象

用户反馈 Hermes 对话框输入栏与 Pi、Claude Code、Codex 等 Runtime 智能体输入栏不一致；Runtime 输入栏中的项目文件夹名和模型名容易被挤掉或只显示为空图标。

### 根因

- Hermes 对话页使用完整的 `ModelPicker + ContextFolderChip` 控件组合。
- Runtime 对话页此前手写了一套简化工具栏：项目目录只显示文件夹图标，且没有复用最近文件夹、目录名、省略和清除逻辑。
- Runtime 页面没有把 `runtime.config.workspace` 初始化到输入栏状态，导致已有默认工作目录参与任务执行，但 UI 上看不到目录名。
- 权限芯片文案较长，占用了输入栏工具区宽度，进一步压缩模型和文件夹显示空间。

### 已完成修复

- Runtime 对话页复用 `ContextFolderChip`，本地 Codex、Claude Code、Pi Agent 的项目目录显示方式与 Hermes 保持一致。
- Runtime 工作目录初始化改为优先使用 `initialWorkspace`，其次使用 `runtime.config.workspace`，保证配置中的项目目录能在输入栏显示。
- Runtime 模型显示改为统一的 `chat-model-trigger` 芯片，配置了模型时显示模型名，未配置时显示“默认模型”。
- 权限控件保留，但压缩为“只读 / 完全访问”的短标签，避免挤占模型和项目目录显示。
- `ContextFolderChip` 增加 API 兜底和无障碍名称，旧测试环境或未暴露最近文件夹 API 时不会报错。

### 验证

- `npm.cmd run typecheck`
  - Node 类型检查通过
  - Web 类型检查通过
- `npm.cmd test -- src\renderer\src\screens\RuntimeChat\RuntimeChat.test.tsx`
  - 1 个测试文件通过
  - 7 个用例通过

### 后续注意

- 后续新增智能体的新对话输入栏应默认复用 Hermes 的输入栏控件组合，不再为单个 Runtime 手写一套独立布局。
- 如果某个 CLI Runtime 无法探测真实模型，只能显示“默认模型”或配置中的模型覆盖值；后续可在 Runtime probe 中增加模型发现能力。

## 2026-07-23：Pi Agent 默认接入与侧边栏智能体外观恢复

### 现象

用户反馈输入栏统一后，之前接入的 Pi Agent CLI 从“智能体协作/可参与协作的智能体”列表里消失；项目和任务记录中的智能体名称、头像也退回成通用机器人或旧名称。

### 根因

- 当前 `desktop.json` 的 `agentRuntimes` 只剩 Codex、OpenClaw、Claude Code，Pi 的用户配置已不在本地 runtime 配置中。
- 主进程此前只内置 Hermes，其余智能体完全依赖用户配置；Pi 配置缺失时，虽然代码支持 `kind: "pi"`，但 UI 不会再列出 Pi。
- 侧边栏历史记录只按 `runtimeId` 命中当前 runtime 外观；一旦旧记录的 id/name 与当前配置不一致，就会错误回退到 Hermes 外观，导致原智能体名称和头像丢失。
- 内置远程 Hermes 的默认展示名仍是 `Remote Hermes`，而运行位置已经由副标题单独展示，列表里会显得像旧英文名称。

### 已完成修复

- 新增内置 Pi Agent CLI runtime：
  - id：`pi`
  - name：`Pi`
  - kind：`pi`
  - location：`local`
  - executable：`pi`
  - 默认紫色标识
- 如果用户后续自己配置了任意 Pi runtime，则优先使用用户配置，不重复插入内置 Pi。
- 内置 Hermes 展示名统一为 `Hermes`，远程/本地位置继续通过副标题展示。
- 侧边栏智能体外观解析改为多级匹配：
  - 优先按 `runtimeId` 匹配；
  - 再按 `runtimeName` 匹配；
  - 再按 `runtimeKind` 匹配；
  - 只有真正缺少 runtime 信息或 Hermes 会话才回退 Hermes 外观。
- 这次修改不删除、不迁移已有项目、任务或对话记录；只是修复运行时列表与历史记录的显示解析。

### 验证

- `npm.cmd run typecheck`
  - Node 类型检查通过
  - Web 类型检查通过
- `npm.cmd test -- tests\agent-runtimes.test.ts src\renderer\src\screens\RuntimeChat\RuntimeChat.test.tsx`
  - 2 个测试文件通过
  - 18 个用例通过

### 后续注意

- 运行时接入配置和显示外观要分离：配置缺失不能导致历史记录丢失，外观缺失时应尽量从 id/name/kind 推断。
- 用户重新给智能体设置头像和名称后，项目/任务列表必须立即使用当前 runtime appearance，而不是保留历史旧名称。
- Pi Agent 作为本地 CLI 智能体应和 Codex、Claude Code 一样保留在默认可接入智能体集合中，避免配置文件意外缺项后从 UI 消失。

### 追加修正

用户复测发现 Pi 虽然重新出现在列表中，但显示为“不可达”，且智能体接入设置页里的 Pi 字段不可编辑。

根因是第一次补救把 Pi 当成 `managed: builtin` 的内置项插入，并使用裸命令 `pi` 作为可执行文件。Windows/Electron 子进程环境下裸命令解析不如 PowerShell 稳定，本机真实可执行入口是 `D:\efunds\nodejs\pi.cmd`；同时 builtin 状态会让设置页禁用类型、位置、可执行文件、工作区等字段。

已修正：

- Pi 默认项改为 `managed: user`，因此接入设置页可编辑名称、图标、类型、位置、可执行文件、工作区、模型覆盖、超时和启用状态。
- 默认 Pi 可执行文件改为按 Windows PATH 探测 `pi.cmd`，本机解析为 `D:\efunds\nodejs\pi.cmd`。
- 如果用户已有自定义 Pi runtime，则继续优先使用用户配置，不插入默认 Pi。
- 用主进程 `probeAgentRuntime("pi")` 实测通过，返回健康状态和版本 `0.81.1`。

验证：

- `npm.cmd run typecheck` 通过。

## 2026-07-26：协作任务改为“原任务对话 + 角色分工”启动

### 产品决策

- 多智能体协作属于按需能力，不能另起一套孤立的对话、项目或历史存储。
- 从项目加号创建“新建多智能体协作任务”，或将现有任务转换为协作任务后，首屏直接显示“角色设置 + 任务说明”面板：上半部分配置项目负责人、实施、测试和可选复核角色；下半部分输入首条任务说明。
- 用户点击“发送并启动”后，任务说明仍通过原有正式任务对话的发送逻辑写入同一会话。角色配置作为该任务的独立协作元数据保存，不迁移、不重写 Runtime 注册表、项目记录或对话历史。

### 已完成调整

- 角色配置增加“角色、智能体、职责、共享上下文”四列；默认提供项目负责人、实施、测试，可按需增加复核。
- 首条协作说明复用现有 Hermes/Runtime 对话的发送与持久化链路：既有标题生成、会话 ID、项目文件夹上下文、历史恢复和错误处理均不复制实现。
- 协作元数据新增 `responsibility`、`context` 和显式启动状态，仅保存在独立的 `task-collaborations.json` 中；历史任务即使没有这些字段也可兼容读取。
- 原协作进度看板不再在创建后抢占任务界面；它仅作为启动后由对话侧栏进入的补充查看入口。

### 当前边界与下一步

- 当前版本已完成“角色设置 + 首条共享任务说明 + 原任务会话持久化”。首条说明由当前任务对话所绑定的智能体执行，角色分工不会自动派发或自动合并。
- 要让多个 Runtime 真正以不同头像/名称在同一个任务时间线中回复，需要新增受控协作调度层：统一消息归档、共享上下文快照、逐角色派发/取消、跨 Runtime 结果回写和人工确认。这必须独立实现并做端到端回归，不能通过修改现有单智能体会话存储来“硬接”。

### 回归验证

- `npm.cmd test -- TaskCollaborationDialog.test.tsx TaskCollaborationWorkspace.test.tsx ConversationSidePanel.test.tsx`：3 个测试文件、10 个用例通过。
- `npm.cmd run typecheck` 通过。
- `npm.cmd test -- tests\agent-runtimes.test.ts tests\pi-runtime.test.ts src\renderer\src\components\settings\AgentRuntimesPane.test.tsx` 通过，22 个用例通过。

## 2026-07-24：移除“智能体协作”页的本地 Hermes 档案兼容区

### 决策

“本地 Hermes 档案（兼容）”是 Hermes Desktop 时代的遗留管理界面。Agents One 当前以已接入 Runtime 为统一智能体入口，远程 Hermes 和本地 CLI 智能体均在同一列表中管理；继续在协作页展示未配置的 `default` 本地档案会造成重复入口和误导。

### 已完成调整

- 从“智能体协作”页面移除了本地 Hermes 档案的加载、创建、切换、编辑和表格渲染。
- 移除了只服务于该表格的页面样式与测试桩；协作页现在只展示已接入智能体、外观编辑、对话入口和项目协作入口。
- 移除了 Layout 中仅由该旧表格调用的 UI 回调。
- 保留主进程的 Hermes profile 存储、兼容 IPC 和历史恢复逻辑，不迁移、不删除任何本地档案数据，也不影响远程 Hermes 配置。

### 回归验证

- `Agents.test.tsx` 新增断言：协作页只加载 Runtime，不展示“本地 Hermes 档案（兼容）”或“新建本地档案”。
- Runtime 外观编辑测试继续保留。
- 完整 TypeScript 类型检查和差异检查在本次修改后执行。

### 后续边界

- 不再把 local profile 作为 Agents One 的主要产品功能暴露。
- 如未来确实需要导入旧 Hermes profile，应单独设计“旧数据导入/迁移”流程，而不是恢复旧档案管理页面。

## 2026-07-24：移除首次安装启动门槛

### 问题

桌面快捷方式启动时，旧 Hermes Desktop 的本地安装检测可能把已配置的 Agents One 导向“Welcome / Get Started”首次安装页。该页面会要求安装本地组件，与 Agents One 的远程及多 Runtime 聚合模式不匹配，也会让用户误以为已有数据或接入配置丢失。

### 已完成调整

- 启动路由现在只保留“启动页 → 主界面”。
- 移除了启动阶段对 `checkInstall`、`verifyInstall`、Welcome、Install、Setup 的页面跳转依赖。
- SSH 连接仍会在启动阶段尝试建立隧道；连接或配置读取异常仅写入诊断日志，不再阻止进入主界面。
- 移除了 Layout 中“重新安装”警告横幅的入口；未接入智能体时应通过“设置 → 智能体接入”完成配置。

### 验证

- `npm.cmd run typecheck` 通过。
- `npm.cmd test -- src\\renderer\\src\\screens\\Agents\\Agents.test.tsx src\\renderer\\src\\screens\\Layout\\ActiveSessionsBar.test.tsx` 通过，6 个用例通过。

## 2026-07-24：智能体统一管理入口与安全接入流程

### 产品调整

- 左侧导航“智能体协作”统一更名为“智能体”，作为已接入智能体的主入口。
- 管理页按“本地智能体 / 远程智能体”分组展示，移除了协作页中的说明性文案、旧的项目协作入口和重复的本地 Hermes 档案区。
- 卡片操作调整为“管理”和“任务对话”：
  - “管理”打开当前智能体的统一接入管理页；用户 Runtime 可保存配置或移除注册，移除不会删除项目、任务、对话或聊天历史。
  - “任务对话”改为创建正式任务对话，不再错误打开右下角的轻量聊天窗口。

### 接入与连接

- “新增智能体”使用统一 Runtime 表单：名称、头像、颜色、ID、类型、位置、连接方式、远程地址或本地 CLI/工作区均可配置。
- 新增 Runtime 采用“连接测试 → 保存”两阶段流程：测试使用临时草稿，不会提前写入 `desktop.json`；仅在测试健康且测试内容未变化时允许保存。
- OpenClaw 的 Bearer Token 仅在受保护凭据存储中保存；草稿测试时 Token 只用于该次请求，不写入 Runtime 定义或日志。
- 原“设置 → 智能体接入”入口已移除；原“设置 → 连接”的 Hermes 远程/本地/SSH 配置复用原有受保护存储，并嵌入到内置 Hermes 的“管理智能体”页面，避免产生第二套连接配置。

### 实现边界

- 继续使用既有 `agentRuntimes`、外观覆盖、Hermes 连接和受保护凭据存储；本次只调整入口与调用关系，不迁移、不清空、不重置已有接入信息。
- 新增 `probeAgentRuntimeDraft` IPC：主进程基于草稿进行探测，未持久化的凭据不会返回给 Renderer，也不会被记录。
- 删除 Runtime 仅从 Runtime 清单取消注册；历史记录仍按已持久化的 runtimeId/name/kind 显示。

### 验证

- `npm.cmd run typecheck` 通过。
- `npm.cmd test -- tests\\agent-runtimes.test.ts src\\renderer\\src\\screens\\Agents\\Agents.test.tsx src\\renderer\\src\\components\\settings\\AgentRuntimesPane.test.tsx` 通过，3 个测试文件、19 个用例全部通过；覆盖草稿探测不会写入 Runtime 注册表。
- `git diff --check` 无空白错误；现有工作树的 CRLF 提示为历史文件行尾提示，不代表本次差异错误。

## 2026-07-25：修复正式启动误入测试沙箱导致的“数据丢失”假象

### 现象与根因

- 用户通过桌面“启动 Agents One”快捷方式启动后，界面仅显示本地 Hermes、Pi 和少量测试项目/任务；远程 Hermes、Codex、OpenClaw、Claude Code 及大量历史记录看似消失。
- 排查确认正式数据没有被删除：`C:\Users\chenfl\AppData\Local\hermes\desktop.json` 仍保存远程 Hermes 配置以及 `codex`、`openclaw-remote`、`claude-code`、`pi` 四个用户 Runtime 和外观覆盖；正式历史仍位于该目录的 `desktop` 存储中。
- 根因是桌面启动脚本错误调用 `scripts/hermes-sandbox.ps1 dev`。该脚本为自动化测试而设计，必然把 `HERMES_HOME` 指向项目 `.sandbox\hermes-home`，并把 Electron 用户目录指向 `.sandbox\electron-user-data`，因此加载的是隔离测试数据而不是用户正式数据。

### 已修复

- `scripts/launch-agents-one.ps1` 改为使用正式 `npm run dev` 启动，不再调用沙箱脚本。
- 启动时明确设置 `HERMES_HOME=%LOCALAPPDATA%\hermes`，并清除所有 `HERMES_DESKTOP_SANDBOX`、`HERMES_DESKTOP_USER_DATA_DIR` 与沙箱端口环境变量。
- 正式启动日志转存到项目 `.agents-one\launcher`，避免与测试沙箱日志混用。
- 沙箱脚本仍保留，但仅允许通过 `npm run dev:sandbox` 或自动化测试显式调用，不能再作为用户桌面入口。

### 恢复验收

- 重启后的 Electron 已使用正式用户目录 `C:\Users\chenfl\AppData\Roaming\agents-one`，不再使用项目 `.sandbox` 目录。
- 通过 CDP 只读验收确认：智能体页同时显示 Codex、Claude、Pi、远程 Hermes、OpenClaw；左侧恢复正式项目和任务历史。
- 远程 Dashboard 当前的 `502 Bad Gateway` 会记入运行诊断，但不影响本地 Runtime 注册表、项目或历史读取，也不会再触发首次安装/本地 Hermes 降级界面。

## 2026-07-25：补齐自定义远程 Hermes 的 API 密钥接入

### 问题与边界

- “新增智能体”表单中，自定义远程 Hermes 仅有服务器地址，缺少与内置 Hermes 管理页一致的“API 密钥”输入；OpenClaw 已有单独的 Bridge Token 输入。
- 不能把远程密钥放入 `agentRuntimes` 或 `desktop.json`，也不能让自定义 Hermes 在探测失败时回退使用默认 Hermes 的全局密钥，否则会造成凭据串用和误报健康。

### 已完成调整

- 自定义远程 Hermes 表单现显示“远程服务器地址”和“API 密钥”；既有 OpenClaw 保持“服务地址”和“Bridge Token”。
- 自定义 Hermes 的 API 密钥与 OpenClaw Token 一样进入受保护凭据存储，Runtime 定义、普通配置和日志均不保存明文。
- 连接测试只临时使用当前表单密钥；保存后，后续探测和远程调用读取该 Runtime 自己的受保护密钥。
- 内置 Hermes 仍继续使用原有“连接”配置的 API 密钥，未迁移或改写既有远程配置。
- 自定义 Hermes 端点探测失败时不再回退默认 Hermes 连接，避免把错误的端点显示为健康。
- 智能体卡片“任务对话”文案收敛为“对话”；点击行为不变，仍创建正式任务对话，不会打开轻量聊天窗口。

### 验证

- `npm.cmd test -- tests/agent-runtimes.test.ts src/renderer/src/components/settings/AgentRuntimesPane.test.tsx src/renderer/src/screens/Agents/Agents.test.tsx` 通过：3 个测试文件、21 个用例。
- `npm.cmd run typecheck` 通过。
- 测试覆盖自定义远程 Hermes：临时 API 密钥参与连接测试与受保护存储，但不会进入保存的 Runtime 定义。

## 2026-07-26：多智能体协作任务改为“原任务对话 + 自定义分工”

### 产品约束

- 协作任务不是独立的项目管理页面，而是在原任务对话上增加协作分工；单智能体任务保持默认路径不变。
- 角色、承担智能体、职责和共享上下文均为任务级数据，用户可逐行新增、编辑和移除，不再限定“负责人/实施/测试/复核”四个预设角色。
- 协作设置完成后，原任务对话顶部显示默认折叠的“协作分工”区；展开可回查角色、智能体、职责和共享上下文。

### 已完成实现

- `TaskCollaborationAssignment.role` 已从固定枚举调整为受长度限制的自定义字符串；协作存储同时支持旧记录，并为新角色行保存稳定 id。
- 协作设置面板保留三个可编辑的常用初始行，但不限制角色名称；支持“添加角色”和逐行移除。
- 智能体选择行会同步显示该 Runtime 已配置的头像、名称与颜色，提升跨智能体辨识度。
- 点击“发送并启动”后，用户可见的任务消息保持原文；平台为每个已选择 Runtime 分发同一份受控协作提示，其中包含完整角色表、各自职责、共享上下文、关联项目目录和任务说明。
- 非当前 Runtime 的结果会以该智能体的头像、名称和角色标识汇入同一个 Runtime 任务对话。提示中明确要求智能体不要用未登记的 subagent 取代平台已分配角色。

### 安全与边界

- 仅向用户在角色行中明确选定的智能体派发；“暂不指定”的行不会运行。
- 分发沿用当前任务的只读/完全访问权限与项目目录，未扩大已有 Runtime 权限。
- 首版只在协作任务启动时做一次并列分发；后续跨角色自动追问、依赖编排、取消汇总和结果验收仍需要下一轮专门实现，不能假装已经具备自动项目经理能力。

### 回归验证

- `npm.cmd test -- TaskCollaborationDialog.test.tsx RuntimeChat.test.tsx` 通过，9 个用例。
- `npm.cmd run typecheck` 通过。

## 2026-07-26：协作任务实测诊断（待进入协作编排 Phase 2）

### 实测任务

- 项目目录：`D:\Users\chenfl\Desktop\test`
- 任务：`协作测试`
- 分工：Pi（项目负责人/验收）、Claude（实施）、Hermes（测试）。

### 已确认问题

- Pi 会话收到完整分工提示，但 Claude、Hermes 没有收到同一任务说明；本次实际只运行了 Pi。
- Pi 在首轮正确说明“平台未实际派发”且自身仅有只读工具；用户后续发送“批准，请落地交付”后，Pi 将其理解为可代替实施与测试角色执行，因此自行写入、测试并验收，产生了“报告显示多人完成、实际单人完成”的假闭环。
- 本次协作配置在 `task-collaborations.json` 中被写成两个记录（`runtime-conv-*` 与实际 Pi session），且两个记录的 `assignments` 都为空；运行时提示拥有正确分工，但配置无法恢复、无法展示角色状态，也不能作为后续阶段的可信来源。
- 当前实现是启动时并列 fan-out，没有子任务记录、依赖关系、产物交接、阶段门禁或跨角色结果回灌；即使分发成功，测试和验收也无法可靠等待实施产物。

### 后续改造原则

- 协作配置必须先以唯一父任务 ID 原子保存，再启动任何 Runtime；空分工不得覆盖已有非空分工，运行 session 只能作为关联字段而不能创建第二份协作记录。
- 每个角色必须生成可追踪的子运行记录，明确状态、输入、预期输出、日志、产物和失败原因；父任务仅在必要角色达到相应阶段后才推进。
- 初版采用受控顺序：负责人规划 -> 实施交付 -> 测试复核 -> 验收结论。只有在用户显式配置为并行时，才允许并列执行。
- 平台而非协调智能体负责派发、上下文封包、产物交接与状态门禁；协调智能体不得把未收到的他人结果表述为已完成，也不得以自身工作替代已登记角色。

## 2026-07-26：协作编排 Phase 1/2 实施完成

### 修复目标

- 消除同一协作任务被会话 ID、对话 ID 重复保存为多条记录的风险。
- 让用户设定的角色分工变成平台真实执行的依赖链，而不是仅写在首条提示词里的说明。

### 已完成实现

- `task-collaborations.json` 现在以任务 `taskId` 作为唯一父记录；Runtime 对话 ID 与 Hermes session ID 只作为该父记录的关联字段，不再创建第二条协作记录。
- 存储层禁止“空角色数组”覆盖已经保存的非空角色配置；未配置任何执行智能体的协作任务不能进入 `active` 状态。
- 每个已分配角色都会保存平台生成的执行记录：角色、Runtime、启动/完成时间、Runtime run ID、真实交接摘要、失败原因和阻塞状态。
- 首版调度采用严格串行门禁：按用户配置顺序运行。前一角色成功后，平台把其真实输出作为限定长度的交接材料发送给下一角色；中间角色失败、不可用或取消时，未开始角色标记为“已阻塞”，不会被静默跳过或由其他智能体代办。
- 协作提示明确禁止角色越权、虚构其他角色完成状态和创建未登记 subagent；仅职责包含实施/开发/交付等语义的角色，在用户选择“完全访问”时才获得写入权限，其余角色保持只读。
- 原任务对话顶部的默认折叠“协作分工”区会显示每个角色的 `待执行 / 执行中 / 已交接 / 失败 / 已阻塞` 状态；所有角色消息仍汇入同一任务时间线并保留智能体头像、名称和角色。

### 自动化验证

- 新增 `tests/task-collaboration-store.test.ts`：覆盖空配置保护、唯一父任务关联和无执行智能体时拒绝启动。
- 扩展 `RuntimeChat.test.tsx`：覆盖三个 Runtime 的严格启动顺序、真实交接材料传递，以及中间角色失败后阻止后续角色派发。
- `npm.cmd run typecheck` 通过。
- `npm.cmd test -- --run tests/task-collaboration-store.test.ts src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx` 通过：2 个测试文件、12 个用例。

### 仍需真实联调的边界

- 旧的“test / 协作测试”历史记录当时已将角色配置保存为空，无法安全地从 Pi 的自然语言回复反向推断职责；历史不删除，但需重新配置角色后再运行。
- 当前是安全的串行 MVP；并行依赖图、人工批准后继续、跨 Runtime 取消汇总、统一产物提取和正式验收看板属于下一阶段，不能被视为已完成。

### 全量回归基线

- `npm.cmd test -- --run`：1,848 个用例中 1,831 个通过、13 个跳过、4 个失败。
- 失败项均不属于本次协作编排改动：两项断言仍使用未包含 Pi Agent CLI 的旧文案（`project-control`、`task-schedules`）；一项计划任务页面测试仍期待旧标题；一项 Gateway 重启测试在 50ms 健康检查窗口内超时，属于既有时序不稳定项。
- 本次新增的协作存储与顺序编排定向测试全部通过；后续处理上述基线失败时，应作为独立、最小范围的修复任务，避免与协作功能混改。

## 2026-07-27：协作编排 Phase 3 - 人工介入与安全恢复

### 交互原则

- 人工介入绑定到单一角色，不作为普通任务消息广播；用户必须显式选择“同步给协作组”，后续角色才能看到该指令。
- 角色无法执行、方向偏差或需要额外资料时，协作不会伪装完成，而是停在“等待人工处理”。后续角色保持阻塞，直到用户明确恢复。

### 已完成实现

- 协作执行记录新增 `waiting_for_user`、`paused`、`retrying`、`needs_review`、`cancelled` 等角色级状态，以及任务级等待/暂停/取消状态。
- 每条人工指令持久化保存目标角色、内容、可见范围和时间；原始任务说明也保存于协作执行记录，支持重启应用后安全恢复。
- 原任务对话顶部的折叠“协作分工”区为每个角色提供“介入”入口；抽屉内可查看该角色最近的私有指令、保存新的修正要求、选择是否同步给协作组，并在适用时“保存并继续”。
- 对运行中的角色可执行“暂停此角色”；平台停止该 Runtime 后把角色转为已暂停，而非把它误判为失败或完成。
- 从等待/暂停角色恢复时，平台只从该角色重新派发，并携带此前成功角色的真实交接、该角色私有指令及用户明确共享的指令；后续角色仍须等待新的真实交接。

### 回归验证

- `npm.cmd test -- --run tests/task-collaboration-store.test.ts src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx`：2 个文件、13 个用例通过。
- 新增用例验证：私有人工指令仅传给目标实施角色，恢复后平台依次运行实施、测试；测试角色不会收到该私有指令。

## 2026-07-27：协作编排 Phase 4 - 真实产物归集与验收

### 产物口径

- 普通模型答复、思考过程和“任务已完成”等状态文本不再被当作产物。
- 平台只归集 Runtime 明确提供的工作目录、代码差异，以及工具事件中具有测试语义的真实执行结果；分别记录为文件、代码变更和测试结果。
- 每项产物都绑定来源角色、Runtime、运行记录和时间。存储层会校验角色归属、产物类型和引用 id，防止一个角色伪造另一个角色的交付物。

### 已完成实现

- 协作执行记录新增 `artifacts` 和 `acceptance`；历史记录兼容读取，新的记录可在应用重启后恢复。
- 原任务对话的协作分工区域下新增默认折叠的“产物与验收”区，集中展示真实文件、代码差异、测试结果及验收结论。
- 验收角色会收到平台整理的可追溯证据编号，而不是未经核实的上游自然语言摘要。
- 验收回复必须使用结构化格式并引用实际证据，例如 `状态：通过` 与 `依据：#1、#2`。缺少验收角色、结论格式或真实证据时，任务会停在“需人工复核”，不会伪装为成功。

### 自动化验证

- 新增协作用例：Codex 生成 worktree 与 diff、Claude Code 返回测试结果、验收角色引用实际 `#1/#2/#3` 后才可通过。
- 存储回归用例验证：无效产物类型、伪造引用会被过滤；重新加载存储后真实产物和验收结论仍存在。

## 2026-07-27：协作编排 Phase 5 - 联调与可靠性回归

### 覆盖范围

- 覆盖 Hermes、OpenClaw Bridge、Pi Agent CLI、Codex CLI、Claude Code CLI 的 Runtime 探测、任务启动、输出归档、取消、超时、失败和历史恢复契约。
- 协作层覆盖成功交接、实施角色超时后下游阻塞、人工介入后恢复、取消和重启后读取协作配置/产物/验收记录。
- 所有涉及外部服务的自动化测试均使用受控 Bridge/Runtime 模拟，不向用户已有项目目录或远程服务器派发写入任务；本地 `codex`、`claude`、`pi` CLI 已确认可解析，版本分别为 `0.144.1`、`2.1.209`、`0.82.1`。

### 本轮修复

- 将项目控制面和定时任务的测试契约更新为当前真实能力：实现型任务支持 Codex、Claude Code 与 Pi Agent CLI。
- 将定时任务页面测试标题更新为“本地智能体定时任务”和“远程 Hermes 定时任务”。仅更新过时断言，未改动 Runtime、历史、连接或凭据配置。
- 全量并发运行时，部分带临时目录/模拟网关的旧用例会相互争用并超时；串行运行后全部通过。因此未为测试噪声放宽产品超时或修改网关逻辑。

### 验收结果

- 定向跨 Runtime 契约：10 个测试文件、97 项通过。
- 产物与协作交互定向回归：2 个测试文件、16 项通过。
- 串行全量回归：`npm.cmd test -- --no-file-parallelism --maxWorkers 1`，186 个测试文件、1,839 项通过、13 项按设计跳过。
- `npm.cmd run typecheck` 通过；`npm.cmd run build` 通过。

### 明早手工验收建议

- 新建含实施、测试、验收三个角色的协作任务，确认“产物与验收”默认折叠、仅显示真实文件/差异/测试结果，验收角色需引用证据才能通过。
- 分别让 Hermes、Pi、Codex、Claude Code 执行一轮受控任务；对其中一个角色触发超时或暂停，确认后续角色阻塞且仅通过“介入”恢复。
- 重启应用并重新打开任务，确认角色配置、运行状态、产物与验收结论完整恢复。

## 2026-07-27：协作编排补强 - 权限恢复与无产物门禁

### 用户实测触发的问题

- Claude Code 在协作实施角色中以 `plan` 模式运行时无法编辑，但原“介入”抽屉只能追加文字，不能改变该角色实际的 CLI 权限；用户无法在原任务内纠正后继续。
- 编排器此前把 Runtime 的成功退出视作可交接，实施角色即使没有生成任何可核验文件或代码变更，测试角色仍可能继续执行，形成“无产物测试”。

### 本次最小范围修复

- 人工介入记录新增可持久化的、角色级 `只读 / 完全访问` 覆盖。实施类角色在介入抽屉中可选择权限后“保存并继续”；该覆盖只作用于目标角色，后续角色不会继承。Claude Code 的完全访问重试将使用其 CLI 的 `acceptEdits` 权限模式。
- 实施/开发/交付类角色成功返回后，平台现在必须先收到 Runtime 发布的实际文件或代码变更证据。没有证据时，该角色转为“等待人工处理”，后续角色标记为“已阻塞”，不会再启动测试或验收。
- Claude Code 的本地完全访问任务新增有界工作目录快照：运行前后仅比较常见项目文件（排除 `.git`、`node_modules`、构建目录等），只有检测到新增或修改文件时才发布“已写入文件”证据；模型文字声称完成不会被当成产物。

### 自动化验证

- `npm.cmd run typecheck` 通过。
- `npm.cmd test -- --run src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx tests/claude-code-runtime.test.ts tests/task-collaboration-store.test.ts` 通过：3 个测试文件、25 个用例。
- 新增断言覆盖：实施角色无真实产物时测试角色不启动；人工介入选择“完全访问”后，目标角色以 `full_access` 重新派发且仅该角色收到私有指令。

## 2026-07-27：协作入口收敛为任务内按需能力

## 2026-07-27：协作建议必须经过平台真实派发

- 排查“多智能体协作新测试”：该对话仅有 Pi 的普通 Runtime 记录，没有对应的协作记录或角色运行。Pi 在终端内自行调用其他 CLI，属于单智能体模拟协作，不能作为 Claude、Hermes 已执行的证据。
- 普通任务 Runtime 增加协作协议：需要协作时只能输出受控的结构化建议，禁止把 Shell/CLI 子进程伪装为已接入智能体协作。
- 客户端解析建议并显示“配置并启动协作”；用户仍可编辑角色、上下文和任务说明后确认。确认后沿用既有平台调度链，真实启动各 Runtime 并将每个角色的过程、答复、产物写回同一任务对话。
- 安全边界：模型文本从不自动启动协作；没有用户确认，不会创建协作运行记录或派发任何其他智能体。

### 产品决策

- Agents One 保持“对话优先”：普通任务始终是默认入口，项目只是任务对话的容器。
- 多智能体协作是少数、按需启用的执行能力，不再作为一种单独的新建任务类型，也不再通过任务右键菜单强行转换。
- 主智能体后续可以在任务对话中提出协作与分工建议；用户确认后才建立协作配置并调度其他已接入智能体。用户也可以主动从当前任务开启“协作方案”。

### 已完成实现

- 左侧项目 `+` 菜单仅保留“新建任务”；已移除“新建多智能体协作任务”。
- 任务右键菜单已移除“转为多智能体协作”，避免误将已有单智能体任务改造成协作流程。
- Hermes 及所有 Runtime 任务对话的输入工具栏新增“制定协作方案”按钮。它只打开现有的角色/智能体/职责/共享上下文配置面板，不会改动 Runtime 注册、连接配置、历史记录或项目归属。
- 用户在配置面板中确认角色并发送任务说明后，现有协作持久化与执行链路才会启用；取消面板则不会写入协作记录。
- 对已经存在的任务，协作设置保存成功后会立即同步写回当前对话的协作元数据，确保首条协作任务说明派发后，任务内的协作角色区能够正常显示。

### 回归验证

- `npm.cmd run typecheck` 通过。
- `npm.cmd test -- --run src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx src/renderer/src/screens/Layout/TaskCollaborationDialog.test.tsx` 通过：2 个测试文件、16 个用例。
- `npm.cmd run build` 通过。
- 新增断言覆盖：协作方案只能由当前任务中的用户显式点击打开。

### 后续实施边界

- 本轮只调整入口和交互边界，刻意不修改智能体注册、凭据、项目/任务存储或 Runtime 执行器。
- “主智能体自动提出结构化协作方案、用户确认后按图调度常驻智能体”是下一步编排层能力，应在独立任务中实现，并增加提案校验、用户确认和失败回退测试。

## 2026-07-27：真实协作复盘 - 跨机器工作区与角色身份

### 实测结论

- “多智能体协作新测试2”已由平台真实串行派发：Pi 负责拆分与终验、Claude Code 负责实施、远程 Hermes 负责验收。三个角色均有独立 `runtimeRunId`、运行时间、交接文本和 Runtime 事件；这不是 Pi 在终端内模拟调用其他 CLI。
- 远程 Hermes 对办公电脑本地目录 `D:\Users\chenfl\Desktop\test` 进行验收时，实际落在远程机器自身的同名路径并得到空目录。Claude 的本地写入与 Hermes 的远程验收没有共享同一个文件系统，最终“不通过”是正确且有价值的验收结果。

### 已修复

- Runtime 对话存储此前在清洗消息时遗漏了 `agentRuntimeId`、名称、头像、颜色和协作角色字段；协作消息重开后会退化为主智能体身份。现已保留这些字段，后续新协作任务会稳定显示各角色自己的名称与头像。
- 验收角色明确输出“不通过”时，协作总状态此前仍会被标记为“成功”。现已改为 `failed`，确保筛选、恢复和后续自动化不会误判任务完成。

### 待实施的最高优先级

1. **工作区可达性预检**：协作启动前逐角色标明“本地直连、远程映射、仅证据包”三种工作区访问方式；远程角色若无法访问项目路径，不允许被分派“独立文件系统验收”。
2. **可验证交接契约**：实施角色的交付除 Runtime 文件/差异证据外，增加路径、摘要、哈希和来源机器；测试角色只能验收同一可达工作区或平台生成的只读证据包。
3. **失败恢复闭环**：验收失败时在“产物与验收”中直接列出失败原因、责任角色与可执行操作（重派实施、改派本地验收、人工介入），而不是仅显示一段结论文本。
4. **协作时间线**：在折叠的协作区以 Pi → Claude → Hermes 的顺序展示开始、交接、产物、验收和阻断点，并可定位到对应角色消息，减少用户在长对话中查找的成本。

### 自动化验证

- `npm.cmd test -- --run src/main/runtime-conversation-store.test.ts src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx`：2 个测试文件、16 项通过。
- `npm.cmd run typecheck` 通过。

## 2026-07-27：协作可靠性闭环 - 可达性、证据、恢复与时间线

### 本轮目标

- 将“运行成功”与“可交接、可验收”明确拆开：跨机器工作区不可达、实施未发布可验证交付、验收引用不足时，平台必须阻断后续阶段。
- 保持对话优先和现有 Runtime 注册、历史记录、项目存储不变；改动限定在协作编排、协作元数据与协作视图。

### 已完成

- 协作角色增加工作区访问声明：`本地直连`、`远程映射`、`只读证据包`。启动前逐角色预检：远程角色不能直接使用本地路径；选“远程映射”但未提供映射路径、或实施角色只拿到证据包时，任务会在派发前进入“等待人工处理”，并给出改派本地角色或配置映射的原因。
- 协调/主负责角色在全部角色之后自动执行一次“终验汇总”。该运行只能基于实施交付和验收结论作结论，不允许自行补做其他角色的工作。
- 实施角色提示词新增交付契约，要求发布文件路径、SHA-256、来源机器与变更摘要。平台从运行输出和真实 Runtime 文件/差异中归集证据；验收角色若无法引用完整交付证据，不能得到“通过”结论。
- 验收失败面板新增三个恢复入口：`重派实施`、`改派验收`、`介入并继续`。改派验收会保留已完成实施/测试记录，仅重新运行验收及其后的终验汇总；不应继续的下游阶段保持阻断。
- 协作视图新增可折叠时间线，按预检、启动、交接、产物、验收、阻断和恢复记录事件。点击事件可滚动定位到对应角色在同一任务对话中的原始答复和工具记录。
- 运行消息增加协作角色标识持久化，重开任务时仍可被时间线精确定位。

### 自动化验证

- `npm.cmd test -- --run src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx src/main/runtime-conversation-store.test.ts src/renderer/src/screens/Layout/TaskCollaborationDialog.test.tsx`：3 个测试文件、20 项通过。
- 新增覆盖：远程实施角色仅有只读证据包时不派发；指定主负责角色会在实施和验收之后执行终验汇总。
- `npm.cmd run typecheck` 通过。
- `npm.cmd run build` 通过。

### 下一轮手工验收建议

1. 在本地项目中设置 Pi 为主负责、Claude Code 为实施、Hermes 为验收。Claude 使用“本地直连”，Hermes 先选择“只读证据包”；确认 Hermes 不会被错误派发本地路径验收，并收到改派或共享访问提示。
2. 让 Claude 生成一个真实文件，确认交付区显示路径、哈希、来源机器和变更摘要；再让验收角色引用该证据给出结论。
3. 制造一次验收不通过，分别验证“重派实施”“改派验收”“介入并继续”只影响目标阶段，且时间线能跳回各角色的原始记录。

### 2026-07-28 热修：远程证据验收误阻断

- 用户实测发现：远程 Hermes 被配置为“测试验收 + 只读证据包”时，预检错误地把职责描述中的“实施交付”理解为该角色需要写入本机目录，导致协作未启动。
- 已改为以**角色名称**优先判断写入能力：`测试/验收/复核/审核` 类角色始终作为只读证据消费者；只有实施、开发、编写等明确实施角色才要求本地直连或远程映射。
- 回归：远程“实施 + 只读证据包”仍会阻断；远程“测试验收 + 只读证据包”可正常启动。`RuntimeChat.test.tsx` 18 项通过，`npm.cmd run typecheck` 通过。

## 2026-07-28：协作流程复盘与远程本地工作区方案

### 回归结果

- 协作相关定向回归：`task-collaboration-proposals`、协作存储、协作设置面板、RuntimeChat 共 4 个测试文件、27 项通过。
- 当前端到端流程已覆盖：显式确认协作方案、逐角色派发、实施无产物阻断、证据化验收、终验汇总、验收失败恢复、重开任务与时间线定位。

### 仍需收口的风险

1. `远程映射`目前是角色配置中的引用值，不会由客户端验证远程端是否真正能访问该目录、Git 引用或共享工作区。应在派发前做能力探测/读目录探测，并把结果显示为“已验证/不可达”。
2. 当前交付契约允许从实施角色的文本输出补齐路径、哈希和摘要；模型文本不能作为哈希的最终来源。后续应优先采集 Runtime 实际发布的文件元数据，或由本机工作区代理重新计算哈希。
3. 只读证据包应由平台生成不可变清单（文件名、内容哈希、来源、时间、可选内容副本），而不是依赖用户在消息中粘贴路径和内容；远程验收只可引用该清单编号。
4. 远程智能体尚无直接、安全操作办公电脑本地项目的通道。共享盘、VPN 或 Git 引用可作为外部映射，但不是客户端自动建立的能力。

### 推荐架构：本地工作区代理（下一阶段）

- Agents One 主进程持有本地项目根目录与权限策略；远程 Hermes/OpenClaw 不获得 Windows 路径、SMB 凭据或直接入站访问权限。
- 客户端通过出站 TLS 长连接向已认证的远程 Bridge 注册短生命周期 `workspaceRef`；远程智能体只能对该引用发起受控的 `list/read/write/patch/move/delete` 请求。
- 主进程逐项执行并校验根目录约束、路径穿越、符号链接、文件大小、任务令牌和角色权限。读取可直接返回证据；创建/编辑生成前后哈希、差异和审计记录；删除始终要求用户逐次确认。
- 每个操作回写协作时间线和真实产物证据，验收角色引用本机代理计算的哈希，而非模型自行声明的哈希。
- 不能部署本地代理时，降级顺序为：受限 Git worktree/合并请求、受限共享目录（VPN/ACL）、只读证据包；不允许远程智能体直接操作任意本机目录。

### 下一阶段验收矩阵

- 本地临时项目：读取、创建、修改、删除确认、取消中断、路径穿越与符号链接拒绝。
- 远程 Bridge 模拟：令牌过期、重复操作、离线重连、超时、角色越权和审计完整性。
- 真实 Hermes/OpenClaw：仅在测试目录中验证只读证据验收与代理写入，确认远程端无法绕过项目根目录或删除确认。

### 2026-07-28：远程只读证据包接入协作执行

- 协作运行会在存在“远程 + 只读证据包”角色时，先由本机生成受限项目快照；快照准备失败或未选择项目时，协作停在“等待人工处理”，不会静默降级。
- 每份项目快照现附带平台计算的文件相对路径、入包字节数和 SHA-256 清单，远程角色可据此引用证据；不会包含本机绝对路径。
- 证据包已接入 OpenClaw 的 Bridge Artifact 上传链路和 Hermes 的受控文本附件链路，远程测试/验收角色可以基于同一份平台生成证据参与任务。
- 增加远程提示词脱敏：远程角色不会收到选定项目的本机绝对路径；前序交接和验收证据中的 Windows 路径会替换为占位符。本地角色不受影响。
- 定向回归：`RuntimeChat.test.tsx` 与 `project-context.test.ts` 共 21 项通过；`npm.cmd run typecheck` 通过。
- 已新增 [REMOTE_LOCAL_WORKSPACE_ACCESS.md](REMOTE_LOCAL_WORKSPACE_ACCESS.md)，定义只读证据包、未来出站受控写入、远程映射和安全验收边界。
- PowerMem 云记忆健康检查、写入和检索于 2026-07-28 通过；已同步本次远程证据包与出站受控工作区授权的长期设计事实。

### 2026-07-28：本机出站工作区网关基础

- 新增独立的本机工作区网关执行器：不监听端口、不暴露 SMB/HTTP 文件服务；仅由 Agents One 主进程主动向受信任 Bridge 轮询操作请求。
- 每个授权绑定任务、智能体、项目根目录、读写权限、过期时间和单次数据上限。远端注册信息只包含短时授权 ID 与能力，不包含办公电脑绝对路径。
- 首版受控操作为 `list/read/write/move/delete`：所有路径必须位于项目根目录内，拒绝路径穿越和符号链接跳转；写入拒绝覆盖冲突；删除必须回到本机单次确认后才会执行。
- 操作结果生成受限审计记录，记录相对路径摘要、状态、时间与结果哈希；不记录 Token、完整请求头或本机绝对路径。
- 新增 [OUTBOUND_WORKSPACE_GATEWAY_BRIDGE_REQUIREMENTS.md](OUTBOUND_WORKSPACE_GATEWAY_BRIDGE_REQUIREMENTS.md)，明确 Hermes/OpenClaw Bridge 需要提供的能力发现、授权注册、长轮询取件、结果回传、撤销和审计协议。

### 自动化验证

- `npm.cmd test -- --run tests/remote-workspace-gateway.test.ts`：4 项通过，覆盖根目录逃逸、只读授权、写入哈希冲突、删除确认、出站注册不泄露根路径、轮询执行与撤销。
- `npm.cmd run typecheck:node` 通过。

### 待联调

1. Hermes/OpenClaw Bridge 按协议实现 `/workspace-gateway` 能力端点，并在 capabilities 中显式声明支持。
2. 桌面端仅在用户对具体远程任务明确授予权限且 Bridge 探测通过后，创建短时授权并启动轮询；普通远程对话继续保持只读证据包。
3. 首次真实联调限定在测试项目目录，覆盖读取、创建、哈希冲突、取消、过期和删除本机确认；通过后再接入协作编排。

### 2026-07-28：远程受控工作区生命周期接入

- Hermes 与 OpenClaw 已分别声明并完成 `outboundWorkspaceGateway` 协议测试；桌面端已接入每任务短时授权、主动轮询、受控执行、结果回传和任务结束自动撤销。
- Runtime 可选配置独立的受控工作区网关地址；这用于 OpenClaw 的独立 `/workspace-gateway` 服务，避免误拼接到其 `/oc-bridge` 地址。网关 Token 独立保存到受保护的本机连接配置，绝不写入 Runtime JSON、日志或对话。
- 首版只允许 `list/read/write/move/delete` 结构化请求。删除仍只回传“需要本机确认”，不由远程侧自动执行。
- 下一步：为已配置的远程 Hermes/OpenClaw 执行真实测试目录的只读与写入测试，再将同一受控访问方式接入协作角色调度。

### 2026-07-28：Gateway 协议联调准备完成

- 远程 Hermes Bridge 已完成 `/hermes-api/workspace-gateway` 的能力声明、短时授权、请求入队/拉取、结果回传、撤销和审计接口；远程 OpenClaw 已完成独立 `https://<host>/workspace-gateway` 服务的同等协议。两端均已在服务器侧完成安全回归。
- 桌面端适配两种部署形态：Hermes 可从常规 API 地址推导 `/workspace-gateway`；OpenClaw 可单独填写完整网关地址，避免把独立服务错误拼到 `/oc-bridge` 下。
- 远程任务选择项目目录并显式授予只读或完全访问后，桌面端会探测能力、创建与任务绑定的短时 Grant、主动轮询队列、在本机项目根目录内执行结构化操作、回传结果，并在任务结束/取消时自动撤销 Grant。Grant、审计和对话不会保存本机绝对路径、Token 或完整文件内容。
- 本轮验证：`tests/remote-workspace-gateway.test.ts` 与 `AgentRuntimesPane.test.tsx` 共 12 项通过；`npm.cmd run typecheck` 与 `npm.cmd run build` 通过。

### 真实验收前置条件

- Gateway HTTP 接口可用并不等于远端模型已经具备操作本机项目的能力。远程 Hermes/OpenClaw 还必须把 `workspaceRef` 绑定为真实工具：模型发起 `list/read/write/move/delete` 时，Bridge 使用 Grant 向相应 `/workspace-gateway` 队列提交结构化请求，而不是让模型输出本机路径或直接运行 Shell。
- OpenClaw 当前声明的独立 Gateway 服务不会自动修改 OpenClaw Gateway 的工具注册；需要在 OpenClaw 端单独注册该工具/适配器。Hermes 也需要确认其 Bridge 在收到 `workspaceRef=desktop-gateway:<grant>` 时会调用相应接口。
- 首次真实验收仅限测试目录的 `list/read` 与新文件 `write`。删除确认的本机交互界面尚未接入，首版会安全地返回“等待本机确认”，不会自动删除。
- 本轮长期设计事实已同步至 PowerMem 云记忆；本地日志仍作为可审计的完整记录。

## 2026-07-28：统一远程接入协议定稿 - Agents One Remote Gateway v1

### 产品决策

- 后续每个远程智能体在 Agents One 中只保留一个 Gateway 地址和一个 Bearer Token。名称、头像、ID、类型仍可按用户偏好自定义。
- Hermes API、Dashboard、OpenClaw Bridge、独立 Workspace Gateway 等多地址、多 Token 只允许作为远端 Adapter 的内部实现；桌面端不再感知或要求这些私有配置。
- 本地 CLI Runtime（Codex、Claude Code、Pi Agent）不迁移到 Gateway，继续采用本地进程适配器。

### 规范产物

- 新增 [AGENTS_ONE_REMOTE_GATEWAY_V1.md](AGENTS_ONE_REMOTE_GATEWAY_V1.md)，定义统一配置、能力发现、Run、SSE 事件、Artifact、工作区 Grant、协作交接、鉴权、安全、兼容迁移和一致性验收。
- Gateway v1 明确区分“接口服务存在”与“远端模型拥有真实工具”。只部署请求队列不算完成；远端 Runtime 必须把 `workspaceRef` 绑定为结构化 `workspace_gateway` 工具，并等待本机的真实结果哈希。
- 迁移采用新增统一 Adapter、保留旧配置、用户主动验证、可回退的顺序；禁止客户端自动覆盖或删除现有 Runtime 凭据、项目、任务和对话历史。

### 下一步

1. Hermes 与 OpenClaw 分别在远端部署 `/agents-one/v1` Adapter，将现有私有端点归一化并签发单一 Gateway Token。
2. Agents One 客户端新增统一 Gateway Runtime 连接模式和 v1 capabilities 探测；旧 Hermes/OpenClaw 配置保持兼容。
3. 用单地址/单 Token 完成 Hermes、OpenClaw 的对话、任务、产物与受控本机工作区真实验收，再逐步将 Claude Code 等远程 Runtime 接入同一协议。

### 本地 CLI 边界确认

- 用户确认本地接入 Codex CLI、Claude Code CLI、Pi Agent CLI 的目标是获得更好的可视化、交互、历史、产物和项目协作体验，而不是减少 CLI 的原生能力。
- 因此本地 CLI **不接入** Agents One Remote Gateway v1，也不使用远程 Grant 或单地址/Token 模型。它们继续由本地 Runtime Adapter 直接启动，保留原生会话、工具、子智能体、终端、工作目录和权限语义。
- 统一的是上层的 Runtime 生命周期与事件呈现：Agents One 将原生输出映射为工具卡片、思考摘要、产物和状态；未能结构化的内容保留可折叠原始记录，避免 UI 优化造成信息或功能损失。

### 统一 Gateway 试点策略

- 先接入一个全新远程智能体作为 Gateway v1 试点，不修改 Hermes、OpenClaw 或现有客户端连接配置。
- 新增 [AGENTS_ONE_REMOTE_GATEWAY_V1_PILOT_GUIDE.md](AGENTS_ONE_REMOTE_GATEWAY_V1_PILOT_GUIDE.md)，按“对话与 SSE → 产物 → 受控本机工作区”的递进顺序实施和验收。
- 试点通过后，Hermes、OpenClaw 只需按同一 Adapter 契约适配；客户端不再为每个 Runtime 发明新的连接表单或凭据字段。

### CGNAT 远程智能体接入策略

- 家庭电脑等无公网 IP Runtime 不采用逐台反向代理或端口映射；Gateway v1 增加“出站 Agent Connector”部署 Profile。
- 家庭电脑上的 Connector 主动通过加密长连接连接公网 Agents One Relay；桌面端仍只配置 Relay 的一个地址和一个 Gateway Token，不感知家庭网络、IP、DDNS 或设备内部凭据。

### 2026-07-29：统一 Gateway 接入界面第一阶段

- “新增/管理智能体”对远程 Runtime 增加 **统一 Gateway (v1)** 与 **兼容模式** 两种协议选择。统一模式只显示 `Gateway 地址` 与 `Gateway Token`，不显示 Hermes API、Dashboard、独立工作区网关或其内部凭据。
- 统一模式的连接测试固定请求 `<gatewayUrl>/capabilities`，要求返回 `protocolVersion: 1.x` 和结构化能力声明；HTTP 200 但不符合 v1 合约会明确拒绝，不会误标为健康。
- Gateway Token 使用受保护的本地密钥存储，运行时定义、项目记录、列表数据与日志均不保存 Token。已有 Hermes/OpenClaw 兼容配置不迁移、不覆盖，也不会因为切换 UI 而删除。
- 当前完成范围是“安全配置 + capabilities 探测”。首个 Relay 提供真实地址后，再按 v1 `/runs`、SSE 事件、取消、Artifact 和短时 Workspace Grant 进行真实联调；在此之前不把统一 Gateway 伪装为已具备正式任务派发能力。
- Connector 只转发规范化的 Run、事件、Artifact 和受控工作区消息，不成为任意 TCP 隧道、Shell 通道或远程文件服务器。

### 2026-07-29：家庭电脑 Hers Gateway v1 首次真实运行验收

- 发现并修复自定义远程 Hermes Runtime 的路由缺陷：过去前端按 `kind === hermes` 直接进入内置 Hermes Profile 对话，导致 Hers 等用户自定义 Hermes 被错误发送给默认 Hermes，且不会使用 Runtime 对话持久化层。
- 路由现改为只有 `managed: builtin` 的内置 Hermes 使用旧 Profile 对话；所有用户接入的 Runtime（包括 Hermes 类型）都会创建携带 `runtimeId` 的独立 Runtime 对话，因此保留自身名称、头像、会话和任务记录。
- Gateway v1 桌面端已补齐正式 Run 生命周期：`POST /runs`、`GET /runs/{id}` 轮询、`POST /runs/{id}/cancel`，并映射状态、答复、错误和结构化产物。远端没有返回 `conversationId` 时，客户端仍以本地 Runtime conversation ID 保存历史；后续消息会携带已保存的上下文，不会丢失左侧记录。
- Hers（家庭电脑 Relay）真实验收：`/capabilities` 返回 `protocolVersion=1.0`，声明 conversation 与 task 的启动/查询/取消能力；发送最小 conversation Run 后由 `queued` 成功结束为 `succeeded`，收到预期答复，未产生 Artifact。测试过程未输出或保存 Gateway Token。

### 2026-07-29：Hers 项目对话与会话连续性复测

- 修复统一 Gateway 对话误阻断：桌面端选中本地项目不再等同于已经授予远程工作区权限。未建立 Workspace Grant 时，普通对话继续以只读模式运行；客户端不会向远端发送本机绝对路径或文件内容。
- 远程 Gateway 对话会继续在本地保存项目关联，确保任务记录显示在对应项目下；项目关联仅是桌面端元数据，不代表远端获得目录访问权。
- 在 Workspace Grant 尚未接入前，统一 Gateway 的“完全访问”入口禁用并明确提示，避免界面承诺实际不存在的本地文件读写能力。
- 自动化回归：`tests/agent-runtimes.test.ts` 与 `RuntimeChat.test.tsx` 共 35 项通过；Electron 主进程、Preload 和 Renderer 生产构建通过。
- Hers Relay 双轮 Run 均成功，且每轮均返回非空 `conversationId`。Relay 当前采用逐轮更新 continuation token 的形式，桌面端可以保存最新值。
- 随机标记连续性测试未通过：第二轮没有召回第一轮标记。说明 Relay 已补充 `conversationId` 字段，但尚未把传入的 `conversationId` 绑定/恢复到同一个 Hermes 会话。家庭端需继续修复会话映射后再进行连续对话验收。

### 回归结果

- `npx.cmd vitest run src/renderer/src/screens/Layout/chatRuns.test.ts tests/agent-runtimes.test.ts`：29 项通过，覆盖自定义 Hermes 不回退、Gateway v1 Probe、Gateway v1 Run 派发、旧 Hermes 流式回归。
- `npm.cmd run build`：TypeScript Node/Web 校验与 Electron-Vite 生产构建通过。

### 当前边界

- Gateway v1 的对话、任务、轮询、取消和 Artifact 回传已进入桌面端；SSE 将作为性能优化接入，轮询是当前可靠的兼容路径。
- Gateway v1 的本机工作区 Grant 尚未复用旧 Hermes/OpenClaw 私有 `/workspace-gateway` 实现。用户为 Gateway v1 Runtime 选择本机项目目录时，客户端会明确阻断并提示使用只读上下文包，直到 `workspace-grants` 统一协议完成，避免误把请求发送到旧私有端点。

### 2026-07-29：Hers Workspace Grant 真实协议探测

- Hers Relay 已声明 `outboundWorkspaceGateway.enabled: true`，且统一 Gateway 的 `/workspace-grants` 注册、拉取和撤销路由真实存在；测试 Grant 已成功创建、拉取空队列并撤销，全程未发送本机绝对路径、文件内容或输出 Token。
- 当前 Relay 声明仍缺少 `operations`、`maxOperationBytes`、`maxGrantSeconds`，尚不足以让客户端按能力边界开放“完全访问”。
- Relay 与 Gateway v1 当前契约存在四项差异：注册要求额外的 `workspaceRoot`；Relay 改写客户端 Grant ID；拉取响应使用 `requests: []` 批量结构而非单条 `request`；服务端过期时间未按客户端请求的短时授权收紧。
- 因此“完全访问”继续保持禁用。开放条件是：Relay 对齐统一 Grant 契约、远端 Runtime 将 `workspaceRef` 绑定为真实结构化工具、桌面端把 v1 Grant 接入现有受控本机执行器，并通过临时测试目录的读取、写入、哈希冲突、撤销、过期和删除确认回归。

### 2026-07-29：桌面端 Gateway v1 Workspace Grant Adapter

- 统一 Gateway 已复用既有的 `OutboundRemoteWorkspaceGateway` 本地安全执行器，并将兼容端点映射为 v1 的 `/workspace-grants`。路径约束、符号链接拒绝、单次大小限制、SHA-256 冲突检查、删除逐次确认和审计逻辑未重写。
- Gateway v1 Runtime 关联本机项目后，桌面端会使用同一 Gateway 地址和 Token 探测完整能力、注册短时 Grant、主动拉取结构化请求、在授权根目录内执行并回传结果；`workspaceRef` 采用 `desktop-gateway:<grantId>`，本机绝对路径不出站。
- “完全访问”改为能力门控：只有远端完整声明 `list/read/write/move/delete`、`maxOperationBytes` 和 `maxGrantSeconds` 后开放。仅声明 `enabled: true` 仍保持只读，避免能力误判。
- 远程 Gateway 任务默认超时由 5 分钟调整为 30 分钟，允许显式配置到 60 分钟。Run 状态轮询增加指数退避和 120 秒恢复窗口，短暂 Relay/Connector 断连不再立即终止任务。
- 新增 [HERS_GATEWAY_V1_WORKSPACE_GRANT_ALIGNMENT.md](HERS_GATEWAY_V1_WORKSPACE_GRANT_ALIGNMENT.md)，记录 Hers 当前能力声明、Grant ID、`workspaceRoot`、pull 响应、到期时间、真实工具绑定和长任务保留等对齐要求。
- 自动化验证：Gateway/Runtime/RuntimeChat 3 个测试文件共 41 项通过；Node 与 Web TypeScript 检查通过。

### 2026-07-29：Hers Workspace Gateway 真实端到端验收

- 修复 Hers 旧 HTTP 地址和自签名 HTTPS 的兼容问题：Runtime 已切换为 HTTPS；Gateway 与 Workspace Grant 请求仅在识别到明确的自签名证书错误时使用受限重试，普通证书、网络和协议错误不会被放宽。
- 增加 `scripts/verify-hers-workspace-gateway.js`，使用受保护配置发起真实 Grant、Run、请求拉取、文件操作核验和撤销，不打印 Token，也不采信模型口头完成声明。
- 两轮真实测试均完成 Grant 注册与撤销，但桌面端未收到任何 `list/read/write` 请求，测试文件未生成；远端却返回“全绿”。结论：Hers Relay 只完成了能力声明和队列接口，Connector 尚未向 Hermes 注入真实 `workspace_gateway` 工具。
- 客户端新增终态验收闸门：已建立 Workspace Grant 的远程 Run 若返回成功但审计中没有任何真实工作区操作，将改判失败并提示检查 Relay 工具绑定；同时正常执行 Grant 撤销，避免授权仅依赖过期自动清理。
- 自动化验证：`tests/remote-workspace-gateway.test.ts` 与 `tests/agent-runtimes.test.ts` 共 22 项通过；完整生产构建通过。

### 2026-07-30：Hers 真实工具绑定端到端复测

- Hers 声明完成 `workspace_gateway` 工具绑定后，重新执行真实 Grant/Run/list/read/write/SHA-256/撤销测试。
- 标准 Grant 注册返回 `201 active`，并保留桌面端生成的 ID；测试脚本新增返回 ID 校验和独立 `conversationId`，防止 Relay 替换授权或误复用旧会话。
- 标准 `input.workspaceRef=desktop-gateway:<grantId>` 仍被 Connector 判定为“当前会话未关联 Grant”，操作统计为 `list=0, read=0, write=0`。
- 兼容诊断确认：顶层 `workspaceRef` 被严格模式拒绝；裸 `grantId` 虽触发工具操作，但 Relay 将刚注册的有效 Grant 错判为 `grant_revoked`。
- 结论：桌面端 v1 字段、注册顺序和 Grant ID 正确；当前阻塞在 Hers Relay/Connector 对 `workspaceRef` 的解析，以及 Run/工具队列之间未共享同一 Grant 状态。完整远端修复清单已更新至 `HERS_GATEWAY_V1_WORKSPACE_GRANT_ALIGNMENT.md`。

### 2026-07-30：Hers Grant 状态关联修复后二次验收

- 再次运行完整端到端测试，真实 Run 中的工具仍返回 `grant_revoked`，未产生桌面端 `list/read/write` 请求或测试文件。
- 新增独立状态探针，不经过 Hermes 会话直接验证同一 Relay：Grant 注册 `201 active`、请求入队 `202`、桌面拉取 `200` 且获得真实 `list` 请求，证明 Relay Grant 数据库和队列本身正常。
- 根因已收敛到 Connector 的运行时绑定：它仍复用上一轮已撤销 Grant，未在每个新 Run 上使用当前 `input.workspaceRef` 创建独立工具上下文。
- 保持安全边界：桌面端不会通过延迟撤销、复用旧授权或发送裸本机路径规避该问题。Hers 必须改为 Run 级 Grant 绑定后再验收。

### 2026-07-30：Hers Run 级 Grant 绑定修复后验收

- Run 级绑定已真实打通：完整测试观察到桌面端执行 `list=1`、`read=1`，不再出现“会话未关联 Grant”或复用旧 Grant 的问题。
- 完整验收仍未通过：Relay 把标准 `permission: "write"` 注册成 `permissions.write=false`，真实写入被 `permission_denied:write_required` 拒绝，未生成验收文件。
- 协议探针确认标准结果体中的 `data` 被 Relay 丢弃，结果查询返回 `result:null`；只有非标准 `result` 字段会被保存，导致 Hers 无法读取桌面端返回的目录和文件内容。
- `denied` 结果状态仍被 Relay 以 `400 invalid_status` 拒绝；Connector 还尝试调用未声明的 `hash` 操作。相关修复要求已写入 [HERS_GATEWAY_V1_WORKSPACE_GRANT_ALIGNMENT.md](HERS_GATEWAY_V1_WORKSPACE_GRANT_ALIGNMENT.md)。
- 自动验收脚本新增权限保真和结果载荷往返断言，今后会在协议入口直接失败，不再等待长任务结束后才暴露错误。
- 本机回归保持正常：`tests/remote-workspace-gateway.test.ts` 与 `tests/agent-runtimes.test.ts` 共 22 项通过。

### 2026-07-30：Hers Gateway v1 Workspace Grant 正式验收通过

- Hers 完成权限映射、标准 `data` 结果载荷和状态枚举修复后，完整真实 E2E 首次通过。
- 测试 Run `run_63a334d1be3e46789dca161b72087365` 产生并完成 `list=1`、`read=1`、`write=1`，没有使用模型口头声明代替本机证据。
- 办公电脑授权目录真实生成 `agents-one-gateway-e2e.txt`；独立读取确认内容为 `Agents One Gateway v1 E2E passed`，大小 32 字节，SHA-256 为 `1d2d9765d1c2a8aaa2c7bb8db02c2efebc18e85a284de81dc0d81378e0e346c5`。
- 失败路径补充验证通过：Relay 接收 `denied` 返回 HTTP 200，结果查询保持 `denied`；短时 Grant 在测试结束后主动撤销。
- 桌面端 `remote-workspace-gateway` 与 `agent-runtimes` 回归共 22 项全部通过。
- 结论：Hers 已成为首个完整通过 Agents One Remote Gateway v1 对话、Run 和受控本机工作区读写闭环的远程智能体。

### 2026-07-30：后续发布前推进方案与 Hers 复验

- 新增 [AGENTS_ONE_NEXT_STAGE_PLAN.md](AGENTS_ONE_NEXT_STAGE_PLAN.md)，将后续工作收敛为：安全基线、统一任务对话界面、Hermes/OpenClaw Gateway v1 迁移、任务与项目软归档、客户端备份恢复、发布前回归与体验收口。
- 强制最小化变更原则：展示层不得修改 Runtime 注册、受保护凭据、项目关系和消息持久化；Gateway 迁移保持既有 `runtimeId`，禁止以删除重建方式迁移智能体。
- 独立验证脚本 Run `run_229c17e43e3b4c71a03b986808db3b27` 成功完成 `list=1`、`read=1`、`write=1`，生成 `agents-one-gateway-e2e.txt`，SHA-256 为 `35628d96ca85a6a6c56cf8ee5dc813d44e0c558c5ecfa7966ea7e59690776248`，随后主动撤销短时 Grant。
- 新建任务复测仍出现 `Workspace request id is invalid`，证明脚本覆盖的直接协议路径与桌面运行时 `pull` 响应形状不完全一致，原先将截图判定为旧错误的结论已撤回。
- Hers Relay 审计确认：请求 `req_58b33b8ddc97480c` 已入队且被桌面拉取；桌面回传结果的 `requestId` 却为空，导致结果查询持续 404。根因是 Relay 返回 `requestId`，而桌面轮询器此前只读取 v1 标准字段 `id`。
- 修复：桌面端在受控工作区请求适配层优先读取 `id`，仅在缺失时兼容读取同一服务端标识 `requestId`；若两者同时存在但不同则拒绝。该修复不创建、不修改请求标识，不放宽任何路径、权限或操作校验。`tests/remote-workspace-gateway.test.ts` 新增兼容回归，Node TypeScript 校验通过；待重启应用后以新任务执行真实复测。

### 2026-07-30：Hers 续聊编辑与新建文件修复

- 复现“首轮读取成功、同一对话后续编辑与新建失败”：桌面端每轮都会建立新的短时 Workspace Grant，但续聊请求此前使用 `mode=conversation`。Hers 只在任务运行入口挂载本轮 `workspace_gateway`，因此第二轮虽然保留了会话上下文，却没有重新挂载新 Grant。
- 最小修复：存在 `input.workspaceRef` 时固定以 `mode=task` 启动本轮 Run；对话连续性继续由 `conversationId` 保留。没有 Workspace Grant 的普通续聊仍使用 `mode=conversation`，不改变既有对话行为。
- 新增序列化回归测试，确认带 Grant 的续聊保留 `conversationId` 和 `workspaceRef`，同时发送 `mode=task`；无 Grant 的续聊保持 `mode=conversation`。
- 新增真实双轮验证脚本 `scripts/verify-hers-workspace-continuation.js`：第一轮 `list=1/read=1` 后撤销 Grant；第二轮沿用同一 `conversationId`、注册新 Grant，实际执行 `read=3/write=2`，成功保留并编辑已有文件，同时新建另一份 Markdown 文件。
- 自动化验证：Gateway、Workspace Gateway、Runtime 三个测试文件共 25 项通过；Node TypeScript 检查通过。Agents One 已以原用户数据目录重新启动并加载修复。

### 2026-07-30：远程删除逐次授权

- Hers 已通过 Gateway v1 完成项目文件读取、编辑和新建；删除测试被 Relay 以 `permission_denied:delete_required` 提前拒绝，桌面端未收到删除请求。
- Agents One 在既有受控工作区执行器上增加本机逐次确认：远端删除请求被拉取后，办公电脑显示智能体名称与项目内相对路径；仅“允许本次删除”会继续执行，关闭、取消或拒绝均不删除。
- 用户允许后仍会重新检查 Grant 有效期、写权限、路径边界和 `expectedSha256`，防止确认期间文件被替换；不会把本机绝对路径或长期删除权限交给远端。
- Gateway v1 权限保持 `read/write` 两级。`permission=write` 且 `operations` 包含 `delete` 表示允许提出删除申请，不代表自动删除；Relay 不得要求私有的 `delete_required` 权限，应把请求入队并等待桌面端最终 `succeeded/denied` 结果。
- 回归验证：Workspace Gateway 与 Runtime 测试共 25 项通过，覆盖允许删除、拒绝删除、结果 `requestId` 回传和既有读写行为；Node TypeScript 检查通过。

### 2026-07-30：任务对话框展示层统一收口

- 产品基线明确为“原生 Hermes 丰富事件展示”：思考、工具、技能、文件和终端事件继续使用现有图标、动画、折叠结构；本地 CLI、OpenClaw 和 Gateway v1 远程智能体统一转换到同一套展示组件，不再各自维护一套对话布局。
- 修复首轮消息顺序：仅对会话开头、尚未出现用户消息前的智能体跟踪事件做展示层重排，确保首条用户消息先出现，再展示本轮思考、工具调用和答复；不修改远端原始事件、时间戳和持久化内容。
- 统一身份展示：消息区和顶部任务标签使用用户配置的智能体名称、头像和颜色；运行中在头像外增加活动环，保留工作反馈感，不再用活动圆圈替代智能体身份。
- 上下文容量映射补充 GLM-5.2 `1,000,000` tokens，容量仪表按模型元数据计算；长期方案仍应由 Runtime/Gateway 能力响应上报模型与上下文上限，静态映射只作为兼容回退。
- 输入区收敛为：上传文件、上下文文件夹、访问权限、模型、网页预览、发送。移除上传按钮后的多余分隔线、协作方案快捷入口、右侧任务侧栏按钮及对应侧栏；访问权限按钮采用无边框样式。
- 原生 Hermes 的“完全访问”保持禁用，并明确提示迁移到 Gateway v1 后开放，避免界面允许但底层没有真实权限约束。CLI 和 Gateway Runtime 继续沿用各自已实现的权限执行逻辑。
- 严格遵守最小变更边界：本轮仅修改 Renderer 展示、事件排序和模型容量元数据，没有修改智能体注册、受保护凭据、会话持久化、Gateway 协议、Workspace Grant、Runtime Adapter 或历史数据。
- 自动化验证：ChatInput、ActiveSessionsBar、RuntimeChat、消息排序和上下文容量 5 个测试文件共 34 项通过；完整 TypeScript 检查和生产构建通过。
- 实际页面验收：在 1440×900 桌面视口检查新任务与既有 Hers 任务，确认无横向溢出，顶部与消息区显示 Hers 配置头像，丰富工具/思考记录保留，输入工具顺序正确，右侧任务栏和废弃按钮不再出现。

### 2026-07-31：统一细粒度智能体事件协议基线

- 新增 [Agent Event Stream v1](AGENT_EVENT_STREAM_V1.md)，以 Hermes Dashboard 的可见反馈为基线，统一 `reasoning.summary`、工具、技能、MCP、终端、受控工作区、真实产物与协作交接事件；协议明确禁止传递原始思维链、高频快照、Token、绝对路径和完整敏感内容。
- Gateway 的 `GET /runs/{runId}` 现在可兼容读取有界 `events`、真实模型和用量元数据；桌面主进程会按稳定事件 ID 去重并转换到既有 Hermes 风格运行时间线。旧 Gateway 不返回事件时仍沿用最终答复路径，不会因增强展示破坏已有接入。
- 新增 [插件实施指南](AGENT_EVENT_STREAM_PLUGIN_GUIDE.md)，规定 Hers Relay、OpenClaw Gateway 及 Pi/Codex/Claude Code 本地 CLI Adapter 的映射边界、断线恢复、身份显示、脱敏和验收夹具；本地 CLI 保持原生调用能力，协议只约束其到 UI 的事件输出。
- 这是一层独立的协议与展示基础设施：未修改智能体注册、受保护凭据、会话/项目持久化、Workspace Grant 或历史数据。实际 Hers/OpenClaw 插件需按指南实现后，才能把真实细粒度事件带到桌面端。
- 自动化验证：新增远程 Gateway 事件快照解析和旧 Gateway 无事件兼容回归；与 Event Stream 归一化测试、Gateway 合同测试共同执行，待本轮代码完成后统一复验。

### 2026-07-31：Agents One Plugin SDK 预览实现

- 新增独立包 `plugins/agents-one-plugin`，提供 Remote Gateway Host、Local CLI Adapter、事件脱敏/去重/有界日志、Hermes/Hers、OpenClaw 和 JSONL CLI 映射示例，以及机器可读的 `agents-one-plugin.manifest.json`。
- Remote Gateway Host 实现 Bearer Token 校验、`/capabilities`、`/runs`、`/runs/{id}`、取消和事件增量读取；它将供应商 Run 映射为 Gateway v1 与 Agent Event Stream v1，而不会改写 Hermes/OpenClaw/Hers 的原生工具权限或工作区能力。
- Local CLI Adapter 只通过非 Shell 参数数组启动本机 CLI，处理 JSONL/Hook 分段输出，保留用户可见的推理摘要、工具、技能、MCP、产物和终态事件；它不使用 Gateway Token，也不会限制 Codex、Claude Code 或 Pi 的原生能力。
- 安全边界：原始思维链、凭据、绝对路径及未脱敏完整输出不进入事件流；真实文件、代码变更和测试报告才会作为 artifact。远程写入仍必须走 Workspace Grant，插件本身不会绕过桌面端逐次删除确认。
- 验证：插件独立 Node 测试 3 项通过（稳定事件去重/脱敏、Gateway Run 终态、CLI 分段 JSONL）；桌面端 `agent-event-stream` 与 `agents-one-remote-gateway` 回归 6 项通过，Node/Web TypeScript 检查通过。

### 2026-07-31：插件化新增智能体连接测试

- 新增智能体仍只需要填写 Gateway 地址和 Gateway Token；桌面端不会远程安装或保存插件代码。
- Gateway 的连接测试会读取 `/capabilities` 中可选的插件身份。`agents-one-plugin-sdk` 会声明版本、`remote-gateway` 类型及细粒度事件流能力，供用户确认远端已按统一规范适配。
- 这项识别信息仅存在于探测结果，不进入 Runtime 保存、受保护凭据、项目关系、会话历史或任务持久化路径。
- 新增 [Hers 插件安装说明](HERS_AGENTS_ONE_PLUGIN_INSTALL.md)，涵盖无密钥插件包分发、Relay 事件映射、Gateway v1 探测和 Workspace Grant 验收。

### 2026-07-31：Hers 从 Relay 迁移到 Plugin Adapter

- Hers 已将旧 `relay.py` 的能力迁移至 Node `plugin-adapter.mjs`；共享 `agents-one-plugin` SDK 包保持未修改，便于后续独立升级。nginx 的 `/agents-one/` 流量已切换至插件宿主 `:8701`，旧 Relay `:8700` 仅临时保留且不再承接流量。
- 新适配器在 SDK 的 Gateway v1 路由基础上提供健康检查、产物 CRUD、`/workspace-grants` 全套接口及 Connector WSS 管理。`/workspace-grants` 与 Agents One 桌面端 Gateway v1 契约一致，不需要新增桌面兼容层。
- 修复远端运行事件重复与终态竞态：SDK 统一产生 `run.started`、`run.completed`、`run.failed`；适配器不再重复发送这些 WSS 事件，并在 `getRun` 中从已完成运行结果合成唯一的 `assistant.completed`。不依赖 SDK 基于 UUID 的 EventJournal 语义去重。
- Hers 已完成 14 项端点测试、无重复的运行生命周期、会话续接及 Workspace Grant 完整回路（含删除确认）。待桌面端真实验收：插件身份识别、细粒度事件展示、产物展示、读写移动删除与断线恢复。

### 2026-08-02：Gateway Event Stream 终态兼容与诊断

- Hers Event Stream v1 验收已能产生 `reasoning.summary`、工具事件、模型和用量元数据；桌面端截图中的 `failed` 暴露出终态事件顺序兼容问题：运行先报告完成时，后续 `assistant.completed` 可能尚未被客户端读取。
- 最小修复：Gateway 运行快照解析会从 `assistant.completed.data.text` 回填最终答复，并兼容从事件读取模型、用量和字符串型错误；不改动任何智能体配置、Token、会话、项目或历史数据。
- 对“已成功但尚未提供最终答复”的 Gateway Run，桌面端仅额外进行 3 次、每次 750ms 的短轮询；仍缺失时显示明确的 Event Stream 契约错误，避免把有效答复截断或只显示模糊的 `failed`。
- 进一步修复成功终态错误字段兼容：若 Gateway 返回 `status: "succeeded"`，桌面端忽略遗留的字符串型 `error` 状态标记（例如 `"failed"`），避免其覆盖已提取的 `assistant.completed` 答复并渲染为空白失败气泡。
- 连接测试在 Gateway 没有声明插件元数据时明确提示“未声明 Agents One 插件信息”；Hers 需在 `/capabilities` 根对象提供 `plugin: { id, version, kind: "remote-gateway" }`，才能显示已识别的 SDK 插件版本。

### 2026-08-02：Gateway 失败详情与事件错误透传

- 修复远程 Gateway 失败运行只显示一个 `failed` 的问题。桌面端现在优先读取 `run.failed`、`tool.failed` 或 `workspace.blocked` 事件中的 `message`、`error`、`reason` 摘要，失败原因会进入运行记录和对话气泡。
- 兼容 Gateway 直接返回、`{ run, events }` 以及嵌套 `data.run` 的响应包，避免插件已经返回失败详情但客户端因响应层级不同而丢失。
- 事件归一化会把 `message`、`error` 作为安全摘要保存到事件数据，后续时间线可以显示可诊断信息；仍不会显示 Token、请求头、绝对路径或完整敏感内容。
- 当远端确实没有提供详情时，界面显示“任务执行失败，但远程网关未返回详细错误”，不再显示无意义的英文 `failed`；HTTP 错误也会附带脱敏后的服务端错误摘要。
- 自动化验证：Gateway 与事件流回归测试 11 项通过，Node/Web TypeScript 检查通过，`git diff --check` 无格式错误。

### 2026-08-02：Gateway v1 失败事件可见性修复

- 根因：部分 Gateway adapter 返回 `error: "failed"`，真实原因只在 `run.failed`、`tool.failed` 或 `workspace.blocked` 事件中；旧解析只显示状态词，前端又把失败渲染成系统气泡，导致界面只剩孤立英文 `failed`。
- 修复：兼容直接运行对象、`run` 包装、`data.run` 和 `data` 运行包；从失败事件提取脱敏摘要；通用状态词不再覆盖真实错误；无详情时显示中文兜底；终态带事件的运行统一按选中智能体消息渲染，保留头像、名称和可折叠事件轨迹。
- 回归：Gateway v1 与事件流相关测试 12 项通过；Node/Web 类型检查通过；生产构建通过；`git diff --check` 通过。
- 待人工验收：关闭旧窗口后重新启动最新 Agents One，创建新的 Hers Gateway v1 对话测试。预期不再出现孤立英文 `failed`，应显示 Hers 头像/名称、失败原因（或中文兜底）及事件明细。旧对话中已经持久化的 `failed` 文字不会自动重写。

### 2026-08-02：远程 Gateway `agent_offline` 诊断修复

- 根因：Gateway 在线只代表 `/capabilities` 可访问；Hers-2 的 Connector 离线时，`/runs` 会返回 `agent_offline`。该错误还可能嵌套在 `{ error: { code } }` 中，旧解析只读取顶层字段，随后界面只剩终态 `failed`。
- 修复：Remote Gateway 错误解析递归读取嵌套 `error`；`agent_offline` 和 `connector_offline` 转换为明确的中文恢复指引；保留真实失败状态与原始事件，不做静默重试或降级到其他智能体。
- 验证：`npm.cmd exec vitest run tests/agents-one-remote-gateway.test.ts` 11 项通过；`npm.cmd run typecheck` 通过；生产构建通过；`git diff --check` 通过。
- 手工验收：先在 Hers-2 所在设备启动 Agents One Plugin/Connector，确认它连接到与该 runtime 相同的 Gateway 地址和 Token；然后新建任务对话重试。仅连接测试通过不代表 Connector 在线；旧失败记录不自动改写。

### 2026-08-03：Gateway 事件语义与模型元数据收口

- Hers Connector 的真实联调根因已完成复盘：运行时注册 ID 与桌面 runtimeId 不一致、Connector Token 与 Gateway 不一致、单连接适配器缺少 runtimeId 路由、日志曾泄露 Token；均已改为多连接按 runtimeId 路由、Token 脱敏日志，并完成 ID/Token 对齐。
- 另发现计划任务僵尸态和手动/计划实例互踢：界面显示运行而 Connector 进程已退出，两个同 ID 实例每约 1.2 秒互相断开。现已清理为单实例，并由 `start_connector.bat` 启动且持续落盘日志。
- 桌面端增强 Event Stream v1 兼容：读取 `model_name`、`modelId`、`context_window_tokens` 等常见别名；运行或事件上报真实元数据后，输入区可显示对应模型和真实上下文窗口，不再回退为虚构默认值。
- 屏蔽两类伪思考：静态“远程智能体已返回新的答复”状态，以及内容与最终答复完全一致的 `reasoning.summary`。该屏蔽只影响展示与持久化噪声过滤；插件仍须从源头停止生成伪事件。
- 恢复数据层 `completed` 终态事件以保持 Runtime API、历史和测试契约；Renderer 继续隐藏这条通用完成标记，避免它混入用户可见的对话过程。
- 自动化验证：`agent-event-stream`、`agents-one-remote-gateway`、`agent-runtimes` 三个定向测试文件共 32 项通过。后续人工验收应覆盖 Hers、OpenClaw、Pi/Codex/Claude Code 的真实思考、工具、模型、上下文、错误、产物和重连路径。

### 2026-08-03：Event Stream v1 嵌套元数据与伪思考过滤补强

- Gateway 运行解析新增 SDK/Relay 常见响应信封兼容：从 `data`、`metadata`、`response`、`result`、`output`、`state`、`run` 中提取插件标识、模型、上下文窗口和用量，不要求远端必须把字段放在顶层。
- 模型字段兼容 `modelId`、`model_name`、`provider`，上下文窗口兼容 `contextWindowTokens`、`context_window_tokens`、`context_window` 等别名。远端真实上报后，任务输入区会显示该模型与实际容量；缺失时保持“默认模型/未知容量”，不伪造 1M。
- 伪思考过滤从“完全相等”扩展为“最终答复被完整复述或包裹在摘要中”的识别；`reasoning.summary` 只有在确为独立、简洁的工作摘要时才会展示和持久化。
- 影响边界：仅修改远程 Gateway 事件归一化与展示链路，未改写、删除或迁移已有智能体配置、对话历史和项目记录。
- 自动化验证：定向 Vitest 34 项通过，`npm.cmd run typecheck` 通过，`npm.cmd run build` 通过；构建仅保留既有 Vite 包体积提示。
- 插件对齐要求：`capabilities` 应返回 `plugin`（含 `id`、`version`、`kind`）和真实 Event Stream v1 能力；运行或事件应返回真实 `model`/`usage`，不得用最终答复冒充 `reasoning.summary`。

### 2026-08-06：对话错误与产物提醒卡收口

- 问题：Hers/Agents One 图片联调已经通过，但运行事件仍在答复前显示独立“错误”卡和“任务已发布新的产物”卡；它们没有补充用户可操作的信息，反而打断对话阅读。
- 根因：`runtimeChatMessageAdapter` 把 `error`、`timed_out` 和 `artifact_published` 事件统一转换为对话 `system` 消息；真实图片和文件其实已由执行记录中的 artifact 元数据独立渲染。
- 最小改动：仅在 Renderer 事件适配层停止生成错误、超时和产物发布系统卡。匹配到工具调用时仍保留失败状态，事件持久化、Runtime/Gateway 协议、诊断数据、智能体配置和历史记录均未修改。
- 回归保护：新增适配器测试，确认错误和产物提醒不进入对话，同时 hydrated 本地图片仍生成 `MEDIA` token 并正常走原生图片渲染。
- 验证：定向 Vitest 7 项通过，Node/Web TypeScript 检查通过，`lat check` 全量通过，`git diff --check` 在最终交付检查中执行。
- 已知风险与下一步：现有历史事件重新打开时也会按新适配器隐藏这两类卡，这是预期展示变化；错误诊断仍应通过工具失败状态、任务中心或日志查看。
- PowerMem：已通过本机 MCP stdio 兜底写入长期记忆 `740405127453605888` 并执行语义检索复核；当前会话未自动加载 PowerMem 工具，且 `codex mcp get powermem` 未找到注册项，后续应恢复全局注册以便新会话直接调用。

### 2026-08-06：多智能体协作冒烟失败修复前评估

- 改动原因：协作确认卡依赖远程智能体先返回结构化 proposal；但绑定工作区的 Gateway 成功轮次会被“必须有工作区审计或产物”规则统一拦截，合法的 proposal 控制轮次也被误判。单改 Renderer 无法恢复该终态，因此必须同时收窄主进程审计边界。
- 影响数据：不迁移、不删除、不重写 Runtime 配置、Workspace Grant、会话历史或用户文件；仅调整未来运行的终态判定、协作协议提示，以及历史/实时事件的展示过滤。
- 下游消费者：`RuntimeChat` 协作提案解析与确认卡、Gateway v1 终态协调、运行事件到 Hermes 风格消息的 Renderer 适配器。
- 失败模式：无效 proposal 绕过工作区审计、真实文件任务被错误标记成功、平台授权状态被误当作模型推理、协作指令仍被模型忽略。
- 防护与回退：只允许能够通过已启用 runtimeId 校验的 proposal 绕过本轮工作区产物审计；真实工具/文件任务的审计保持不变；授权事件仅从“思考”展示中过滤，不删除持久化记录。本修复作为 `1baedf5` 之后的独立提交，可整体回滚。
- 验证清单：先补 proposal 解析/协议、Gateway 审计和消息适配器失败用例；再运行相关 Vitest、Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check`；人工冒烟继续使用“编排 → 用户确认 → Pi 执行 → Claude 复核”的原任务。
- 实施结果：协作规则现在位于用户请求之前；明确多智能体/角色分工以及“为何没有确认界面”的重试轮次必须先返回 proposal，并禁止先调用工具。只有所有 assignment 都指向已启用 runtime 的有效 proposal 才能作为无工作区审计的控制结果放行。
- 展示结果：未来不再生成 Workspace Grant 建立/缺失的伪思考事件；既有会话中已经持久化的两类事件也会在 Renderer 适配层隐藏，真正的模型 reasoning、工具事件和诊断数据不受影响。
- 自动验证：协作 proposal、RuntimeChat、消息适配、Gateway Runtime 与协作存储 5 个测试文件共 63 项通过；Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check` 均通过。仍需在最新开发版执行一次真实 Gateway 冒烟，确认卡出现后由用户点击确认再派发。
- PowerMem：当前会话未自动注册 MCP 工具，已按 stdio 兜底写入长期记忆 `740449803531452416` 并执行语义检索；服务端提示 infer 索引异步处理，首次检索先召回了既有“任务对话是唯一交互式协作入口”等相关记忆。

### 2026-08-06：明确分工的协作确认改为平台本地生成（修复前评估）

- 二次冒烟现象：协调智能体已开始输出 `<agents-one-collaboration-proposal>`，但内容进入 `reasoning.summary` 且 JSON 中途截断；Gateway 没有最终答复，确认卡仍无法解析。继续加强提示词无法提供确定性保证。
- 改动边界：仅在共享 proposal 纯函数与 `RuntimeChat` 提交路径增加“明确点名多个已接入智能体并使用‘负责’分工”的本地识别与序列化；不修改 Runtime 注册、Gateway、Workspace Grant、IPC、配置和历史迁移。
- 影响数据与消费者：命中条件时不再创建远程运行，而是在当前对话新增一条可持久化的 agent proposal 控制消息；现有 proposal 卡、确认回调和后续协作执行继续消费同一格式。既有会话不重写。
- 失败模式与防护：名称误匹配可能生成错误分工，因此要求明确协作意图、至少两个不同已启用 Runtime、每个角色具有“负责”职责；runtimeId 始终来自当前目录而非用户文本。未满足条件时仍走原模型建议通道。
- 回退与验证：作为 `27a9482` 之后的独立提交，可整体回滚；测试覆盖“你负责…Pi 负责…Claude 负责…”解析、未知名称/单角色不触发、RuntimeChat 直接出现确认卡且不启动远端任务、持久化后可恢复，并复跑协作测试、类型检查、构建及 `lat check`。
- 实施结果：明确分工由共享纯函数在本地解析，名称/别名只映射到当前启用 Runtime；当前协调智能体即使未出现在外部 catalog map 中也会纳入可信集合。命中后写入与既有模型 proposal 完全相同的可持久化控制消息，直接显示确认卡，不创建 Gateway Run。
- 回退兼容：只有明确协作意图且至少两个角色带有职责时才走本地路径；单角色、概念咨询和开放式“请推荐协作方案”仍交给协调智能体。现有模型 proposal、用户确认、协作配置和后续派发链路均保留。
- 自动验证：proposal 纯函数、RuntimeChat、消息适配、Gateway Runtime 与协作存储 5 个测试文件共 66 项通过；生产构建（含 Node/Web TypeScript 检查）通过。`lat check` 与最终差异检查在提交前执行。
- PowerMem：已通过 MCP stdio 兜底写入长期记忆 `740454907009564672` 并执行语义检索；新记忆仍按服务端提示异步进入 infer 索引。

### 2026-08-06：同一对话多智能体自动闭环（修复前评估）

- 改动原因：最新冒烟已经能显示单个 Runtime 的思考与工具事件，但协作仍要求用户先打开配置对话框并再次提交同一任务；实施角色的文字交付契约还可能被贴到未验证的工作目录或 diff 证据上，导致目标文件不存在时复核角色仍被错误推进。单改展示层无法建立可信闭环，因此必须同时收窄 Renderer 编排器、Layout 协作持久化回调和本地 Runtime 产物登记边界。
- 影响数据：不删除、不迁移、不批量重写 Runtime 配置、头像名称、历史消息、项目文件或既有协作记录；新任务会自动保存同一份 `TaskCollaborationRecord`，角色运行记录只增加重试次数等向后兼容字段，本地 CLI 仅为未来完成的 full-access Run 补充主进程验证过的文件 artifact。
- 下游消费者：`RuntimeChat` 发送/轮询/顺序派发与消息身份展示、`Layout` 的协作保存和当前 Run 映射、`agent-runtimes` 本地 CLI 终态归档、协作状态面板/时间线/历史恢复逻辑。
- 失败模式：误识别普通对话并自动启动协作、重复写入用户消息、主进程接受越界路径或伪造 SHA、验收失败无限重试、重试读取旧产物、运行中显示错误智能体头像、旧协作记录无法恢复。
- 防护与回退：自动启动仅接受已通过当前启用 runtimeId 白名单的结构化 proposal；复用当前用户消息，不再派发第二次 submit 事件；文件必须位于已选择工作区、真实存在且主进程重算 SHA-256 与声明一致；自动回派设置有界次数并保留每次消息/时间线；新增字段均可选。修改按“可信文件 artifact”和“自动闭环 UI”分层，可分别回滚到 `a4b2a3c`。
- 验证清单：先补本地文件 artifact 的路径边界/存在性/SHA 回归，再补明确分工自动启动且不重复用户消息、实施无真实交付不启动复核、验收不通过自动回派实施并重新复核、运行中切换当前角色头像的 Renderer 回归；随后执行定向 Vitest、Node/Web TypeScript、生产构建、`lat check`、`git diff --check`，最后用 Hers-2 → Pi → Claude → Hers-2 真实冒烟。
- 实施结果：明确点名分工由客户端白名单解析后直接保存并启动，不再打开首次配置对话框，也不再通过 `agents-one:submit-task-message` 重复写入同一用户要求；开放式请求仍由主智能体输出 proposal，但该可见规划轮次会直接作为负责人交接，平台从下一角色继续执行。
- 对话可见性：每个角色的完成消息继续保存独立 Runtime 名称、头像、颜色、角色和执行事件；运行中的思考/工具行改用当前正在执行的 Runtime 身份。负责人首次编排和最终验收是两个真实可见轮次，实施与复核也各自保留完整消息和事件。
- 可信交付：本地 Codex、Claude Code、Pi 的 full-access 终态新增主进程文件核验。只有声明路径位于所选工作区、文件真实存在且重算 SHA-256 与声明一致时才发布 `file` artifact；Renderer 不再用模型文字覆盖 worktree/diff 路径。实施没有可信文件或 diff 时不会启动复核。
- 闭环恢复：复核输出“不通过”时，平台保留失败消息和时间线，清除本轮陈旧证据，把复核结论注入对应实施角色后自动重试，再次进入复核；最多三次实施尝试，超过上限才等待人工介入。最终只有负责人基于登记证据输出“通过”才把任务标记成功。
- 自动验证：本地交付、三类 Runtime、proposal、协作存储、RuntimeChat、消息适配、协作查看与手动配置 8 个测试文件共 74 项通过，其中 RuntimeChat 27 项覆盖开放式 proposal 自动接力；Node/Web 类型检查与生产构建通过。当前 PowerShell 找不到 `lat` 可执行文件，已更新并人工核对新增 `lat.md` 源码锚点，待工具恢复后补跑 `lat check`；最终 `git diff --check` 通过。
- PowerMem：当前会话未加载 MCP 工具且 `codex mcp get powermem` 未找到注册项，但服务脚本、API Key 与健康检查正常；已按 stdio 兜底写入长期记忆 `740600315727839232` 并执行语义检索。服务提示 infer 异步处理，本次即时检索先召回了既有“任务对话是唯一协作入口”和真实审计门禁等强相关记忆。

### 2026-08-07：多智能体协作冒烟失败复盘与闭环修复

- 测试结论：8月7日冒烟未通过。真实任务记录显示角色顺序被 Runtime 注册顺序打乱为“负责人 → Claude 复核 → Pi 实施”，Claude 在实施前必然报告 `test.txt` 不存在；Pi 随后虽在本机写入文件，远程 Hers-2 终验又把本机路径当作可直读目录，因远程环境文件系统不同而重复误判“不通过”。
- 头像根因：协作回复已经保存 `agentRuntimeId/agentName/agentAvatar/agentColor`，但 RuntimeChat 适配器将每条回复降级为公共 `MessageList` 身份，历史和实时消息都沿用了负责人头像。Pi 的自定义头像在桌面配置中存在，Claude 未配置自定义图片时应显示其稳定字母头像，而不是继承 Hers-2。
- 修复边界：新增依赖顺序排序（负责人/协调 → 实施 → 复核/验收），对旧记录重跑也在执行前收口顺序；远程终验只消费平台主进程已核验的文件证据，不再附带项目证据包诱导其访问错误文件系统；协作存储补齐文件大小、SHA-256、来源机器、变更摘要、重试次数、终验阶段和时间线；消息适配与实时事件行按生产 Runtime 渲染名称、头像、颜色和角色。未改写用户的 `desktop.json`、既有对话内容或项目文件。
- 回退与风险：排序保持同一阶段内原有相对顺序；旧协作记录继续可读，新增终验角色以 `::final-review` 关联基础负责人；无自定义头像的 Runtime 继续使用字母回退。若远程模型仍违反证据审查规则，平台仍会保留其不通过结论并进入有界重试/人工介入。
- 自动验证：协作 proposal、RuntimeChat 闭环、消息身份适配、任务协作存储和本地交付验证定向测试通过；Node/Web TypeScript 检查通过。待补生产构建、`lat check` 和最终真实 Hers-2 → Pi → Claude → Hers-2 冒烟。
- 新一轮复测定位：新建任务实际停在 Pi 实施阶段，Pi 运行 `300000ms` 后超时。Pi 会话被继承为只读工具集 `read/grep/find/ls`，没有 `write/edit/bash`，因此无法创建 `smoke-test.txt`；这不是 Pi 网络故障，也不是 Claude 复核先行。
- 修复：Pi 的 `implementation/full_access` 启动参数显式授予 `read,bash,edit,write,grep,find,ls`；协作启动前新增实施角色权限预检，未选择“完全访问”立即阻断并提示，不再无提示等待 5 分钟。远程负责人仍可先以只读方式编排，本地 Pi/Claude 实施角色按本机权限执行。
- 自动验证补充：Pi Runtime 与 RuntimeChat 定向测试 35 项通过；全量 190 个测试文件、1899 项通过、13 项跳过；Node/Web TypeScript 检查与生产构建通过。待重启开发版后，以 `D:\\Users\\chenfl\\Desktop\\test` 目录重新执行完整 Hers-2 → Pi → Claude → Hers-2 人工冒烟。

### 2026-08-09：协作过程实时呈现与交付物文件交互

- 冒烟现象：Pi、Claude Code 和 Hers-2 的协作角色运行时只显示“处理中”，思考、工具调用与最终答复在终态一起出现；工具调用作为首条事件时没有可见智能体名称；本地交付物沿用下载按钮，无法像 Codex 文件链接一样直接打开和执行路径操作。
- 实时根因与修复：`RuntimeChat` 的协作循环虽然每 900ms 读取 Runtime Run，但中间快照只写入局部变量。现在每轮都通过单调事件合并更新活动 Run，终态薄快照也不会覆盖前序事件，因此三类 Runtime 只要上报事件即可逐步显示并持久化完整轨迹。
- 身份修复：思考行在角色首条记录显示 Runtime 头像与名称；没有 reasoning、直接从工具开始的 Claude/Pi/Hers 轨迹也由工具组显示对应身份，后续连续行仍共用一次身份，避免重复头像。
- 文件交互：本地 Runtime artifact 与正文识别出的本机文件路径统一渲染为文件链接；悬停显示完整路径，单击用默认应用打开，右键提供“打开文件、复制路径、复制文档内容、在资源管理器中打开”。URL/data 产物继续保留下载/另存行为。
- 变更边界评估：实时刷新与身份仅修改 Renderer 状态和展示；文件右键菜单复用现有 `read-file`、`open-file-in-editor`、剪贴板和 Electron shell 能力，新增最小 preload/IPC 通道，不修改 Runtime 注册、凭据、配置写入、会话结构或历史迁移。复制内容仅对存在且不超过 5 MiB 的文件启用；可按 Renderer、IPC 两层独立回滚。
- 自动验证：RuntimeChat、MessageList、MediaImage、AttachmentChip 和 preload API 定向测试 188 项通过；全量 191 个测试文件、1903 项通过、13 项跳过；Node/Web TypeScript 检查、生产构建和 `lat check` 均通过。最终差异检查在交付前执行。
- PowerMem：当前会话未自动暴露 MCP 工具且全局注册未加载，已按 stdio 兜底完成健康检查、写入长期记忆 `741341184399507456`，并以“协作运行思考工具实时显示、交付物文件链接”执行语义检索复核；新记忆按服务端提示异步进入 infer 索引，检索已召回既有同一对话多角色独立事件与可信 artifact 规则。

### 2026-08-09：协作中的定向多轮沟通（实施前评估）

- 改动原因：现有“介入”只能保存一条指令并立即恢复整条串行链路，无法点击角色头像进入与单智能体一致的多轮沟通，也无法在人工确认前持续阻断后续复核和验收。
- 改动边界：优先复用 Renderer 的 `MessageList`、角色执行循环和介入抽屉；共享类型只为介入记录增加可选回复与回复时间，主进程协作存储仅保留这两个向后兼容字段。不修改 Runtime 注册、用户配置、CLI 参数、历史迁移或既有消息内容。
- 影响数据与消费者：未来的 `TaskCollaborationIntervention` 可同时持久化用户指令与目标角色回复，角色运行记录可选保留 Runtime 会话 ID；`RuntimeChat` 将问答注入目标角色和明确选择共享后的后续角色，并在提供方支持时复用同一角色会话。旧记录缺少新字段时保持原行为。
- 失败模式：头像误指向同 Runtime 的其他角色、暂停后仍启动下游、介入回复未持久化、共享上下文越界、恢复时重复执行已完成角色。使用稳定 assignment id、显式 `role/shared` 可见性、单角色 hold 点和定向回归测试防护。
- 回退方案：新增字段均为可选，旧存储格式无需迁移；头像回调、定向发送和 hold/resume 参数可作为 Renderer 小补丁独立回退，现有“保存指令”恢复路径继续可用。
- 验证清单：覆盖角色面板与消息头像入口、自动暂停、连续两轮目标角色运行、共享回复进入后续角色提示、人工继续前下游不启动、继续后从下一角色开始、重启后介入回复仍在；再执行定向 Vitest、Node/Web 类型检查、生产构建、`lat check` 与差异检查。
- 实施结果：角色面板头像和对话消息头像均可进入定向沟通；打开时自动取消当前活动角色。每次发送只重跑目标角色并在成功回复后保持整条依赖链暂停，用户可继续多轮沟通、显式点击“继续后续任务”，或在抽屉中改派当前角色。
- 上下文与证据：默认共享本轮问答，也可切换为仅目标角色；用户消息和目标回复共同进入主对话及持久化介入记录。支持的 Runtime 会复用同一角色会话 ID；重新执行或改派时清除该角色及下游的陈旧 artifact/验收结论。
- 自动验证：定向 3 个测试文件 39 项通过；全量 191 个测试文件、1907 项通过、13 项跳过；Node/Web TypeScript 检查和生产构建通过。测试覆盖头像路由、活动角色暂停、连续两轮不启动下游、共享回复传递、会话复用、人工恢复、改派及重启持久化。
- PowerMem：当前会话未自动暴露工具且全局注册未加载，已按 stdio 兜底完成健康检查、写入长期记忆 `741360595361595392` 并执行语义检索；服务健康，新记忆仍按 infer 异步进入索引，当前检索已召回既有“任务对话是唯一协作入口”和“角色独立呈现”的强相关记忆。

### 2026-08-09：DAG 编排与任务/项目归档（实施前评估）

- 改动原因：现有协作仅按语义排序串行运行，无法表达独立并行分支和多前置汇合；侧栏任务只能直接删除，项目没有归档入口，用户也无法在设置中恢复或永久清理已归档对象。
- DAG 边界：为角色分配增加可选 `dependsOn`，新增共享纯函数负责校验未知依赖、自依赖、环路、拓扑层和下游集合。无显式依赖的旧记录继续使用原串行顺序；显式 DAG 才启用并行波次。调度仍由 Agents One 客户端掌握，不允许模型绕过 runtimeId 白名单、权限预检、artifact 和验收门禁。
- 归档边界：新增 profile 级独立归档 JSON 与最小 IPC/preload API，只保存任务/项目身份、标题、路径、Runtime 类型和归档时间；不改写会话正文、Runtime 配置或项目文件。侧栏读取归档索引后过滤，恢复只删除归档标记。
- 永久删除：仅设置中的归档管理可发起并要求二次确认；任务按原有原生会话/Runtime 会话删除路径清理，项目永久删除只移除桌面项目登记和归档记录，绝不删除磁盘目录或项目内文件。
- 下游消费者：协作配置对话、RuntimeChat 调度与恢复、协作存储清洗；侧栏项目/任务菜单、设置导航与归档管理面板、IPC 注册和 preload 类型。
- 失败模式与防护：环路导致死锁、并发完成覆盖状态、汇合节点提前启动、分支失败仍推进、旧记录顺序变化、归档任务重新出现在分页结果、跨 profile 误删。以纯图算法测试、按层启动/全部完成后汇合、失败后只阻断后代、旧串行回归、profile 归档存储测试和永久删除确认防护。
- 回退方案：`dependsOn` 和归档字段/API 均为可选增量；DAG 调度可回退到旧串行分支，删除归档索引即可恢复全部侧栏对象。项目文件不进入删除范围，因此归档功能回退不会造成磁盘数据丢失。
- 实施结果（DAG）：角色支持稳定 `id + dependsOn[]`；共享图模块完成缺失依赖、自依赖、重复 ID、环路、拓扑层、后代和汇合终点校验。显式 DAG 按 ready layer 并行派发，汇合节点等待全部前置成功；单分支失败只阻断其后代，其他独立分支继续。旧记录完全不含 `dependsOn` 时仍走原串行闭环。负责人终验自动依赖所有终点分支。
- 实施结果（配置与持久化）：配置对话增加前置角色多选和错误提示，删除角色会同步清理依赖；proposal 协议支持 DAG JSON。协作存储保留依赖、工作区访问和并行活动角色 `activeAssignmentIds`，字段均为可选，无历史迁移。
- 实施结果（归档）：任务菜单增加“归档任务”，项目标题增加项目操作/归档入口；归档任务、归档项目及项目内任务都会从侧栏隐藏。设置新增“归档管理”，支持搜索、任务/项目筛选和恢复；只有已归档任务显示永久删除并二次确认。原生、本地 Runtime、远程/SSH 任务按既有删除通道处理；项目始终只处理登记元数据，绝不删除目录。
- 自动验证：全量 194 个测试文件通过，1915 项通过、13 项跳过；新增用例真实保持两个 sibling Runtime 运行并确认 join 在两者成功前不派发，同时覆盖图校验、归档持久化、项目登记移除、协作存储和归档管理 UI。Node/Web TypeScript 检查、生产构建和 `git diff --check` 通过；`lat check` 在最终交付前执行。
- 明日人工检查：①配置一个“规划 → 前端/后端并行 → 验收汇合”真实任务，观察两个分支的实时思考/工具与汇合时机；②分别归档普通任务、项目及项目内任务，重启后确认仍隐藏；③在设置归档管理中搜索、筛选、恢复；④对临时归档任务执行永久删除，确认不会恢复且项目磁盘目录未受影响。
- PowerMem：当前长会话未加载 MCP 工具表且 `codex mcp get powermem` 未发现注册项；按既有 stdio 兜底完成健康检查并写入长期记忆 `741377466190266368`，随后语义检索成功召回相关 Agents One 记忆，新记录按服务端提示异步进入 infer 索引。

### 2026-08-09：项目/任务菜单补齐与侧栏分页稳定性

- 问题与根因：项目菜单只有归档且采用独立小卡片；任务菜单缺少会话 ID 和工作目录操作。侧栏分页把每轮固定查询的 Runtime 对话计入原生 `sessions.json` 的 offset 与 `hasMore`，造成后续页重复、`hasMore` 永远为真，并被初始同步反复重置到第一页，表现为列表底部持续“加载中”和界面跳动。
- 项目菜单：项目与任务统一复用同一套 Portal 浮层、样式、动画、视口钳制和关闭规则；项目增加置顶/取消置顶、在资源管理器中打开、重命名、归档和移除。浮层支持外部点击、侧栏滚动、窗口失焦和 `Esc` 关闭；内联重命名的 `Esc` 会取消并抑制卸载时的失焦保存。
- 任务菜单：增加“在资源管理器中打开”和“复制会话 ID”。只有存在上下文工作目录时才启用资源管理器操作；会话 ID 直接复制稳定任务 ID，不改写对话或标题。
- 数据边界：项目自定义名称与置顶状态只写入桌面项目登记，不重命名/移动磁盘目录。移除项目只删除桌面登记并解除原生及 Runtime 对话的项目关联，使任务回到“对话”分组；不会删除任务、历史、项目目录或任何文件。归档仍使用独立 profile 级标记。
- 分页修复：原生缓存分页拥有独立的 `loadedNativeCount`、lookahead 和 `hasMore`；Runtime 对话只在刷新时合并一次，不参与原生 offset。初始缓存同步保留已经加载的原生窗口，不能再把第二页压回第一页。新增纯分页函数覆盖满页、末页与 offset 推进。
- 回退方案：菜单 UI、项目登记 API 和分页 helper 可分层回退；项目移除没有磁盘删除副作用，且解除关联后的任务仍保留，因此回退不会造成历史或项目文件丢失。
- 自动验证：项目/任务菜单、原生分页、项目登记和 Runtime 项目解除关联 5 个定向测试文件共 9 项通过；全量 197 个测试文件通过，1920 项通过、13 项跳过；Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check` 均通过。
- 明日人工检查：①项目菜单样式与任务菜单一致，`Esc` 可关闭；②置顶排序、重命名、资源管理器打开和移除后任务回到“对话”；③任务复制会话 ID 与有/无工作目录时的菜单状态；④连续滚动超过两页，确认列表不跳动、不重复且最终停止加载。
- PowerMem：当前会话未暴露 MCP 工具，已通过本机 stdio 兜底完成健康检查并写入长期记忆 `741574340679565312`；新记忆按服务端提示异步索引。随后以“Agents One 任务对话、项目管理、协作”执行语义检索，召回 5 条既有相关记忆，最高相关度 0.713。

### 2026-08-10：归档项目任务清单、项目删除与字号收口

- 现场问题：归档管理使用浏览器默认 `h2/strong/select` 字号，明显大于设置页其他面板；归档项目无法查看被项目归档一并隐藏的任务，也没有删除入口。
- 展示修复：归档页改用设置系统一致的 13px 主文字、12px 辅助文字和紧凑控件；项目卡片增加“任务对话”折叠区，默认关闭。展开后同时列出原生会话缓存和 Runtime 对话索引中项目路径一致的任务，兼容 Windows 斜杠、大小写和末尾分隔符差异，不读取或改写对话正文。
- 搜索与加载：任务索引按 100 条分页并设置最大页数防护；项目折叠条在索引完成后显示任务数。归档搜索也能通过项目内任务标题命中对应项目，任务清单仍仅在用户展开时渲染。
- 项目删除：归档项目现在与任务一样显示删除按钮，但使用独立确认文案。确认后仅清除 Agents One 项目登记、归档标记和原生/Runtime 任务的项目关联，使保留任务回到“对话”；绝不删除项目目录、磁盘文件或任务历史。
- 回退与风险：折叠清单和字号仅为 Renderer/CSS 增量；项目删除沿用既有 `deleteArchivedItem` IPC，并补齐与普通“移除项目”一致的解除关联行为。所有底层对话仍保留，可按 UI、IPC 两层独立回退。
- 自动验证：归档 UI、归档存储、项目登记和 Runtime 解除关联 4 个定向测试文件共 9 项通过；降低并发后的全量 197 个测试文件通过，1921 项通过、13 项跳过；Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check` 均通过。两次默认高并发全量运行分别出现既有 Gateway 50ms 定时竞态和 Windows 临时文件 `EPERM`，相关用例单独复跑均通过，降低并发后全量无失败。
- PowerMem：当前会话未暴露 MCP 工具，已通过本机 stdio 兜底完成健康检查、写入长期记忆 `741693308794830848`，并以“归档项目、任务清单、删除不删除磁盘文件”执行语义检索，成功召回 5 条相关记忆。

### 2026-08-10：真实 DAG 会话复盘与多分支实时呈现

- 复盘对象：只读检查会话 `runtime-conv-0e41fcc3-36f8-45f3-bfc3-001324e1bc12` 及其协作记录，未重跑任务、未修改历史消息或测试交付物。会话主 Runtime 为 Hers-2；原 proposal 却把 `plan` 和 `acceptance` 指派给 Hers，并由平台额外补了一个无依赖的 Hers-2 负责人节点，形成两个根节点。Pi 与 Claude 的实际运行时间重叠，DAG 并行成功，但 Renderer 的单个 `taskRun/activeRuntimeId` 被后写入的 Claude 覆盖，导致 Pi 活动态直到终态才出现。
- 身份与调度修复：自动 proposal 在持久化前由平台把负责人、规划/编排/汇合与验收职责锚定到当前对话 Runtime；实施与独立复核仍可自由选择其他 Runtime。首个负责人规划节点复用当前可见 proposal 轮次；负责人已有显式末端验收节点时不再追加重复的合成终验。这样同类智能体不能在用户未指定时替换被直接交办的 Hers-2。
- 并行实时修复：显式 DAG 以 assignment 为键维护多条活动 Runtime Run；同一波次的 Pi、Claude 等分支分别保留头像、名称、角色、事件和占位状态，并同时呈现。停止任务会取消全部活动 Run，不再只取消最后写入的分支。
- 轨迹真实性：该实测中 Pi 有 29 条事件、Claude 有 18 条（含结构化工具名、调用 ID、输入与结果），Hers/Hers-2 各轮只有 4–5 条远程事件，主要是生命周期、最终答复及与最终答复重复的 summary。客户端会过滤冒充思考摘要的最终答复镜像；提供方未上报思考摘要或工具事件时明确显示“运行轨迹未上报”，不伪造内部思维或不存在的工具调用。完整远程摘要/工具轨迹仍需对应 Gateway Connector 实际上报 Agent Event Stream。
- 看板与措辞：协作分工、交付物与验收、时间线收成右下角紧凑悬浮看板，默认折叠，字号统一为 13px/12px，避免占据首条对话上方的大面积空间；头像介入和恢复动作保留。智能体提示、状态和用户答复统一使用“交付物”，新输出标记为 `[交付物]`，主进程继续兼容旧 `[交付契约]` 历史。
- 自动验证：负责人锚定、实施职责防误判、远程轨迹缺失/最终答复镜像、交付物新旧格式及并行双分支实时呈现等 4 个定向测试文件共 54 项通过；全量 Vitest 通过；Node/Web TypeScript 检查、变更文件 ESLint（0 error）及生产构建通过。全仓 ESLint 在 120 秒窗口内未结束，变更文件检查仅有既有格式与 Hook 警告。
- PowerMem：当前会话未暴露 MCP 工具且全局注册未加载，已按 stdio 兜底完成健康检查并写入长期记忆 `741713323166269440`；随后检索召回既有 DAG 并行、汇合和远程 Gateway 记忆，新记录按服务端提示异步进入 infer 索引。

### 2026-08-10：并行协作身份、思考提示与看板收起修复

- 复盘真实任务 `runtime-conv-9b498ccb-debc-427a-9b0d-df04ecbbdea4`：Pi 上报了 `progress` 与工具事件；Claude 只上报工具事件，Hers-2 验收只上报生命周期与最终答复，因此后两者本轮没有可展示的真实思考摘要，前端不得伪造。
- 根因一：并行执行时，最后启动的子 Runtime 被当成整段主会话的默认外观，导致 Hers-2 的历史头像/名称临时变成 Claude。现已分离“主会话默认外观”和“当前子任务事件身份”，每条子任务轨迹仍保留自己的 Runtime 身份。
- 根因二：“思考记录未上报”系统卡不渲染头像，却占用了同身份连续行的头像位，导致随后 Claude/Hers-2 最终答复没有头像和名称。现由下一条真实答复重新承担头像；Claude CLI 若实际返回 `thinking` 内容块，也会保存为真实思考记录。
- 根因三：自动协作先创建 Runtime 会话、后保存协作任务，旧关联回调可能在 `persistedTaskId` 尚未进入 Run 状态时提前返回。本轮自动启动入口会在会话 ID 已存在后直接补链；重开历史时优先按 `conversationId` 恢复协作，并可用消息执行与角色运行共享的唯一 `runtimeRunId` 恢复此前未链接的任务。
- 交互：右下协作看板新增“隐藏协作看板”按钮；隐藏后保留紧凑“协作看板”按钮，可随时原位调回，不影响角色状态、产物、验收或时间线。
- 变更边界：仅调整 Runtime 会话渲染、Claude 结构化事件解析、协作会话关联/恢复与看板 UI；未修改 Runtime 注册、用户凭证、智能体配置或既有历史内容。
- 自动验证：定向 Vitest 95 项通过，最终受影响测试 86 项复跑通过；Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check` 均通过。旧未链接任务的 run-id 恢复路径和看板隐藏/显示均有回归用例。

### 2026-08-10：Hers-2 Connector Agent Event Stream v1 最终验收

- 验收对象：Hers-2（`hermes-home2`）远端 Connector/Relay，Gateway 使用 `agents-one-plugin-sdk` v0.1.1。Connector 已将真实 Hermes SSE 推理摘要、工具生命周期、Workspace Grant 事件、最终答复、模型与用量映射到 Agent Event Stream v1；没有发送原始思维链或伪造工具事件。
- 能力声明：删除依赖 `_observedEventTypes` 的运行后动态声明，Connector 启动及重启后均稳定返回 `reasoningSummaries=true`、`toolEvents=true`、`modelMetadata=true`、`usageMetadata=true`，与实际 Adapter 能力一致。
- 独立远程复核：直接查询真实 Run `run_bda14bc2-b9ef-4125-a240-65a40ba57d12` 两次，均返回 HTTP 200、`succeeded`、12 个唯一事件；`sequence` 严格为 1–12，两次 event ID 列表完全一致。事件依次覆盖 `run.started`、三组真实工具开始/完成、`workspace.requested(list, .)`、`workspace.completed(list, .)`、`reasoning.summary`、带真实 text/model/usage 的 `assistant.completed` 和 `run.completed`。
- Workspace 验收：`workspace_gateway` 的 started/completed 复用稳定 `callId=call_run_7e10_3_workspace_gateway`，Workspace 事件保留 `operation=list` 和相对路径 `.`；成功路径与此前保留的 `workspace.blocked/tool.failed` 失败路径均有真实证据。
- 附带修复：修复 Hermes 工具结果含 `"error": null` 时的误判失败；在 SSE、Connector 与 Adapter 链路保留 Workspace args/operation/path；补齐 SDK EventJournal 对 `operation/path` 的白名单；修复 SDK 字符串输入导致的 `Buffer.concat` 崩溃。
- 最终结论：通过。当前 Gateway v1 能力声明、事件顺序、稳定 ID/sequence、成功与失败 Workspace 路径、最终输出以及模型/用量均有真实运行证据支撑。
- PowerMem：当前会话未暴露 MCP 工具，已通过本机 stdio 兜底成功写入本次最终验收事实；随后的语义检索复核因 PowerMem 五小时账户配额耗尽返回 429，写入本身成功，待配额于服务端提示时间恢复后可再次检索确认。

### 2026-08-10：Plugin SDK 0.1.2 发布包

- 发布原因：SDK 0.1.1 的 `refresh()` 在追加 Adapter 事件前先生成 `run.completed/run.failed`，迫使 Hers-2 Adapter 直接写内部 journal；Event Stream 四项增强能力又被固定声明为 `true`，无法表达 Adapter 的真实支持范围。现场还发现 Workspace `operation/path` 被白名单剥离，以及字符串请求 chunk 触发 `Buffer.concat` 崩溃。
- 核心修复：Gateway refresh 先合并 output/error/artifact/model/usage 和 `getRun().events`，最后应用终态；`eventStreamCapability` 只返回 Adapter 在 `capabilities.eventStream` 中稳定声明为 `true` 的标志，基础 Adapter 仍保留 protocol/transport。Connector 升级后可删除 `/capabilities` 拦截、直接 `record.journal` 写入和 SDK 本地白名单补丁。
- 事件与安全：EventJournal 保留允许的 Workspace `operation`、Grant 相对 `path`、稳定 `callId` 及非负工具时长；绝对路径和包含 `..` 的路径不进入持久事件。请求体读取统一兼容 Buffer、Uint8Array 和字符串 chunk。
- 版本与回退：`package.json`、插件 manifest 和 Gateway capability 版本统一升级到0.1.2；旧 `agents-one-plugin-sdk-0.1.1.tgz` 保留，可由 Connector 回装并恢复原 Adapter 备份。未修改用户配置、Runtime 注册、对话历史或 Hers-2 远端服务。
- 发布物：`plugins/agents-one-plugin/agents-one-plugin-sdk-0.1.2.tgz`，14,946 bytes，SHA-256 `a5a3836a3c9bf229ce2a6e467b9f16a734b9332c956fdc55dcd085cebebde61a`；包内 `package.json` 与 manifest 均确认版本0.1.2。
- 自动验证：SDK 自身13项测试通过；桌面端 Event Stream、Remote Gateway 和 Agent Runtime 定向47项通过；Node/Web TypeScript 检查和生产构建通过；`npm run verify`、pack 内容检查、`lat check` 与 `git diff --check` 均通过。
- PowerMem：已按 stdio 兜底尝试同步0.1.2发布事实，但 `memory_store` 与 `memory_search` 均因 PowerMem 五小时账户配额耗尽返回 429，未写入云记忆；完整事实已保存在本地进展日志，待服务端提示的 2026-08-10 17:32:46 +0800 后可重试。

### 2026-08-10：设置页品牌与关于信息收口

- 问题：设置左侧导航仍显示冗余的“Agents One”分组标题；“关于与更新”混入本地 Hermes 引擎维护卡片，桌面端又误用旧 Hermes 图标和上游 Hermes Desktop `0.7.3` 版本。
- 改动边界：仅调整设置 Renderer 展示、Agents One 产品版本元数据和对应文档；保留“关于与更新”“日志与诊断”等入口，不修改 Runtime 注册、用户配置、IPC、更新状态机或历史数据。
- 实施：所有设置入口合并到一个“通用”分组；关于页只保留 Agents One 桌面端卡片，使用正式 dawn-ring 标志；产品版本从重命名前的上游版本线重置为 Agents One `0.1.0`，界面仍通过 Electron `app.getVersion()` 读取真实构建版本。
- 回归保护：新增设置导航和关于页组件测试，覆盖单一分组、Hermes 卡片移除、正式 Logo、版本显示及桌面更新操作；相关设置测试 5/5、Node/Web 类型检查、生产构建和变更文件 ESLint 均通过。

### 2026-08-11：Pi 模型请求失败诊断与错误语义修复

- 现场结论：失败会话 `runtime-conv-e6b86741-a785-42b2-a1d0-6f516b1e7850` 使用 `openai-codex/gpt-5.6-luna`，用量为 0；对应 Pi 原生会话连续记录 `stopReason=error / errorMessage=fetch failed`，但 CLI 以退出码 0 结束，桌面端误记为成功并显示“没有返回可显示的最终答复”。
- 对照验证：用户切换至 `ark/deepseek-v4-flash` 后，会话 `runtime-conv-f5871dc5-0f87-47e8-bc55-2fedca0ed546` 连续两轮成功，分别返回 3150、3802 tokens。由此确认 Pi Runtime、工作区与会话 UI 正常，问题集中在原 OpenAI Codex 模型请求链路；原模型在修复逻辑下单独验证 120 秒仍未完成，未宣称已恢复该模型。
- 修复：Pi 子进程继续使用最小环境白名单，同时补传标准大小写代理变量；完成时解析 Pi JSONL 的最后 assistant 结果，将退出码 0 中的结构化模型错误转为失败状态。成功重试会覆盖较早的瞬时错误，`fetch failed` 会显示可操作的网络/代理提示，不再伪装成空成功。
- 变更边界：仅修改 Pi 本地 Runtime 的子进程环境与终态判定，以及对应测试/文档；未更改智能体注册、用户模型选择、认证信息、历史会话或 Ark 配置。诊断请求使用独立 Pi session，超时后确认无残留诊断进程。
- 自动验证：Pi Runtime 与输出摘要定向测试 15 项通过；Node/Web TypeScript 类型检查与生产构建通过；变更文件 ESLint 为 0 error（仅有仓库现存 CRLF/Prettier 警告），`lat check` 与 `git diff --check` 通过。

### 2026-08-11：Runtime 对话上下文占用与项目文件面板恢复

- 现场问题：Pi、Claude Code 等 Runtime 对话的输入栏没有上下文占用仪表；同一输入栏的项目树按钮虽然切换了 `worktreeVisible` 状态，却没有渲染右侧文件面板，导致浏览项目文件、查看文档和在项目路径打开终端全部无效。
- 元数据根因：RuntimeChat 只读取 `contextUsedTokens`。真实 Pi 使用 `input/cacheRead/cacheWrite`，Claude Code 使用 `input_tokens/cache_read_input_tokens/cache_creation_input_tokens`；现有归一化只保留部分输入/总量，既丢失缓存 tokens，也不能用包含输出的 `totalTokens` 代替上下文占用。
- 修复：本地 CLI 元数据边界把本轮输入与缓存读取/创建相加为 `contextUsedTokens`，明确排除输出 tokens；RuntimeChat 从当前 Run 或最近持久化回复恢复用量，优先采用实际上报的上下文窗口，本地模型缺失窗口时复用模型族映射。远程 Runtime 仅有 `inputTokens` 时仍不猜测占用。
- 文件面板：本地 Codex、Claude Code、Pi 对话重新复用原生 `WorktreePanel`；项目树在右侧展示、支持目录展开与文件查看、宽度拖拽，并通过既有 `open-terminal` IPC 在选中项目路径打开终端。远程路径不会交给本地文件面板。
- 变更边界：修改本地 Runtime 元数据归一化和 RuntimeChat 展示接线，未改写智能体配置、模型选择、会话正文、工作区文件或终端实现。
- 自动验证：Agent Runtime 与 RuntimeChat 定向测试 2 个文件、63 项通过；Node/Web TypeScript 类型检查与生产构建通过；变更文件 ESLint 为 0 error（4 条为工作区既有 Hook/Prettier 警告），`lat check` 与 `git diff --check` 通过。

### 2026-08-11：Runtime 上下文窗口按实际模型动态解析

- 现场问题：Pi 对话虽已显示上下文占用，但 `ark/deepseek-v4-flash` 的上限固定落到静态模型族兜底 `131072`，与 Pi 模型目录声明的 `1000000` 不一致；切换模型也无法同步更新分母。
- 根因：RuntimeChat 没有调用原生对话的异步模型窗口解析链，且 Hermes 模型库中该 Pi 自定义 Provider 模型没有 `contextLength`；仅凭模型名启发式无法知道 Pi 自己的自定义模型元数据。
- 修复：新增本地 Runtime 模型窗口 IPC。Pi 优先只读解析其 `models.json` 和 `models-store.json` 中当前 provider/model 的 `contextWindow`，随后依次尝试 Agents One 模型库显式值和原生 config/provider discovery；Renderer 在当前 Run 未上报窗口时异步取值，并在 provider/model 改变后重新解析。查询未完成期间不显示错误的 131K 瞬时值，所有权威来源均缺失时才回退静态模型族映射。
- 安全与边界：只读取模型 ID 与窗口数字，不返回、记录或改写 Pi 模型配置中的 API Key、Header 等字段；不启动 Pi 子进程，不修改用户模型选择、认证信息、会话正文或工作区文件。
- 自动验证：Pi Runtime 与 RuntimeChat 定向测试 2 个文件、52 项通过，覆盖 Pi 自定义/刷新目录解析以及 `ark/deepseek-v4-flash` 显示 `3680/1000000`；Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check` 通过。变更文件 ESLint 为 0 error，仅保留 RuntimeChat 中既有的 1 条 Hook 依赖 warning。

### 2026-08-11：启动字标、侧栏品牌与双手触碰动效

- 品牌收口：移除启动页和展开侧栏字标中独立的白色圆角 Logo 底板；统一由 dawn ring 直接替代 `ONE` 的字母 `O`。深色启动页使用白色字标，常驻浅色导航使用深色字标。
- 折叠兼容：折叠侧栏继续保留既有圆角渐变方形标记以及 hover/focus 切换展开图标的交互，未改变折叠宽度、命中区域或导航结构。
- 启动动效：以用户提供的机器手与人手照片为主视觉，使用连续背景层和两层羽化手部图层实现相向靠近；约 1.42 秒在指尖产生短促接触光，约 1.62 秒从接触点显现完整新字标。连续背景层随动效显现，避免运动遮罩产生斜向接缝。
- 可访问性与边界：支持 `prefers-reduced-motion`，减少动态时直接显示终帧；保留启动状态文本和远程连接的本地模式逃生按钮。未修改侧栏信息架构、智能体配置、会话数据或更新逻辑。
- 验证：启动页、品牌资产与侧栏关联定向测试 3 个文件、6 项通过；Node/Web TypeScript 检查、变更文件 ESLint、生产构建、逐帧视觉检查、`lat check` 与定向 `git diff --check` 均通过。
- PowerMem：当前会话未暴露记忆工具；本机 `powermem` MCP 全局注册当前缺失，直接 stdio 兜底调用超时，未写入云记忆。完整品牌规则、动效参数与验证结论已保存于本地品牌规范、架构索引和本进展日志。

### 2026-08-11：启动动效指尖、光效与 Logo 时长校准

- 反馈复核：原图本身保留了指尖间距，旧终帧回到原图位置，因此两只手没有真正接触；接触光和 Logo 使用的固定锚点又没有跟随视觉接触点；3 秒启动窗口只给完成入场的 Logo 留下约 0.6 秒稳定展示。
- 空间校准：机器人手和人手使用对称视口位移，在 1.15 秒终点闭合原图间距；统一以画面 `50% / 44%` 作为指尖、接触光和 Logo 的唯一锚点。隐藏 Logo 的独立验收帧确认光效核心正好位于两指接触处。
- 时间校准：接触光约 1.12 秒触发，Logo 约 1.30 秒开始出现；启动页最低时长从 3.0 秒延长至 4.2 秒，使 Logo 完成入场后稳定展示约 2 秒。前段反而更快，不用延长等待来弥补迟缓靠近。
- 可访问性：减少动态模式直接使用新的接触终帧，不再退回有明显指尖间距的原始照片位置。
- 验证：品牌资产与启动页定向测试 2 个文件、3 项通过；Node/Web TypeScript 检查、变更文件 ESLint（0 error）、生产构建和逐帧视觉检查通过。视觉检查包含临时隐藏 Logo 的接触帧，用于独立确认指尖闭合和光效中心位置。

### 2026-08-11：启动动画总时长收口至 2.9 秒

- 用户体验判断：4.2 秒虽然给 Logo 足够停留，但超过了启动反馈的合理等待感，容易让用户误判系统卡顿；确认将完整启动动画控制在 3 秒以内。
- 最终时间轴：双手约 1.1 秒接触，接触光约 1.06 秒触发，Logo 于约 1.20 秒开始出现并用 0.7 秒完成入场；启动页最低时长为 2.9 秒，Logo 总可见约 1.7 秒，其中稳定展示约 1 秒。
- 变更边界：仅压缩启动节奏，继续保留已验收的 `50% / 44%` 指尖、光效和 Logo 共用锚点、双手接触终帧及减少动态模式。
- 验证：自动时间点检查确认 2.5 秒仍显示启动页、3.0 秒已进入主界面；指尖接触帧和 Logo 停留帧视觉正常。定向测试 2 个文件、3 项通过，Node/Web TypeScript、生产构建、`lat check` 与定向 `git diff --check` 通过。

### 2026-08-12：启动页与导航栏字标切换为 Oxanium 700

- 用户确认：在 Space Grotesk、Sora、Oxanium、Rajdhani 四组同时覆盖启动页大尺寸与导航栏小尺寸的对比稿中，最终选择 `03 · Oxanium 700`，强化切角几何和未来科技感。
- 实施：启动页白色字标与展开导航栏深色字标同步采用 Oxanium 700；字母由 Google Fonts 官方字体文件生成并固化为两段 SVG 矢量路径，Dawn Ring 继续直接替代 `ONE` 的 `O`，渐变色、粗细、背景和启动动画时间轴保持不变。应用不内置字体文件，也不产生启动阶段的外部字体请求。
- 变更边界：仅替换两份 Renderer 字标 SVG，并更新品牌资产测试、品牌规范、架构索引与设计记忆；未修改 CSS 动画、侧栏布局、折叠标记、Runtime 注册、配置、IPC、会话或历史数据。
- 回归保护：品牌资产测试要求两份字标均包含两段路径和一个圆环，同时禁止 `<text>`、`font-family` 与白色底板，防止以后退回系统字体或旧版独立图标结构。
- 验证：品牌资产与启动页定向测试 2 个文件、3 项通过；Node/Web TypeScript 检查、变更测试 ESLint 和生产构建通过；隔离开发实例在 1920×1080 启动页、1920×1080 展开导航及 375×812 窄视口完成真实截图复核，字标居中且 30px 高度下清晰；`lat check` 与 `git diff --check` 通过。
- PowerMem：当前会话未加载记忆工具且全局注册项缺失，已按既有 stdio 兜底完成健康检查并写入长期记忆 `742432768968884224`；随后执行语义检索复核，新记录仍处于服务端提示的异步 infer 索引阶段，暂未进入检索结果。

### 2026-08-12：深色主题导航栏字标对比度修复

- 现场问题：导航栏通过外部 `<img>` 加载固定深色填充的 SVG；切换到深色主题后，字母仍为 `#171A21`，与侧栏背景接近而不可见。
- 修复：新增深色表面专用的 Oxanium 700 矢量字标，字母使用 `#F5F7FA`；布局依据主题注册表中的 `appearance` 语义自动选择深色或浅色表面资产，覆盖当前及后续登记的全部深色主题。Dawn Ring 的紫橙渐变在两份资产中保持一致，没有使用会改变品牌色的整图滤镜或反色。
- 变更边界：仅调整 Renderer 字标资产选择、品牌资产测试与文档；未修改主题配置值、侧栏结构、Runtime、IPC、用户设置持久化、会话或历史数据。
- 验证：品牌资产定向测试 4 项通过；Node/Web TypeScript 检查、变更文件 ESLint 和生产构建通过。隔离开发实例分别切换 `dark` 与 `light` 完成真实截图和 SVG 色值复核：深色主题使用浅色字母、浅色主题使用深色字母，两者 Dawn Ring 均保持原渐变。

### 2026-08-12：定时任务编辑与任务级工作区/权限修复

- 根因：普通 Runtime 新对话、项目任务入口以及 Codex/Claude Code/Pi 主进程适配器都会把智能体配置中的 `workspace` 当作任务兜底；RuntimeChat 同时默认使用 `analysis`，因此 Pi 会话被隐式带入 Agents-One 目录并显示“只读”。
- 任务语义：智能体配置中的工作区改为可选“检测工作区”，只参与连接检测，不再进入普通新对话、项目外任务或定时任务。普通新对话默认“自动 · 对话”；用户显式选择项目目录后，“自动”解析为可读写，仍可手动切换为只读或完全访问。Codex/Claude Code 无项目的普通对话在应用私有空目录运行，不暴露用户项目目录；写入任务必须显式选择项目文件夹。
- 定时任务：管理卡片新增编辑图标，复用新建表单修改名称、频率、提示词、本地 CLI 智能体、项目目录、文件访问和并发策略；活动执行期间禁止编辑。新任务默认 `auto` 且不设置工作区；选择项目后自动以 `full_access` 执行，显式完全访问必须有项目目录。v1 旧任务的隐式 `analysis` 在读取时迁移为 `auto`。
- 界面：定时任务标题、说明、分组标题、任务名称、正文与元数据字号统一上调；智能体编辑页将“工作区”更名为“检测工作区（可选）”，并明确项目目录在每个任务中按需选择，不存在跨项目冲突。
- 回归保护：新增定时任务编辑、旧模式迁移、自动可写与新对话不继承智能体工作区用例；相关 6 个测试文件 78 项通过，新增专项 3 个测试文件 53 项通过；Node/Web TypeScript 检查和生产构建通过，变更文件 ESLint 为 0 error，`git diff --check` 通过。

## 2026-08-12：统一“自动”为安全读写权限

- 权限入口统一只显示“自动”，不再根据是否选择项目目录显示“自动 · 对话”或“自动 · 可写”；说明统一为“可读写，无移动、删除文件权限”。新对话、定时任务以及选择/切换项目目录后都保持“自动”，不暗中切换成只读或完全访问。
- 实际执行新增 `safe_write` 模式：未选择项目目录时仍以无项目普通对话运行；选择目录后，Pi 仅开放 read/edit/write/grep/find/ls，Claude Code 开放 Read/Edit/Write/Glob/Grep 并禁用 Bash，Codex 使用 workspace-write 且禁用 shell tool。三者均在运行期间保护原有项目文件，若智能体尝试移动或删除，会在任务结束时恢复原路径并写入执行结果提示。
- 远程 Workspace Grant 同步支持操作级授权；“自动”只下发 list/read/write，不再下发 move/delete。显式“完全访问”仍保留移动、删除能力，显式“只读”仍只开放 list/read。
- 定时任务的持久化值继续使用 `auto`，触发时有项目目录映射到 `safe_write`，无项目目录映射到普通对话；旧任务和旧远程 Grant 保持兼容。
- 回归验证：权限/调度/CLI/Gateway 定向测试 96 项通过，界面与文件保护复测 63 项通过；Node/Web TypeScript 检查、生产构建和 `git diff --check` 通过，变更文件 ESLint 为 0 error（仅保留项目既有格式与 Hook warnings）。

## 2026-08-12：定时任务结果对话实时刷新与权限回显

- 修复“任务卡已有结果、已打开的任务对话仍只有用户提示词”：完成结果和 Runtime 执行事件原本已经持久化，但对话组件没有订阅后台完成后的 conversation 更新。现在完成事件会携带 conversationId 定向通知已打开对话重新读取；重新打开已有对话时也会主动同步最新持久化内容。
- Runtime 对话新增 `accessMode` 元数据。定时任务创建结果对话时写入本任务真实权限，打开结果对话后准确显示“自动 / 只读 / 完全访问”，不再总是回退到聊天默认“自动”。
- 定时任务文件访问第三项由“可读写”明确改名为“完全访问：可创建、编辑、移动或删除项目文件”，保存值保持独立 `full_access`；历史 `implementation` 计划迁移为 `full_access`，避免被新版默认值折叠为自动。
- 本机数据核验确认本轮“obsidian知识库整理”的最终回复与执行记录均已完整保存；专项 UI、调度、对话存储测试 59 项通过，扩展回归 113 项通过，Node/Web TypeScript 检查通过。
- PowerMem：当前会话未加载 MCP 注册，但本地 stdio 服务可用；已写入长期记忆 `742631226967326720`。随后的语义检索召回既有“仅本地 CLI 定时任务、移除执行位置/执行方式”等强相关记录，新记忆按服务端提示仍在后台 infer 索引。

## 2026-08-12：本地 CLI 任务恢复终端原生能力

- 现场复盘：会话 `runtime-conv-schedule-a2d4f824-9e3b-49fb-8ed1-4a3d5130b809` 的 Pi 运行实际由当前 Electron 用户 `chenfl` 启动，并非 Windows 任务计划程序或 SYSTEM 账户；Pi 在会话中的 HOME/USERPROFILE 推断不符合 Agents One 的进程模型。
- 根因：Agents One 的统一 Pi Runtime 为所有普通对话、手动任务和定时任务固定传入 `--no-skills`，因此 `C:\Users\chenfl\.agents\skills\llm-wiki\SKILL.md` 虽真实存在，也不会进入 Pi 的可用技能清单。首轮任务只读取了 Pi 自身文档和知识库文件，却错误声称已加载 `llm-wiki`。
- 产品目标：普通新任务与定时任务作为 Pi、Claude Code、Codex 的桌面入口，应继承对应 CLI 在终端中的用户配置、技能、MCP、扩展/插件、Hooks、项目指令、Shell 和自定义工具；Agents One 只负责工作目录、用户选择的文件权限、运行记录和结果展示，不再维护一套会导致能力缺失的工具白名单。
- Pi 修复：移除 `--no-skills / --no-extensions / --no-prompt-templates / --no-context-files` 以及可写模式的 `--tools` 白名单，让 Pi 自行加载 `~/.pi/agent`、`~/.agents/skills`、已安装 packages、MCP adapter 和项目资源；无项目的自动对话在应用私有目录运行，但仍保留完整工具能力。
- Claude/Codex 修复：移除自动模式下对 Bash/shell 的禁用与固定工具白名单；Claude 的可写非交互任务使用原生完整授权，Codex 自动模式保留原生 `workspace-write` 边界但不再禁用 shell，完全访问才绕过 sandbox。这样 MCP、插件、Hooks、子智能体和 Shell 不会被适配器裁掉。三个 CLI 子进程均继承桌面进程的完整用户环境，以兼容用户配置的任意本地工具变量。
- 权限边界：“只读”仍明确使用各 CLI 的 read-only/plan 能力；“自动”启用完整 CLI 能力，但选定项目时 Agents One 会在运行前后保护原有文件并恢复被移动或删除的内容；“完全访问”不做移动/删除恢复。当前“obsidian知识库整理”保存为 `full_access + D:\pkulyn_vault`，满足 `llm-wiki` 的写入、快照、索引及状态更新需要。
- 验证：Pi 原生技能加载器成功解析 `C:\Users\chenfl\.agents\skills\llm-wiki\SKILL.md` 且无诊断错误；Pi/Codex/Claude/调度/RuntimeChat/文件保护 6 个定向测试文件共 84 项通过，Node/Web TypeScript 检查通过；相关 ESLint 为 0 error（仅有仓库现存格式及 Hook warning）。

## 2026-08-14：开源前优化启动 - Phase 0 提交基线

- 生成最终开发文档 [Agents One 开源前最终优化开发文档](./AGENTS_ONE_OPENSOURCE_PLAN.md)，含用户确认的 10 项决策（接入统一=方案 A/远程走 Gateway v1/本地 CLI+本地 API/SSH 删除/旧远程代码直接删除/上游遗留直接删除/旧页面界面删除数据备份保留/仓库 pkulyn-agents-one/i18n en+zh-CN/MIT Copyright 改 pkulyn）。
- 将 2026-08-06 至 08-13 的未提交工作整理为 8 个语义化提交：①gitignore 本地产物 ②备份/恢复/归档 ③Task Center 退役+计划任务收敛 ④协作 DAG ⑤safe_write+CLI 原生能力 ⑥侧栏菜单/分页/附件操作 ⑦品牌资产/启动动画 ⑧Plugin SDK 0.1.2+文档+lat.md ⑨Runtime 对话集成/计划任务 UI/统一渲染。
- 打标签 `agents-one-pre-opensource-baseline` 作为开源前回退点（此前基线标签 `agents-one-pre-slim-20260806`）。
- 全量验证全绿：Node/Web TypeScript 检查通过；Vitest 203 个测试文件、2010 项通过、9 项跳过；Electron Vite 生产构建通过。
- 两个本地测试产物（`Hers-2-Connector-Adaptation-Package-2026-08-10.zip`、`agents-one-test.md`）保持未跟踪，不入库。

## 2026-08-14：开源前优化 - Phase 2 遗留清理推进

- 用户确认执行顺序调整：Phase 2（旧页面删除）前置，Phase 1（接入统一）后置（SSH/旧远程模式与旧页面支撑模块深度耦合，先删旧页面可清掉大部分消费者）。
- ①删除孤儿屏幕：Discover、Office（含重型 3D 资源）、Providers、Tools、Gateway、Models、Install、Setup、Welcome；保留 Sessions（Cmd+K 会话搜索/恢复是活功能）；Layout 清理对应 View 类型/渲染/discoverFocus/remoteMode。renderer 产物从 11.7MB 降至 8.6MB。
- ②删除上游云/钱包/社区栈：agent-sync、hermes-account、account-store、wallet-store/balances/sync 及测试、shared/wallets/account/agent-sync/tokens；UI 组件 FollowUsModal、HermesAccountModal、OAuthLoginModal、ProviderKeysSection、ProfileWalletPane、CommunityPane；对应 IPC/preload API。
- ③删除 Skills/Memory/Soul 管理界面；ProfileModal 移除死掉的 persona/agentMemory/wallet 段；main 的 memory/skills/soul 模块保留为数据后端（备份仍快照 memories/skills 目录）。
- ④i18n 收敛为 en + zh-CN：删 10 个 locale 目录，重写 shared/i18n index/config/types，LANGUAGE_NATIVE_NAMES 2 项，更新三个 locale 测试。
- ⑤清理上游 hermesone/fathah 引用：菜单 issues 指向 pkulyn/agents-one；删除 hermesone provider setup card/PROVIDER_CARDS/BASE_URLS/SETTINGS_SECTIONS/url-key-map；删孤儿 i18n key；删除 stale detect-provider/office-url 测试并更新 layout-remote-gates、ProfileModal 测试。
- 全量回归：191 个测试文件、1912 项通过、9 项跳过；Node/Web TypeScript 与生产构建通过。
- 深层主进程清理（registry/messaging-platforms/tools 等 IPC 与 preload）与旧 Hermes 远程/SSH 传输耦合，延后到 Phase 1 一并处理。

## 2026-08-14：Phase 2 主体完成 + Phase 3 元数据

- Phase 2 遗留清理主体完成：除深层主进程 IPC（registry/messaging/tools，与 Phase 1 旧远程传输耦合延后）外全部落地——孤儿屏幕、上游云/钱包/社区、Skills/Memory/Soul 界面、i18n 收敛、hermesone/fathah 引用、上游 analytics 均已删除/清理。
- Phase 3 元数据完成：package.json author=pkulyn + repository/homepage/bugs；LICENSE copyright pkulyn（保留 MIT，注明 hermes-desktop fork 起源）；electron-builder appId=com.pkulyn.agents-one + publish 指向 pkulyn/agents-one；dev-app-update.yml 改 agents-one；删除上游 changelogs(0.4.5-0.7.0)、README.ja-JP/es-LATAM、CONTRIBUTING.ja-JP；CONTRIBUTING 链接改新仓库；.env.example 精简。
- 删除上游 analytics 客户端（utils/analytics.ts）与 PrivacyPane 隐私同意 UI、privacy 设置导航、VITE_ANALYTICS_* / MAIN_VITE_HERMES_API_* 环境变量与 workflow 引用。
- 全量回归：191 个测试文件、1912 项通过、9 项跳过；Node/Web TypeScript 与生产构建通过；renderer 产物降至约 8.1MB。
- 下一步进入 Phase 1：智能体接入统一（方案 A）——配置模型 transport=gateway-v1/local-cli/local-api、SSH 与旧远程 Hermes/OpenClaw 传输删除、注册表单统一为链接+Token 或路径。
