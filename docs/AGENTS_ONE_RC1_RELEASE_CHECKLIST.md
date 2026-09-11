# Agents One RC1 Release Checklist

本清单是 `v0.1.0-alpha.1` Windows x64 候选的逐次验收记录模板。每个候选必须绑定一个不可变 commit SHA；不得用分支名、未提交工作区或后续重建产物替代该 SHA 的证据。

## 候选身份

| 项目          | 记录                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 候选版本      | `0.1.0-alpha.1`                                                                                                           |
| 目标 tag      | `v0.1.0-alpha.1`（仅在 OR-701～706 与 G0～G8 全部通过后创建）                                                             |
| Commit SHA    | `0043bf7f1678536dfd2525a0179b3c5ce218f6c1`（当前远端自动 Dry Run 候选，不是最终 RC tag 授权）                             |
| 工作流运行    | [Windows Alpha Release Gate #34577793216](https://github.com/pkulyn/agents-one/actions/runs/34577793216)；CI #34577013104 |
| 验收人 / 日期 | 自动门禁：GitHub Actions / 2026-09-11；人工验收人待填写                                                                   |
| 结论          | **No-Go**；远端自动门禁及 OR-702 本地 CLI 子范围通过，Hermes/Gateway、独立机与 OR-703～706 尚未完成                       |

## 自动门禁证据

发布工作流必须从目标 GitHub 的固定 SHA checkout，并在同一次运行中执行三轮连续门禁。三轮均包含格式、Node/Web TypeScript、零错误 lint、主工程及三个子项目测试、完整依赖 audit 和生产 build；任一步失败即终止。依赖只通过 `npm run install:clean` 安装，安装前后校验 lockfile 与工作区不变。

| 检查                           | Round 1  | Round 2 | Round 3 | 证据                                                                                                                |
| ------------------------------ | -------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `format:check`                 | 通过     | 通过    | 通过    | run `34577793216` step 8                                                                                            |
| `typecheck`                    | 通过     | 通过    | 通过    | run `34577793216` step 8                                                                                            |
| ESLint 0 errors                | 通过     | 通过    | 通过    | run `34577793216` step 8                                                                                            |
| 主工程 + 三个子项目测试        | 通过     | 通过    | 通过    | run `34577793216` step 8；既有 9 项有据 skip                                                                        |
| 完整依赖 audit                 | 通过     | 通过    | 通过    | run `34577793216` step 8                                                                                            |
| production build               | 通过     | 通过    | 通过    | run `34577793216` step 8                                                                                            |
| Windows NSIS + portable 打包   | 通过     | 不重复  | 不重复  | run `34577793216` step 9                                                                                            |
| 解包应用 + portable 启动 smoke | 通过     | 不重复  | 不重复  | run `34577793216` step 10；隔离 `userData`                                                                          |
| 资产 SHA-256                   | 通过生成 | 不适用  | 不适用  | step 11 `SHA256SUMS.txt`；artifact digest `sha256:6c24410cd7e70d12194eb0c359cf4f3210548faff855b7967c23697010e9ced0` |

三轮门禁证明同一源码与锁文件的连续稳定性；Windows 打包和启动 smoke 在三轮源码门禁全部通过后执行一次。不得把其他 commit 的历史绿色结果拼接为本候选结果。

## 远端候选制品下载复核（当前开发机预检）

2026-09-11 已从 run `34577793216` 下载完整候选 artifact 到仓库外隔离目录。`SHA256SUMS.txt` 恰含以下四项，逐文件复算均匹配；GitHub artifact 本身的 digest 见上方自动门禁证据。该步骤验证远端上传包可下载且内容自洽，但当前机器不是独立干净 Windows，不替代 OR-701～705 的独立人工回放。

| 远端候选文件                                  |        字节 | SHA-256                                                            |
| --------------------------------------------- | ----------: | ------------------------------------------------------------------ |
| `agents-one-0.1.0-alpha.1-setup.exe`          | 195,544,575 | `b5274a33e5447900d68ba1a8d8613854aa2fbcc1330abff5891356b7ac6fabc5` |
| `agents-one-0.1.0-alpha.1-portable.exe`       | 195,358,202 | `8e432cf87be2ee6c5c165a389b73fe4fdd21d2c0a180ab34de82b93b30ca36bd` |
| `agents-one-0.1.0-alpha.1-setup.exe.blockmap` |     204,989 | `28e25e1a78821a23e12e63269477a87dfde86d89e1e4ec04da5788159c0b173e` |
| `latest.yml`                                  |         373 | `cc3a14ec49b979c167445c974d9b8cf550ceda708c333fcbe8ccf62d4d15288d` |

portable 使用专用 `userData` 真实启动通过，停止后关联进程和隔离数据残留为 0。NSIS 首次安装后，卸载注册表 `DisplayVersion` 与 `resources/app.asar` 包版本均为 `0.1.0-alpha.1`；安装版以隔离 `userData` 启动通过，卸载后卸载项、安装目录、关联进程和隔离数据残留均为 0，测试前已存在的真实用户数据目录未变化。两个 exe 均为 `NotSigned`。由于当前构建关闭 `signAndEditExecutable`，安装版主 exe 的 PE `FileVersion` 为 Electron `43.4.1`；应用版本应以注册表和 `app.asar` 为验收依据。

## 本地预检记录（不替代远端验收）

2026-09-11 在 `<independent-local-clone>` 对固定提交 `7bac448ddc3aa59164c022a6e9ad7a814c5568fb` 完成非硬链接独立克隆。克隆初始没有 `node_modules`、`.env`、Agents One 用户配置、沙箱、`dist` 或 `out`；`npm run install:clean` 安装 932 个包、audit 0，lockfile SHA-256 为 `3340c3ea1a0d0ed1aca836a97ea16cf23fe25089b8f24cec131fc02675929b97`，安装未修改 tracked 工作树。

同一 SHA 的三轮格式、typecheck、零错误 lint、主工程/子项目测试、完整 audit 与 build 全部通过。每轮主工程均为 213/213 文件、2,071 passed/9 skipped；三个子项目均为 22+8+8 passed。随后生成 Windows x64 包，分别真实启动 `win-unpacked` 与 portable 并写入各自隔离 `userData`；关联进程、隔离数据目录和 portable SFX 解压目录清理后残留均为 0。本机宿主 Node 25.8.2，不替代 workflow 声明的 Node 22 runner 验收。

| 本地产物                                      |        字节 | SHA-256                                                            |
| --------------------------------------------- | ----------: | ------------------------------------------------------------------ |
| `agents-one-0.1.0-alpha.1-setup.exe`          | 197,320,348 | `4cb68f56ec7a28f509ee51d972ec6bffd21c4f4a2c258d19393ea1155893e707` |
| `agents-one-0.1.0-alpha.1-portable.exe`       | 197,133,977 | `853fdf57fc596ee65fdfb236c40d28206e932b4884274be0d94963983686304b` |
| `agents-one-0.1.0-alpha.1-setup.exe.blockmap` |     208,854 | `c52e2495849c93819f7ac4746b663f6d83f2922fbf473494e2851402e8ddf164` |
| `latest.yml`                                  |         373 | `5df876fb8ad1955c828b55b931e33b6dea6cf6aeae6a80d40e6fc8bb9748e011` |

两个 exe 的 Authenticode 状态均为 `NotSigned`，符合当前未签名 Alpha 策略。这些文件仅为本机候选，不得上传或公开分发。先前预检拦截了校验清单误含未上传 `builder-debug.yml` 的问题；上述 SHA 已采用修正后的严格四文件白名单复验。发布 workflow 还会拒绝 branch、tag、短 SHA 或非十六进制输入，并在 checkout 后确认 HEAD 与请求的完整 SHA 完全一致。

本地完整预检之后，提交 `2dcb45b9c1ad0af6728001188c5cf51a24bb11e7` 又将全部外部 GitHub Actions 固定到完整提交 SHA，并增加 GitHub Actions Dependabot 更新入口。该变更不改变应用源码或本地产物，但必须由目标仓库的 Windows runner 在最终候选 SHA 上验证，不能把 `7bac448` 的本地绿色结果直接登记为该后续提交的远端 Actions 结果。

## OR-7 干净 Windows 人工回放

以下操作必须在普通用户权限、没有当前仓库 `node_modules`、没有开发机 Agents One 配置的独立 Windows 环境执行。测试账号、Token、Cookie、提示词、用户数据和原始日志不得提交到仓库；这里只记录脱敏结论和受控证据位置。

| ID     | 场景             | 必验步骤                                                                                                     | 状态 / 证据                                        |
| ------ | ---------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| OR-701 | 干净环境         | 从目标 GitHub 固定 SHA 全新 clone；clean install；三轮门禁；打包                                             | 自动部分与远端制品下载校验通过；独立人工机待验收   |
| OR-702 | Runtime 黄金路径 | Hermes、本地 CLI、Gateway v1 分别完成配置、probe、真实对话、取消/失败、重启恢复；其余首发 Runtime 按回归矩阵 | Codex/Claude Code/Pi 通过；Hermes/Gateway 待验收   |
| OR-703 | 用户数据         | 项目/任务归属、历史、附件、定时任务、时区/休眠补偿、备份校验、恢复、失败回滚                                 | 待验收                                             |
| OR-704 | 桌面体验         | NSIS 首启、portable、托盘、窄窗口、中英文、外链、下载、退出、崩溃恢复、卸载残留                              | 开发机安装/portable 启动与卸载预检通过；其余待验收 |
| OR-705 | 稳定性           | 固定 SHA 三轮自动门禁 + 至少一轮独立干净机人工验收                                                           | 三轮自动通过；独立人工机待验收                     |
| OR-706 | RC 标签          | 前述项目和 G0～G8 全绿后，才为同一 SHA 创建 RC tag                                                           | 禁止提前执行                                       |

## 发布闸门签字

| Gate | 通过条件摘要                                     | 状态   | 证据 / 负责人 |
| ---- | ------------------------------------------------ | ------ | ------------- |
| G0   | 独立干净 clone、正确远端/SHA、历史与公开内容安全 | 待验收 |               |
| G1   | TypeScript 与生产 build                          | 待验收 |               |
| G2   | 主/子项目测试，同一 SHA 三轮绿色                 | 待验收 |               |
| G3   | ESLint、格式、`git diff --check`                 | 待验收 |               |
| G4   | 供应链、可复现 lockfile、产物校验值              | 待验收 |               |
| G5   | 凭据、Web Provider、SECURITY 与威胁边界          | 待验收 |               |
| G6   | 固定 SHA、人工批准、签名/更新策略                | 待验收 |               |
| G7   | Windows 安装、Runtime、历史、计划、备份恢复      | 待验收 |               |
| G8   | README、LICENSE、贡献、安全、行为、变更与模板    | 待验收 |               |

## 安装、升级、回滚与发布检查

- [ ] 从 draft Release 下载 NSIS、portable、`SHA256SUMS.txt` 和发布说明，并在运行前核验 SHA-256。（Actions artifact 下载与四文件复算已预检；draft Release 尚未创建。）
- [ ] 记录 Windows 版本/架构、普通用户权限、安装路径和 SmartScreen 实际表现。
- [ ] 验证首次安装、覆盖升级、退出后升级、卸载、重装和 portable 不相互污染。（当前开发机已完成首次安装、隔离启动、卸载和 portable 隔离启动；覆盖升级、重装与旧版回滚待独立机。）
- [ ] 验证未签名 Alpha 的自动更新入口保持禁用，文档、UI 与发布说明一致。
- [ ] 在恢复前创建并验证备份；分别验证成功恢复、损坏备份拒绝、写入失败回滚和上一版本数据回退。
- [ ] 确认卸载后仅保留文档明确声明的用户数据；由用户决定是否删除，不由安装器静默清理。
- [ ] 复核公开资产只含 Windows x64 声明文件，没有 macOS/Linux 或本机私有材料。
- [ ] 维护者完成风险接受、最终 Go/No-Go 和发布日期签字。

## 当前阻断

目标私有暂存仓库、默认 `main`、固定 SHA clean checkout、Windows CI/Release Gate 与候选 artifact 已建立；当前开发机已完成远端制品校验、首次安装/启动/卸载、portable 启动及 Codex/Claude Code/Pi 黄金路径预检。当前 GitHub Free 私有仓库不支持 `main` branch protection 和 Environment required reviewer，Private Vulnerability Reporting 也须在转公开后启用；因此尚不执行 `publish_draft=true`。Hermes、Gateway v1、独立干净 Windows 的用户数据、完整桌面、覆盖升级与旧版回滚人工回放仍未完成。本清单保持 No-Go，不创建 OR-706 RC tag，也不公开 Release。
