# Agents One RC1 Release Checklist

本清单是 `v0.1.0-alpha.1` Windows x64 候选的逐次验收记录模板。每个候选必须绑定一个不可变 commit SHA；不得用分支名、未提交工作区或后续重建产物替代该 SHA 的证据。

## 候选身份

| 项目          | 记录                                                          |
| ------------- | ------------------------------------------------------------- |
| 候选版本      | `0.1.0-alpha.1`                                               |
| 目标 tag      | `v0.1.0-alpha.1`（仅在 OR-701～706 与 G0～G8 全部通过后创建） |
| Commit SHA    | 待远端 RC 验收时填写完整 40 位 SHA                            |
| 工作流运行    | 待填写 Actions run URL 与 run ID                              |
| 验收人 / 日期 | 待填写                                                        |
| 结论          | **No-Go**；OR-507/OR-701～706 尚未全部完成                    |

## 自动门禁证据

发布工作流必须从目标 GitHub 的固定 SHA checkout，并在同一次运行中执行三轮连续门禁。三轮均包含格式、Node/Web TypeScript、零错误 lint、主工程及三个子项目测试、完整依赖 audit 和生产 build；任一步失败即终止。依赖只通过 `npm run install:clean` 安装，安装前后校验 lockfile 与工作区不变。

| 检查                         | Round 1 | Round 2 | Round 3 | 证据                            |
| ---------------------------- | ------- | ------- | ------- | ------------------------------- |
| `format:check`               | 待验收  | 待验收  | 待验收  | Actions step/log                |
| `typecheck`                  | 待验收  | 待验收  | 待验收  | Actions step/log                |
| ESLint 0 errors              | 待验收  | 待验收  | 待验收  | Actions step/log                |
| 主工程 + 三个子项目测试      | 待验收  | 待验收  | 待验收  | Actions step/log；逐项登记 skip |
| 完整依赖 audit               | 待验收  | 待验收  | 待验收  | Actions step/log                |
| production build             | 待验收  | 待验收  | 待验收  | Actions step/log                |
| Windows NSIS + portable 打包 | 待验收  | 不重复  | 不重复  | 固定 SHA 的同一 workflow run    |
| 解包应用启动 smoke           | 待验收  | 不重复  | 不重复  | 隔离 `userData`、进程退出与日志 |
| 资产 SHA-256                 | 待验收  | 不适用  | 不适用  | `SHA256SUMS.txt`                |

三轮门禁证明同一源码与锁文件的连续稳定性；Windows 打包和启动 smoke 在三轮源码门禁全部通过后执行一次。不得把其他 commit 的历史绿色结果拼接为本候选结果。

## 本地预检记录（不替代远端验收）

2026-09-11 在 `<independent-local-clone>` 对固定提交 `7fd0811688e365118dcedc0050875a96b766ef7a` 完成非硬链接独立克隆。克隆初始没有 `node_modules`、`.env`、Agents One 用户配置、沙箱、`dist` 或 `out`；`npm run install:clean` 安装 932 个包、audit 0，lockfile SHA-256 为 `3340c3ea1a0d0ed1aca836a97ea16cf23fe25089b8f24cec131fc02675929b97`，安装未修改 tracked 工作树。

同一 SHA 的三轮格式、typecheck、零错误 lint、主工程/子项目测试、完整 audit 与 build 全部通过。每轮主工程均为 213/213 文件、2,071 passed/9 skipped；三个子项目均为 22+8+8 passed。随后生成 Windows x64 包并通过解包应用隔离 `userData` 启动 smoke；本机宿主 Node 25.8.2，不替代 workflow 声明的 Node 22 runner 验收。

| 本地产物                                      |        字节 | SHA-256                                                            |
| --------------------------------------------- | ----------: | ------------------------------------------------------------------ |
| `agents-one-0.1.0-alpha.1-setup.exe`          | 197,320,349 | `d6f6ffc1e63250c5112396bbbf01c1453588d304c961c07262849c0650615c3d` |
| `agents-one-0.1.0-alpha.1-portable.exe`       | 197,133,973 | `1af5a12d9adfaae9a277f5e605f6d4c06ada7e4984768cba054c2f38136fd7b3` |
| `agents-one-0.1.0-alpha.1-setup.exe.blockmap` |     208,855 | `9072a2ff4090b0e5d2041860533195e5b629cc90d72dfaf2092d1c5a020fdde4` |
| `latest.yml`                                  |         373 | `3d73b18cf35bc55bd088ed3c2693219391e1866e55c73f178ac8143983dd885c` |

两个 exe 的 Authenticode 状态均为 `NotSigned`，符合当前未签名 Alpha 策略。这些文件仅为本机候选，不得上传或公开分发。首次预检还拦截了校验清单误含未上传 `builder-debug.yml` 的问题；上述 SHA 已采用修正后的严格四文件白名单复验。

## OR-7 干净 Windows 人工回放

以下操作必须在普通用户权限、没有当前仓库 `node_modules`、没有开发机 Agents One 配置的独立 Windows 环境执行。测试账号、Token、Cookie、提示词、用户数据和原始日志不得提交到仓库；这里只记录脱敏结论和受控证据位置。

| ID     | 场景             | 必验步骤                                                                                                     | 状态 / 证据  |
| ------ | ---------------- | ------------------------------------------------------------------------------------------------------------ | ------------ |
| OR-701 | 干净环境         | 从目标 GitHub 固定 SHA 全新 clone；clean install；三轮门禁；打包                                             | 待验收       |
| OR-702 | Runtime 黄金路径 | Hermes、本地 CLI、Gateway v1 分别完成配置、probe、真实对话、取消/失败、重启恢复；其余首发 Runtime 按回归矩阵 | 待验收       |
| OR-703 | 用户数据         | 项目/任务归属、历史、附件、定时任务、时区/休眠补偿、备份校验、恢复、失败回滚                                 | 待验收       |
| OR-704 | 桌面体验         | NSIS 首启、portable、托盘、窄窗口、中英文、外链、下载、退出、崩溃恢复、卸载残留                              | 待验收       |
| OR-705 | 稳定性           | 固定 SHA 三轮自动门禁 + 至少一轮独立干净机人工验收                                                           | 待验收       |
| OR-706 | RC 标签          | 前述项目和 G0～G8 全绿后，才为同一 SHA 创建 RC tag                                                           | 禁止提前执行 |

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

- [ ] 从 draft Release 下载 NSIS、portable、`SHA256SUMS.txt` 和发布说明，并在运行前核验 SHA-256。
- [ ] 记录 Windows 版本/架构、普通用户权限、安装路径和 SmartScreen 实际表现。
- [ ] 验证首次安装、覆盖升级、退出后升级、卸载、重装和 portable 不相互污染。
- [ ] 验证未签名 Alpha 的自动更新入口保持禁用，文档、UI 与发布说明一致。
- [ ] 在恢复前创建并验证备份；分别验证成功恢复、损坏备份拒绝、写入失败回滚和上一版本数据回退。
- [ ] 确认卸载后仅保留文档明确声明的用户数据；由用户决定是否删除，不由安装器静默清理。
- [ ] 复核公开资产只含 Windows x64 声明文件，没有 macOS/Linux 或本机私有材料。
- [ ] 维护者完成风险接受、最终 Go/No-Go 和发布日期签字。

## 当前阻断

目标 `https://github.com/pkulyn/agents-one.git` 当前不存在或当前维护者账号不可见，因而无法取得目标仓库 clean clone、Windows Actions、`release` Environment 审批、draft Release 与独立干净机证据。该阻断解除前，本清单保持 No-Go，不创建 OR-706 RC tag，也不公开上传本地产物。
