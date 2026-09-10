# Agents One OR-5 Windows Alpha 发布链路验收记录

验收日期：2026-09-10

验收范围：OR-500～OR-507

实现提交：`4ddb1db style: establish repository formatting baseline`、`d9c47a6 build(release): gate Windows alpha candidates`

结论：**OR-500～OR-506 通过；OR-507 的本地候选生成与启动冒烟通过，远端草稿 Release 及安装/升级/卸载/回滚实测待目标 GitHub 仓库可用后执行。** 当前不得公开发布。

## 决策记录

| 项目       | 决策                           | 理由与边界                                                                                                                                                                                                            |
| ---------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首发平台   | Windows x64 Alpha              | README、工作流和 Release 模板均明确仅发布 Windows x64。macOS/Linux job 已从公开发布工作流移除，不生成或上传对应公开资产。                                                                                             |
| 版本线     | `v0.1.0-alpha.1`               | Agents One 尚无可见公共 Release 或既有更新用户；采用全新产品版本线，不延续 Hermes 上游 `v0.7.3` 更新通道。`package.json`、lockfile、产物名和拟发布 tag 已统一。                                                       |
| 历史 tag   | 不推送 44 个上游时代 `v*` tag  | 这些 tag 属于迁移前 Hermes 历史，不作为 Agents One 新公共仓库的发布命名空间。迁移恢复标签与未来 RC tag 继续分开管理。                                                                                                 |
| 签名与更新 | Alpha 未签名，自动更新默认禁用 | 本地 Authenticode 检查为 `NotSigned`。只有打包、非便携且编译时显式设置 `AGENTS_ONE_SIGNED_AUTO_UPDATE_BUILD=1` 的构建才可加载 `electron-updater`；运行时环境变量不能打开该能力。                                      |
| 发布权限   | 仅手动触发，默认不创建 Release | 删除 `release` 分支 push 触发器。`publish_draft=false` 时只上传 14 天保留的 Actions 候选产物；创建草稿 Release 还需显式选择并经过 `release` Environment。目标仓库建立后必须为该 Environment 配置 required reviewers。 |

## 验收矩阵

| ID     | 结果         | 证据                                                                                                                                                                                                                                  |
| ------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OR-500 | 通过         | `.github/workflows/release.yml` 仅有 Windows x64 打包 job；README 中英文入口明确 Alpha 平台边界，macOS/Linux 不进入公开资产。                                                                                                         |
| OR-501 | 通过         | 统一 workflow 包含干净安装、格式、类型、零错误 lint、主测试、对话/配置定向测试、38 项子项目测试、完整 audit、生产 build；`rc1-windows.yml` 直接复用该 workflow。新增全仓 `format:check`，并用独立样式提交建立可通过的 Prettier 基线。 |
| OR-502 | 通过         | Windows runner 生成 NSIS 与 portable x64；脚本检查安装包、便携包、解包 exe、`app.asar`，启动解包应用 12 秒并确认隔离 `userData` 写入。基础对话和配置路径由三个定向测试文件在打包前阻断；工作流生成 SHA-256。                          |
| OR-503 | 通过（代码） | 仅 `workflow_dispatch` 或受调用 workflow 可进入；默认权限只读，只有 `publish_draft` job 申请 `contents: write` 并绑定 `release` Environment。Environment 审批规则仍须在新远端配置。                                                   |
| OR-504 | 通过         | checkout 后记录解析 SHA、版本及 lockfile SHA-256；安装后验证 lockfile 与工作区未改变；同一 job 完成测试/构建/打包，候选 artifact 名携带完整 SHA；草稿 Release 固定到该 SHA，说明文件记录平台、签名、更新、已知限制和回退步骤。        |
| OR-505 | 通过         | 版本改为 `0.1.0-alpha.1`；决定不推送 44 个上游 `v*` tag；工作流检查同名远端 tag 不得指向其他 SHA。                                                                                                                                    |
| OR-506 | 通过         | 主进程通过编译时常量执行 fail-closed 策略；缺失/损坏偏好默认 false；策略禁用时不加载 updater，check/download/install 均不执行；设置页显示中英文警告并禁用控件。                                                                       |
| OR-507 | 待远端验收   | 本地产物和解包启动已通过，但目标 `pkulyn/agents-one` 仍不存在或当前账号不可见，尚未运行 GitHub Windows runner、创建草稿 Release，也未完成安装、升级、卸载和回滚实测。                                                                 |

## 本地候选产物

以下校验值只对应 `d9c47a6` 内容在本机生成的验证候选，不是公开 Release：

| 文件                                          |        字节 | SHA-256                                                            |
| --------------------------------------------- | ----------: | ------------------------------------------------------------------ |
| `agents-one-0.1.0-alpha.1-setup.exe`          | 197,320,347 | `dd3feb4ee9042c5f235cffba75ad62ff583b4b82edcb36c9640eb475a50ca2db` |
| `agents-one-0.1.0-alpha.1-portable.exe`       | 197,133,974 | `759d88bbff65dccd41a5eaa7c33bb5fc446e3d7b6cf28bc3f2fa4091ccb39266` |
| `agents-one-0.1.0-alpha.1-setup.exe.blockmap` |     208,833 | `41192641b9f5ef5b4adbdfe877936349e16438bf9d125b94d9c08a4a3beae141` |
| `latest.yml`                                  |         373 | `687589143820b99bfc28b4f8d7df83ff41174bc8bc254a7d5e96efdd09008660` |

CI 会重新从固定 SHA 构建并生成自己的 `SHA256SUMS.txt`；不得把上述本机校验值复制为未来远端资产的校验值。

## 自动验证

- `npm run format:check`：全仓通过。
- `npm run typecheck`：Node/Web TypeScript 通过。
- `npm run lint -- --no-cache --quiet`：0 error。
- `npm run test:all`：主工程 213/213 文件，2,071 passed、9 skipped、0 failed；三个子项目 38/38 passed。
- `npm audit --audit-level=high`：完整依赖树 0 vulnerability。
- `npm run build`：main、preload、renderer 生产构建通过，构建产物内策略为 `unsigned-build`。
- `npm run package:win`：NSIS、portable、win-unpacked 生成成功。
- `scripts/windows-package-smoke.ps1`：真实启动通过，独立 `userData` 路径产生启动数据；测试进程和临时目录已清理。
- Authenticode：安装包 `NotSigned`，符合本阶段发布边界。

## 进入远端 Dry Run 前置清单

1. 创建或恢复可访问的 `pkulyn/agents-one` 目标仓库，只推送 Agents One `main` 与必要恢复标签，不推送 44 个上游版本 tag。
2. 配置 `release` Environment required reviewers，并确认默认分支保护与 Actions 权限。
3. 以完整 commit SHA 手动运行 `Windows Alpha Release Gate`，先保持 `publish_draft=false` 核对 runner 结果和候选校验值。
4. 再经审批以 `publish_draft=true` 创建草稿 Release；不得转为公开。
5. 在干净 Windows 普通用户环境完成安装、首次启动、基础 Runtime、升级模拟、卸载、数据保留与备份回滚；把证据写入 OR-7 验收记录后才允许公开。
