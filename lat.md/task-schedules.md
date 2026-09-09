# Runtime Schedules

Agents One 的桌面定时任务以稳定 `runtimeId` 关联智能体，在应用运行期间按 Cron 或间隔启动独立 Runtime 对话，并保留每轮状态、结果与会话入口。

## Eligible Runtime boundary

定时任务只接受当前已启用、配置无冲突且无需重新授权的本地 CLI、Web Agent 或远程 Gateway v1 Runtime，前端选项与主进程执行门禁共用同一判定。

[[src/shared/task-schedules.ts#taskScheduleRuntimeCategory]] 负责区分 `local`、`web`、`remote` 三类目标，[[src/shared/task-schedules.ts#isTaskScheduleRuntimeEligible]] 再叠加启用状态、网页适配器开关、远程端点和重新授权状态。已删除或暂不可用 Runtime 的计划记录继续保留并可暂停或删除，但不会自动派发。

## Execution semantics

每次手动、到期或错过补跑都通过统一 Runtime 任务入口启动，沿用并发策略、超时、运行事件、产物和可见对话对账。

[[src/main/task-schedules.ts#startRun]] 对本地 CLI 和远程 Gateway 保留计划配置的访问模式与可选项目 capability。Web Agent 固定使用 `analysis`，不携带工作区；若登录态失效，其 Runtime 可进入现有用户接管流程。远程任务继续由 Gateway v1 执行，离线或鉴权失败作为本轮失败结果记录，不删除计划。

## Renderer behavior

定时任务页在同一个管理面板展示全部计划，并在创建或编辑时按本地、网页、远程分组选择当前可调度智能体。

[[src/renderer/src/screens/Schedules/Schedules.tsx#Schedules]] 在选择 Web Agent 时隐藏项目文件夹与文件访问控件并提交分析模式；任务表按任务信息、计划、目标、下次执行、最近结果和状态组织数据，并提供仅影响前端显示的本地搜索与状态筛选。表格复用 Runtime 的头像和显示色；计划表达式只转换成可读的自然语言，最近结果显示状态图标、触发时间与可推导的执行耗时。当前不可用的智能体会禁用继续和立即执行，但仍允许暂停、编辑到其他智能体或删除记录。

计划启动事件继续用于刷新主窗口中的对话和计划状态，但不再发送 Windows 原生通知或应用内 Toast；任务终态仍由既有托盘完成提示呈现，避免同一轮任务重复打扰。

## Persistence compatibility

扩展不改变 `task-schedules.json` 的记录结构，也不重写未知字段或批量迁移历史计划。

旧计划继续按其 `runtimeId` 解析；只要对应远程 Gateway 或 Web Agent 现已满足资格门禁，旧记录也能在下一次到期时执行。既有本地 CLI 计划、项目 `workspaceId`、并发游标和运行历史保持原语义。
