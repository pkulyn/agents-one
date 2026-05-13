<img width="100%" alt="HERMES DESKTOP" src="https://github.com/user-attachments/assets/80585955-3bae-4aee-af90-a1e61757ccb8" />

<br/>
<p align="center">
  <a href="https://hermes-agent.nousresearch.com/docs/"><img src="https://img.shields.io/badge/Docs-hermes--agent.nousresearch.com-FFD700?style=for-the-badge" alt="Documentation"></a>
  <a href="https://discord.gg/NousResearch"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/fathah/hermes-desktop/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://github.com/fathah/hermes-desktop/releases/"><img src="https://img.shields.io/badge/Download-Releases-FF6600?style=for-the-badge" alt="Releases"></a>
  <a href="https://github.com/fathah/hermes-desktop/stargazers">
    <img src="https://img.shields.io/github/stars/fathah/hermes-desktop?style=for-the-badge&color=FFD700&label=Stars" alt="Stars">
  </a>
  <a href="https://github.com/fathah/hermes-desktop/releases/">
    <img src="https://img.shields.io/github/downloads/fathah/hermes-desktop/total?style=for-the-badge&color=00B496&label=Total%20Downloads" alt="Downloads">
  </a>
</p>

> **本项目仍在积极开发中。** 功能可能变化，部分内容可能出现问题。如有问题或想法，欢迎[提交 issue](https://github.com/fathah/hermes-desktop/issues)。欢迎贡献！

## 语言

- 英文：`README.md`
- 简体中文：`README.zh-CN.md`

Hermes Desktop 是一款原生桌面应用，用于安装、配置 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 并与之对话——Hermes Agent 是一个具备工具调用、多平台消息接入和闭环学习能力的自我改进 AI 助手。

与其手动维护 CLI，不如让应用一站式引导你完成安装、供应商配置和日常使用。它使用官方 Hermes 安装脚本，将 Hermes 存储在 `~/.hermes` 中，并提供聊天、会话、档案、记忆、技能、工具、定时任务、消息网关等 GUI 功能。

## 安装

请从 [Releases](https://github.com/fathah/hermes-desktop/releases) 页面下载最新构建版本。

| 平台 | 文件 |
| ---- | ---- |
| macOS | `.dmg` |
| Linux（通用） | `.AppImage` |
| Linux（Debian） | `.deb` |
| Linux（Fedora） | `.rpm` |
| Windows | `.exe`（NSIS 安装器） |

### Windows（winget）

待清单被 `microsoft/winget-pkgs` 收录后，可使用以下命令安装：

```powershell
winget install NousResearch.HermesDesktop
```

在此之前，请从 Releases 页面下载 `.exe`。

> **Windows 用户注意：** 安装器未进行代码签名。首次启动时 Windows SmartScreen 会发出警告——点击"更多信息"→"仍要运行"。

### Fedora（RPM）

```bash
sudo dnf install ./hermes-desktop-<version>.rpm
```

> **Fedora 用户注意：** `.rpm` 未进行 GPG 签名。如果系统强制要求签名验证，请在安装命令后追加 `--nogpgcheck`。`.rpm` 版本不支持自动更新（`electron-updater` 的限制）；更新时需重新安装新版本 `.rpm`。

### macOS

> **macOS 用户注意：** 应用未进行代码签名或公证。首次启动时 macOS 会阻止运行。请在安装后执行以下命令：
>
> ```bash
> xattr -cr "/Applications/Hermes Agent.app"
> ```
>
> 或者右键点击应用 → **打开** → 在确认对话框中点击 **打开**。

## 功能

- **引导式首次安装** Hermes Agent，带进度追踪和依赖解析
- **本地或远程后端** —— 在本地 `127.0.0.1:8642` 运行 Hermes，或将桌面应用连接到远程 Hermes API 服务器（URL + API Key）
- **多供应商支持** —— OpenRouter、Anthropic、OpenAI、Google (Gemini)、xAI (Grok)、Nous Portal、Qwen、MiniMax（全球及中国端点）、Hugging Face、Groq，以及本地 OpenAI 兼容端点（LM Studio、Ollama、vLLM、llama.cpp）
- **流式聊天界面** —— SSE 流式传输、工具进度指示器、Markdown 渲染和语法高亮
- **Token 用量追踪** —— 聊天底部实时显示 prompt/completion token 数量和费用，以及 `/usage` 斜杠命令
- **22 个斜杠命令** —— `/new`、`/clear`、`/fast`、`/web`、`/image`、`/browse`、`/code`、`/shell`、`/usage`、`/help`、`/tools`、`/skills`、`/model`、`/memory`、`/persona`、`/version`、`/compact`、`/compress`、`/undo`、`/retry`、`/debug`、`/status` 等
- **会话管理** —— 全文搜索（SQLite FTS5）、按日期分组历史、跨对话恢复和搜索
- **档案切换** —— 创建、删除和切换独立的 Hermes 环境，配置互相隔离
- **14 个工具集** —— web、browser、terminal、file、code execution、vision、image gen、TTS、skills、memory、session search、clarify、delegation、MoA 和 task planning
- **记忆系统** —— 查看/编辑记忆条目、用户档案记忆、容量追踪，以及可发现的记忆供应商（Honcho、Hindsight、Mem0、RetainDB、Supermemory、ByteRover）
- **人格编辑器** —— 编辑和重置 Agent 的 SOUL.md 人格文件
- **已保存模型** —— 对跨供应商的模型配置进行增删改查管理
- **定时任务** —— Cron 任务构建器（按分钟、每小时、每天、每周、自定义 cron），支持 15 种投递目标
- **16 个消息网关** —— Telegram、Discord、Slack、WhatsApp、Signal、Matrix、Mattermost、Email (IMAP/SMTP)、SMS (Twilio/Vonage)、iMessage (BlueBubbles)、钉钉、飞书/Lark、企业微信、微信 (iLink Bot)、Webhooks、Home Assistant
- **Hermes Office (Claw3d)** —— 可视化 3D 界面，含开发服务器和适配器管理
- **备份、导入和诊断转储** —— 在设置中完成完整数据备份/恢复以及系统诊断
- **日志查看器** —— 在设置界面直接查看网关和 Agent 日志
- **自动更新器** —— 通过 electron-updater 检查和安装更新
- **国际化就绪** —— 国际化框架，英文语言包已覆盖所有界面，等待社区翻译
- **测试套件** —— 基于 Vitest 的 SSE 解析器、IPC 处理器、preload API 接口、安装器工具函数和常量校验测试

## 预览

<table>
<tr>
<td width="50%" align="center"><b>Office</b><br/><img width="100%" alt="Office" src="https://github.com/user-attachments/assets/214bfa60-48ec-4449-be40-370628205147" /></td>
<td width="50%" align="center"><b>Chat</b><br/><img width="100%" alt="Chat" src="https://github.com/user-attachments/assets/ca84a56c-4d14-4775-96bb-c725069988be" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>Profiles</b><br/><img width="100%" alt="Profiles" src="https://github.com/user-attachments/assets/bd812e4a-bbdc-4141-b3a8-1ab5b0e561d4" /></td>
<td width="50%" align="center"><b>Tools</b><br/><img width="100%" alt="Tools" src="https://github.com/user-attachments/assets/ad051fbe-055d-40d2-b6dd-959c522412d2" /></td>
</tr>
<tr>
<td width="50%" align="center"><b>Settings</b><br/><img width="100%" alt="Settings" src="https://github.com/user-attachments/assets/b3f7e0d8-b087-4935-b57c-f8db30491f2e" /></td>
<td width="50%" align="center"><b>Skills</b><br/><img width="100%" alt="Skills" src="https://github.com/user-attachments/assets/508c3501-52eb-419d-8cfd-06268875ff62" /></td>
</tr>
</table>

## 工作原理

首次启动时，应用会：

1. 询问是**本地**运行 Hermes 还是连接到**远程** Hermes API 服务器。
2. **本地模式：** 检查 `~/.hermes` 中是否已安装 Hermes；若未安装，则运行官方 Hermes 安装程序，并解析依赖（Git、uv、Python 3.11+）。
3. **远程模式：** 提示输入远程 API URL 和 API Key，验证连接，跳过本地安装。
4. 提示选择 API 供应商或本地模型端点。
5. 通过 Hermes 配置文件保存供应商配置和 API Key。
6. 设置完成后进入主工作区。

在本地模式下，聊天请求通过 `http://127.0.0.1:8642` 发出，使用 SSE 流式传输。在远程模式下，应用以相同的流式协议与你配置的远程 URL 通信。桌面应用实时解析数据流，在响应到达时渲染工具进度、Markdown 内容和 Token 用量。

## 界面

| 界面 | 说明 |
| ---- | ---- |
| **Chat** | 流式对话界面，支持斜杠命令、工具进度和 Token 追踪 |
| **Sessions** | 浏览、搜索和恢复历史对话 |
| **Agents** | 创建、删除和切换 Hermes 档案 |
| **Skills** | 浏览、安装和管理内置及已安装技能 |
| **Models** | 按供应商管理已保存的模型配置 |
| **Memory** | 查看/编辑记忆条目、用户档案，配置记忆供应商 |
| **Soul** | 编辑当前档案的人格设定（SOUL.md） |
| **Tools** | 启用或禁用各个工具集 |
| **Schedules** | 创建和管理定时任务及投递目标 |
| **Gateway** | 配置和控制消息平台集成 |
| **Office** | Claw3d 可视化界面设置和管理 |
| **Settings** | 供应商配置、凭证池、备份/导入、日志查看器、网络设置、主题 |

## 支持的供应商

### LLM 供应商

| 供应商 | 备注 |
| ------ | ---- |
| **OpenRouter** | 通过单一 API 访问 200+ 模型（推荐） |
| **Anthropic** | 直接访问 Claude |
| **OpenAI** | 直接访问 GPT |
| **Google (Gemini)** | Google AI Studio |
| **xAI (Grok)** | Grok 模型 |
| **Nous Portal** | 提供免费额度 |
| **Qwen** | 通义千问模型 |
| **MiniMax** | 全球及中国端点 |
| **Hugging Face** | 通过 HF Inference 访问 20+ 开源模型 |
| **Groq** | 高速推理（语音/STT） |
| **本地/自定义** | 任意 OpenAI 兼容端点 |

内置本地预设包括：LM Studio、Ollama、vLLM、llama.cpp。

### 消息平台

Telegram、Discord、Slack、WhatsApp、Signal、Matrix/Element、Mattermost、Email (IMAP/SMTP)、SMS (Twilio & Vonage)、iMessage (BlueBubbles)、钉钉、飞书/Lark、企业微信、微信 (iLink Bot)、Webhooks 和 Home Assistant。

### 工具集成

Exa Search、Parallel API、Tavily、Firecrawl、FAL.ai（图像生成）、Honcho、Browserbase、Weights & Biases 和 Tinker。

## 开发

### 前置要求

- Node.js 和 npm
- 可运行 Hermes 安装器的类 Unix shell 环境
- 首次安装时需具备网络连接以下载 Hermes

### 安装依赖

```bash
npm install
```

### 启动开发模式

```bash
npm run dev
```

### 运行检查

```bash
npm run lint
npm run typecheck
```

### 运行测试

```bash
npm run test
npm run test:watch
```

### 构建桌面应用

```bash
npm run build
```

各平台构建：

```bash
npm run build:mac
npm run build:win
npm run build:linux
npm run build:rpm    # 仅 Fedora/RHEL .rpm
```

## 首次设置

应用首次打开时，会自动检测是否已存在 Hermes 安装；若未安装，则会引导你完成安装。

UI 中支持的设置路径包括：

- `OpenRouter`
- `Anthropic`
- `OpenAI`
- `Local LLM` 通过 OpenAI 兼容 Base URL

内置本地预设包括：

- LM Studio
- Ollama
- vLLM
- llama.cpp

Hermes 相关文件存放位置：

- `~/.hermes`
- `~/.hermes/.env`
- `~/.hermes/config.yaml`
- `~/.hermes/hermes-agent`
- `~/.hermes/profiles/` — 各命名档案目录
- `~/.hermes/state.db` — 会话历史数据库
- `~/.hermes/cron/jobs.json` — 定时任务

## 技术栈

- **Electron** 39 — 跨平台桌面框架
- **React** 19 — UI 框架
- **TypeScript** 5.9 — 主进程和渲染进程的类型安全
- **Tailwind CSS** 4 — 工具优先的样式方案
- **Vite** 7 + electron-vite — 快速开发服务器和构建工具
- **better-sqlite3** — 本地会话存储，支持 FTS5 全文搜索
- **i18next** — 国际化框架
- **Vitest** — 测试运行器

## 说明

- 桌面应用依赖上游 Hermes Agent 项目来完成 Agent 行为和工具执行。
- 内置安装器以 `--skip-setup` 参数运行官方 Hermes 安装脚本，然后在 GUI 中完成供应商配置。
- 本地模型供应商不需要 API Key，但对应的兼容服务必须已启动运行。
- 支持为网络受限环境配置替代 npm registry。

## 贡献

欢迎贡献！请查看[贡献指南](https://github.com/fathah/hermes-desktop/blob/main/CONTRIBUTING.md)开始参与。如果不知道从哪里入手，可以看看已有的 [open issues](https://github.com/fathah/hermes-desktop/issues)。发现 bug 或有功能需求？欢迎[提交 issue](https://github.com/fathah/hermes-desktop/issues/new)。

## 相关项目

核心 Agent、文档和 CLI 工作流请查看 Hermes Agent 主仓库：

- https://github.com/NousResearch/hermes-agent
