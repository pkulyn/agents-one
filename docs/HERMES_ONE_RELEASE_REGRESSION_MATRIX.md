# Agents One 发布前回归矩阵

日期：2026-07-16

本矩阵用于 Phase 5 发布前验收。当前处于产品 UI 优化期，安装包、便携版和发布候选版本制作暂停；涉及 Runtime、Task Center、Project Center、安全或存储层改动时，先执行开发版对应分组，待 UI 人工验收通过后再恢复 Windows 发布分组。

## Runtime 与任务执行

| 编号 | 场景 | 验收方式 | 通过标准 |
| --- | --- | --- | --- |
| R1 | 远程 Hermes 对话 | 手工 | 可正常发送问题、接收回复；错误事件不混入正文。 |
| R2 | 远程 Hermes coordinator planning | 手工 + 自动测试 | Bridge 强制只读规划可用，计划 artifact 可进入 Task Center。2026-07-16：真实能力探测与只读计划已通过；即时取消返回 `cancelled` 且 `cleanedUp: true`。 |
| R3 | 远程 OpenClaw coordinator planning | 手工 + 自动测试 | Bridge 能力探测健康，计划 artifact 可预览生成 Project tasks。2026-07-16：真实能力探测与只读计划已通过。 |
| R4 | Codex analysis | 手工 + 自动测试 | Task Center 可运行分析任务，输出可读，可取消。 |
| R5 | Codex implementation | 手工 + 自动测试 | 只写隔离 Git worktree，产出 worktree/diff artifact，原工作区不被直接修改。2026-07-16：真实项目闭环已通过。 |
| R6 | Claude Code analysis | 手工 + 自动测试 | `claude auth status` 已登录，analysis 使用 `plan` 权限，输出进入 Task Center。2026-07-16：真实 Runtime 分析任务通过。 |
| R7 | Claude Code implementation | 手工 + 自动测试 | 只写隔离 Git worktree，产出 worktree/diff artifact，可取消、可超时。2026-07-16：真实不改文件的 implementation 任务通过，并返回受管 worktree。 |

## Project Center 与协作流

| 编号 | 场景 | 验收方式 | 通过标准 |
| --- | --- | --- | --- |
| P1 | 指定任意 Runtime 作为 coordinator | 手工 | Hermes/OpenClaw 走远程 Bridge；Codex/Claude Code 走本地只读分析。2026-07-16：Hermes coordinator 已在隔离 Electron 中通过。 |
| P2 | Coordinator plan 预览 | 手工 + 自动测试 | 结构化 plan 可解析为任务草稿；非结构化 plan 降级为人工复核任务。2026-07-16：真实 Hermes plan 产生 4 条草案。 |
| P3 | 从 plan 创建 Project tasks | 手工 + 自动测试 | 用户确认后才创建任务；重复点击不会重复生成。 |
| P4 | 建议 Runtime 映射 | 手工 + 自动测试 | `suggestedRuntimeKind` 优先筛选候选 Runtime，仍由用户手动 Assign。 |
| P5 | Context package | 手工 | 只包含相关依赖任务与 artifact 引用，不泄露 secret。 |

## 安全与恢复

| 编号 | 场景 | 验收方式 | 通过标准 |
| --- | --- | --- | --- |
| S1 | 输出脱敏 | 自动测试 | 日志、错误、diff/final artifact 不显示 Token、API Key、Authorization、Cookie。2026-07-16：Hermes 真实安全事件查询返回 1 条脱敏记录，未检出认证字段。 |
| S2 | 子进程环境 | 代码审查 | Codex/Claude Code 仅继承最小必要环境变量，不通过 shell 拼接命令。 |
| S3 | Worktree 路径校验 | 自动测试 | 打开/清理操作只能作用于 Agents One 用户数据目录下的受管 worktree。 |
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

## 已执行的开发版验证（2026-07-16）

- 当前源码全量单元/组件回归：177 个测试文件通过，1778 个测试通过、13 个跳过。
- 任务、项目、计划任务、网关重启、Preload API 与相关界面的针对性回归：8 个测试文件、200 个测试通过。
- OpenClaw 连续对话、远程 artifact、Codex/Claude Code 项目目录与附件、对话持久化专项回归：4 个测试文件、18 个测试通过。
- 类型检查与当前修改文件的 `git diff --check` 通过。
- 开发版 U5 UI 自动回放已覆盖 14 个页面/状态：对话、项目四视图与新建表单、任务新建/列表/详情/看板、定时任务及新建表单、智能体、智能体编辑和设置；1024px 下任务看板为两列，768px 下为单列，对话编辑器在 768px 下宽 518px，均无横向溢出。
- 真实本地 Codex 对话已完成发送、运行反馈、最终答复、重载恢复和侧栏布局验收；用户与智能体消息均持久化，768px 下任务侧栏以 320px 覆盖式抽屉呈现，不压缩主区或输入框。
- 对话任务侧栏已隐藏 Codex JSONL 和网络重试等底层日志，改为状态、最终摘要和中文进展事件，并新增关联项目摘要与跳转入口。
- 设置页新增词条、远程对话降级提示及中文界面术语已完成收口；用户界面统一使用“对话、智能体、智能体接入”，不改变底层 session/runtime/agent 协议字段。
- 隐藏的后台对话不再响应快捷键、弹窗或迟到的连接通知；任务列表正文限制为三行摘要，完整输入仍可在任务详情中查看。
- 智能体页自动探测已接入 Runtime，探测期间显示“检测中”，不再以“未检测”误导用户；连接设置中的 Dashboard 与对话传输说明已全部中文化。
- 定时任务入口统一为“新建定时任务”，最近运行状态使用中文显示；创建表单可打开、取消且不污染现有任务数据。
- UI 截图改用 Playwright 稳定采集通道，并在截图前等待 Electron GPU 合成稳定，避免 CDP 截图偶发黑块被误判为产品缺陷。
- 先前曾在普通用户权限下成功执行 Windows 解包构建，证明工具链无需 Visual Studio 或管理员权限；该旧产物不是当前发布候选。本轮不生成或验证新的安装包、便携版或解包产物。
- 全仓 ESLint 仍存在仓库既有的 CRLF 格式告警和少量历史规则问题，因此当前变更采用严格的“修改文件 lint”作为门槛，并已通过。发布前需要单独清理该历史基线，不能把其视为本轮功能回归失败。

## U5 补充体验验收（2026-07-17）

- 完成项目概览、任务、产物、活动四个视图的逐页操作复核；项目任务的“在任务中心查看”现在会自动打开对应任务详情，避免进入任务中心后再次查找。
- 完成任务列表、详情抽屉、最终结果、验收状态、看板和隔离工作树空状态复核；项目到任务中心的关联任务标题与最终结果一致。
- 完成 Agents One 与 Hermes Cron 两类定时任务视图及新建表单复核；表单可切换执行位置、频率和智能体，取消后不产生计划任务。
- 完成智能体列表、健康状态、发起对话、外观编辑和同值保存复核；设置中的“智能体接入”改为加载后自动探测全部已启用智能体，不再短暂误报“尚未接入”或长期停留在“未检测”。
- 完成设置的外观、语言、隐私、连接、数据、关于与更新、智能体接入、日志与诊断逐页巡检；日志标签统一为“网关、智能体、错误”。
- U5 自动 UI 回放再次通过，覆盖 14 个页面/状态及 1024×768、768×800 两档窗口；目标组件回归 3 个测试文件、19 项通过，Node/Web 类型检查通过。
- 截图脚本为单次截图增加独立超时，并兼容不提供 Browser 窗口命令的 Electron CDP，降低最小化窗口造成的误报。
- 手工测试发现远程工作目录选择器引用了未定义主题变量，导致弹窗主体透明、对话内容穿透；现已改用统一主题背景，补充远程 API 模式说明、路径输入标签和目录加载异常兜底。组件测试 2 项、Node/Web 类型检查及实机视觉复验通过。

## U5 追溯体验验收（2026-07-20 至 2026-07-21）

- 产品信息架构完成一次重要收敛：确认 Agents One 当前阶段仍是“对话优先”，任务列表承接对话列表，项目列表归集同一目标下的一组对话/任务。
- 项目创建和上下文目录流程完成手工验证：支持新建空白项目和使用现有文件夹，目录会进入当前任务输入区的上下文。
- 智能体默认身份和外观完成多轮修复：左下角默认智能体、智能体协作卡片、任务记录头像和名称应保持一致。
- 聊天功能方向从完整任务页改为轻量浮窗；聊天内容可按需加入当前任务/对话。
- Pi Agent CLI 作为自定义本地 Runtime 接入并完成连接测试；后续围绕连续对话、权限、工具过程展示继续优化。
- 对话侧栏与输入工具栏继续调整：侧栏不压缩主对话区，入口按钮移到输入工具区，避免遮挡消息。
- 发布包和便携版继续冻结；本阶段只验收开发版 UI、Runtime 接入和真实使用路径。

## U5 补充体验验收（2026-07-22）

- Pi Agent CLI 执行过程展示完成收口：thinking snapshot 改为合并/替换，不再把半截思考逐条追加到历史。
- “思考”分组默认折叠，只展示最近 2 条完整摘要；`任务已开始执行`、`任务执行完成`、空参数工具调用和普通最终回复提示默认隐藏。
- Read/Write/List/Terminal 等工具过程继续保留，且以目标文件、命令或工具结果作为主要可读信息。
- 用户实测截图确认 Pi Agent 读取文件流程基本达到预期，执行过程噪音显著减少。
- 针对性自动回归通过：`tests/agent-runtimes.test.ts` 与 `src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx` 共 18 项通过；`npm.cmd run typecheck` 通过。

## 待完成的发布前手工回放

当前开发版已由 Electron CDP 验收脚本完成核心页面回放。仍需由产品负责人继续进行 UI 人工体验验收；确认布局、文案和核心路径稳定后，再恢复发布包、安装包与便携版验证。

## 当前自动化命令

```powershell
npm.cmd test -- tests/task-center.test.ts tests/project-control.test.ts tests/agent-runtimes.test.ts tests/remote-coordinator-bridge.test.ts tests/claude-code-runtime.test.ts src/renderer/src/screens/TaskCenter/TaskCenter.test.tsx src/renderer/src/screens/TaskCenter/taskOutput.test.ts src/renderer/src/screens/ProjectCenter/ProjectCenter.test.tsx
npm.cmd run typecheck
npm.cmd run test:u5-ui
```

发布冻结期间不要执行 `build:unpack`、`build:win` 或其他安装包制作命令。
