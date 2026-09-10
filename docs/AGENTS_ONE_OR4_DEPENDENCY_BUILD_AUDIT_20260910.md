# Agents One OR-4 依赖、锁文件与构建质量验收记录

验收日期：2026-09-10

验收范围：OR-401～OR-405

实现提交：`43c028c build(deps): harden reproducible dependency gates`

结论：通过。未使用直接依赖已移除，完整 npm 依赖审计为 0，最终 lockfile 已在独立临时克隆中完成干净安装和双运行时 SQLite 探针；构建体积已形成可重复报告，三个子项目的 38 项测试已进入根级脚本和 CI。

## 验收矩阵

| ID     | 结果 | 证据                                                                                                                                                                                                                                                                    |
| ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OR-401 | 通过 | 对 `src`、`tests`、`scripts`、`plugins`、`services` 做导入扫描，未发现 `ethers`、Three.js 相关包或 `react-file-icon` 消费者。删除 6 个生产直接依赖和 1 个仅为 Three.js 服务的开发类型依赖，并移除 30 行无消费者 CSS。                                                   |
| OR-402 | 通过 | `npm audit` 与 `npm audit --omit=dev` 均为 0。传递依赖落锁到 `fast-uri@3.1.7`、`hono@4.13.7`、`js-yaml@4.3.2`、`qs@6.16.0`、`esbuild@0.28.2`；Vitest/Vite 在同一主版本内升级到 4.1.11/7.3.6。                                                                           |
| OR-403 | 通过 | 从本地 Git 固定内容创建非硬链接临时克隆，仅覆盖本轮最终 `package.json`/`package-lock.json`，执行 `npm run install:clean`。`npm ci --ignore-scripts` 安装 932 个包，完整 audit 0；Node 与 Electron 均加载 SQLite 3.53.4，无系统级 C++ 工具链。临时目录经路径校验后删除。 |
| OR-404 | 通过 | 新增 `npm run size:report`，从 `out` 递归输出 main、preload、renderer 总字节数和前十大文件；本记录保存首个基线。                                                                                                                                                        |
| OR-405 | 通过 | 新增 `test:subprojects` 与 `test:all` 根级入口；Linux CI 新增子项目测试步骤。Plugin SDK 22、Connector 8、Connect Service 8，共 38/38 项通过。PRD 原“34 项”是旧基线，已按当前测试发现数校正。                                                                            |

## 直接依赖处置

删除的生产依赖：

- `ethers`
- `@react-three/drei`
- `@react-three/fiber`
- `three`
- `troika-three-text`
- `react-file-icon`

删除的开发依赖：`@types/three`。

删除前导入扫描仅发现 `main.css` 中一条 `react-file-icon` 历史注释及其从未被 JSX 使用的 `.worktree-file-icon-wrapper` 样式；实际 Worktree 文件图标由本地 `FileIcon` 组件和 `.worktree-file-icon` 样式提供。构建与全量测试通过，说明移除未破坏运行消费者。

## 漏洞处置

初始生产基线为 6 项：2 high、4 moderate。删除无用依赖后，`colord` 与旧 `fflate` 链消失；其余传递依赖通过兼容范围内锁文件更新修复。进一步把 Vitest、Vite 和 esbuild 更新到已修复版本后，完整开发/生产依赖树也达到 0 vulnerability，无需风险接受记录。

## 构建体积基线

命令：`npm run build && npm run size:report`

| 区域     | 文件数 |   总字节数 | 主要文件                                        |
| -------- | -----: | ---------: | ----------------------------------------------- |
| main     |      2 |  1,366,779 | `start-ypuyS9AN.js` 1,358,412；`index.js` 8,367 |
| preload  |      2 |     37,979 | `index.js` 37,147；`askpass.js` 832             |
| renderer |    208 | 13,324,750 | 主 JS 4,323,996；延迟 JS 2,453,479；CSS 384,006 |

Renderer 总量包含三张启动视觉 PNG，分别为 1,403,479、1,392,783 与 1,172,923 字节，以及按需加载的语法高亮语言文件和字体。两个大 JS chunk 与 OR-3 构建规模基本一致；本阶段只建立基线，不做高风险拆包重构。后续若主 JS、延迟 JS、CSS 或区域总量明显增长，提交必须说明新增消费者和拆分判断。

## 自动验证

- `npm run test:all`：主工程 212/212 文件，2,067 passed、9 skipped、0 failed；三个子项目 38/38 passed。
- `npm run typecheck`：Node/Web TypeScript 通过。
- `eslint --cache --quiet .`：0 error。
- `npm run build`：Electron main、preload、renderer 生产构建通过。
- `npm audit`：完整依赖 0 vulnerability。
- 最终 lockfile 独立临时克隆 `npm run install:clean`：通过；安装后的 `npm audit` 同为 0。
- `npx --yes lat.md check` 与 `git diff --check`：通过。

## 非阻断提示

干净安装仍显示 `inflight`、`lodash.isequal`、`rimraf@2`、`glob@7`、`whatwg-encoding`、`boolean` 的上游弃用提示。它们不是当前 npm audit 漏洞，且均为传递依赖；本轮不通过 overrides 强行改写不兼容依赖树。后续依赖升级应优先由直接上游版本自然移除这些链，并继续以 lockfile 干净安装和完整 audit 为门禁。

下一阶段按 PRD 进入 OR-5 CI、打包与发布链路；不得因 OR-4 通过而提前创建公开 Release。
