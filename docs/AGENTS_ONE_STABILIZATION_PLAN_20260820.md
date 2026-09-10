# Agents One 稳定化与发布前详细开发计划

> 制定日期：2026-08-20
> 状态：历史稳定化计划；当前权威执行入口已迁移至开源发布收口 PRD
> 上游计划：[Agents One 开源前最终优化开发文档](./AGENTS_ONE_OPENSOURCE_PLAN.md)
> 评测输入：[Agents-One 评测报告 v1.0](./Agents-One-评测报告_20260819_v1.0.md)

> 2026-09-10 更新：本文档保留 S0–S5 的历史设计与验收依据，不再描述当前门禁状态。当前以 [Agents One 开源发布收口阶段 PRD](./AGENTS_ONE_OPENSOURCE_RELEASE_READINESS_PRD_20260909.md) 为唯一执行入口：OR-0～4 与 OR-500～506 已完成，全仓格式/typecheck/lint/test/audit/build 通过，Windows `v0.1.0-alpha.1` 本地候选已完成打包和启动冒烟；OR-507 远端草稿 Release 与 OR-7 干净机验收仍阻断公开发布。下文所有“当前”“进行中”“唯一阻塞”均是 2026-08-20 当时记录，不能覆盖该结论。

## 1. 决策与目标

Agents One 的 Phase 1 接入统一、Phase 2 遗留清理和 Phase 3 开源准备已完成，但 2026-08-19 至 2026-08-20 的源码复核与基线重跑发现，当前版本仍有 Runtime 生命周期、定时任务一致性、Gateway 终态、安全边界和工程门禁问题。因此 Phase 4 发布暂停，先执行本计划的 S0-S5 稳定化阶段，再生成 RC1 发布候选。

本计划继续遵守既定产品方向：

- 任务对话优先，项目是相关任务对话的容器。
- 本地 Pi、Claude Code、Codex 保留原生 CLI 能力；Agents One 只管理工作目录、权限、运行记录和统一展示。
- 远程智能体统一通过 Gateway v1 接入，不恢复 SSH、旧远程 Hermes 或 OpenClaw 私有传输。
- 定时任务到点创建普通 Runtime 任务对话，不恢复独立 Task Center 执行器。
- 不以稳定化为由重构无关 UI、替换 Runtime id、批量迁移历史或覆盖未知配置。

## 2. 2026-08-20 基线

| 检查项                 | 结果                                      | 结论                                                                 |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| Node/Web TypeScript    | 通过                                      | 类型基线可用                                                         |
| Electron Vite 生产构建 | 通过                                      | 构建链可用                                                           |
| Vitest 全量            | 1782 通过、1 失败、9 跳过                 | 发布门禁失败；失败会在 RuntimeChat 与 Gateway restart 时序用例间漂移 |
| 两个不稳定文件定向复跑 | 61/61 通过                                | 属于全量负载型 flaky，不能按固定单例处理                             |
| ESLint 干净仓库范围    | 54 errors、约 70,781 个 Prettier warnings | 真实 error 可控；CRLF 需独立治理                                     |
| `npm audit --omit=dev` | 1 critical、10 high、2 moderate、1 low    | 发布阻断；`tar` 为直接 critical 依赖                                 |
| lat.md 本地替代校验    | 253 个链接、0 失效                        | 知识链接基线可用                                                     |
| Git                    | 当前分支领先 `main` 39 个提交             | 发布前必须整理分支与目标远端                                         |
| Remote                 | `origin` 仍指向本地上游目录               | 尚未接入 `github.com/pkulyn/agents-one`                              |

报告数字的使用口径：

- 报告中的 P0/P1 代码结论大部分成立，以修复前新增回归测试为最终证据。
- `npm run lint` 会扫描本地 `.sandbox` 历史 worktree，64 万级结果不能代表干净仓库；CI 与发布门禁必须显式排除本地产物。
- 仓库已有 CI/release workflow，但 lint 当前非阻断、release workflow 有旧 Hermes 品牌，且尚未在目标 GitHub 仓库运行。
- `upstream/` 与 `_research/` 是工作区同级目录，不属于 Agents-One 仓库清理范围；构建日志与 Hers ZIP 为 ignored 本地产物。

## 3. 总体顺序与发布闸门

```text
S0 基线与复现
  -> S1 Runtime 生命周期
  -> S2 定时任务一致性
  -> S3 Gateway 与传输安全
  -> S4 文件、附件与恢复边界
  -> S5 可靠性、依赖与工程门禁
  -> RC1 真实回放与发布
```

| 阶段                  | 当前状态   | 预计投入 | 主要交付物                                                                                    |
| --------------------- | ---------- | -------- | --------------------------------------------------------------------------------------------- |
| S0 基线与复现         | 进行中     | 0.5-1 天 | 稳定化标签、数据快照、P0/P1 红色测试与问题清单                                                |
| S1 Runtime 生命周期   | 自动化完成 | 2-3 天   | 本地可等待取消、退出/恢复静默门禁及 Windows 真实进程树回归已落地；RC1 再做五 Runtime 人工回放 |
| S2 定时任务一致性     | 自动化完成 | 2-3 天   | cron、串行写入、原子存储、错过策略及本地 civil-time 语义已验证；RC1 再做睡眠/时区人工回放     |
| S3 Gateway 与传输安全 | 自动化完成 | 2-4 天   | 取消状态机、artifact 解耦、TLS/Grant/响应上限及 SSE 兼容性已验证；RC1 再做真实 Gateway 回放   |
| S4 文件与恢复边界     | 自动化完成 | 3-5 天   | 授权路径、附件约束、symlink、恢复身份与 capability 迁移已收口；RC1 再做真实回放               |
| S5 工程门禁           | 进行中     | 3-4 天   | flaky 清零、lint/依赖/CI/release workflow 收口                                                |
| RC1 发布候选          | 阻塞       | 2-3 天   | 五条 Runtime、调度、恢复和 Windows CI 发布回放                                                |

S1-S4 是发布关键路径。任何阶段出现用户数据损坏、Runtime 配置丢失、历史不可恢复或原工作区越权写入，立即停止后续阶段并回退该阶段提交。

### 2026-08-20 实施状态（第 1 轮）

- S1：本地 CLI 的取消已改为等待真实进程关闭，退出协调器先停止入场与调度、再等待取消结果；新增 Electron 事件级回归确认重复 `before-quit` 不会重复取消，且未收到 Runtime 静默结果前不允许 `app.quit()`。三个 CLI Runtime 共用可等待的 Windows `taskkill /T` 进程树终止器，真实 Node 父子进程回归确认父/子 PID 均已消失。RC1 仍需以五条真实 Runtime 黄金路径做人工回放。
- S2：cron 校验与匹配共用同一语法；手动触发、tick、创建、编辑、启停和删除已纳入同 Profile 串行 mutation queue，存储使用同目录临时文件+rename 原子替换。错过执行默认合并为一轮、记录 `trigger: missed` 与原 `dueAt`；一个计划启动失败会记录脱敏诊断并继续处理同 tick 的其他计划。100 次并发手动触发、100 次 edit/delete 竞争及本地 civil-time 重复分钟保护回归均已通过。DST 前跳跳过不存在分钟、回拨不重复派发、时区变化不回放旧分钟并按当前本地时间重算，RC1 再做睡眠/时区人工回放。
- S3：已移除 HTTPS 自签证书静默降级；Gateway 取消失败或仍为 running 时不再伪造确认。取消/超时收到 `cancelling` 后以 1 秒间隔、最长 60 秒轮询终态，无法确认则明确失败；artifact 下载失败保留成功 Run、标注不可用原因。Renderer 现在可对单个不可用产物发起受限重试（主进程最多三次，不会重跑任务），成功后更新同一条持久化对话。Gateway JSON 响应上限为 4 MiB。Workspace Grant 现在显式取任务超时、桌面上限和 Relay 上限三者最小值，撤销失败会留下脱敏诊断。共享 SSE 解析器已覆盖 LF/CRLF、`data:`/`data: `、多行 data、残帧及 `[DONE]`；S3 自动化验收完成，RC1 再做真实 Gateway/Grant/产物回放。
- S4：媒体 IPC 已限制为临时媒体目录和登记项目根，并在 realpath 后判定；默认应用打开、图片读取同样受此边界约束，终端只允许登记项目根。目录读取、文本读取和 `prepare-project-context` 现在也必须解析到主进程保存的项目根或本次原生选择器创建的工作区能力；任务启动拒绝未获此授权的 `workspace`，junction/symlink 解析后仍不得越界。二进制/文档附件现在一律先复制至主进程 `desktop-staging`，Runtime 拒绝 Renderer 提供的原始路径；staging 实行 20 MiB 单文件、100 MiB 单会话和 1 GiB 总量拒绝式配额，删除会话会清理对应目录。历史纯文本中的图片路径若不属于授权根会保留原文、不会读取；safe-write 已阻断父目录 symlink；恢复遇到身份不明的新文件会停止并保留 journal。Runtime artifact 已完成 opaque 迁移：`start/get/retry` 与计划手动触发返回值剥离 `worktreePath` 和 artifact `path`，Renderer 只保存 `runId + artifactId`，由专用主进程 IPC 解析、打开、预览或另存；持久化 Runtime 对话不再写入 artifact 绝对路径。受管 implementation worktree 由运行 ID 派生稳定 `worktree-*` 标识，路径继续仅由主进程持有。项目登记已增加稳定 `project-*` capability id，Dashboard、普通聊天、协作记录/证据、最近会话、侧栏分组和项目菜单均只传 `workspaceId + 展示名`；项目打开、重命名、置顶、归档和移除均在主进程重新解析 capability。新会话工作区绑定会校验登记 ID，未验证的 ID 不得降级成 Renderer 路径。Runtime 工作树的目录读取、文件/图片预览、默认应用打开和终端启动已改为 `workspaceId + 相对路径` 专用 IPC，恢复后不依赖保存绝对路径。旧路径记录只读兼容、不会重新授权或写入新记录。
- S5：已收敛 ESLint 输入、更新 release 品牌及直接依赖；`src`/`tests` 无缓存 ESLint 的真实 error 已为 0，CI lint 恢复阻断。Electron 锁文件已由 39.8.10 升至 43.4.1（Node ≥22.12，本机为 25.8.2），`npm audit --omit=dev` 已为 0 漏洞。干净验证副本已从 Electron 43.4.1 官方 ZIP 恢复二进制，SHA-256 `c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a` 与 `electron/checksums.json` 一致，`electron --version` 为 `v43.4.1`；因此“Electron 下载失败”不再是门禁。正常 `npm ci` 仍在 `better-sqlite3@12.8.0` 的 Electron ABI 148 重建处受本机缺少 Visual Studio C++ 工具阻断，且该版本未发布 ABI 148 Windows 预编译资产。安全边界变更后的全量 Vitest 已得到 183 文件、1809 通过、9 跳过（120.73s）；此前三轮 180/1796 的稳定结论不能与改码后的这一轮混算，S5 仍需在当前 lockfile、干净 checkout 中重新完成连续三轮及 `build:win`。当前测试环境因一次受限时间内的 `npm ci` 中断，临时由可恢复的链接层提供测试依赖；RC1 前仍须在具备受支持原生构建环境的干净 checkout 按当前 lockfile 完成正常 `npm ci` 并复跑全部门禁。

### S4/S5 收口顺序（本轮后续执行）

1. 已完成项目选择 API、最近项目/侧栏、普通聊天和协作记录的 capability 迁移。Dashboard 通过主进程代理创建/切换工作区会话；新持久化记录仅写 id 与展示名。旧绝对路径记录只读兼容，未验证的记录不重新授权。
2. 已给 implementation worktree 分配运行记录内稳定 ID；协作证据只保留相对路径、hash、来源与运行 ID，远程角色提示继续脱敏，不能把本机路径写入持久化交接材料。
3. 仅剩 S5/RC1 门禁：将正常 `npm ci`、Electron 43.4.1/native module 检查、`npm run typecheck`、`npx eslint --no-cache --quiet src tests`、S1-S4 定向组、连续三轮 `npm test`、`npm run build`、`npm run build:win` 与 `npm audit --omit=dev --json` 放入 Windows CI 手动验收 workflow（`.github/workflows/rc1-windows.yml`）。任何一次计数不一致均保留日志并回到对应 flaky/依赖问题，不进入 RC1。

当前已验证：独立副本的 `npm ci --ignore-scripts` 可完成，Electron 43.4.1 已按官方 checksum 恢复并可执行，Node/Web TypeScript、真实 error lint、生产依赖审计（0 漏洞）和本轮不依赖 Electron 二进制的 S4 定向组（6 文件、54 项）均通过。随后一次生产构建发现文件树依赖 `@wesbos/code-icons` 会把 Node 专用 `stringify.js` 打入 Renderer；已替换为浏览器安全的通用文件图标，当前 `npm run build`（Node/Web 类型检查 + Electron Vite 三端构建）通过。当前唯一已确认阻塞：正常 `npm ci` 的 `better-sqlite3@12.8.0` 为 Electron ABI 148 重编译，需要未安装的 Visual Studio C++ 工具；GitHub Release 未提供该版本/ABI 的 Windows 预编译包。对 npm 可用的后续 `12.9.0`、`12.10.0`、`12.10.1`、`12.11.1` 和当前 `13.0.3` 的发布资产复核同样没有该包，不能以普通依赖升级绕过；隔离地尝试未发布到 npm 的上游源标签也未在两分钟内完成，未改动项目依赖或锁文件。因此 RC1 的正常安装、全量三轮、`build:win` 与安装包冒烟改由具备受支持原生编译环境的 Windows CI/构建机完成，不能以本机 `--ignore-scripts` 结果替代。

建议单人投入约 15-22 个工程日，不包含等待远程 Connector 配合、证书环境或商店审核的时间。每个编号工作包单独提交，禁止把多个安全边界合成一个不可回退的大提交。

## 4. S0：基线冻结与问题复现

目标：建立可审计、可回退的修复起点，先证明问题再改代码。

### S0.1 文档与问题清单

- 本文档作为后续开发的权威执行计划。
- `AGENTS_ONE_NEXT_STAGE_PLAN.md` 保留为历史阶段方案，不再作为执行入口。
- `AGENTS_ONE_RELEASE_REGRESSION_MATRIX.md` 保留历史验收记录，但发布门槛改由本文档第 11 节控制。
- 评测报告原文不改写；勘误、复测和处置状态记录在本文与进展日志。

### S0.2 代码与数据恢复点

- 记录当前 commit、分支领先数和所有标签。
- 修复开始前创建新的稳定化基线标签。
- 复核 Agents One 数据备份和恢复命令，确认快照不包含 Token/API Key。
- 不把未跟踪评测报告、日志、构建产物或本地测试数据误提交进功能 commit。

### S0.3 失败复现测试

修复前至少补齐以下红色测试：

- 正常退出时存在 Pi/Claude/Codex 活动子进程。
- 本地 cancel/timeout 发出后，子进程尚未 `close`。
- 同一计划双击立即运行、tick 与删除并发、tick 与编辑并发。
- cron 保存成功但 `nextRunAt` 不存在。
- Gateway 取消请求失败、取消响应仍为 running、成功 Run 的 artifact 下载失败。
- 未授权自签证书、附件文本注入任意绝对路径、路径 IPC 越过项目根。
- safe-write 目标或父目录被替换为 symlink。
- 中断恢复时，原本不存在的目标已出现身份不匹配的新文件。

### S0 验收

- 每个 P0/P1 至少有一个稳定复现测试或明确的人工故障注入步骤。
- 基线标签、数据快照、回滚命令和影响模块记录完整。
- 不修改生产行为。

## 5. S1：Runtime 生命周期与静默收敛

目标：终态必须反映真实进程/远端状态；恢复、退出和取消不得与仍在写文件的任务并行。

### S1.1 统一本地进程控制契约

涉及模块：`pi-runtime.ts`、`claude-code-runtime.ts`、`codex-runtime.ts`、`agent-runtimes.ts`。

- 将 `cancel(): void` 收敛为可等待的终止契约，例如 `cancel(): Promise<TerminationResult>`。
- 监听真实 `close/exit`，区分未启动、正常退出、强制结束、taskkill 失败和超时。
- Windows 先执行进程树终止，失败后进行有界重试/兜底；不得无限等待。
- 只有确认子进程已结束后，才写入 `cancelled` 或 `timed_out`。
- 保留终态幂等：迟到的 completion 不得覆盖已确认终态。

### S1.2 应用退出协调器

涉及模块：`app/start.ts`、`agent-runtimes.ts`、调度器和数据库关闭路径。

- `before-quit` 进入一次性的 quiescing 状态，停止新任务和计划写入。
- 取消所有 Runtime，等待本地子进程退出和远端取消确认，设置总截止时间。
- 完成 Runtime、Workspace Grant、Dashboard、数据库和临时文件的有序关闭后再允许退出。
- 正常退出与强制杀进程分开描述；本阶段不声称能在 OS 强杀或主进程崩溃时执行清理。
- 后续如仍需覆盖崩溃级孤儿，再单独评估 Windows Job Object/监护进程，不在本工作包顺手引入原生依赖。

### S1.3 备份恢复静默门禁

- `cancelAllAgentRuntimeTasks()` 返回真实静默结果，而不是仅统计取消请求已发出。
- 恢复替换 Profile 数据前，确认所有本地进程退出、调度 tick 结束、数据库连接关闭。
- 任一进程未在截止时间内退出时中止恢复，保留原数据和恢复事务信息。

### S1.4 运行记录生命周期

- 运行记录驱逐只淘汰终态记录，不得驱逐 `running`。
- `runAgentRuntimeTask` 遇到记录意外丢失时清理 interval 并返回明确失败，不得永久轮询。
- spawn 失败后清理本轮新建的受管 worktree，不触碰历史 Task Center worktree。

### S1 验收

- Pi、Claude Code、Codex 各完成正常取消、超时和退出关闭测试。
- 取消终态产生时对应 PID/进程树已不存在。
- 应用正常退出后不再发生工作区写入，Grant 已撤销或留下明确失败诊断。
- 恢复流程不会在 Runtime 仍活动时替换任何数据目录。

## 6. S2：定时任务一致性与 cron 语义

目标：计划任务的每次变更具有单一串行化写入顺序，创建成功的表达式一定能计算和触发。

### S2.1 Profile 级调度写入协调器

涉及模块：`task-schedules.ts` 及其 IPC 消费者。

- 为每个 Profile 建立单一 mutation queue/mutex。
- create/update/delete/trigger/tick/reconcile 全部通过同一写入通道。
- 存储采用同目录临时文件加 rename 的原子替换。
- 依赖 Electron 单实例锁处理同一数据目录的单进程所有权；如仍可能跨进程写入，再增加 revision/CAS。
- Windows 同目录临时文件 `rename` 遇到短暂 `EPERM`/`EBUSY`/`ENOTEMPTY` 时允许严格有界重试；不得删除旧目标、不得对其他错误重试或将写入失败伪装为成功。
- 异步启动失败不得把过期 store 快照重新写回。

### S2.2 并发策略

- 双击立即运行只允许产生一个活动 Run；第二次严格按 `skip/queue/replace` 处理。
- delete/update 与 tick 的先后顺序由 mutation queue 决定，禁止删除复活和编辑覆盖。
- 每个计划单独捕获错误；一个坏计划不能中断本 tick 的其他计划或已完成对账。
- runner 的 catch 必须记录脱敏诊断，不再静默吞错。

### S2.3 cron 契约

- 先确定并文档化五字段语法：数值、`*`、列表、范围、步长、星期 0/7、可选英文名称和时区策略。
- `L` 等非统一扩展只有在选定解析器明确支持时才开放；否则保存时直接拒绝并给出中文错误。
- 校验、`nextRunAt`、`isDue` 使用同一解析器和同一时区。
- 不手写第二套近似 cron 语义；新增依赖前先完成安全审计与锁文件评估。

### S2.4 错过与手动运行语义

- 默认采用“合并补跑”：应用休眠/重启后最多补一轮，不回放所有错过分钟。
- 补跑记录明确标记 missed/coalesced，不能伪装成准时执行。
- 手动触发更新独立游标，不产生随后一条幽灵 skipped 记录。
- cron 以运行桌面的本地 civil time 解释：DST 前跳中不存在的分钟不补发；回拨重复的本地分钟只派发一次；时区变化不回放旧时区分钟，而是在下一次 tick 以当前本地时区重新计算游标。以上语义必须有回归说明。

### S2 验收

- 并发触发、删除、编辑各至少运行 100 轮无重复、复活或覆盖。
- 所有可保存的 cron 均能计算下一次运行；所有不支持表达式均在保存时拒绝。
- tick 单任务失败不影响其他任务，错误可从诊断日志定位。
- 定时任务仍只支持已启用的本地 CLI Runtime，并继续创建普通 Runtime 对话。

## 7. S3：Gateway 终态与传输安全

目标：执行结果、取消结果和 artifact 可用性相互独立；远程认证流量默认 fail-closed。

### S3.1 Gateway 取消状态机

- 取消网络请求失败时不得返回 `true`，也不得假装已取消。
- 取消响应仍为 `running` 时保留 `cancelRequested`，继续有界轮询直至远端终态。
- UI 明确区分“取消已请求”“取消已确认”“取消失败/无法确认”。
- 超时触发远端取消后，也必须记录取消是否得到确认；不能仅以本地计时器推断远端已停止。

### S3.2 artifact hydration 解耦

- 先持久化远端 Run 的权威终态，再独立处理 artifact 下载与本地暂存。
- artifact 404、临时网络错误、SHA/大小错误和本地写入失败分别分类。
- 已成功的 Run 不因 artifact 失败翻转为 failed；产物显示“暂不可用/校验失败”并允许有界重试。
- Renderer 仍不得接触 Gateway Bearer Token。

### S3.3 TLS 与证书

- 删除自签证书错误后的自动 `rejectUnauthorized:false` 重试。
- 默认 HTTPS 严格校验，连接失败给出证书诊断但不泄漏 Token。
- 如确需支持私网自签名证书，单独设计按 Runtime/端点的显式授权；优先考虑证书指纹固定，不提供全局静默降级。
- 端点变化后原授权失效并要求重新确认。

### S3.4 Workspace Grant 与网络上限

- Grant `expiresAt` 受任务超时、桌面上限和远端 `maxGrantSeconds` 共同限制。
- revoke 失败写入脱敏日志和运行诊断，不再吞掉。
- Gateway JSON/SSE/错误体设置总字节上限；Workspace read 先 stat 再按上限分配/读取。
- SSE 同时支持 LF/CRLF、`data:` 与 `data: `，正确处理多行 data 和 `[DONE]`。

### S3 验收

- 取消请求的返回值与远端真实状态一致。
- 成功 Run 的 artifact 故障不会改变 Run 终态。
- 未显式授权的自签证书无法建立携带 Token 的连接。
- Grant 到期、撤销失败、超大响应和合法 SSE 变体均有自动化覆盖。

## 8. S4：文件、附件与恢复安全边界

目标：所有 Renderer 可达的本地文件操作都必须从主进程的授权对象解析，恢复操作必须核对文件身份。

### S4.1 统一授权路径解析器

- 为项目根、受管 worktree、desktop-staging、Runtime artifact 临时目录建立明确授权类型。
- Renderer 传递会话/项目/artifact 标识和相对路径，主进程解析真实绝对路径。
- 所有解析执行 realpath/lstat、根目录包含关系、symlink、Windows 设备名/ADS 与 UNC 检查。
- `read-file`、`read-directory`、`read-image-file`、`open-file-in-editor` 统一接入该边界。

### S4.2 附件和历史兼容

- `[Image attached at: ...]` 只能引用已登记在当前会话附件记录中的路径或当前 staging 资产。
- 用户消息文本、模型输出或历史纯文本不得直接授权任意绝对路径。
- 无法验证的旧标记保留文字提示，不读取、不转 base64、不发送到远端。
- stageAttachment 增加单文件上限、每会话配额、总配额和清理策略。

### S4.3 safe-write 恢复

- 恢复前逐级复查父目录和目标的 lstat/realpath。
- 原文件缺失但目标为 symlink、目录或其他类型时 fail-closed，不向该目标写入。
- 需要替换异常对象时必须先保留证据并采用同目录原子恢复，不静默覆盖外部目标。

### S4.4 中断恢复文件身份

- 恢复事务为新建目标记录预期 payload hash/大小或等价身份。
- 启动回滚仅删除仍匹配事务写入身份的文件。
- 如果目标已经出现不同内容，停止自动删除并保留救援目录，提示人工处理。

### S4.5 其他边界补齐

- redaction 覆盖带空格的 JSON/键值秘密、Authorization、Cookie 和 URL 参数。
- `desktop.json` 等配置改为原子写，继续保留未知键。
- `updateSessionTitle` 等写入遵守恢复写锁。
- 会话续接位置、usage 单调合并和大文件读取分别补回归测试。

### S4 验收

- 任意路径 IPC 和文本附件注入均无法越过授权根。
- symlink 攻击不能让 safe-write/恢复写到授权根外。
- 中断恢复不会删除身份不匹配的新文件。
- 备份导入攻击矩阵、完整往返和崩溃恢复全部通过。

## 9. S5：可靠性、依赖和工程门禁

目标：把目前“可构建但不可稳定放行”收敛为可重复、可自动阻断的发布基线。

### S5.1 Runtime 与聊天可靠性

- 在本地 Runtime 公共输出边界统一 strip ANSI，同时保留结构化事件。
- Hermes abort 必须 settle 主进程 promise，并通知 Renderer 停止 DB 轮询。
- 修复 SSE 解析、worktree spawn 失败清理、usage 统计回退和会话续接锚点偏移。
- 远程 `full_access` 保持不开放；UI 不提供无效选项，错误文案与 `safe_write + 删除确认` 产品契约一致。

### S5.2 测试稳定性

- `gateway-restart` 健康探测不再依赖 50ms 真实计时竞争，改用可控时钟/信号。
- RuntimeChat 轮询 mock 使用持续、可耗尽检查或显式状态机，禁止依赖全量负载下的调用次数偶然值。
- 全量测试连续运行三次，三次文件数、通过数和跳过数一致。
- 为 S1-S4 的关键并发/故障注入建立专门测试组，避免只在全量套件偶发覆盖。

### S5.3 lint 与行尾

- ESLint 永久排除 `.sandbox/**`、`.agents-one/**`、worktree、构建产物和缓存。
- 先清零干净仓库范围 54 个真实 error。
- CRLF 治理单独提交：统一 `.gitattributes`/Prettier 策略，避免功能 diff 混入全仓行尾重写。
- 修复后 CI lint 取消 `continue-on-error`。

### S5.4 依赖安全

- 单独升级直接 critical/high：优先 `tar`、`electron-updater`、Electron、Vite、YAML。
- 处理 `@wesbos/code-icons` 自带旧 Vite 的依赖链，评估升级、降级或替换。
- 每组升级分别运行备份安全测试、更新器测试、typecheck、全量 Vitest 和生产构建。
- 不直接执行不可审计的全量 `npm audit fix`；锁文件变化必须人工复核。

### S5.5 CI、发布流与文档

- CI 必须阻断 typecheck、lint、Vitest 和生产 build。
- 建立覆盖率基线，先防止下降，再按模块逐步提高；不在首轮强行设不现实的全仓高阈值。
- release workflow 删除旧产品品牌和无实际动作的 landing-page wait job。
- 更新 README、Runbook、回归矩阵和过时 SSH/OpenClaw/Kanban 文档的历史状态。
- `pr-comment.md` 等发布无关跟踪文件单独审计，不与功能修复混合删除。

### S5 验收

- 干净 checkout：lint 0 error，typecheck/test/build 全绿。
- 全量测试连续三次稳定通过。
- `npm audit --omit=dev` 无 critical/high；如上游暂时无修复，必须记录可利用性、隔离措施和明确期限，由发布负责人单独批准。
- CI 在目标仓库真实运行并能阻断故意制造的失败。

## 10. RC1：发布候选与真实回放

目标：在真实 Windows 普通用户环境和目标 GitHub 流水线验证发布候选。

### RC1.1 五条 Runtime 黄金路径

当前黄金集合为：

1. 内置 Hermes `local-api`。
2. Pi `local-cli`。
3. Claude Code `local-cli`。
4. Codex `local-cli`。
5. Hers-2 作为通用 Gateway v1 参考实现。

每条至少覆盖新对话、连续对话、附件、项目上下文、取消、超时、错误展示、历史重开和产物；本地 CLI 额外覆盖工具/技能/MCP/Shell 原生能力，Gateway 额外覆盖 artifact 和 Workspace Grant。

### RC1.2 定时任务与恢复

- 手动、准时、错过补跑、queue/replace/skip、重启失联和删除/编辑竞争回放。
- 导出备份、全新目录导入、损坏归档拒绝、prepared/committed 中断恢复、凭据保留和远程重新授权。
- 正常退出活动 Runtime，确认无孤儿进程和退出后文件写入。

### RC1.3 Windows 发布

- 使用普通用户权限从干净目录执行 `npm ci`、typecheck、test、build、`build:win`。
- NSIS 和 portable 均启动，设置页、Runtime 探测、备份恢复和更新元数据可用。
- 不要求管理员权限，不安装系统服务或驱动。

### RC1.4 分支与远端

- 将稳定化分支以可审查方式合入 `main`，处理当前领先提交，不做历史破坏性重写。
- 将目标 GitHub 远端与本地上游远端分开命名，避免误推送。
- 先运行 CI，再创建候选 tag；发布 workflow dry-run 通过后才允许正式发布。

## 11. 最终发布门槛

以下条件必须全部满足：

- 无未处置的 P0/P1 数据安全、执行正确性或凭据泄漏问题。
- typecheck、lint、Vitest、production build 全部为阻断式绿色。
- 全量 Vitest 连跑三次无 flaky。
- 生产依赖无 critical/high，或有发布负责人书面接受的不可利用例外。
- 五条 Runtime 黄金路径和定时任务矩阵通过。
- 备份、恢复、回滚和 symlink/路径攻击矩阵通过。
- Windows 普通用户安装版和便携版通过。
- CI/release workflow 在 `pkulyn/agents-one` 真实运行，品牌、版本、artifact 名称和更新元数据一致。
- 进展日志、Runbook、回归矩阵、README、lat.md 和 PowerMem 已同步最终事实。

## 12. 提交、验证与记录纪律

每个工作包遵循：

1. 在进展日志记录事前影响评估：原因、数据、消费者、失败模式、回退和验证。
2. 先提交复现测试，再提交最小生产修复；纯机械行尾/格式改动独立提交。
3. 先定向测试与类型检查，再扩展回归、生产构建和真实手工回放。
4. 受保护配置写入前先读后写，保留未知键；不批量重建 Runtime 或历史。
5. 完成后更新本文状态、进展日志、受影响的 lat.md，并运行 `lat check`。
6. 重大结论同步 PowerMem，随后用语义检索复核；本地文档始终是审计权威。

建议提交粒度：`test(...)` 复现、`fix(...)` 修复、`docs(...)` 记录分开；任何工作包都应可独立 revert，不依赖未记录的本机数据。

## 13. 发布后再做的优化

以下内容不进入本轮关键路径：

- 定期自动备份与保留策略。
- Adapter 注册表方案 C。
- 新 Runtime 类型和旧 OpenClaw 私有传输恢复。
- 大规模 UI 重构或视觉换肤。
- 全仓高覆盖率目标、性能专项和历史数据格式压缩。
- 崩溃/强杀级 Windows Job Object 方案；仅在正常退出收敛仍不足时单独立项。

## 14. 标准验证命令

每个工作包先运行对应定向测试，再逐级扩大到以下基线。企业 Windows 环境统一使用 `npm.cmd`/`npx.cmd`：

```powershell
npm.cmd run typecheck
npm.cmd test -- --run
npm.cmd run lint
npm.cmd run build
npm.cmd audit --omit=dev
git diff --check
```

阶段定向测试建议：

| 阶段 | 优先测试文件/范围                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| S1   | `tests/agent-runtimes.test.ts`、三个本地 CLI Runtime 测试、`tests/agents-one-backup.test.ts`、新增 app shutdown 测试 |
| S2   | `tests/task-schedules.test.ts`、Runtime conversation store、调度 Renderer 组件测试                                   |
| S3   | `tests/agents-one-remote-gateway.test.ts`、`tests/remote-workspace-gateway.test.ts`、Event Stream/SSE 测试           |
| S4   | backup、session attachment、sessions history、IPC handlers、workspace protection 测试                                |
| S5   | RuntimeChat、gateway restart、全量 lint/test/build、依赖审计                                                         |
| RC1  | 全量自动化、Windows `build:win`、五条 Runtime 与备份恢复人工回放                                                     |

项目要求的 `lat check` 优先直接执行；若当前机器仍未安装 `lat` CLI，使用仓库现有 `.agents-one/verify-lat-links.js` 做链接兜底，并在进展日志明确记录“替代校验”，不能把替代脚本描述为正式 `lat check`。
