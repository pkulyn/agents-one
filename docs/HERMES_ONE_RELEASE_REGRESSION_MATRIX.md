# Hermes One 发布前回归矩阵

日期：2026-07-14

本矩阵用于 Phase 5 发布前验收。每次 Windows 发布候选版本至少执行一次完整矩阵；涉及 Runtime、Task Center、Project Center、安全或存储层改动时，也应执行对应分组。

## Runtime 与任务执行

| 编号 | 场景 | 验收方式 | 通过标准 |
| --- | --- | --- | --- |
| R1 | 远程 Hermes 对话 | 手工 | 可正常发送问题、接收回复；错误事件不混入正文。 |
| R2 | 远程 Hermes coordinator planning | 手工 + 自动测试 | Bridge 强制只读规划可用，计划 artifact 可进入 Task Center。 |
| R3 | 远程 OpenClaw coordinator planning | 手工 + 自动测试 | Bridge 能力探测健康，计划 artifact 可预览生成 Project tasks。 |
| R4 | Codex analysis | 手工 + 自动测试 | Task Center 可运行分析任务，输出可读，可取消。 |
| R5 | Codex implementation | 手工 + 自动测试 | 只写隔离 Git worktree，产出 worktree/diff artifact，原工作区不被直接修改。 |
| R6 | Claude Code analysis | 手工 + 自动测试 | `claude auth status` 已登录，analysis 使用 `plan` 权限，输出进入 Task Center。 |
| R7 | Claude Code implementation | 手工 + 自动测试 | 只写隔离 Git worktree，产出 worktree/diff artifact，可取消、可超时。 |

## Project Center 与协作流

| 编号 | 场景 | 验收方式 | 通过标准 |
| --- | --- | --- | --- |
| P1 | 指定任意 Runtime 作为 coordinator | 手工 | Hermes/OpenClaw 走远程 Bridge；Codex/Claude Code 走本地只读分析。 |
| P2 | Coordinator plan 预览 | 手工 + 自动测试 | 结构化 plan 可解析为任务草稿；非结构化 plan 降级为人工复核任务。 |
| P3 | 从 plan 创建 Project tasks | 手工 + 自动测试 | 用户确认后才创建任务；重复点击不会重复生成。 |
| P4 | 建议 Runtime 映射 | 手工 + 自动测试 | `suggestedRuntimeKind` 优先筛选候选 Runtime，仍由用户手动 Assign。 |
| P5 | Context package | 手工 | 只包含相关依赖任务与 artifact 引用，不泄露 secret。 |

## 安全与恢复

| 编号 | 场景 | 验收方式 | 通过标准 |
| --- | --- | --- | --- |
| S1 | 输出脱敏 | 自动测试 | 日志、错误、diff/final artifact 不显示 Token、API Key、Authorization、Cookie。 |
| S2 | 子进程环境 | 代码审查 | Codex/Claude Code 仅继承最小必要环境变量，不通过 shell 拼接命令。 |
| S3 | Worktree 路径校验 | 自动测试 | 打开/清理操作只能作用于 Hermes One 用户数据目录下的受管 worktree。 |
| S4 | 重启恢复 | 自动测试 + 手工 | 应用重启后遗留 running task 被标记为 failed/recoverable，历史不丢失。 |
| S5 | 远端错误分类 | 手工 | 502、403、证书、WebSocket 断连能被定位，不泄露请求头或密钥。 |

## Windows 发布

| 编号 | 场景 | 验收方式 | 通过标准 |
| --- | --- | --- | --- |
| W1 | 开发构建 | 自动 | `npm.cmd run build` 通过。 |
| W2 | 单元/组件回归 | 自动 | Phase 4/H3/H4 相关测试全部通过。 |
| W3 | 普通用户权限运行 | 手工 | 无需管理员权限、无需 Visual Studio，即可启动和配置 Runtime。 |
| W4 | Worktree 运维 | 手工 | Task Center 可列出、打开、清理非活跃 worktree；清理前有确认。 |
| W5 | 发布阻断条件 | 人工评审 | 无 P0/P1 安全问题、数据丢失问题或原工作区直接写入问题。 |

## 当前自动化命令

```powershell
npm.cmd test -- tests/task-center.test.ts tests/project-control.test.ts tests/agent-runtimes.test.ts tests/remote-coordinator-bridge.test.ts tests/claude-code-runtime.test.ts src/renderer/src/screens/TaskCenter/TaskCenter.test.tsx src/renderer/src/screens/TaskCenter/taskOutput.test.ts src/renderer/src/screens/ProjectCenter/ProjectCenter.test.tsx
npm.cmd run build
```
