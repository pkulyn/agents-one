# Agents One 功能瘦身备份与恢复记录

本记录用于在删除旧独立管理界面前固化可恢复基线，确保任务对话、任务内多智能体协作、运行时配置和历史数据可在回归失败时及时恢复。

## 变更边界

本轮计划退役以下旧独立管理功能：

- 独立 Task Center 页面及其任务列表、看板、验收和工作树管理入口。
- 独立 Project Center 项目/协作控制面及其左侧导航跳转入口。
- Hermes 原生 Kanban 页面、CLI 适配、IPC 和 Claw3D HQ 镜像。

本轮明确保留：

- 左侧项目文件夹分组和任务对话历史。
- 任务对话内的多智能体协作配置、顺序编排、人工介入、真实产物与验收。
- Runtime 注册、凭据引用、Gateway v1、Workspace Grant、图片/文件产物和定时任务。
- Task Center 的最小后台执行存储，供现有定时任务继续创建、取消和对账 Runtime Run。

## 删除前代码基线

- 基线分支：`hermes-one-phase3-4-integration`
- 基线标签：`agents-one-pre-slim-20260806`
- 标签含义：包含功能瘦身前的完整工作区实现与本记录，不包含本机日志、缓存、用户数据或密钥。

若后续瘦身提交影响核心功能，可直接从标签建立恢复分支：

```powershell
git switch -c restore/agents-one-pre-slim agents-one-pre-slim-20260806
npm.cmd run typecheck
npm.cmd test
```

若只需撤销某一步瘦身，应优先对相应独立提交执行 `git revert <commit>`，不要重写用户数据。

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
3. Hers Gateway v1、图片/文件产物、Workspace Grant 和本地 Runtime 事件链路不受影响。
4. 定时任务仍可创建执行记录、取消和对账；受管工作树仍有安全清理路径。
5. 被删除的 Task Center、Project Center、Kanban 页面、IPC 和文案没有残余入口。

任何一项出现数据丢失、Runtime 不可用、协作记录无法恢复或任务对话失败，立即停止后续删除并回到基线标签或 revert 最近提交。
