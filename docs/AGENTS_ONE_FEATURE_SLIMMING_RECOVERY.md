# Agents One 功能瘦身备份与恢复记录

本记录用于在删除旧独立管理界面前固化可恢复基线，确保任务对话、任务内多智能体协作、运行时配置和历史数据可在回归失败时及时恢复。

## 2026-08-13：Task Center 执行器退役补充

定时任务已经收敛为普通 Runtime 任务对话，独立 Task Center 不再有 UI、IPC、Preload 或现役业务调用。当前代码进一步删除 Task Center 主进程执行器、共享类型、专用测试、孤儿样式及旧 U1 回放脚本；调度只保留一套 `AgentRuntimeRun` 状态机。

删除前完成了真实数据审计：默认 Profile 的 `task-schedules.json` 为 v4、0 条计划、0 条旧 Task Center 引用；`task-center.json` 有 19 条历史任务但 0 条 `queued/running`，其中 10 条为历史 `review_required`，3 个受管 worktree 仍被历史记录引用。代码退役不等于数据清理：现有 `task-center.json` 和 `desktop/worktrees` 均不删除、不改名、不迁移、不重写。

本次额外快照目录：

```text
D:\Agent Console\artifacts\agents-one-pre-task-center-retirement-20260813
```

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `task-center.json` | 6,662,348 | `0865F1CC909D4408B123A92EEE8649F9F5474E3E82E792DBF9A7B9653C658AA4` |
| `task-schedules.json` | 28 | `737B35CF5E7F3D4C5E40E198BE2EF15D10B5EAE2D3725F2B79802C761871E75B` |

`task-center.json` 现在是冻结的回退档案，现役程序不再读取或写入。计划存储升级为 v5：读取到旧 `activeTaskCenterTaskId` 时不再把它视为活动运行；旧 `queued/running` 记录被幂等显示为“旧执行引擎无法恢复，请重新触发”，已完成记录的状态、摘要、对话链接和 `taskCenterTaskId` 指针原样保留。

## 变更边界

本轮计划退役以下旧独立管理功能：

- 独立 Task Center 页面及其任务列表、看板、验收和工作树管理入口。
- 独立 Project Center 项目/协作控制面及其左侧导航跳转入口。
- Hermes 原生 Kanban 页面、CLI 适配、IPC 和 Claw3D HQ 镜像。

本轮明确保留：

- 左侧项目文件夹分组和任务对话历史。
- 任务对话内的多智能体协作配置、顺序编排、人工介入、真实产物与验收。
- Runtime 注册、凭据引用、Gateway v1、Workspace Grant、图片/文件产物和定时任务。
- 2026-08-06 阶段曾保留的 Task Center 后台执行存储已于 2026-08-13 退役；只保留历史 JSON 和关联 worktree 作为冻结回退资料。

## 删除前代码基线

- 基线分支：`hermes-one-phase3-4-integration`
- 基线提交：`7d3dd4d`
- 基线标签：`agents-one-pre-slim-20260806`
- 标签含义：包含功能瘦身前的完整工作区实现与本记录，不包含本机日志、缓存、用户数据或密钥。

若后续瘦身提交影响核心功能，可直接从标签建立恢复分支：

```powershell
git switch -c restore/agents-one-pre-slim agents-one-pre-slim-20260806
npm.cmd run typecheck
npm.cmd test
```

若只需撤销某一步瘦身，应优先对相应独立提交执行 `git revert <commit>`，不要重写用户数据。

本轮瘦身在分支 `agents-one-slim-task-dialog` 上拆为两个可独立撤销的提交：

| 提交 | 内容 | 单独恢复命令 |
| --- | --- | --- |
| `2a69749` | 退役独立 Task Center、Project Center、旧对话任务侧栏和控制面 IPC | `git revert 2a69749` |
| `200686b` | 退役 Hermes Kanban 页面、命令、IPC、本地/SSH 桥接、样式和翻译 | `git revert 200686b` |

如需同时恢复两部分，应按逆序执行 `git revert 200686b`、`git revert 2a69749`；如需完整回到删除前状态，直接从基线标签建立恢复分支。

## 删除前用户数据备份

备份目录：

```text
D:\Agent Console\artifacts\agents-one-pre-slim-20260806-1120\desktop-data
```

备份仅复制已存在的桌面数据文件，原文件未移动、未修改、未删除。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `project-control.json` | 51,454 | `2EDC141CA25D8F8476B865E194B111DE7AD2F0854EEF324FB14498FFFCD99C4A` |
| `project-folders.json` | 133 | `386D56C9EEC81BFE9AC26ABE659FDC0FBD3F8CD3C59C0ABD35E92829802F8E4A` |
| `remote-session-cache.json` | 910,786 | `49B3CC8160A02055DC562EE321C9F909812ED7E4BDB203062C14521183501DF0` |
| `runtime-conversations.json` | 819,593 | `0EE51E7A199439C9CCBFF214AE66AF2E0B10ED66EAA5E25D0E02D828E030AE46` |
| `session-overlays.json` | 494 | `265D5A96038CB9AA24511BFFB5BFED6999F5809244E786A4689600060AA21F1F` |
| `task-center.json` | 1,167,221 | `3A79C38E462A3814913CEE3363BD2F8F3FB18A6243A9A7BA1595E531A9EB5827` |
| `task-collaborations.json` | 36,971 | `D32A15FE0E1799AD3154601650E056652DB9F15454F05AD4647851A147F4C154` |

`project-control.json` 中现有 8 个项目、12 个任务、104 条事件和 10 个产物引用；`task-center.json` 有 16 条任务记录；`task-collaborations.json` 有 7 条任务对话协作记录。瘦身过程不得删除或重写这些文件。

## 用户数据恢复步骤

仅当确认当前数据损坏且应用已完全退出时执行恢复。恢复前先把当前文件复制到新的时间戳目录，避免覆盖后无法反向恢复。

```powershell
$backup = 'D:\Agent Console\artifacts\agents-one-pre-slim-20260806-1120\desktop-data'
$target = 'C:\Users\chenfl\AppData\Local\hermes\desktop'
Copy-Item -LiteralPath (Join-Path $backup 'project-control.json') -Destination (Join-Path $target 'project-control.json') -Force
Copy-Item -LiteralPath (Join-Path $backup 'project-folders.json') -Destination (Join-Path $target 'project-folders.json') -Force
Copy-Item -LiteralPath (Join-Path $backup 'remote-session-cache.json') -Destination (Join-Path $target 'remote-session-cache.json') -Force
Copy-Item -LiteralPath (Join-Path $backup 'runtime-conversations.json') -Destination (Join-Path $target 'runtime-conversations.json') -Force
Copy-Item -LiteralPath (Join-Path $backup 'session-overlays.json') -Destination (Join-Path $target 'session-overlays.json') -Force
Copy-Item -LiteralPath (Join-Path $backup 'task-center.json') -Destination (Join-Path $target 'task-center.json') -Force
Copy-Item -LiteralPath (Join-Path $backup 'task-collaborations.json') -Destination (Join-Path $target 'task-collaborations.json') -Force
```

恢复后重新计算 SHA-256，与上表核对，再启动开发版检查任务对话、协作分工、图片/文件产物和历史重开。

## 回归与停止门槛

每个瘦身提交必须分别验证：

1. Node/Web TypeScript 检查通过。
2. 任务对话可创建、发送、恢复，任务内多智能体协作入口和已保存分工仍可使用。
3. Hermes Gateway v1、图片/文件产物、Workspace Grant 和本地 Runtime 事件链路不受影响。
4. 定时任务仍可创建普通 Runtime 对话、显示实时进度、取消和对账；旧 Task Center 活动标记不会阻塞编辑、删除或重新触发。
5. 被删除的 Task Center、Project Center、Kanban 页面、IPC、执行器和专属文案没有残余入口；历史数据文件哈希不变。

任何一项出现数据丢失、Runtime 不可用、协作记录无法恢复或任务对话失败，立即停止后续删除并回到基线标签或 revert 最近提交。

## 删除完成后的验证记录

### 2026-08-13 执行器退役

- Task Center 退役边界、调度和管理页定向回归 20/20，扩展调度/会话回归 26/26；全量 Vitest 201 个文件、1973 项通过、13 项跳过。
- Node/Web TypeScript、Electron Vite 生产构建、`lat check` 与 `git diff --check` 通过；生产源码没有 Task Center 执行器、共享类型、IPC/Preload 或页面导入残留。
- 删除后再次计算源 `task-center.json` 和本次快照哈希，两者仍为 `0865F1CC909D4408B123A92EEE8649F9F5474E3E82E792DBF9A7B9653C658AA4`；没有删除、覆盖或迁移用户历史数据与关联 worktree。

- `npm.cmd run build` 通过，其中包含 Node/Web TypeScript 检查和 Electron Vite 生产构建。
- 全量 Vitest 输出 189 个测试文件通过、1885 项通过、13 项跳过；测试汇总已完成后，外层 PowerShell 因遗留子进程未及时退出触发 180 秒超时，不存在失败用例。
- 核心边界定向回归 9 个测试文件、67 项通过、4 项跳过，覆盖任务对话、协作配置/工作区、协作存储、定时任务、内部任务执行器、SSH 与删除边界。
- Plugin SDK 基线回归 8/8 已在删除前通过；本轮未修改插件协议代码。
- `lat check` 通过；U5 UI 回放脚本已移除退役页面步骤，保留对话、定时任务、智能体和设置检查。
- 删除后重新核验用户数据：除 `remote-session-cache.json` 的顶层 `updatedAt` 被正在运行的应用正常刷新外，其余六个文件哈希与备份一致；远程会话缓存的 histories、38 条 sessions 及其他内容与备份一致。未执行用户数据删除、迁移或覆盖。
