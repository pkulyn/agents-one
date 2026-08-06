# U0 界面基线审计

日期：2026-07-16  
范围：Agents One 当前 Electron 客户端，桌面 1600x1080 基线。

## 证据

已保存的基线截图：

- `.sandbox/ui-audit/conversation-after-first-pass.png`
- `.sandbox/ui-audit/projects-before-translation.png`
- `.sandbox/ui-audit/task-center-before-translation.png`

这些截图用于后续 U1 至 U5 的视觉回归，不作为最终设计稿。

## 当前问题

| 区域 | 观察结果 | 影响 | 对应重构轮次 |
| --- | --- | --- | --- |
| 应用壳 | 仍以 Hermes Desktop 的大品牌、顶部多会话标签和历史模块为中心 | 主区被挤压，Agents One 的项目/任务能力不成为首屏 | U1 |
| 主导航 | 仅项目、任务中心是 Agents One 新入口；其他入口和 Profile 仍是旧模型 | 信息架构混杂，用户无法理解高频路径 | U1、U4 |
| 对话 | Hermes 与 Runtime 对话容器、输入框和过程事件不一致 | 不能形成统一多智能体体验 | U2 |
| 项目 | 创建表单与项目长列表并列，缺少项目总览、活动、任务摘要和产物入口 | 难以组织真实工程项目 | U3 |
| 任务 | 任务中心已有数据能力，但缺少与对话和项目的紧凑联动 | 输入、输出、验收需要跨屏查找 | U2、U3 |
| 文案 | `Projects`、`Create project`、`Coordinator` 等英文仍直接暴露 | 与中文工作台目标不一致 | U1、U3 |

## U0 兼容性核对

- `Layout` 的对话、项目、任务中心仍采用延迟挂载，未移除现有数据读取路径。
- 现有 `RuntimeChat`、Hermes `Chat`、`TaskCenter`、`ProjectCenter` 保持独立挂载，适合在 U1 中先替换外层 Shell，再在 U2/U3 收敛内部体验。
- 当前主导航与旧页面的耦合集中在 `src/renderer/src/screens/Layout/Layout.tsx`，可用特性开关保留旧入口作为回退。

## U1 不可退让的验收条件

1. 主导航仅展示“对话、项目、任务中心、智能体”和低频“设置”。
2. 顶部会话条不再挤压项目和任务页面；对话的会话切换仅在对话工作台显示。
3. 1024px 宽度时，左侧导航、主内容和输入区不重叠、不截断。
4. 用户可见的 U1 新增文案全部为中文。
5. 旧会话、任务、项目、Runtime 设置和缓存继续可读取。
