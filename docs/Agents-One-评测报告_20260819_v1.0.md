# Agents-One 评测报告

| 项目     | 内容                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 评测对象 | Agents One（Electron 桌面应用，多智能体协调工作台）                                                                                      |
| 版本     | 0.1.0（分支 `agents-one-slim-task-dialog`，git 工作区干净）                                                                              |
| 报告日期 | 2026-08-19                                                                                                                               |
| 版本号   | v1.0                                                                                                                                     |
| 评测方法 | 全量 typecheck / vitest / eslint 静态验证 + 4 路并行源码深审（主进程运行时、安全/备份、调度/协作、IPC/渲染层）+ 关键发现逐条回读源码验证 |
| 状态说明 | 每条发现标注「源码直接验证」（主审人逐行回读确认）或「深度审读确认」（子审读报告，逻辑链路完整、未逐行回读）                             |

---

## 1. 验证基线

| 检查                    | 结果                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------- |
| typecheck（node + web） | 通过                                                                               |
| vitest                  | 1782 通过 / **1 失败** / 9 跳过（179 个测试文件，1792 项）                         |
| eslint                  | **640,814 个问题**（2,795 errors + 638,019 个 CRLF 换行警告），lint 门禁实际为红色 |
| git                     | 干净，无未提交变更                                                                 |

**失败测试**：`src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx:914`「does not present input tokens as context occupancy」。

- 该项目进度日志（`docs/AGENTS_ONE_PROGRESS_LOG.md` Phase 1.7）声称已修复过该 flaky 模式（`mockResolvedValueOnce` → 持久 `mockResolvedValue`），但该测试仍保留旧写法，说明修复不完整且无 CI 兜底。
- 该测试失败的 DOM 输出中暴露一个真实 bug：`\x1b[0m` ANSI 转义序列被原样渲染进聊天气泡（见 P2-1）。

---

## 2. 严重问题（P0，影响数据安全 / 任务正确性）

### P0-1 应用退出不终止 Agent Runtime 任务，子进程成孤儿继续改文件

- 位置：`src/main/app/start.ts:148-160`（源码直接验证）
- 现象：`before-quit` 只 abort 旧版 Hermes 聊天流（`activeRuns`），从未调用 `cancelAllAgentRuntimeTasks()`（该函数仅在备份恢复流程中被调用，`ipc/register.ts:2033`）。
- 触发：用户关闭窗口（或系统杀进程）时 Pi / Claude Code / Codex / 远程 Gateway 任务仍在运行。Windows 下父进程退出不会连带杀子进程，CLI（spawn 时带 `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox`，见 `claude-code-runtime.ts:369`、`codex-runtime.ts:204`）继续运行并修改 worktree/工作区。
- 后果：safe-write 备份永不恢复；远程 workspace grant 永不吊销；远程运行继续消耗 token。

### P0-2 定时任务 JSON 存储无并发控制 → 重复执行 / 已删任务复活 / 编辑被覆盖

- 位置：`src/main/task-schedules.ts:624-713`（tick）、`:610-621`（trigger）、`:384-470`（requestRun/startRun）（深度审读确认）
- 现象：5 秒 tick 与 IPC 处理器（立即运行、删除、编辑）各自执行 read → mutate → write，无互斥锁、无版本化写保护；`ticking` 标志只能防止 tick 自并发。
- 触发路径：
  - 双击「立即运行」→ 两个 CLI 进程同时执行同一 prompt，一个 run 记录连同 `activeRuntimeRunId` 被覆盖丢失，其完成事件被静默丢弃；
  - 删除任务时 tick 正在进行 → 已删任务被复活且带 active run；
  - tick 的过期快照回滚用户刚保存的编辑。

### P0-3 Cron 校验与匹配器不一致 → 合法 cron 静默永不触发

- 位置：`src/main/task-schedules.ts:68-70`（`validSchedule`）vs `:321-338`（`cronPartMatches` / `cronMatches`）、`:351-359`（`nextRunAt`）（源码直接验证）
- 现象：`validSchedule` 只校验「5 个空白分隔字段」；匹配器只支持 `*`、`*/n`、逗号分隔整数。`0 9 * * 1-5`、`*/15 9-18 * * *`、`0 8 * * MON-FRI`、`7`（周日）、`L` 等常见写法全部通过创建/编辑校验但**永远不触发**，`nextRunAt` 返回 undefined。
- 后果：用户创建即静默失败，无任何提示，运行历史空白。

### P0-4 取消 / 超时不等待子进程真正死亡就标记终态

- 位置：`src/main/agent-runtimes.ts:2443-2450`、`:2511-2518`、`:2576-2583`；`pi-runtime.ts:320-329`（terminateTree）（深度审读确认）
- 现象：`cancel()`（taskkill /T /F 异步）发出后立即 `finishRuntimeRun("timed_out"/"cancelled")`，不 await 子进程 `close`，子进程死亡从未被观察；taskkill 失败或缓慢时无第二次击杀尝试。
- 后果：超时后 CLI 仍在运行；配合 P0-1 退出即成孤儿进程。

### P0-5 远程 Gateway 取消语义错乱

- 位置：`src/main/agent-runtimes.ts:2766-2772`、`:2749`（深度审读确认）
- 现象：
  - 取消 POST 网络失败 → 运行被标记为 `failed`（而非 cancelled），且 `cancelAgentRuntimeTask` 返回 `true`，调用方误以为取消成功；
  - 取消响应为 `running`（取消中）→ 函数返回 `true` 但记录保持 `running`：`cancelRequested` 只在 Hermes 路径（`:2653`）被读取，Gateway 轮询路径从不消费，取消永远不完成，直到 Gateway 自发报告 cancelled 或超时。

### P0-6 远程运行成功后被 artifact 拉取失败翻转为 failed

- 位置：`src/main/agent-runtimes.ts:2688-2725`、`:2406-2414`、`:2030-2033`（深度审读确认）
- 现象：`getAgentRuntimeRun` 的 catch 将所有错误（含 artifact 404 / 临时文件写入失败 / SHA 校验失败）当作「Gateway 不可达」，退避 120 秒后把已成功的运行标记为 failed 并报「Gateway 状态连续 120 秒不可达」。启动路径同样会把刚完成运行的 artifact 拉取失败立即判 failed。
- 与 `:2030` 注释「hydration 延迟到终态以免影响健康运行」的设计意图直接矛盾。

---

## 3. 安全问题（P1）

### P1-1 TLS 校验静默降级 → MITM（最高优先级安全项）

- 位置：`src/main/agents-one-remote-gateway.ts:203-215`、`src/main/remote-workspace-gateway.ts:437-449`、`:368-370`（源码直接验证）
- 现象：`requestJson` 对**任意** https 端点捕获 `DEPTH_ZERO_SELF_SIGNED_CERT` / `SELF_SIGNED_CERT_IN_CHAIN` 错误后用 `rejectUnauthorized: false` 重试，无按端点的用户显式开启。
- 触发：用户配置任何 https 远程 Gateway；中间人出示自签证书即可解密全部流量（Bearer token、对话文本、workspace 文件内容、artifact 字节）。

### P1-2 safe-write 恢复可被符号链接绕过

- 位置：`src/main/workspace-protection.ts:88-104`（深度审读确认）
- 现象：`restoreAndDispose` 恢复前只检查 `existsSync(target)`，不复查符号链接。
- 触发：agent 运行期把子目录替换为指向外部的 symlink → 恢复时原文件内容**写入外部目标**，真实位置永不恢复；把文件本身换成 symlink → 恢复被静默跳过，用户后续编辑跟着 symlink 覆写外部文件。

### P1-3 中断恢复的自动回滚会删除用户新文件

- 位置：`src/main/agents-one-backup.ts:1974-1979`（深度审读确认）
- 现象：`recoverInterruptedAgentsOneRestore` 对「恢复前不存在」的路径直接 `rmSync(force)`，无所有权/身份检查。
- 触发：恢复中途崩溃；用户在下次启动回滚前于这些路径创建新文件（如 SOUL.md / desktop 存储）→ 自动回滚静默删除用户文件。快照路径安全，仅「原本不存在」分支有破坏性。

### P1-4 附件 / 图片路径无约束 → 任意文件读取 + 跨机外泄

- 位置：`src/main/sessions.ts:702-716`、`src/main/session-attachment-store.ts:110-138`、`src/main/ipc/register.ts:1831-1941`（read-directory / read-file / open-file-in-editor / read-image-file）、`src/main/media.ts:183-201`（深度审读确认）
- 现象：
  - 消息文本中 `[Image attached at: <任意路径>]` 标记会被主进程读取任意本地文件并转 base64，仅按扩展名和 5MB 上限过滤，路径不限于 staging 目录；续聊时该附件会回传给**远程** Gateway（跨机数据外泄）。
  - `read-file` / `read-directory` / `open-file-in-editor` / `read-image-file` 均无项目目录约束。在 `sandbox + contextIsolation` 下渲染层单独难以利用，但任何注入脚本（markdown/link 载荷、devtools）即可任意读文件/用默认处理器打开文件。
  - 与代码库自身范例不一致：`get-skill-content`（skills.ts:168-181）、`read-logs`（installer.ts:1494-1496）、`open-terminal`（terminal-launcher.ts:339-341）、`open-external`（start.ts:174-182）均有白名单/校验。
- 注：2026-07-09 安全审计（`docs/security-audit-2026-07-09.md`）已标记「任意本地路径操作」为 Medium，至今未处理。

### P1-5 其他次要安全项

- **Workspace 授权永不过期**：`agent-runtimes.ts:2282-2292` 创建 grant 时不带 `expiresAt`（`remote-workspace-gateway.ts:620` 存 null），探测到的远端 `maxGrantSeconds`（`agents-one-remote-gateway.ts:727-739`）从未用于限制授权；吊销失败被 `.catch(() => undefined)` 吞掉（`agent-runtimes.ts:2079`、`:2398-2400`）。超时通常因 Gateway 不可达，此时授权保持有效，远端文件操作持续成功。（深度审读确认）
- **redaction 部分打码泄漏**：`src/shared/redaction.ts:1-6` 值类别 `[^\s"',;}\]]+` 遇空格即截断，`"token": "abc def"` → `"token": "[redacted] def"`，尾部泄漏进日志/UI。（深度审读确认）
- **staged 附件无大小上限**：`src/main/attachment-staging.ts:54-66` + `ipc/register.ts:1103-1108` 对渲染层 base64 解码后直接写盘，无字节限制、无配额/清理。（深度审读确认）
- **大文件读后置检查**：`remote-workspace-gateway.ts:677-686` 先整读文件再比 `maxOperationBytes`（默认 256KB），多 GB 文件可打爆主进程内存。（深度审读确认）

---

## 4. 功能 / 可靠性问题（P2）

1. **ANSI 转义序列泄漏到 RuntimeChat 气泡**：`pi-runtime.ts:466-473`、`claude-code-runtime.ts:492-503`、`codex-runtime.ts:302-311` 的子进程输出只过 `redact()` 不过 `stripAnsi`；`RuntimeChat.tsx:174-194` 的 `responseText` 在无结构化事件时直接返回原始 `run.output`；`shared/runtime-output.ts:51-139` 也不清洗 ANSI。渲染层无任何 `stripAnsi` 使用（仅 `src/main/utils.ts:24-28` 有该函数，旧 Hermes 聊天路径 `hermes.ts:2487` 在清洗、新 runtime 路径没有）。已被失败测试 DOM 证实。（源码直接验证）
2. **中止聊天后 `send-message` promise 永不 settle + DB 轮询停不下来**：`hermes.ts:1510`（AbortError 分支不调 `finish()`）、`:1882-1890`（cancel 不触发 `onDone`）→ `ipc/register.ts:865` 的 invoke 永不 resolve；渲染层 `useChatIPC.ts:243-249` 的 750ms DB 轮询无停止器（`useChatActions.ts:402-408` 的 `handleAbort` 不 stop，且 abort 后 `chat-done`/`chat-error` 永不到达），持续 IPC 流量 + `setMessages` 抖动直到会话结束/卸载。（深度审读确认）
3. **定时任务错过后不补跑**：cron 到期分钟在休眠/重启/春令时跳变中被跳过，无补跑、无错过标记（`task-schedules.ts:340-349`）；interval 格式（`"5m"`）有补跑，两种格式行为不一致。秋令时回拨会触发两次（arguably 正确，但需知悉）。（源码直接验证）
4. **「立即运行」恰逢 cron 到期分钟产生幽灵 skipped 记录**：`triggerTaskSchedule` 不更新 `lastDueAt`，下次 tick `isDue` 仍为真 → 追加一条 `skipped` run 并 rebase。手动触发与定时触发互相污染历史。（深度审读确认）
5. **tick 内 `startRun` 抛异常中断整个 tick**：`task-schedules.ts:698,706,731-741`，`.catch(()=>undefined)` 静默吞错无日志；已完成的 reconciliation 丢失，其后所有任务整 tick 被跳过（写锁窗口内持续复现即全线阻塞）。（深度审读确认）
6. **SSE 解析对合法流不健壮**：`run-stream.ts:103-117`、`hermes.ts:1460-1476` 要求 `"data: "` 带空格且按 `"\n\n"` 切块；CRLF 流（`\r\n\r\n`）解析失败、`[DONE]` 漏判、流挂到 120s 请求超时。（深度审读确认）
7. **full_access 死代码 + 报错自相矛盾**：`agent-runtimes.ts:2222-2229` 对所有非本地 transport 拒绝 full_access，但错误文案称「远程 workspace gateway 可用」，且 `:2263` 分支专门为 gateway full_access 构建 write grant——该分支实际不可达。远程用户选择 full access 得到硬错误。（源码直接验证）
8. **运行记录驱逐泄漏**：`agent-runtimes.ts:2048-2055` 不区分状态驱逐最旧记录；running 记录被逐出后（需 100+ 并发）无法查询/取消，500ms 工作区轮询链与 25ms 轮询 interval 永不清理（`!current` 分支不 `clearInterval`）。（深度审读确认）
9. **恢复流程不等子进程死亡**：`ipc/register.ts:2033` + `agent-runtimes.ts:2810-2820` cancel 仅发出即替换 profile 目录；CLI 子进程可能仍在向 worktree 写入，safe-write 备份目录被毁 → safe_write 删除的文件永久丢失。（深度审读确认）
10. **配置写入非原子**：`config.ts:62-68` `writeFileSync` 直写 desktop.json（运行时注册数据），崩溃可整文件损坏（对比 `runtime-conversation-store.ts:79-84` 正确使用 temp+rename）。（深度审读确认）
11. **其他**：失败 spawn 遗留孤儿 git worktree（`pi-runtime.ts:417-430` 等三处，child `error` 后不 `git worktree remove`）；usage 合并 last-wins 导致 token 统计中途回退（`agent-runtimes.ts:707-711`、`:494-504`）；Gateway 响应体无大小上限可打爆主进程内存（`remote-workspace-gateway.ts:372-376`、`agents-one-remote-gateway.ts:144-147`，仅 artifact 下载有上限）；恢复路径插入会话位置偏移（`session-continuation-store.ts:367-401`，assistant 锚点忽略 tool_result 行）；`updateSessionTitle` 绕过写锁门禁直接开 DB（`session-cache.ts:310-334`）。

---

## 5. 工程债

- **lint 门禁形同虚设**：`npm run lint` 报 640,814 个问题（2,795 errors + 638,019 CRLF 警告，后者主要来自 Windows 换行符），从未通过；errors 集中在 no-require-imports / explicit-function-return-type / no-explicit-any / no-unused-vars / no-empty / no-useless-escape。
- **测试**：179 文件 / 1792 项基础良好，但 1 个已知 flaky 未根治（P0 基线表）、无覆盖率门禁（`test:coverage` 未接入 CI）、`.github/` 目录存在但未发现 Actions 工作流。
- **文档严重滞后**：`SSH-TUNNEL-VPS.md`、`ssh-dashboard-transport.md`、`OPENCLAW_BRIDGE_INTEGRATION_REQUEST.md`、`REMOTE_COORDINATOR_BRIDGE_REQUIREMENTS.md`、`MULTI_AGENT_EXECUTION_PLAN.md`、根目录 `KANBAN_GAP_REPORT.md` 等仍描述已被 Phase 1.3-1.4 删除的 SSH/OpenClaw/Kanban 功能；`AGENTS_ONE_REMOTE_GATEWAY_V1.md` 示例仍含已移除的 `kind: "openclaw"`。
- **仓库残留**：`upstream/hermes-desktop`、`_research/multica` 无关源码树；根目录散落构建日志（`.agents-one-*.log`）、`pr-comment.md`、`Hers-2-Connector-Adaptation-Package-*.zip` 等发布物。
- **依赖审计欠账**：2026-07-09 审计标记 1 high / 4 moderate / 1 low（vite、esbuild、js-yaml、postcss、brace-expansion、@wesbos/code-icons，含 Windows 文件读取/路径穿越类问题），未升级。

---

## 6. 做得扎实的部分

- IPC 契约：194 个 invoke/send 通道与 preload/main 注册零错配；主进程监听器与渲染层订阅均有清理路径。
- 备份/恢复安全：归档解压路径穿越防护严密（拒绝非 File/Directory 条目、绝对路径、`..`、盘符、NTFS ADS、保留名、大小写重复条目；manifest 逐文件 SHA-256 + 计数校验；还原目标双重检查；SQLite 载荷头 + `PRAGMA quick_check`；回滚快照/journal 校验）。
- Electron 安全默认值：`sandbox: true / contextIsolation: true / nodeIntegration: false / webSecurity: true`；外部 URL 协议白名单；webview 过滤。
- secrets 体系：spawn 限速（1s/key、TTL+1s 硬地板）、providerListSafe 单一路径、跨键泄漏防护（S2 守卫）；本地秘密只注入本地子进程，远程运行时仅收 Bearer token。
- 任务协作：依赖图环检测、证据门禁（交付物路径包含 + SHA-256 验证 fail-closed）、存储同步读改写原子性。
- 取消/完成幂等性：Hermes 路径超时自愈；终态不可被后续完成覆盖。

---

## 7. 修复优先级建议

### P0 一批（正确性/数据安全）

1. 退出时终止全部 runtime 任务（`before-quit` 接入 `cancelAllAgentRuntimeTasks`）；取消/超时先 await 子进程死亡再标记终态，taskkill 失败重试。
2. `task-schedules.json` 加互斥写（或迁 SQLite/写锁）；tick 与 IPC 共用同一写通道。
3. cron 校验器与匹配器对齐（支持范围/名称/`L` 或直接接入成熟 cron 库），`nextRunAt` 同步修正；补错过分钟补跑策略。
4. 修正 Gateway 取消语义（失败标 failed、取消中续轮询直至终态）与 artifact 拉取错误分类（网络不可达 ≠ 数据问题）。

### P1 一批（安全）

5. 移除自动 TLS 降级，改为用户显式「忽略证书校验」开关（按端点持久化）。
6. safe-write 恢复与中断回滚补 symlink 复查 / 文件身份校验；中断回滚改为快照比较后仅回滚快照内文件。
7. 附件/图片读取路径约束到 staging 目录；高危 IPC（read-file/read-directory/open-file-in-editor/read-image-file）加路径白名单或项目目录校验。
8. workspace grant 接入 `expiresAt` 与 `maxGrantSeconds`；吊销失败记录日志而非吞掉。

### P2 一批

9. 三处本地 runtime 输出加 `stripAnsi`（同步修复失败测试）；abort 后补发 `chat-done`/`chat-error` 并停止 DB 轮询。
10. 清理陈旧文档与残留目录（upstream/\_research/构建日志）；配置 lint 忽略 CRLF 并恢复门禁；接入 CI（typecheck + test + lint）。
11. 依赖审计升级（vite/esbuild/js-yaml 等）。

---

## 8. 附注

- 本报告为静态评测，未做真实环境下的端到端冒烟（本地 CLI 进程、远程 Gateway 实测、备份恢复实操）——这些场景下 P0-1/P0-2/P0-3 可按触发路径快速复现。
- 所有「深度审读确认」项在修复前建议按文中触发路径先写回归测试再改代码。
