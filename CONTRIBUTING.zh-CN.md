# 为 Agents One 做贡献

感谢你愿意为 Agents One 做出贡献。无论是修复 bug、添加新功能、完善文档，还是修正一个拼写错误，每一份贡献都很有价值。

## 语言

- 英文：`CONTRIBUTING.md`
- 简体中文：`CONTRIBUTING.zh-CN.md`

## 快速开始

1. **Fork** 本仓库，并将你的 fork 克隆到本地。
2. 安装 Node.js 24 或更高版本。企业 Windows 无管理员权限时，可使用官方 ZIP 便携版，解压到用户可写目录并加入用户级 `PATH`；无需系统服务、驱动、Visual Studio 或全局 npm 包。测试与数据库回退路径会导入内置 `node:sqlite` 模块，因此最低版本为 Node 24。
3. **严格按 lockfile 安装依赖：**

   ```bash
   npm run install:clean
   ```

   该入口严格使用 lockfile，显式安装 Electron，并同时验证 Node.js 与
   Electron 下的 SQLite，无需本机安装 C++ 编译工具链。

4. **以开发模式启动应用：**

   ```bash
   npm run dev
   ```

## 修改代码

1. 从 `main` 创建新分支：

   ```bash
   git checkout -b your-branch-name
   ```

2. 完成你的改动。请保持提交聚焦，每个 commit 只做一类逻辑改动。

3. 提交前运行与发布门禁一致的检查：

   ```bash
   npm run format:check
   npm run typecheck
   npm run lint -- --no-cache --quiet
   npm run test:all
   npm audit --audit-level=high
   npm run build
   ```

4. 使用 `npm run dev` 在本地测试改动，确保行为符合预期。

## 提交 Pull Request

1. 将分支推送到你的 fork。
2. 在上游仓库中向 `main` 发起 Pull Request。
3. 清楚描述你改了什么，以及为什么这样改。
4. 如果你的 PR 解决了某个已有 issue，请在描述中引用它（例如：`Fixes #42`）。

### 保持 Pull Request 精简

请保持 PR 小而聚焦——这样更容易审核和合并。触及过多文件或捆绑了不相关改动的 PR 可能会被要求拆分，甚至可能不被接受。

- 每个 PR 只做一类逻辑改动（一个修复、一个功能、一次重构）。
- 如果你发现自己改了很多不相关的文件，请将工作拆分成多个 PR。
- 避免将格式化/样式改动与功能改动混在一起提交。
- 更小的 PR 能更快得到审核和合并。

维护者会审核你的 PR，并可能提出修改建议。审核通过后，PR 会被合并。

## 报告 Bug

如果你发现了 bug，请在 GitHub 上 [提交 issue](https://github.com/pkulyn/agents-one/issues/new)，并尽量包含：

- 清晰的标题和描述
- 复现步骤
- 预期行为与实际行为
- 你的操作系统和应用版本（如果相关）

## 功能请求

如果你有新想法，也欢迎 [提交 issue](https://github.com/pkulyn/agents-one/issues/new)，并描述：

- 你想解决的问题
- 你希望它如何工作
- 你考虑过的替代方案

## 项目结构

```text
src/main/                Electron 主进程、IPC 处理器、Runtime 集成
src/preload/             安全的 renderer bridge
src/renderer/src/        React 应用和 UI 组件
resources/               应用图标和打包资源
build/                   打包配置资源
```

## 代码风格

- 项目使用 TypeScript、React 和 Electron。
- 运行 `npm run lint` 检查 lint 错误。
- 运行 `npm run format:check` 检查仓库格式。
- 运行 `npm run typecheck` 验证类型安全。
- 运行 `npm run test:all` 验证桌面端和三个子项目。
- 尽量遵循当前仓库现有模式和约定。

## 社区

- 请通过 [GitHub Issues](https://github.com/pkulyn/agents-one/issues) 报告问题或提出功能建议。
- 请阅读项目 README，了解当前架构、受支持的 Runtime 和开发流程。
- 请遵守[行为准则](CODE_OF_CONDUCT.md)、[安全策略](SECURITY.md)和[当前发布限制](KNOWN_ISSUES.md)。

## 许可证

向 Agents One 提交原创内容，即表示你同意将该内容按 [PolyForm Noncommercial License 1.0.0](LICENSE) 授权。请标明引入的第三方内容并保留其原有协议及声明；继承自 `hermes-desktop` 的部分继续遵循 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中的 MIT 条款。
你同时同意将原创贡献按[商业机构内部评估补充许可](COMMERCIAL_EVALUATION_PERMISSION.md)授权。请仅提交你有权按这两份文件授权的内容。
