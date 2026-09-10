# Agents One 目录独立化验收记录（OR-006）

> 日期：2026-09-10
> 结论：**通过**。后续开发、门禁修复和 RC 打包以 `D:\Projects\Agents-One` 为唯一工作目录；旧目录继续作为只读恢复副本保留，暂不删除。

## 1. 迁移来源与仓库身份

- 新目录：`D:\Projects\Agents-One`，位于 `Agent Console` 父目录之外。
- 迁移方式：从旧仓库的已审计固定提交执行 `git clone --no-local --branch main`，没有复制旧工作区或旧 `.git`。
- 恢复标签：`agents-one-pre-migration-20260910`（annotated tag）。
- 固定基线：`564ef2ad30a9491bf8270418df0fe0b0a87a042b`；标签解析结果与克隆初始 HEAD 一致。
- 新仓库 common Git directory 为自身 `.git`，当前分支为 `main`，未配置 upstream tracking branch。
- `origin`：`https://github.com/pkulyn/agents-one.git`；`upstream`：`https://github.com/fathah/hermes-desktop.git`。
- 目标 GitHub 仓库仍不存在或当前账号不可见，因此首次推送、默认分支和远端保护规则仍是公开发布前外部验收项。

## 2. 隔离与可移植性

- 新 clone 未携带旧目录的 `.sandbox`、`.cache`、`.agents-one`、`.belt`、`tmp`、`dist`、`release`、依赖备份、`.env` 或用户凭据。
- 非文档活跃文件中，旧 `Agent Console` 项目路径、个人用户名及固定个人工具目录命中为 0；发布包内容命中为 0。公开内容审计文档中保留的一处旧路径仅用于描述已完成的历史处置，不是运行依赖。
- WSL 探测、Claude Code 实机脚本、Drive 回归脚本及测试夹具已改为环境变量、当前仓库相对资源或通用示例路径。
- `npm run install:clean` 使用锁文件安装、显式安装 Electron，并分别在宿主 Node 与 Electron 内执行内存 SQLite 查询；不依赖本机 Visual Studio C++ 工具链。
- `better-sqlite3` 固定为 `13.0.3`；Node 25.8.2 与 Electron 43.4.1（内嵌 Node 24.18.1、ABI 148）均成功加载 SQLite 3.53.4。
- electron-builder 直接复用已由 `install:clean` 安装和验证的 `node_modules/electron/dist`，避免 Windows 实时扫描器锁住二次解压临时目录；标准 `npm run build:unpack` 已在新 clone 中通过。

## 3. 自动化验证

| 检查 | 结果 |
| --- | --- |
| `npm run install:clean` | 通过，994 packages；宿主 Node/Electron SQLite 双探针通过 |
| `npm run typecheck` | 通过 |
| 迁移路径相关定向 Vitest | 9 个文件，187/187 通过 |
| `npm run build` | 通过 |
| `npm run build:unpack` | 通过，直接复用本地 Electron distribution |
| 全量 Vitest | 205/209 文件通过；1,969 通过、82 失败、9 跳过；仍为 PRD 已登记的 4 个失败文件 |
| ESLint 发布范围 | 仍为已登记的 11 errors（托盘测试 10、voice-stream 1），无新增 |
| `npm audit --omit=dev --audit-level=high` | 仍为已登记的 6 项（2 high、4 moderate），无新增 |

全量验证没有把既有 OR-1/OR-4 缺口误报为迁移成功；这些缺口继续按 PRD 后续工作包修复。

## 4. Windows 产物验收

- 标准未安装目录的 ASAR 共 16,913 个条目；禁入目录命中 0，个人路径命中 0。
- `app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node` 存在；使用打包后的 `agents-one.exe` 以 Electron Node 模式执行 `select 42` 成功。
- 解包后的 ASAR、ASAR unpacked 内容及本轮工作 diff 的 Gitleaks 命中均为 0。
- NSIS 与 portable 产物存放在私有验收目录 `D:\Agents-One-Recovery\OR-006-20260910-005925\windows-artifacts`，不提交仓库：

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `agents-one-0.1.0-setup.exe` | 212,417,864 | `9CE73F87E9645E87B7C1E1EA8D39327A5E04709C7F53A41099E5D7E769A86DB5` |
| `agents-one-0.1.0-portable.exe` | 212,231,510 | `63A38F347E78EC8431D95CA3F7D23394A678C75226BC0A35F7A8CCD8965EA013` |
| `agents-one-0.1.0-setup.exe.blockmap` | 224,339 | `830D9CEF71B4AE1DE34F84580C1177013E61BEE84FE9237625704AA11C7F0C73` |

本地产物未签名，不作为公开 Release；代码签名仍按 PRD 的 CI/发布门禁执行。

## 5. 安全复扫与回退

- Gitleaks 8.30.0 对可移植性提交后的全部 refs 复扫仍只有 2 个 `generic-api-key` 命中，均为 `tests/sibling-hermes-home-drift.test.ts` 与 `tests/validation.test.ts` 的显式测试假值；脱敏报告 SHA-256 仍为 `05F061AB2E0065EC3A53A88F414EA2E19D06D02689663EF8870A76709E150F1D`。
- 原始/脱敏明细、解包扫描目录和构建产物仅留在私有恢复根目录，不进入 Git。
- 旧仓库 `D:\Agent Console\Agents-One`、OR-001 快照和迁移恢复标签继续保留。在独立目录完成后续发布门禁前，不删除旧目录，也不在新旧目录之间双向同步开发。
- 若新目录后续出现迁移特有故障，停止在新目录追加工作，按迁移恢复标签回到固定基线复核；用户 Runtime、会话、计划任务和凭据不参与本次源码目录迁移。
