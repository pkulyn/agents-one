<div align="center">

# Agents One

**一个原生桌面工作区：在多个 AI 智能体之间协调对话、任务、项目与产物。**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Alpha-Windows%20x64-blue.svg)](#安装)

</div>

[English](README.md) · [贡献指南](CONTRIBUTING.zh-CN.md) · [安全策略](SECURITY.md) · [已知问题](KNOWN_ISSUES.md) · [变更日志](CHANGELOG.md)

Agents One 是一款桌面应用，把**本地 CLI 智能体**（Pi、Codex、Claude Code）与**远程智能体**（通过 Remote Gateway v1 协议）统一到同一套对话界面背后——无需再在不同终端、Dashboard 或各家 Web 界面之间来回切换，即可完成对话、任务、定时任务与项目管理。

每个智能体都注册为一个 **Runtime**，只有一套连接配置、一套展示模型：

- **远程智能体** — 一个 Gateway v1 地址 + 一个 Bearer Token。能力通过协议协商获得，而不是按厂商硬编码。
- **本地 CLI 智能体** — 本机可执行文件路径。应用直接以原生 CLI 语义启动它们（模型、工具、权限、项目指令），并把事件流渲染进统一对话。

> **项目状态：** 尚未公开发布。Windows Alpha 本地候选仍需通过远端 CI、草稿 Release 和干净环境验收；功能及持久化数据格式仍可能变化。欢迎参与贡献。

## 功能特性

- **统一对话壳** — 流式聊天，支持工具调用卡片、思考摘要、产物、取消/超时/重试，以及原生 CLI 终端回退。Hermes 与所有已注册 Runtime 都通过同一套基于适配器的消息模型渲染。
- **智能体注册表** — 添加、探测、启停、移除 Runtime。健康状态与能力徽章（对话 / 任务派发 / 工具 / 产物 / 工作区）来自真实探测结果。
- **本地 CLI Runtime** — 自动在 PATH 中探测 Pi、Codex、Claude Code 并以原生 CLI 进程启动（参数数组、不包 shell、一次性 Git worktree、保留原生权限模式）。
- **远程 Gateway v1** — 每个远程智能体一个 URL + 一个 Token；能力协商、运行生命周期、产物交换与短时工作区授权，取代各家私有 API Key。
- **项目** — 以文件夹为作用域的容器，归组会话与任务；`safe_write` 工作区保护阻止越界写入。
- **任务与定时任务** — 对话即任务；定时任务到点后创建并启动一条普通 Runtime 对话（没有隐藏的执行层）。
- **多智能体协作** — 显式角色分配（协调者 / 实现 / 审查）配角色时间线与证据闸门；结构化交接，而非共享原始上下文。
- **会话管理** — 可搜索、按日期分组的会话历史与续接；Quick Chat 面板按 Profile 持久化。
- **归档** — 软归档任务与项目，不动底层消息或产物；可浏览、搜索、恢复或永久删除。
- **备份与恢复** — 可移植的 `*.agents-one-backup` 归档，含清单 + SHA-256 校验、凭据安全迁移、预检与崩溃安全回滚。
- **插件 SDK** — `plugins/agents-one-plugin` 提供事件流契约、Gateway 宿主与 CLI 适配器，新智能体无需改动桌面端即可接入。
- **实验性网页 Provider** — 内置豆包、ChatGPT 和 Grok 浏览器适配器在公开构建中默认关闭；只有开发者开放本地实验开关且用户明确接受第三方数据与账号风险后才可使用。
- **国际化** — 简体中文与英文。

## 快速开始

### 安装

首个公开 Alpha 将**仅面向 Windows x64**，但目前**尚未发布**。发布门禁全部通过后，请仅从[官方 Releases 页面](https://github.com/pkulyn/agents-one/releases)下载安装包或便携包，并根据 `SHA256SUMS.txt` 核对 SHA-256。Alpha 将不会签名，首次启动时 Windows SmartScreen 可能告警；仅在校验值一致后继续运行。未签名构建默认关闭自动更新；本次 Alpha 不发布 macOS/Linux 资产。

### 添加你的第一个智能体

1. 打开 **智能体**（侧边栏 → Agents）。
2. 点击 **添加智能体**。
3. 选择智能体类型：
   - **远程智能体**（如 Hermes、OpenClaw 或任意 Gateway v1 实现）— 填写 Gateway 地址与 Bearer Token。
   - **本地 CLI**（Pi、Codex、Claude Code）— 应用会自动扫描 PATH 并预填可执行文件路径。
4. 保存并探测。运行健康胶囊与能力徽章随探测结果更新。
5. 打开 **聊天** 开始对话，或在对话框创建 **任务**。

### 创建项目

从侧边栏创建项目文件夹。新对话可关联到项目；项目成为本地 CLI Runtime 与已授权远程智能体的工作区边界。

## 工作原理

```text
        用户
          │
          ▼
    Agents One 桌面端
    ├─ 智能体注册表 → 每个 Runtime 一套连接配置
    ├─ 统一对话壳   → 基于适配器的统一消息模型
    ├─ 定时任务 / 项目 / 归档 / 备份
          │
          ├──▶ 本地 CLI Runtime（Pi / Codex / Claude Code）
          │        原生进程、原生权限，事件流 → 对话
          │
          └──▶ 远程智能体（Gateway v1）
                   一个 URL + 一个 Token，能力协商，
                   运行生命周期、产物、工作区授权
```

- **Runtime Adapter 契约** — `probe`、`start`、`get`、`cancel`、事件、产物。每个 Runtime 在编排层统一表示且不损失信息：无法结构化呈现的原生输出仍可在“原始记录”中查看。
- **Remote Gateway v1** — 跨机访问的外层协议。Token 绑定单个远程智能体与有限 scope；工作区访问是短时授权，不是常驻文件服务器。详见 [docs/AGENTS_ONE_REMOTE_GATEWAY_V1.md](docs/AGENTS_ONE_REMOTE_GATEWAY_V1.md)。
- **Agent Event Stream v1** — 思考摘要、工具、技能、MCP、产物与交接的统一事件语言。详见 [docs/AGENT_EVENT_STREAM_V1.md](docs/AGENT_EVENT_STREAM_V1.md)。
- **插件 SDK** — `plugins/agents-one-plugin` 提供 Gateway 宿主与 CLI 适配器，新智能体无需改动桌面端即可接入统一契约。详见 [docs/AGENTS_ONE_PLUGIN_SDK.md](docs/AGENTS_ONE_PLUGIN_SDK.md)。

## 界面预览

> 截图为当前构建版本实拍。

|                                                             |                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| <img width="100%" alt="智能体" src="previews/agents.png" /> | <img width="100%" alt="聊天" src="previews/chat.png" /> |

## 数据与隐私

### 数据路径

- 桌面状态位于 Electron `userData` 目录（Windows 通常为 `%APPDATA%\Agents One`）。Windows portable 默认使用 `%LOCALAPPDATA%\agents-one-portable`，不与安装版共享数据或单实例锁；仅在确实需要另一隔离目录时，才应在启动前设置 `AGENTS_ONE_USER_DATA_DIR`。
- 用户选择的项目目录和本地 CLI Runtime 数据不放入桌面状态。内置 Hermes Runtime 在 Windows 通常使用 `%LOCALAPPDATA%\hermes`，其他系统通常使用 `~/.hermes`；`HERMES_HOME` 或应用内已有安装覆盖项可指定其他位置。
- Agents One Connector 的独立设备状态位于 Windows `%APPDATA%\agents-one\connector`，其他系统位于 `${XDG_CONFIG_HOME:-~/.config}/agents-one/connector`。
- 备份只写入用户主动选择的位置；移动或分享前请先阅读下方凭据边界。

- **凭据存储有明确边界。** 桌面端录入的 Remote Gateway Token 会在安全后端可用后从 `.env` 幂等迁移到 Electron 的操作系统级保护；Windows Connector 的设备 Token 与私钥使用当前用户 DPAPI，其他平台的 Connector 文件使用仅当前用户可访问的权限。Provider/API 凭据仍可能来自 `.env`、进程环境变量或已配置的命令型秘密提供器。Linux 若被 Electron 判定为不安全的 `basic_text` 回退，Agents One 会继续使用受限的旧文件路径并明确提示，不会宣称该值已受操作系统保护。
- **备份保护凭据边界。** 已知的 `.env`、账户/凭据文件、Token/API Key 字段、SSH keyPath、代理、原始配置、桌面受保护密文及 Connector 凭据文件均不导出；若技能文本疑似硬编码 Bearer/API 凭据，导出会停止，提示先迁移到受保护配置。对话、记忆、技能、附件等用户自建内容仍可能含敏感文本，必须按敏感数据保管。
- **备份**覆盖配置档案、项目、任务、对话、协作记录、SQLite 状态、记忆、技能、附件与 Runtime 输入。恢复先预检、保留回滚快照，且能在恢复中途崩溃时自动回滚。
- **本地 CLI 不是远程。** 本地 Runtime 保留原生能力；桌面端只增加你明确选择的工作区范围、运行记录与统一渲染。
- **网页 Provider 是默认关闭的实验功能。** 明确启用后，提示词和所选附件会通过已登录的第三方网页发送，账号数据由对应 Provider 处理。Agents One 为每个 Provider/Profile 使用独立 Chromium 分区，阻止白名单外导航和浏览器权限，并支持一键停止全部网页任务或清除隔离登录数据。项目目前未取得豆包、OpenAI 或 xAI 的书面自动化许可；详见[网页 Provider 合规记录](docs/AGENTS_ONE_WEB_PROVIDER_COMPLIANCE_20260910.md)。

支持版本、漏洞私下报告方式与信任边界模型见 [SECURITY.md](SECURITY.md)；当前发布限制见 [KNOWN_ISSUES.md](KNOWN_ISSUES.md)。

## 界面一览

| 界面                     | 说明                                             |
| ------------------------ | ------------------------------------------------ |
| **聊天 / Chat**          | 统一流式对话，含工具、产物与 Runtime 事件        |
| **智能体 / Agents**      | 按本地/远程分组的 Runtime 卡片，含探测健康与能力 |
| **定时任务 / Schedules** | 以 cron 触发定时创建普通 Runtime 对话            |
| **设置 / Settings**      | 外观、语言、数据（备份/恢复）、归档、关于、日志  |

## 开发

```powershell
npm.cmd install
npm.cmd run dev       # 开发模式启动
npm.cmd run typecheck # TypeScript 检查
npm.cmd test          # vitest 测试
npm.cmd run build     # typecheck + 生产构建
```

贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，运维说明见 [docs/AGENTS_ONE_RUNBOOK.md](docs/AGENTS_ONE_RUNBOOK.md)。

## 许可证

[MIT](LICENSE)
