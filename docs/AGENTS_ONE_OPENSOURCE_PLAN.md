# Agents One 开源前最终优化开发文档

> 创建日期：2026-08-14
> 状态：Phase 1-3 已完成；Phase 4 发布暂停，先执行稳定化计划
> 目标仓库：`github.com/pkulyn/agents-one`（MIT，public）

> 2026-09-09 更新：本文档保留为产品方向与历史执行记录；当前发布收口的唯一执行入口为 [Agents One 开源发布收口阶段 PRD](./AGENTS_ONE_OPENSOURCE_RELEASE_READINESS_PRD_20260909.md)。

## 0. 背景与目标

截至 2026-08-14，Agents One 的基本功能已经实现，并曾在当时基线完成多 Runtime 接入、统一对话、多智能体协作 DAG、Gateway v1、Workspace Grant、定时任务、备份恢复和归档管理的全量验证。2026-08-20 的新评测与复跑发现发布阻断项，因此原“优化完成后直接发布”的路径已调整为“先完成稳定化计划，再生成发布候选”。

**用户核心目标**：在保证智能体调用功能的前提下，让用户的接入设置尽可能简单——

- 远程智能体：输入**一个链接 + 一个 Token** 即可接入（插件负责远程智能体的安装部署并产出链接与 Token）
- 本地智能体：给出**可执行文件路径**即可接入（常见 CLI 自动探测路径）
- 不需要复杂繁琐的配置过程

## 1. 已确认的关键决策

| #   | 决策项                                                                                      | 结论                                                                                                     |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| D1  | 智能体接入统一方案                                                                          | **方案 A（Transport 主轴收敛）**；方案 C（Adapter 注册表）作为后续按需迭代方向                           |
| D2  | 远程接入                                                                                    | 统一走 **Gateway v1**（单地址 + 单 Token + capabilities 自动探测）；协议已涵盖"能力协商而非类型分支"     |
| D3  | 本地接入                                                                                    | `local-cli`（Pi/Claude Code/Codex，可执行文件路径，自动探测）+ `local-api`（内置 Hermes 本地 API，保留） |
| D4  | Hermes SSH 模式                                                                             | **删除**。无公网 IP 场景由 Gateway v1 出站 Connector 模式覆盖                                            |
| D5  | NAS Hermes/OpenClaw 旧兼容模式                                                              | **不迁移，直接删除旧代码**。这两个智能体是测试用途；后续有需要时按 Gateway v1 协议重新接入               |
| D6  | 上游遗留（云账号同步/钱包/社区）                                                            | **直接删除源码**                                                                                         |
| D7  | 隐藏旧页面（Discover/Office/Providers/Skills/Memory/Soul/Tools/Gateway/Models/Sessions 等） | **全部删除界面**；Skills/Memory/Soul 的**数据备份保留**（数据备份 ≠ 管理界面）                           |
| D8  | GitHub 仓库                                                                                 | `pkulyn/agents-one`                                                                                      |
| D9  | i18n 首发范围                                                                               | 只保留 **en + zh-CN**，删除其余 10 个 locale                                                             |
| D10 | LICENSE                                                                                     | 保留 MIT，Copyright 改为 pkulyn                                                                          |

## 2. 智能体接入统一的最终形态

```
新增智能体
├─ 远程智能体
│   └─ [Gateway 地址] + [Token] → 连接测试 → 自动显示类型/能力 → 保存
│       （无 SSH 模式；无多地址多 Token；无 Hermes/OpenClaw 私有表单）
│
└─ 本地智能体
    ├─ CLI 智能体：自动列出 PATH 检测到的 Pi / Claude Code / Codex，
    │   或手动填可执行文件路径
    └─ 本地 Hermes（内置保留）：本地 API（127.0.0.1:端口），
        managed: builtin，字段锁定不可删
```

**配置模型**：

```typescript
// AgentRuntimeConfig 新增必填字段
transport: "gateway-v1" | "local-cli" | "local-api";
// location 从 transport 派生：gateway-v1 → remote；local-cli/local-api → local
// kind 降级为显示元数据（图标/名称/默认参数模板），不参与逻辑分支
```

**主进程分支**：`probeAgentRuntime` / `startAgentRuntimeTask` / `cancelAgentRuntimeTask` 从 6+ 个 `kind+location` 分支收敛为按 transport 的三个主分支。

**存量配置迁移**：只读兼容迁移，保留旧字段，不删数据；存量 SSH 配置标记为"需重新设置"，提示改用 Gateway v1。

## 3. 执行计划

> ⚠️ 2026-08-14 用户确认执行顺序调整：**Phase 2（旧页面删除）前置，Phase 1（接入统一）后置**。
> 原因：SSH/旧远程模式与旧页面支撑模块（dashboard/remote-skills/claw3d 等）深度耦合，先删旧页面可顺带清掉大部分 SSH 消费者，使 Phase 1 的 SSH/旧远程模式删除变小而干净。

### Phase 0：提交基线（✅ 已完成 2026-08-14）

1. ✅ 检查 `git status`，将 8/6–8/13 未提交工作整理为 9 个语义化 commit
2. ✅ 打标签 `agents-one-pre-opensource-baseline`
3. ✅ 全量验证：typecheck ✅ / test 203 文件 2010 通过 ✅ / build ✅

### Phase 2：上游遗留与旧页面清理（前置）

11. **删除上游云服务**：`agent-sync.ts`、`hermes-account.ts`、`account-store.ts`、`wallet-store.ts`、`wallet-balances.ts`、`wallet-sync.ts` 及测试；移除 `ethers` 依赖
12. **删除上游 UI 组件**：`FollowUsModal`、`HermesAccountModal`、`OAuthLoginModal`、`ProviderKeysSection`、`CommunityPane`、`ProfileWalletPane`、`VerifyWarningBanner`，并清理引用点
13. **删除旧页面**：Discover、Office、Providers、Skills、Memory、Soul、Tools、Gateway、Models、Sessions 及审计确认孤儿的 Kanban/TaskCenter/ProjectCenter/Install/Setup/Welcome 残留；同步清理主进程模块（`skills.ts`、`memory.ts`、`soul.ts`、`registry.ts`、`model-discovery.ts`、`mcp-servers.ts`、`claw3d.ts` 等仅服务旧页面的部分）、IPC、preload、i18n key、CSS；审计 `installer.ts` 与内置 Hermes 本地模式的依赖关系，保留仍在用的安装能力；**备份功能继续备份 Skills/Memory/Soul 数据**
14. **清理上游引用**：`constants.ts` 的旧官网 provider 预设与 console 链接、`menu.ts` 的上游 issues 链接，以及旧 analytics 模块和 i18n 文案
15. **i18n 收敛**：删除 ar/es/he/id/ja/pl/pt-BR/pt-PT/tr/zh-TW 十个 locale，只保留 en + zh-CN

### Phase 3：开源准备

16. **重写 README.md**：Agents One 定位、功能、截图（复用 previews/）、安装与快速开始（远程 = 链接+Token；本地 = 路径）、Gateway v1 与 Plugin SDK 指引；删除全部上游徽章/赞助商/Token/Ko-fi
17. **更新元数据**：package.json（author=pkulyn、repository/homepage 指向 `github.com/pkulyn/agents-one`）、LICENSE（Copyright 改 pkulyn，保留 MIT）、`dev-app-update.yml` 与 `electron-builder.yml` 指向新仓库
18. **清理个人路径**：`scripts/verify-hers-*.js` 硬编码路径改为参数必填；测试文件中的个人目录改为通用临时路径
19. **更新文档**：CONTRIBUTING.md（仅保留 en + zh-CN，删除 ja-JP 版）、changelogs 合并为 Agents One 初始条目、删除 README.ja-JP/es-LATAM
20. **更新 lat.md 知识库**：接入统一、页面删除、SSH 移除等架构变更同步进 `lat.md/`，跑通 `lat check`

### Phase 4：发布

> ⏸️ **2026-08-20 发布冻结**：全面评测与复跑确认仍有 Runtime 生命周期、调度一致性、Gateway 终态、TLS/文件边界、恢复安全、依赖漏洞和测试稳定性阻断项。Phase 4 不再直接执行，先完成 [Agents One 稳定化与发布前详细开发计划](./AGENTS_ONE_STABILIZATION_PLAN_20260820.md) 的 S0-S5；全部发布门槛通过后再进入 RC1。

21. **S0-S5 稳定化**：按详细计划依次完成基线复现、Runtime 生命周期、定时任务一致性、Gateway/TLS、文件与恢复边界、可靠性及工程门禁
22. **RC1 干净目录与真实回放**：全新 clone → install → typecheck → lint → 三轮全量 test → build → build:win；完成五条 Runtime 黄金路径、定时任务和备份恢复演练
23. **推送 GitHub 与发布**：整理当前领先 `main` 的提交，将目标 GitHub 与本地 upstream 远端分开配置；CI 与 release dry-run 通过后才创建正式 tag

## 4. 执行纪律

- 遵守 [变更安全守则](./AGENTS_ONE_CHANGE_SAFETY_PROTOCOL.md)：先评估边界、小补丁、定向验证、可回退
- 每完成一个关键节点：更新 `docs/AGENTS_ONE_PROGRESS_LOG.md`（开发日志）、本开发文档（勾选完成项）、`lat.md/`（架构变更），并写入 PowerMem 云记忆（scope=group，共享给所有智能体）
- 删除类改动前先确认引用点清零；配置迁移保留旧字段不删数据
- npm 命令一律使用 `npm.cmd`（企业 PowerShell 策略）

## 5. 执行记录

| 节点                   | 状态        | 日期       | 备注                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 方案对齐与开发文档生成 | ✅          | 2026-08-14 | 用户确认方案 A + 全部 10 项决策                                                                                                                                                                                                                                                                                                                                                                                                |
| Phase 0 提交基线       | ✅          | 2026-08-14 | 8 个语义化 commit；标签 `agents-one-pre-opensource-baseline`；typecheck✅ test 203 文件/2010 通过/9 跳过 ✅ build✅                                                                                                                                                                                                                                                                                                            |
| Phase 2 遗留清理       | ✅ 主体完成 | 2026-08-14 | ①孤儿屏狄删除✅ ②上游云/钱包/社区删除✅ ③Skills/Memory/Soul UI 删除✅ ④i18n 收敛 en+zh-CN✅ ⑤上游 hermesone/fathah 引用清理✅ ⑥分析器删除✅；深层主进程 IPC 清理（registry/messaging/tools）与 Phase 1 旧远程传输耦合，延后                                                                                                                                                                                                    |
| Phase 3 开源准备       | 🔄 部分完成 | 2026-08-14 | 元数据（package.json/LICENSE/electron-builder/updater/CONTRIBUTING/删上游 changelog+README 变体）✅；README 重写待 Phase 1 完成后（需描述统一接入模型）                                                                                                                                                                                                                                                                        |
| Phase 1 接入统一       | ✅ 完成     | 2026-08-14 | 1.1 配置模型 `agentTransport`+推导 ✅（c414f23）；1.2 transport 分类器+start 守卫 ✅（e393d9a）；1.3 SSH 删除 ✅；1.4 旧远程模式删除 ✅；1.5 注册表单统一 ✅；1.6 Agents 卡片增强 ✅；1.7 定向+全量回归 ✅（全量 179 文件 1783 通过，typecheck/build/diff-check 全绿；修复 RuntimeChat 协作 flaky）                                                                                                                            |
| Phase 3 开源准备       | ✅ 完成     | 2026-08-16 | 16 README 重写 ✅（README.md/zh-CN 描述统一接入模型、Gateway v1 与 Plugin SDK 指引、删除上游徽章/赞助/Ko-fi、替换为当前构建实拍截图）；18 硬编码路径清理 ✅（verify-hers-\*.js 参数必填、测试个人用户名→tester、HERS_GATEWAY 文档命令示例改占位符）；20 lat.md 知识库同步 ✅（删除 5 个已删功能文档 + 修 sidebar-navigation/main-process/window-chrome 失效链接与过时章节；lat.md CLI 未安装，用本地脚本验证 253 链接 0 失效） |
| 发布前稳定化 S0-S5     | 🔄 已规划   | 2026-08-20 | 发布冻结；详细范围、顺序和门槛见 `AGENTS_ONE_STABILIZATION_PLAN_20260820.md`                                                                                                                                                                                                                                                                                                                                                   |
| Phase 4 / RC1 发布     | ⏸️ 暂停     | 2026-08-20 | 稳定化、依赖安全、三轮稳定测试、五条 Runtime 回放与 Windows 普通用户构建全部通过后恢复                                                                                                                                                                                                                                                                                                                                         |
