# Agents One 项目进展日志

## 2026-09-12：英文 UI 收口与 Windows Connector 回归稳定化

- 英文 UI 收口继续推进：轻量对话、主对话入口和反馈、托盘、协作工作区/新建向导、Runtime Shell、项目/任务侧栏已改为按活动语言渲染；项目名称、任务标题、已配置 Runtime 名称等用户数据保持原文。侧栏本轮提交为 `2d9ebfe`，英文定向测试和 Web TypeScript 检查通过；剩余 RuntimeChat 的中文主要是兼容解析、协作协议与角色提示，须另作双语协议兼容切片，不能直接替换正则。
- Layout 的计划任务结果 toast、项目文件夹选择器、快速对话转入任务提示及协作设置的成功/失败反馈已纳入 `collaboration.shell`。TaskCollaborationDialog/Workspace 定向回归 7/7、Web TypeScript、格式、`lat check` 与 `git diff --check` 通过。
- OR-703 自动数据证据：`agents-one-backup`、`task-schedules`、`session-cache-sync`、`workspace-protection` 与 `sessions-history-items` 共 5 个隔离测试文件、76 项断言通过，覆盖备份/恢复、附件路径迁移、事务回滚、项目工作区、会话历史和计划任务存储。该结果不替代独立 Windows 的完整桌面、时区/休眠补偿和人工恢复回放。
- GitHub Windows CI `34683699418` 暴露 Connector 测试在非交互服务账户下三次真实 DPAPI 调用均阻塞至原 15 秒超时，并非业务断言失败。生产调用超时提高到 60 秒；契约测试在 Windows CI 改用注入式保护器验证加密信封和失败边界，真实 DPAPI 回环移为显式 `npm --prefix plugins/agents-one-connector run test:dpapi` 交互 Windows 验收。当前开发机已实际通过该命令；CI 仍须以本次修复后的提交重新取得绿色证据。
- GitHub CI `34686809637` 已在 `295386a` 完成并成功，覆盖 Connector DPAPI 稳定化、项目/任务侧栏和 Layout 本地化。该绿色结果是当前主线回归证据，不替代后续固定最终 SHA 的 Windows Alpha Release Gate、草稿 Release 和独立干净机验收。

## 2026-09-11：OR-702 本地 CLI 黄金路径与候选刷新

- 真实回放发现 Codex 无项目普通对话会在应用私有非 Git 目录启动，但既有命令未传 `--skip-git-repo-check`，导致 probe 健康后首轮对话仍立即失败。提交 `0043bf7f1678536dfd2525a0179b3c5ce218f6c1` 仅在无显式项目时加入该参数；已补回归测试，显式项目、受管 worktree 与权限模式不变。
- 当前开发机完整门禁通过：双 TypeScript、213/213 主工程测试文件（2,072 passed/9 skipped）、零错误 lint、生产依赖 audit 0、production build、格式、diff 与 `lat.md` 均通过。GitHub CI run `34577013104` 对同一 SHA 全绿。
- Agents One 隔离实例中的本地 Runtime 真实验收通过：Codex `0.147.0`、Claude Code `2.1.233`、Pi `0.85.1` 均完成配置保存、healthy probe、真实只读对话和结构化事件终态；无效 CLI 正确得到 `unreachable/failed`，Codex 运行中取消正确得到 `cancelled`。应用重启后，三项 Runtime 定义均恢复并再次 probe 为 healthy；随后测试定义和隔离配置已清理。未记录回答正文、账户信息或凭据。
- OR-704 中文核心 UI 自动回放通过：在全新隔离配置中检查对话、定时任务、新建表单、智能体、智能体编辑和设置页，1024×768 与 768×800 均无横向溢出，关键截图目视无明显遮挡或错位。既有脚本的计划任务 aria-label 已落后于当前产品文案，提交 `f2b9b22` 将断言同步为当前标签后通过。
- OR-704 英文回放未通过：切换 English 后文档语言已为 `en`，但侧栏和计划任务等核心界面仍显示硬编码中文。排除测试和语言资源后，Renderer 有 29 个产品文件、约 1,133 行包含硬编码中文，主要集中于 RuntimeChat、AgentRuntimesPane、Schedules、Agents 与协作界面；双语 UI 必须作为 P1 收口，不能用局部 i18n 或中文截图替代。
- OR-702 外部 Runtime 边界：本机标准 Hermes Home 中不存在可用 repo/venv/config/auth，真实配置也没有 `hermes-home` Gateway v1 Runtime；孤立的 Token 占位不得被猜测或复用。因此 Hermes 与 Gateway v1 当前无可执行环境，继续保持待验收。
- 新候选远端门禁：固定 SHA `0043bf7f1678536dfd2525a0179b3c5ce218f6c1` 的 Windows Alpha Release Gate run `34577793216` 在 28m27s 内完成 clean checkout、依赖与工作树不变校验、连续三轮完整门禁、NSIS/portable 打包、双启动 smoke、校验清单及 artifact 上传，结论 `success`。`publish_draft=false`，草稿 Release job 正确跳过。
- 新候选 artifact：`agents-one-0.1.0-alpha.1-windows-x64-0043bf7f1678536dfd2525a0179b3c5ce218f6c1`，391,178,899 字节，digest `sha256:6c24410cd7e70d12194eb0c359cf4f3210548faff855b7967c23697010e9ced0`，保留至 2026-09-25。下载后四项 SHA-256 全部匹配；portable 启动及 NSIS 首次安装、隔离启动、卸载通过，卸载后无注册表/安装目录/隔离数据残留，既有真实用户数据未变化。
- 候选替代关系：`0043bf7` 取代 `7c56549`；后者只保留为发现 Codex 无项目对话缺陷前的历史自动门禁证据，不得用于 tag/Release。OR-702 的本地 CLI 子范围已通过；Hermes、Gateway v1、英文 UI，以及独立干净 Windows 的 Runtime、数据和完整桌面路径仍待验收，整体继续 No-Go。

## 2026-09-11：目标 GitHub 私有暂存仓库与远端门禁建立

- 仓库建立：已由维护者账号创建私有暂存仓库 `https://github.com/pkulyn/agents-one`，`origin` 指向该仓库，默认分支为 `main`；首次人工推送只包含 `main`，未推送 44 个 Hermes 上游 `v*` tag，当前远端仍无 tag、无 GitHub Release。Dependabot 随后按仓库配置创建了独立更新分支/PR，不属于产品分支推送。
- GitHub 权限边界：Issues 已启用、Wiki 已关闭，`release` Environment 已创建。当前 GitHub Free 私有仓库对 `main` branch protection 返回 403，对 Environment required reviewer 返回 422，Private Vulnerability Reporting 在私有状态返回 404；仓库保持私有且不创建 draft Release，以上三项须在转公开时先配置验证，或由维护者升级 GitHub Pro 后配置。
- 远端首次回放发现并修复三项环境问题：Windows runner 的临时目录可能混用 8.3 短路径与长路径，交付物测试现比较 `realpath`；Linux runner 无法正确承载本项目的 Windows 路径语义，主 CI 已与声明首发平台统一为 `windows-latest`；Node 22 不向当前 Vite/Vitest 工具链暴露 `node:sqlite`，最低开发版本与 CI/Release 已统一为 Node 24。
- 合并门禁补齐：普通 CI 除 clean install、格式、typecheck、主/子项目测试和 lint 外，新增完整依赖 audit 与生产 build。固定 SHA `7c56549508385213189a338b526d3a8a039e2638` 的 CI run `34564056533` 全绿。
- 发布门禁通过：同一固定 SHA 的 Windows Alpha Release Gate run `34564064432` 在全新 GitHub runner 完成 clean install、lockfile/工作树不变校验、连续三轮完整自动门禁、NSIS/portable 打包、unpacked/portable 真实启动、四项资产校验清单和 artifact 上传；run 于 2026-09-11 13:26（Asia/Shanghai）完成，结论 `success`。
- 候选 artifact：`agents-one-0.1.0-alpha.1-windows-x64-7c56549508385213189a338b526d3a8a039e2638`，391,179,002 字节，GitHub artifact digest `sha256:dbd1ebd7f954e4e59ec1e99c04fed04aa4b97eae1884174d9574494854beb94f`，保留至 2026-09-25。此次 `publish_draft=false`，未创建 tag/Release。
- 下载制品复核：已从 run `34564064432` 下载候选 artifact，`SHA256SUMS.txt` 恰含 NSIS、portable、blockmap、`latest.yml` 四项，逐文件重算结果全部一致；`latest.yml` 与发布说明中的版本、架构、固定 SHA、未签名及禁用自动更新说明一致。两个 exe 的 Authenticode 均为 `NotSigned`。
- 当前开发机隔离 smoke：portable 使用专用 `userData` 启动通过并清理至零残留；NSIS 静默安装后，卸载注册表 `DisplayVersion` 与 `resources/app.asar` 的包版本均为 `0.1.0-alpha.1`，安装版以隔离 `userData` 启动通过，随后卸载成功，卸载项、安装目录、测试进程与隔离数据均无残留，既有真实用户数据目录的存在性、根时间戳和文件数未变化。由于构建关闭 `signAndEditExecutable`，主 exe 的 PE `FileVersion` 为 Electron `43.4.1`，不得用它替代应用版本验收。
- 当前结论：OR-701 的目标 GitHub clean checkout、自动门禁与打包部分已通过，OR-705 的同 SHA 三轮自动验证已通过；OR-507 的制品下载、校验、portable 启动及首次安装/启动/卸载已在当前开发机完成预检，但 draft Release、独立干净机、覆盖升级和上一版本回滚仍未完成。OR-702～704 及 OR-705 的独立干净 Windows 人工回放也仍待完成，整体继续 No-Go。

## 2026-09-11：OR-7 固定 SHA 验收准备

- 三轮门禁固化：Windows 发布工作流不再只运行一轮主测试，改为在同一 checkout、同一 lockfile 上连续三轮执行格式、Node/Web TypeScript、零错误 lint、主工程与三个子项目测试、完整 audit 和生产 build；任一步失败即停止，三轮后才允许打包与启动 smoke。
- 验收载体：新增 `docs/AGENTS_ONE_RC1_RELEASE_CHECKLIST.md`，统一记录候选 SHA、Actions run、OR-701～706、G0～G8、Runtime/用户数据/桌面人工回放、安装升级回滚及维护者签字，不允许拼接其他提交的历史绿色结果。
- 首次本地预检：固定提交 `070fc59ffea8d3ce18cefd612dbd10e95521f7f8` 从无依赖、无配置的非硬链接独立克隆完成 clean install，三轮均为主工程 213/213 文件、2,071 passed/9 skipped、子项目 38/38、audit 0、build 通过；NSIS/portable 生成，解包应用以隔离 `userData` 启动通过，两个 exe 均为 `NotSigned`。
- 预检拦截：产物复核发现旧校验生成逻辑会把未上传的 `builder-debug.yml` 写进 `SHA256SUMS.txt`。该 SHA 因此拒绝作为候选；工作流改为严格要求并只校验 NSIS、portable、blockmap 与 `latest.yml` 四个实际发布文件，缺一即失败。修正后的新固定 SHA 必须重新回放。
- 修正后复验：固定提交 `7fd0811688e365118dcedc0050875a96b766ef7a` 在第二个全新独立克隆再次完成 clean install 和连续三轮完整门禁；每轮均为主工程 213/213 文件、2,071 passed/9 skipped，子项目 38/38、audit 0、build 通过。随后同 SHA 生成 NSIS/portable，解包启动 smoke 通过，两个 exe 均为 `NotSigned`，四行校验清单不再包含 `builder-debug.yml`。本机宿主 Node 为 25.8.2，GitHub Node 22 lane 仍须远端验证。
- 发布输入与资产 smoke 再收紧：固定提交 `7bac448ddc3aa59164c022a6e9ad7a814c5568fb` 移除 workflow 的 `main` 默认值，并在 checkout 前只接受完整 40 位十六进制 commit SHA，checkout 后再次校验解析 SHA；branch、tag、短 SHA 与注入形态输入均被拒绝。启动 smoke 从仅检查 `win-unpacked` 扩展为同时真实启动 portable，按唯一 `userData` 参数精确终止关联进程并清理 SFX 解压目录，不触碰其他 Agents One 会话。
- 最终本地复验：`7bac448` 在第三个无依赖、无配置的独立克隆完成 clean install 和连续三轮完整门禁，每轮结果仍为主工程 213/213 文件、2,071 passed/9 skipped、子项目 38/38、audit 0、build 通过；同 SHA 的 unpacked 与 portable 双启动、严格四文件校验清单及 Authenticode 检查通过，smoke 进程和临时目录残留均为 0。该 SHA 取代 `7fd0811` 作为最新本地预检基线。
- Actions 供应链：提交 `2dcb45b` 将 CI/Release 使用的 checkout、Node setup、artifact 上传/下载和 GitHub Release action 全部从浮动主版本标签固定到 2026-09-11 解析出的完整 40 位提交，仓库扫描为 0 个未固定外部 action；新增每周 GitHub Actions Dependabot 更新入口。固定 action 本身只能在目标 GitHub runner 上完成最终验证，本地 YAML/格式检查不能替代该证据。
- 当前边界：本地克隆不能替代 OR-701 指定的目标 GitHub clone，也不能替代 Windows Actions、draft Release 或独立干净机人工验收。结论继续 No-Go，禁止提前创建 OR-706 RC tag。

## 2026-09-10：OR-6 开源文档与治理完成

- 公开事实：README 中英文入口互链并明确尚无公开 Release、首发 Windows x64、未签名/校验值/无自动更新边界，以及 Electron `userData`、Hermes Runtime、Connector、项目与备份的数据位置。
- 治理文件：新增 `CODE_OF_CONDUCT.md`、`CHANGELOG.md`、`KNOWN_ISSUES.md`、Bug/Feature Issue Forms、Issue 配置和 PR 模板；保留并复核 `SECURITY.md`，安全或行为问题使用私密入口，公开模板禁止凭据和私有数据。
- 贡献路径：英中贡献指南删除不存在的日文入口；远端回放后最低开发版本校准为 Node.js ≥24，并保留企业 Windows 无管理员权限下的官方 ZIP/用户级 PATH 方案；提交前命令覆盖 clean install、format、typecheck、0-error lint、主/子项目测试、audit 和 build。
- 状态一致性：稳定化计划降级为历史依据；回归矩阵增加 2026-09-10 当前基线，并把旧“发布冻结、格式未治理、不要打包”明确标为历史。Runbook 同步真实数据路径、未签名更新策略和远端验收边界。
- 已知问题：AO-KNOWN-001～007 记录远端发布阻断、未签名、非 Windows 平台、网页 Provider 实验、9 项 skip、Linux keyring 和体积/覆盖率债务，每项包含退出标准。
- 结论：OR-601～605 完成；本地可执行发布收口范围结束。OR-507 与 OR-7 仍需目标 GitHub 仓库、`release` Environment、Windows runner、草稿 Release、干净机安装/升级/卸载/回滚和真实 Runtime 人工回放，当前继续 No-Go。

## 2026-09-10：OR-5 Windows x64 Alpha 发布链路本地收口

- 首发决策：公开 Alpha 仅面向 Windows x64，版本为 `v0.1.0-alpha.1`；44 个 Hermes 上游时代 `v*` tag 不推送到 Agents One 新公共仓库。README 中英文入口已同步平台、未签名、校验值和无自动更新边界。
- 发布隔离：`release.yml` 删除普通 `release` 分支 push，改为固定 ref/SHA 的手动工作流；默认只生成 14 天候选 artifact，只有显式 `publish_draft=true` 且通过 `release` Environment 才申请写权限并创建草稿 Release。`rc1-windows.yml` 复用同一门禁。
- 门禁：新增全仓 `format:check`，以独立 `4ddb1db` 机械化提交建立 Prettier 基线；统一链路包含干净安装、lockfile/工作区不变校验、类型、零错误 lint、主测试、对话/配置路径测试、38 项子项目测试、完整 audit、build、Windows 打包、启动冒烟和 SHA-256。
- 更新安全：未签名、便携和开发构建在主进程 fail-closed；只有编译时明确启用的签名非便携构建可以加载 `electron-updater`。设置页显示未签名警告并禁用更新控件，缺失或损坏偏好默认关闭。
- 自动验证：全仓格式、Node/Web TypeScript、ESLint 0 error、完整 audit 0 vulnerability、生产 build 通过；主工程 213/213 文件、2,071 passed/9 skipped，子项目 38/38 passed。相关更新器/设置/preload/IPC 定向回归 226 项通过。
- 本机候选：NSIS 197,320,347 字节、portable 197,133,974 字节；解包应用真实启动 12 秒并写入隔离 `userData`，Authenticode 为 `NotSigned`。详细 SHA-256 与证据见 `docs/AGENTS_ONE_OR5_WINDOWS_ALPHA_RELEASE_AUDIT_20260910.md`。
- 未完成边界：目标 `pkulyn/agents-one` 仍不存在或当前账号不可见，因此未执行 GitHub Windows runner、Environment 审批、草稿 Release 及安装/升级/卸载/回滚验证。OR-500～506 已完成，OR-507 保持待验收；当前不得公开发布，本地转入 OR-6。

## 2026-09-10：OR-4 依赖、锁文件与构建质量完成

- 依赖清理：全库导入扫描确认 `ethers`、`@react-three/drei`、`@react-three/fiber`、`three`、`troika-three-text`、`react-file-icon` 与 `@types/three` 无代码消费者，已从 package/lock 删除；同时移除 30 行无消费者的旧文件图标 CSS。
- 漏洞收口：初始生产审计 2 high/4 moderate；删除无用链并更新安全版传递依赖后，`npm audit` 完整开发/生产树为 0 vulnerability。Vitest/Vite 在同一主版本内升级到 4.1.11/7.3.6，esbuild 落锁为 0.28.2。
- 可复现安装：使用最终 package/lock 在独立非硬链接临时克隆运行 `npm run install:clean`，932 个包安装、完整 audit、Node/Electron SQLite 3.53.4 双探针均通过，无系统 C++ 工具链；临时目录经边界校验后删除。
- 子项目入口：根级新增 `test:subprojects`/`test:all`，Linux CI 纳入 Plugin SDK 22、Connector 8、Connect Service 8，共 38 项测试；PRD 原“34 项”已按当前发现数校正。
- 体积基线：新增 `npm run size:report`。当前 main 1,366,779 bytes、preload 37,979 bytes、renderer 13,324,750 bytes；主要 Renderer JS 为 4,323,996 与 2,453,479 bytes，CSS 为 384,006 bytes，本阶段不做高风险拆包。
- 验证：统一入口下主工程 212/212 文件、2,067 passed、9 skipped、0 failed，子项目 38/38；typecheck、0-error lint、生产 build、完整 audit、最终 lockfile 干净安装、`lat check` 与 `git diff --check` 均通过。详见[OR-4 验收记录](./AGENTS_ONE_OR4_DEPENDENCY_BUILD_AUDIT_20260910.md)。下一步进入 OR-5 CI、打包与发布链路。

## 2026-09-10：OR-3 Web Agent 合规与默认边界完成

- 默认策略：内置豆包、ChatGPT、Grok Provider 在公开构建中默认不可用；登录窗口、健康探测、普通任务和计划任务均受同一主进程门禁约束。只有设置本地实验环境开关并由用户阅读风险后明确确认，才可执行网页自动化。
- 合规记录：逐项核对 OpenAI、xAI 与豆包现行官方条款，记录版本/日期、限制、允许依据、负责人和发布决定。项目未取得三家书面自动化许可，因此全部 Provider 继续保持公开禁用；该判断是工程风险控制建议，不替代法律意见。
- 风险与退出：设置页明确提示提示词、附件和网页账号的数据流及账号受限/封禁风险；一键停用会取消活动运行并销毁窗口，本机紧急开关可覆盖历史选择。当前不连接远端 kill-switch 或策略遥测，不采集 Cookie、Token、账号或提示词。
- 隔离验证：新增 Controller 级测试，覆盖 Provider/Profile 分区、权限拒绝、弹窗与导航白名单、越界下载阻断以及登录数据/缓存清除；既有 OAuth、会话 URL、回复与下载夹具继续通过。
- 验证：全量 Vitest 212/212 文件、2,067 passed、9 skipped、0 failed；Node/Web typecheck、全仓 lint（0 error）、生产 build、`lat check` 与 `git diff --check` 均通过。详见[OR-3 验收记录](./AGENTS_ONE_OR3_WEB_AGENT_COMPLIANCE_AUDIT_20260910.md)与[网页 Provider 合规记录](./AGENTS_ONE_WEB_PROVIDER_COMPLIANCE_20260910.md)。下一步进入 OR-4 依赖、锁文件与构建质量。

## 2026-09-10：OR-2 凭据、安全与隐私事实一致完成

- 桌面秘密：Remote Gateway 主 Token 与独立工作区 Gateway Token 接入 Electron `safeStorage`。历史 `.env` 值按“加密、回读验证、原子落盘、再删除明文”幂等迁移，并保留上一代密文用于损坏回滚；进程注入和命令型 secrets provider 仍由外部管理，不复制到桌面存储。
- 失败语义：Linux `basic_text` 不算安全后端，设置页明确警告并保留受限旧文件路径；已有密文遇到后端缺失、换用户或换机时标为不可读并要求重新授权，不误报为未配置。损坏密文、损坏 JSON、清理失败和上一代回滚均有假值测试。
- Connector：Windows 设备 Token、Ed25519 私钥和待配对秘密改用当前用户 DPAPI；旧明文凭据首次读取后自动迁移。秘密通过标准输入传给 PowerShell/.NET，不进入命令行或错误输出；非 Windows 继续保持目录 `0700`、文件 `0600`。
- 文档与响应：中英文 README 删除“所有 Secrets 都在受保护存储”的绝对承诺；新增 `SECURITY.md`，定义支持版本、私下报告入口、响应窗口和 Runtime/Gateway/Connector/WebView/更新/备份边界。目标 GitHub 创建后仍须实际启用 Private Vulnerability Reporting。
- 验证：完整 lint 0 error，Node/Web typecheck 与生产 build 通过，Connector 8/8 通过；全量 Vitest 210/210 文件、2,057 passed、9 skipped、0 failed。首轮发现并修复一个随机配对码测试可能生成“未改变末位”的既有非确定性，未降低断言。详见[OR-2 安全验收记录](./AGENTS_ONE_OR2_SECURITY_READINESS_AUDIT_20260910.md)。下一步进入 OR-3 Web Agent 合规与默认边界。

## 2026-09-10：OR-1 自动化门禁恢复完成

- 修复：preload API 测试切换到真实 `AgentsOneAPI`/`readDiagnostics` 契约；IPC 双向一致性扫描纳入托盘实际注册模块；两组配置审计测试显式隔离 Agents One 日志目录；托盘测试清除 10 个 `any`，语音 WebSocket 清除裸 `require()`；一个全量高负载下的冷模块加载用例使用专属 15 秒超时，业务断言未放宽。
- 结果：固定提交 `0f10679447243f60513f5b4351f2cb86d4a06a1d` 上，原 82 项失败和 11 项 lint error 均归零。typecheck、209/209 测试文件（2,051 passed、9 skipped、0 failed）、`src tests plugins services` lint 0 error、production build 连续三轮全部通过。
- 跳过项：6 项为 Windows 不执行的真实 POSIX `/bin/sh` command-provider 用例，归 OR-501 Linux CI lane；3 项为 `yaml-path.ts` 尚未实现的严格层级语义，归配置模块独立缺陷。Windows process-tree 实测在本机执行，不在 skip 内。完整证据见[OR-1 门禁恢复验收记录](./AGENTS_ONE_OR1_GATE_RECOVERY_AUDIT_20260910.md)。
- 边界：OR-1 不修改用户配置、会话、Runtime、计划任务或凭据数据。下一步按 PRD 进入 OR-2 凭据、安全与隐私事实一致。

## 2026-09-10：OR-006 目录独立化完成

- 迁移结果：从带注释恢复标签 `agents-one-pre-migration-20260910` 对应的固定提交 `564ef2ad30a9491bf8270418df0fe0b0a87a042b`，以非本地硬链接方式干净克隆到 `D:\Projects\Agents-One`；没有复制旧 `.git`、依赖、构建目录、缓存、沙箱、日志、`.env` 或用户数据。后续开发以新目录为唯一工作区，旧 `D:\Agent Console\Agents-One` 只读保留用于恢复。
- 可移植性修正：清除活跃脚本/测试中的个人路径依赖；引入 `npm run install:clean` 和宿主 Node/Electron SQLite 双探针；`better-sqlite3` 固定为 13.0.3；CI 与发布工作流使用同一干净安装入口；electron-builder 复用已验证的本地 Electron distribution，标准 `npm run build:unpack` 在新目录通过。
- 验证：`install:clean`、typecheck、生产构建和标准未安装版打包通过；路径相关定向测试 187/187 通过。全量测试仍为 205/209 文件、1,969 通过/82 失败/9 跳过，lint 仍为 11 errors，生产 audit 仍为 6 项（2 high/4 moderate），均与 PRD 已登记基线一致，无迁移新增回归。
- 产物与安全：打包后 Electron 43.4.1/ABI 148 成功加载 SQLite 3.53.4；ASAR 16,913 条目，禁入目录和个人路径均为 0；ASAR、unpacked 内容与工作 diff 的 Gitleaks 命中均为 0。NSIS、portable 和 blockmap 的哈希、远端、回退与全部证据见[OR-006 目录独立化验收记录](./AGENTS_ONE_DIRECTORY_MIGRATION_AUDIT_20260910.md)。全部 refs 复扫仍只有 2 个既有测试假值，无需改写历史。
- 遗留边界：目标 GitHub 仓库仍不存在或当前账号不可见，首次推送与保护规则属于公开发布前外部验收；本地产物未签名且不作为公开 Release。M0 的仓库内/目录独立化范围完成，下一步进入 OR-1 修复 82 项测试失败和 11 项 lint error。

## 2026-09-10：OR-005 迁移恢复基线标签建立

- 前置条件：OR-003/004/007～009 已完成；OR-007 安全提交后的全部 refs 复扫仍只有 2 项既有测试假值，原始报告 SHA-256 与首次扫描一致；工作树干净且 `lat check` 通过。
- 标签：本记录所在的固定提交使用带注释标签 `agents-one-pre-migration-20260910` 标记，标签说明明确其用途仅为 OR-006 目录迁移失败时的恢复基线，不是 RC、版本发布或公开 Release 授权。
- 使用边界：OR-006 必须从该标签解析出的 commit 干净克隆/检出到 `Agent Console` 之外；不得复制旧工作区的 `.git`、依赖、`dist`、缓存、`.sandbox`、临时文件、日志或凭据。旧目录在独立目录通过迁移验收前继续保留，不删除。
- 回退：若独立目录安装、测试、构建、打包或路径审计失败，停止在新目录继续开发并回到该标签；不要在新旧目录同时产生领先提交。

## 2026-09-10：OR-007 Git 全历史与本地产物安全审计完成

- 工具与范围：使用经官方 SHA-256 清单核验的 Gitleaks 8.30.0，扫描 `--all --full-history` 的 866 个提交，以及 `out`、`build`、`.agents-one`、`.cache`、`.sandbox`、`tmp`、OR-001 权威快照、两个依赖备份和历史/修正后打包产物。包含候选值的 JSON 原始报告只保存在 `<private-security-audit-root>`，仓库仅提交脱敏结论。
- Git 历史结论：发现 2 个 `generic-api-key` 命中，均为历史测试夹具中的显式假值，不是有效凭据；未发现需要撤销、轮换或从历史移除的真实秘密，因此不触发历史改写。
- 本地状态边界：`.sandbox` 有 28 个候选命中，包含测试工作树假值及机器本地环境、会话/缓存材料；中断依赖备份有 52 个命中，全部位于第三方依赖源码、README 或测试样例；其余受检目录为 0。两类目录均已忽略、原地保留且禁止迁移/发布，没有删除或公开任何本地数据。
- 打包风险与修复：历史 `dist/visual-fix-20260824` 的 3.8 GB `app.asar` 曾误纳入 `.sandbox`、`.cache`、`dist`、备份与环境/浏览器状态文件，已判定为禁止分发的本地污染产物。`electron-builder.yml` 现显式排除全部机器状态、缓存、恢复和日志目录，不再依赖 `.gitignore` 的间接行为。
- 修正验证：`npm run build` 通过；新生成的 Windows unpacked 包经 Gitleaks 扫描为 0 命中。其 `app.asar` 共 17,078 项，仅含 `out`、运行依赖与 `package.json`，禁入路径为 0；解包后再次扫描仍为 0。完整证据和报告校验值见[全历史安全审计](./AGENTS_ONE_GIT_HISTORY_SECURITY_AUDIT_20260910.md)。
- 处置与下一步：旧 `dist`、`.sandbox`、缓存和依赖备份继续作为本机私有/可重建材料隔离，OR-006 只能从固定 Git commit 干净克隆，禁止复制。OR-007 安全提交后须再扫描最终历史，随后按串行顺序建立 OR-005 带注释迁移恢复标签。

## 2026-09-10：OR-004 分支与远端模型校正完成（远端规则待仓库建立后应用）

- 拓扑核验：`main...agents-one-slim-task-dialog` 为 `0/44`，merge-base 是旧 main tip `8a4268f`，因此全部 Agents One 工作可无合并提交地快进到本地 `main`，不存在双边分叉或冲突。
- 远端核验：GitHub CLI 已登录维护者账号，但 `pkulyn/agents-one` 经 Git HTTPS 与 GitHub API 双重查询均不存在或当前账号不可见；在 OR-007 前未创建公开仓库、未推送代码，也未修改任何远端保护规则。
- 本地处置：RC1 Windows workflow 的默认 ref 从历史功能分支改为 `main`；本提交后将旧本地 `origin` 重命名为 `upstream` 并保留 Hermes 地址，新增目标 `origin=https://github.com/pkulyn/agents-one.git`，再把本地 `main` 快进到本提交。历史功能分支暂时保留为恢复引用，待目标仓库建立并验证 main 后再删除。
- 政策固化：新增[分支与远端政策](./AGENTS_ONE_BRANCH_AND_REMOTE_POLICY.md)，明确 `main` 为唯一默认产品分支、`origin/upstream` 职责、PR/线性历史/禁止 force-push 与删除、强制状态检查和固定 SHA 发布规则。目标仓库建立后必须实际应用并把查询证据补回日志；当前不伪称远端规则已启用。
- 完成边界：OR-004 的仓库内模型已完成：远端命名正确、产品工作已纯快进整合到 `main`、workflow 默认 ref 已切换、保护规则已明确。目标仓库创建、已审计 main 首次推送和 GitHub 规则实际启用属于外部落地验收，必须在公开 Release 前完成；现在可按强制顺序进入 OR-007，但不提前建立 OR-005 标签或执行 OR-006 迁移。
- 回退：远端命名可用 `git remote remove origin`、`git remote rename upstream origin` 恢复；本地 main 旧 tip 已由 OR-001 bundle 和 `upstream/main` 保全。不得用强制推送覆盖任何已存在远端分支。

## 2026-09-10：OR-003 语义提交与公开内容处置完成

- 提交边界：从 OR-001 固定基线 `333cf4d` 出发，使用逐文件精确暂存形成五个切片：`7227256` 仓库卫生与开发资产、`a4d6691` 构建/依赖/CI、`10b80f8` Plugin SDK/Connector/Connect Service、`714632b` 桌面产品源码与配套测试/脚本/lat.md，以及本日志所在的发布文档提交。全过程未使用 `git add .`、`git add -A`、目录通配暂存或历史改写。
- 公开内容处置：移除 13 份已在 OR-008 判定不公开的旧 Kanban/Profile/PR 临时稿、SSH/legacy Dashboard、安全审计、本机恢复记录、早期计划及 Hers 定向交接资料；原文仍由 OR-001 私有快照保全。`remote-access-lab` 与远程/SSH 实验脚本因仍被回归手册引用而保留，并将其中个人目录改为 `<repo>`。
- 路径脱敏与可移植性：进展日志、Windows 构建说明、Plugin SDK 文档、插件 README、启动脚本和测试中的固定开发机目录已改用 `<repo>`、`<portable-node>`、`%LOCALAPPDATA%`、`%USERPROFILE%` 或 PATH 探测；五份 OR-003 启动文档的本地 Markdown 链接复核为 0 缺失。
- 验证：三子项目测试 36/36 通过；Node/Web TypeScript 全部通过；Agent Runtime 设置定向测试 15/15 通过；`lat check` 通过；所有 staged diff 均通过 `git diff --cached --check`。全量 Vitest 为 205/209 文件通过、1969 项通过、82 项失败、9 项跳过，82 项与 PRD 既有基线完全对应：OR-101 preload 契约 79 项、OR-102 托盘 IPC 1 项、OR-103 配置审计隔离 2 项，按强制顺序留给 OR-1 修复。
- 回退：各切片均可按逆序执行 `git revert <commit>`；扩展与桌面提交依赖构建/依赖切片，若整体回退应从文档、桌面、扩展、构建、仓库卫生依次撤销。任何回退前仍须保留 OR-001 快照，不触碰用户 Runtime、项目、会话、计划任务或凭据数据。
- 交付：[OR-003 语义提交清单](./AGENTS_ONE_OR003_SEMANTIC_COMMIT_MANIFEST_20260909.md)记录提交 SHA、精确文件清单查询方式、验证证据和回退顺序。下一步严格进入 OR-004，仅校正远端与分支模型；不提前执行历史改写、迁移标签或目录迁移。

## 2026-09-09：OR-009 开发环境资产审计与当前树处置完成

- 执行范围：逐项审计 `AGENTS.md`、`CLAUDE.md`、`.agents/skills/`、`.claude/settings.json`、`.claude/skills/`、`.codex/hooks.json` 与 `skills-lock.json`；没有修改 Runtime、应用配置、用户 skills、构建产物或仓库外全局 Codex/Claude 环境。
- 保留：项目权威 `AGENTS.md`、Claude 入口、Agents One 直接需要的 Hermes Agent 与 `lat.md` 两类 skills、Claude 对应副本及受 CLI 支持的 `lat hook claude` 配置。两套 Hermes skill SHA-256 一致，两套 lat skill SHA-256 一致。
- 移除：无随附完整许可证且无产品消费者的 `electron-pro`、`typescript-expert` 及 Claude symlink；记录 4 个第三方来源但与当前树不一致的 `skills-lock.json`；内容误调用 `lat hook claude`、而 CLI 不支持 Codex agent 参数的 `.codex/hooks.json`。全部删除均可从 OR-001 快照按文件恢复。
- 防复入：`.gitignore` 新增 `/.codex/hooks.json`、`/.claude/settings.local.json`、`/skills-lock.json`，防止机器级 hook、Claude 本地覆盖和第三方 skill 安装锁重新混入公开工作树。
- 交付：[Agents One 开发环境资产审计](./AGENTS_ONE_DEVELOPMENT_ASSET_AUDIT_20260909.md)记录保留/移除理由、许可与 Windows symlink 可移植性边界、哈希证据和 OR-003 精确暂存清单。
- 下一步：OR-0 前置审计已完成，进入 OR-003；先按公开内容审计实施脱敏/删除，再将当前 264+ 个变更按文档、仓库卫生、功能、测试和构建拆成可回退语义提交，禁止 `git add .`。

## 2026-09-09：OR-008 公开范围内容审计完成

- 执行范围：审计当前工作树 76 个 tracked Markdown、20 个 untracked Markdown 及其他非依赖类公开候选文本；只形成公开处置决定与脱敏报告，没有在本轮删除历史资料、改写 Git 历史、暂存文件或上传扫描结果。
- 安全初扫：未发现高可信私钥 PEM、JWT、GitHub Token 或真实 OpenAI Key 形态；API key、Token、IPv4 与 `sk-` 命中主要来自字段名、占位符、测试假值和回环/私网示例。该结论不覆盖 Git 历史，不能替代 OR-007 专用扫描。
- 公开决定：README/贡献指南、当前发布 PRD/回归矩阵/运行手册、变更安全、Event Stream、Plugin SDK、Gateway v1、现行 Runtime/Web Agent/Connect 文档及 `lat.md` 保留；过期但无确定敏感信息的产品计划仅以历史状态保留；进展日志、构建笔记、插件 README、脚本和测试中的开发机路径必须先泛化。
- 私有归档/删除决定：旧 Kanban 报告、Profile handoff、临时 PR comment、SSH/VPS 与 legacy Dashboard 实验、过期内部安全审计、本机瘦身恢复记录、U0 内部视觉审计、早期 Agent Console 计划及 Hers/Hers-2 定向部署交接资料不进入公开工作树。OR-001 快照已保全原文，OR-003 再精确暂存删除。
- Git 历史边界：当前树删除不能清除历史 refs。若 OR-007 在这些历史文档中发现真实凭据、个人信息或未授权合作资料，必须停止并由维护者决定重写/重建公开历史；原始扫描报告不得提交，只允许脱敏摘要。
- 交付：[Agents One 公开范围内容审计](./AGENTS_ONE_PUBLIC_CONTENT_AUDIT_20260909.md)记录完整分类、逐项处置和 OR-003 交接清单；本 PRD 与本日志中的 OR-001 私有恢复位置已改为 `<private-recovery-root>`，精确路径只保留在仓库外私有 `RECOVERY.md`。
- 下一步：执行 OR-009，逐项决定 `.claude/`、`.codex/`、`.agents/` 与 `skills-lock.json` 的公开边界；随后 OR-003 按审计清单实施脱敏、删除和语义提交。

## 2026-09-09：OR-002 本地依赖副本与临时目录隔离完成

- 执行范围：按 PRD v1.2 仅处理 OR-002；修改 `.gitignore`、新增 `.prettierignore`、扩展 ESLint 全局 ignores，没有删除、移动或改写任何备份、依赖、QA 截图、Runtime 配置或用户数据。
- 隔离对象：`/.agents-one-node_modules-interrupted-*/`、`/node_modules.upstream-junction-backup-*/`、`/.belt/` 与 `/tmp/`。前两者是中断依赖副本和指向父级 upstream 的 junction 集合，后两者是本地工具状态和 QA 临时截图，不是源码事实来源。
- Git/文件验证：4/4 目标目录及代表文件继续存在；`git check-ignore -v` 均命中新规则。状态仍为 264 个 tracked 变更，但 untracked 从 83 组降为 80 组，展开文件从 68,367 降为 109；其中相对 OR-001 保全清单新增的 1 个文件是本轮 `.prettierignore`，没有源码丢失。
- 工具验证：Prettier `--file-info` 对 4 个代表路径均返回 `ignored: true`；全仓 ESLint 在约 64 秒内完成，隔离路径命中 0，只报告 PRD 已知的 11 个真实错误（`tray.test.ts` 10 个 `no-explicit-any`、`voice-stream.ts` 1 个 `no-require-imports`）；Vitest list 成功发现 209 个正式测试文件，隔离路径命中 0。Vitest 原本已有显式 `src/**/*.test.*` 与 `tests/**/*.test.ts` include，因此未新增多余配置。
- 已知边界：本轮目标是消除无关目录扫描，不负责修复 11 个真实 lint errors；它们仍由 OR-104 处理。`.prettierignore` 当前未跟踪，后续按 OR-003 归入仓库卫生/工具配置语义提交，禁止使用 `git add .`。
- 下一步：按 OR-0 强制顺序执行 OR-008 公开范围内容审计，再执行 OR-009；暂不进入 OR-003。

## 2026-09-09：OR-001 工作区清点、恢复快照与恢复演练完成

- 执行范围：按开源发布收口 PRD v1.2 仅执行 OR-001；没有修改忽略规则、暂存/提交文件、整合分支、修改远端、迁移项目目录或触发发布。
- 基线：仓库为自包含 `.git`，分支 `agents-one-slim-task-dialog`，HEAD `333cf4d29b6a9cbd5cf527c6b4eba9b7def889f1`；当前有 264 个 tracked 状态项（252 modified、12 deleted）、83 组 untracked，展开为 68,367 个未跟踪文件。`origin` 仍指向本地 `<legacy-upstream-repo>`。
- 快照：权威目录为 `<private-recovery-root>\OR-001-20260909-161432-333cf4d`。其中 `repository.bundle` 保存全部 61 个 refs 和完整提交历史，`tracked-working-tree.patch` 保存所有未提交 tracked 差异，`untracked-source.tar` 与逐文件 SHA-256 清单保存 114 个非依赖类未跟踪源码、测试、文档、工作流、图片和 QA 临时证据；另保存 status、refs、remotes、元数据与整包校验值。
- 排除边界：`.agents-one-node_modules-interrupted-20260820-172024/` 是约 613.47 MB 的中断依赖副本；`node_modules.upstream-junction-backup-20260821/` 由指向父级 upstream node_modules 的 junction 组成。两者均可由 lockfile 重建或仍依赖原目标，已在元数据中登记并原地保留，没有重复打包，也没有删除。其余 `.belt/`、`tmp/` 和所有非依赖类 untracked 文件均已保全。
- 恢复验证：`git bundle verify` 确认完整历史；隔离目录从 bundle 检出固定 HEAD 后，tracked 补丁 `git apply --check` 与实际应用成功；untracked 归档解包后 114/114 文件 SHA-256 一致；恢复态重新得到 264 个 tracked 状态项和 81 组已保全 untracked（比原状态少的两组正是明确排除的依赖副本）。临时验证 clone 已在确认路径边界后删除。
- 已知风险：快照在 OR-007 历史与敏感信息扫描完成前按私有恢复资料管理，不上传、不提交；两个排除依赖目录仍会拖慢全仓扫描，交由下一项 OR-002 通过忽略/工具排除规则隔离。首次参数绑定失败留下 `<private-recovery-root>\OR-001-20260909-161234-333cf4d` 非权威目录，已标记为不完整，不得用于恢复。
- 下一步：执行 OR-002，先为大型依赖副本、构建产物、缓存和临时目录制定逐项保留/忽略边界；不删除未知文件，不越级进入 OR-003。

## 2026-09-09：发布 PRD v1.2 修正执行依赖与启动文档保全

- 复核结论：v1.1 新增的历史扫描、内容审计与分支整合方向正确，但 OR-005“发布候选标签”与 M0 形成循环依赖，OR-006 前置条件未包含最终历史扫描；目录基线误称活跃文件已无绝对路径；现有 Release 同时构建三平台而 RC 验收只覆盖 Windows。
- 修正：OR-005 改为迁移恢复标签，最终 RC 标签移至 OR-706；OR-0 明确为 `001→002→008/009→003→004→007→005→006`，历史处置后必须重扫；按实际 tracked-file 命中修正绝对路径基线；新增 OR-500 首发平台决策，默认建议 Windows x64 Alpha，未验收平台不得公开发布。
- 启动文档保全：PRD、稳定化计划和发布回归矩阵当前未跟踪，进展日志与旧开源计划已有未提交修改。OR-001 必须先记录这组文档及校验值；OR-003 使用精确路径将 PRD、进展日志和相互依赖的历史/回归文档纳入 `docs(release)` 语义提交，禁止 `git add .` 或目录级批量暂存。若历史依据不公开，先受控归档并移除链接。
- 安全补充：Git 历史扫描只允许将脱敏摘要提交到仓库，包含疑似凭据或用户数据的原始报告必须私下受控保存。
- 变更边界：仅更新发布 PRD 与进展日志，不执行 Git 暂存/提交、分支整合、目录迁移、远端修改或发布操作。

## 2026-09-09：将项目目录独立化纳入开源发布 OR-0

- 决策：Agents One 从 `<legacy-workspace>\Agents-One` 迁出不延后到发布收口结束，而是在 OR-001～OR-003 完成后、OR-1 开始前实施；后续门禁修复与 RC 打包统一在独立新目录完成。
- 方案：PRD 新增 OR-006，默认建议目标为 `D:\Projects\Agents-One`。不直接搬运当前脏目录，而是从已收口的固定 commit 干净克隆；不复制 node_modules、构建产物、缓存、临时目录、日志或未知凭据，并将 Git 远端调整为目标 Agents One `origin` 与 Hermes `upstream`。
- 数据与回退：旧目录在新目录完成 G0～G8 和 RC 回放前保持只读恢复副本；配置中的旧工作目录只逐项核验，不批量重写。迁移失败时停止新目录开发并回到旧目录固定 commit，禁止新旧目录并行产生两套领先版本。
- 验收：G0、M0、停止条件、提交切片和 Definition of Done 已同步增加目录独立性要求；最终发布必须来自 `Agent Console` 外独立目录的干净 clone，且安装、测试、构建、打包不依赖旧父目录。
- 变更边界：本次仅更新 PRD 与进展日志，没有移动目录、修改 Git 远端、运行配置迁移或改变用户数据。

## 2026-09-09：开源发布收口阶段 PRD 定稿

- 目标：在主要功能齐备后，将下一阶段从零散优化收敛为可由后续智能体逐项执行、逐项验收的发布计划。
- 评估结论：当前功能成熟度约 80%–85%，开源准备度约 50%–55%，发布状态为 No-Go。TypeScript、生产构建、子项目测试与文档链接基线可用；全量测试仍有 82 项失败，源码/测试 ESLint 有 11 errors，生产依赖有 2 high/4 moderate 漏洞，Git 工作区与目标远端尚未收口，凭据说明、Web Agent 合规边界和发布工作流仍是 P0 阻断项。
- 交付：新增 [Agents One 开源发布收口阶段 PRD](./AGENTS_ONE_OPENSOURCE_RELEASE_READINESS_PRD_20260909.md)，按 OR-0 至 OR-7 定义 Git 基线、门禁恢复、凭据安全、Web 合规、依赖治理、CI/发布、开源材料和 RC1 回放，并提供 G0–G8 发布闸门、智能体执行协议、停止条件和 Definition of Done。
- 执行口径：本文档成为当前发布收口唯一执行入口；旧开源计划和 2026-08-20 稳定化计划保留为历史设计依据。建议从 OR-0 开始，不并行开展跨层重构，不在全部闸门通过前发布 Stable。
- 变更边界：本次仅新增/更新计划文档，不修改 Runtime、IPC、配置、用户数据、构建或发布行为。

## 2026-09-08：补齐定时任务表格与确认稿的信息呈现

- 反馈：首次表格版未完全复刻确认稿，缺少智能体头像、结果图标及最近执行时间，并且仍显示 Cron 表达式。
- 修复：任务表复用 Runtime 已配置的头像和颜色，缺省时显示稳定的首字母头像；最近结果显示语义状态图标、触发时间和执行耗时；调度计划只显示“每周一 10:00”“每天 00:53”等自然语言，复杂规则降级为“自定义计划”，不泄露 Cron 字符串。
- 变更边界：仅修改 Renderer 展示、现有组件测试和行为文档，不读取或写入 Runtime 外观配置，也不改变任务计划或执行记录的持久化结构。
- 验证：运行中的 Electron 开发版实测 3 条计划均有头像、结果图标与时间，页面中不存在 `Cron ·` 文案；表格显示计划依次为“每周一 11:00”“每周一 10:00”“每天 00:53”。

## 2026-09-08：定时任务管理页改为表格效率布局

- 需求：用户确认采用“表格效率”方案，解决原任务卡片过高、错误信息占用过多空间、列表扫描效率低的问题。
- 改动：Renderer 定时任务页改为四项统计摘要、任务搜索、状态筛选和七列结构化任务表；任务提示词和运行摘要均限制为单行省略，失败/超时使用语义色突出。编辑、暂停/恢复、立即执行、打开最近对话与删除均沿用原有 API 和交互，不改变调度数据。
- 变更边界：仅修改 `Schedules.tsx`、其 CSS 与 Renderer 行为说明；不触及 Runtime 注册、调度执行器、IPC、`task-schedules.json`、会话或项目持久化。
- 验证：`Schedules.test.tsx` 7/7、`task-schedules` 19/19 通过，Web TypeScript 检查与 `npx lat.md check` 通过；已通过正在运行的 Electron 开发版实测 3 条任务的表格渲染、搜索（3→1）、暂停筛选（3→1）及页面无窗口级横向溢出。

## 2026-09-07：托盘提示品牌图标修正与定时任务启动提示

- 现场问题：任务提示框头部错误引用 `src/renderer/src/assets/icon.png`，显示为旧 Hermes 黄色图标，与 Agents One 窗口标题栏使用的彩虹圆环不一致。
- Logo 修复：提示框头部改为复用 `agents-one-mark.svg`，即 Renderer favicon 与产品现行品牌共同使用的 Agents One 彩虹圆环；测试直接比对构建器实际导入后的资源值，覆盖 Vite 将小型 SVG 内联为 Data URL 的生产行为。智能体头像区域不变。
- 定时任务启动提示：终态 DTO 新增进程内 `scheduled_started` 展示状态，使用紫蓝色、播放图标和“定时任务已启动”文案，摘要显示计划名称已触发且正在执行；与橙色时钟“执行超时”保持明确区分。点击优先打开本次定时任务创建的 Runtime conversation，3 秒自动收起，悬停暂停。
- 事件链路：`TaskScheduleRunStartedEvent` 增加所选 Runtime 的 id、名称、kind 和头像展示元数据；Runner 改为在主窗口与托盘控制器建立后启动，确保应用启动时到期的计划任务也能弹出。任务后续结束仍由既有成功、失败、取消、超时提示报告最终状态。
- 变更边界：只调整现有品牌资源引用、进程内启动事件和托盘展示状态；不修改计划任务、Runtime、会话或项目持久化格式，不创建第二套通知窗口。
- 验证：Agents One Logo、定时任务启动状态、原四种终态、3 秒计时/悬停、点击行为、非聚焦窗口与启动事件 Runtime 元数据共 11 项定向测试通过；Node/Web TypeScript、定向 Prettier 检查及 Electron 生产构建通过。`lat search`、`lat expand` 与 `lat check` 均已尝试，但本次会话环境没有安装或暴露 `lat` 命令，无法完成工具校验。

## 2026-09-07：移除定时任务启动的重复提示

- 需求：用户已采用托盘任务提示，不希望定时任务启动时再出现 Windows/Electron 系统通知和 Agents One 主窗口右下角的绿色 Toast。
- 改动：主进程保留计划启动事件向 Renderer 的转发，确保对话与计划列表仍可刷新，但移除 `Notification` 调用；Renderer 保留会话变更广播，移除对应的启动 Toast。任务完成后的托盘提示和完成结果 Toast 均未改动。
- 变更边界：仅改进程内提示展示与行为文档；不改 Runtime、IPC 契约、定时计划存储、智能体配置、会话内容或托盘完成提示链路。两个删减点均可独立恢复。
- 验证与交付：定时任务与托盘定向测试 21/21 通过，Node/Web TypeScript、生产构建、Prettier（目标文件）与 `lat check` 通过，生产产物也确认不含被移除的启动提示文案或原生通知调用。重启前确认 3 条计划均无活动运行，随后已启动最新生产构建。

## 2026-09-07：修复托盘右键二次点击无法关闭

- 现场现象：左键快捷输入可正常二次点击关闭，但右键任务菜单在二次右键后仍保持显示。
- 根因：Windows/Electron 会在派发托盘 `right-click` 回调之前使任务菜单失焦；菜单原来的失焦处理立即隐藏窗口，使后续右键回调误判为“菜单未打开”并再次显示。
- 修复：任务菜单的失焦关闭改为当前事件循环结束后执行。二次右键会先命中仍可见的菜单并调用关闭，同时取消延后任务；普通失焦仍在事件结束后关闭菜单，Esc、点击菜单操作和左右键切换行为不变。
- 变更边界：仅修改托盘任务菜单的临时失焦定时器和主进程测试桩；不改 IPC、任务/项目数据、会话持久化、窗口尺寸或退出逻辑。
- 验证：`tray.test.ts` 2 项通过，新增覆盖“菜单先失焦、再收到右键托盘事件”的真实时序；Node/Web TypeScript、Electron 生产构建、Prettier、`git diff --check` 与 `npx lat.md check` 全部通过。

## 2026-09-07：托盘图标左、右键重复点击关闭

- 需求：托盘图标左键唤出快捷任务输入框、右键唤出任务菜单后，用户可再次点击同一鼠标键关闭对应卡片，保留 Esc、失焦和离开菜单区域的既有关闭路径。
- 修复：主进程为快捷输入框和任务菜单分别判定“已显示”及“等待首次渲染显示”两种打开状态。左键命中已打开的快捷输入框时隐藏它，右键命中已打开的任务菜单时隐藏它；若窗口尚在加载，再次点击会清除待显示标记，避免 `ready-to-show` 后意外弹出。切换不同鼠标键仍按原行为先关闭另一表面再打开当前表面。
- 变更边界：只调整 `tray.ts` 的临时窗口显示状态与托盘事件处理，并扩展对应主进程测试桩；不改 IPC、Runtime、任务/项目数据、会话持久化、窗口尺寸或退出逻辑。可单独回退事件开关，不涉及用户数据。
- 验证：`tray.test.ts` 2 项通过，覆盖左键与右键打开后再次点击关闭，并覆盖首次加载期间二次点击取消待显示；Node/Web TypeScript 检查、Electron 生产构建、Prettier 与目标文件 `git diff --check` 通过。`lat search`、`lat expand` 的全局命令未暴露，但项目级 `npx lat.md check` 全量链接与源码引用检查通过。

## 2026-09-07：Grok 网页智能体接入

- 需求与现场核对：按豆包、ChatGPT 的隔离网页 Runtime 方式接入 `https://grok.com/`。官方资料确认 Grok 网页、账号同步和文件上传能力；临时 Playwright 探测确认当前页面使用 `Ask Grok anything` 输入框、`chat-submit`、`assistant-message` 与 Stop 控件，具体登录入口跳转到 `accounts.x.ai`。匿名首页虽然展示输入框，提交后只进入注册墙，因此不能仅凭输入框判为健康。
- 功能实现：新增独立 `grok` Provider 与适配器，覆盖登录/验证码探测、根路径新会话、`/c/{id}` 恢复、聊天模式、附件回执、提示词发送、Markdown 回复、生成状态和取消；主控制器新增 Grok 分派与统一 Provider 文案，设置页新增 Grok 选项，智能体卡片和用户接管区显示 Grok 名称。
- 数据、安全与回退：Provider/Profile 继续使用独立持久化 Chromium Partition；导航仅放行 Grok 自有域名、`accounts.x.ai` 及明确身份提供方，会话映射只接受 Grok 自有 HTTPS 具体会话 URL。没有新增凭据字段、没有读取或复制浏览器外部 Cookie、没有迁移或覆盖豆包/ChatGPT 会话；删除 `grok` 枚举、适配器和 UI 选项即可独立回退。实机登录时确认 xAI 会拦截含 `agents-one/... Electron/...` 的默认 User-Agent；仅 Grok Partition 改用与内置 Chromium 真实版本一致的标准 Chrome User-Agent，豆包与 ChatGPT 保持原样。
- 验证：Grok DOM/登录/模式/提交/回复/取消夹具、Google OAuth 拒绝页提示、域名白名单、会话持久化、Runtime 配置及设置页，与豆包/ChatGPT 回归共 131/131 通过；登录兼容修复后相关子集 84/84 通过；Node/Web TypeScript、定向 ESLint/Prettier、生产构建与 `lat check` 通过。全量 2050 项中 2036 通过、9 跳过，5 个既有失败为 preload `readLogs`、托盘 IPC 静态扫描、审计日志环境隔离和主进程测试 mock，均不经过 Web Agent 代码。实际配置先备份再追加 `grok-web-test`，保留所有顶层键及原 7 个 Runtime；系统 Chrome 对照可正常进入 `accounts.x.ai/sign-in`，修复并重启生产构建后，Agents One 隔离窗口也成功进入同一登录页且不再出现 HTTP 403/“出了点问题”。Google OAuth 仍会被 Google 拒绝，适配器现会提示返回选择邮箱或 X 登录，不复制外部 Chrome Cookie 或凭据。PowerMem 写入及搜索复核成功（最高相关度 0.543）；用户完成账号登录后再验收真实回复与附件。

## 2026-09-07：定时任务扩展后旧主进程驻留导致网页计划仍被拒绝

- 现场现象：新版 Renderer 已显示网页智能体并可提交创建，但 IPC 返回旧文案 `Scheduled tasks require an enabled local CLI Runtime.`。当前源码和生产构建均已不存在该字符串，新构建包含本地 CLI、Web Agent、远程 Gateway v1 的统一门禁。
- 根因：Agents One 的 Electron 主进程自 2026-09-06 17:28 起持续驻留在托盘；Renderer 热更新不会替换已加载的主进程模块，因此界面与 IPC 执行器版本不一致。
- 处置与保护：确认本地计划存储没有活动运行后，只终止该仓库对应的旧 Electron 主进程，并从最新生产构建重新启动。用户现有 `desktop.json` 中豆包、ChatGPT 两个 Web Agent 均为 `local-web`、Runtime 与适配器双重启用，符合新门禁；未修改 Runtime 配置或计划数据。
- 验证：最新 `out/main` 包含新的三类 Runtime 错误边界，`out/renderer` 包含三类智能体选择提示；重启后的主进程 PID 与启动时间已更新。上一轮定时任务/i18n 聚焦测试 33/33、生产构建与 `lat check` 继续有效。

## 2026-09-06：定时任务覆盖本地、网页与远程智能体

- 需求与根因：定时任务执行页和主进程在新建、编辑、重新启用、手动触发、后台轮询五处都硬编码为“已启用的本地 CLI Runtime”，因此已经接入统一 Runtime 任务入口的 Web Agent 与远程 Gateway v1 无法被选择或执行，旧远程计划也会被保留但永久跳过。
- 功能实现：新增共享的定时任务 Runtime 分类与资格判定，统一接受已启用、配置无冲突且无需重新授权的本地 CLI、Web Agent 和远程 Gateway v1。管理页改为单一“智能体任务”面板，按三类分组选项并在卡片显示类别；全部计划均可见，目标暂不可用时禁止继续/立即执行但仍可暂停、改绑或删除。
- 执行约束：Web Agent 计划自动保存并派发为 `analysis`，不携带项目路径或 `workspaceId`，继续使用隔离浏览器登录态及既有用户接管流程。远程计划沿用 Gateway v1 的会话、超时、权限、取消和结果对账；本地 CLI 的项目 capability、并发策略和历史记录不变。
- 数据与回退：`task-schedules.json` 结构和版本不变，不批量迁移、不删除未知或旧记录；既有远程计划在对应 Gateway 满足资格后可直接恢复调度。共享资格判定、主进程门禁和 Renderer 展示可按层独立回退，无用户数据恢复步骤。
- 验证：定时任务主进程、Renderer 与 i18n 聚焦测试 33/33 通过，覆盖三类计划展示/选择、网页分析模式与无工作区、远程手动和旧记录到期派发、本地并发与会话回归；Node/Web TypeScript、Electron 生产构建与 `git diff --check` 均通过；定向 ESLint 无错误，仅保留 `Schedules.tsx` 既有的 `closeCreateModal` Hook 依赖警告。已新增 `lat.md/task-schedules.md`，并通过项目级 `npx lat.md check` 全量链接与源码引用检查。

## 2026-09-06：任务终态托盘提示扩展为成功、失败、取消、超时四态

- 需求：在既有 B+C 托盘提示结构上覆盖全部任务终态，并清晰区分成功、失败、取消和超时。统一保留 Agents One 框头与智能体头像，通过图标、明确文案和语义色共同表达状态，避免只依赖颜色。
- 视觉与文案：成功使用绿色勾与浅绿气泡，文案“完成了任务”；失败使用红色叉与浅红气泡，文案“执行失败”并显示一行错误原因；取消使用灰色停止方块与浅灰气泡，文案“任务已取消”；超时使用橙色时钟与浅橙气泡，文案“执行超时”并显示一行超时原因。失败、超时提示“点击查看详情”，其余提示“点击打开任务”；四态均在 3 秒后收起，悬停暂停。
- 终态链路：Runtime 原有 `succeeded`、`failed`、`cancelled`、`timed_out` 状态全部转发到同一个非聚焦托盘窗口，错误详情压缩到 120 字符。旧 Hermes 对话完成、错误和用户显式取消也进入同一链路；超时形态错误归类为超时，取消后的异步错误回调由单次终态保护去重。原生错误通知移除，避免同一失败出现两个通知界面。
- 变更边界：只扩展进程内展示 DTO、终态回调和 Renderer 语义样式；不增加持久化字段，不修改 Runtime、会话、任务或项目数据。点击仍优先直达已有任务，没有持久会话时打开 Agents One 主窗口。
- 验证：四态图标/文案/样式、错误原因、3 秒倒计时、悬停暂停、点击打开、非聚焦窗口和 Runtime 完成事件共 9 项定向测试通过；Node/Web TypeScript、定向 Prettier 检查及 Electron 生产构建通过。`lat search`、`lat expand` 与 `lat check` 均已尝试，但当前环境没有安装或暴露 `lat` 命令，无法完成工具校验。

## 2026-09-06：任务完成托盘提示（B+C 组合方案）

- 需求与设计：任务成功完成后，从 Agents One 通知区域图标上方弹出提示；采用用户确认的 B+C 组合，顶部显示 Agents One Logo、名称与“刚刚”，主体显示实际执行智能体头像、主动汇报文案和指向托盘的气泡尖角。整卡点击打开对应任务，无操作 3 秒后自动收起，悬停时暂停倒计时。
- 实现：Runtime 统一成功终态通过进程内监听发送有限展示元数据；普通 Hermes 对话完成也进入同一提示路径，并移除原有长任务成功系统通知以避免重复。主进程新增固定透明提示窗口，使用 `focusable: false` 与 `showInactive()` 避免抢焦点；按真实托盘坐标定位。存在 Runtime conversation 时点击直达任务，否则安全回退为打开 Agents One 主窗口。
- 变更边界：仅新增进程内完成事件、托盘提示窗口、sender-bound preload IPC 和独立 Renderer 提示组件；不增加持久化字段，不写 Runtime 配置、智能体外观、会话历史或项目数据。头像只读取现有 Runtime 外观，缺失时显示通用智能体图标。
- 风险与回退：本节记录首次交付时仅成功终态触发的范围；后续“四态”扩展见上方最新记录。窗口销毁与应用优雅退出同步清理。可独立移除完成监听与提示窗口恢复原行为，无数据迁移或用户数据回滚。
- 验证：提示组件、3 秒计时/悬停暂停、非聚焦窗口与点击直达、Runtime 成功事件共 5 项定向测试通过；Node/Web TypeScript 检查与 Electron 生产构建通过。`preload-api-surface` 的 153 项检查通过，唯一失败仍为工作区既有 `readLogs` 缺失基线，与本次新增 API 无关。`lat check` 已执行，但当前环境没有安装或暴露 `lat` 命令，无法完成工具校验。

## 2026-09-06：托盘录音提示条收窄并与快捷框无缝衔接

- 实机问题：录音提示条与快捷框之间存在明显空挡，提示条横向过长，边缘超过下方胶囊顶部圆角之间的直线范围。
- 修复：录音提示条改为相对快捷框左右各内收 36px，宽度由 540px 收至 468px，与下方 36px 圆角的顶部直线起止点对齐；底部通过 1px 叠合与快捷框无缝连接。语音错误提示保持原有独立间距，避免错误态被意外粘连。
- 变更边界：仅调整托盘录音态 CSS，不改变主输入框语音逻辑、录音服务、`Ctrl+M`、计时、窗口定位、菜单或数据。
- 验证：QuickComposer 与 ChatInput 语音定向测试 9 项通过，Node/Web 类型检查、定向 Prettier、`git diff --check` 及 Electron 生产构建通过；生产 CSS 实图复核测得提示条左右内缩均为 36px、提示条底部与快捷框顶部重叠 1px，确认无空挡且文字与计时完整显示。`lat search`、`lat expand` 与 `lat check` 均已尝试，但当前环境未安装或暴露 `lat` 命令。

## 2026-09-06：托盘快捷输入弹层裁切、语音复用与默认居中修复

- 实机问题：智能体和别针菜单虽使用向上定位 CSS，但打开时快捷 BrowserWindow 仍停留在 96px，弹层被任务栏边缘裁切成狭窄片段，看起来像向下展开；快捷框维护了第二套语音按钮，没有复用主输入框的录音状态、计时提示和 `Ctrl+M`；初始水平位置跟随右侧托盘图标，而非屏幕中央。
- 根因与修复：菜单状态主要改变 QuickComposer 的 `padding-top`，默认 content-box `ResizeObserver` 不保证报告该变化。现改为 border-box 观察并用 `MutationObserver` 覆盖 class/子树变化，菜单打开后明确请求约 402px/336px 高度；主进程保持窗口底边，使 330px 智能体菜单和 280px 别针菜单完整向上展开，并取消 padding 动画消除点击瞬间裁切。语音删除快捷框自维护实例，直接启用 `ChatInput` 的原生语音控件、录音波形、累计时间、错误处理和 `Ctrl+M`。
- 定位行为：首次唤出在托盘所在显示器的工作区水平居中、垂直位于任务栏上方。用户移动改由 Electron `will-move` 判定，程序自己的初始定位和弹层 resize 不再被误记为人工移动；人工拖动后仍保留进程内位置。
- 变更边界与回退：仅调整 QuickComposer 观察/语音组合、托盘显示坐标和对应 CSS/测试；继续复用既有语音服务配置、Runtime 派发、附件暂存、Workspace capability 与 sender-bound resize IPC，不修改 `desktop.json`、智能体注册、会话历史、项目数据或迁移。各修复均可独立回退且无需用户数据恢复。
- 验证：QuickComposer、ChatInput 及语音定向测试 17 项通过，新增断言验证智能体菜单打开后发送 402px 高度请求及 `Ctrl+M` 只触发主输入框语音实例；Node/Web 类型检查、ESLint、定向 Prettier、`git diff --check` 与 Electron 生产构建通过。生产 Renderer 复核闭合态及两类菜单，确认弹层均在胶囊上方完整显示、智能体菜单不再狭窄、别针选项可见，主输入框语音按钮位于别针右侧。`lat search`、`lat expand` 与 `lat check` 均已尝试，但当前环境未安装或暴露 `lat` 命令。

## 2026-09-06：托盘任务标题与项目名字体统一

- 现象：任务标题比右侧项目（文件夹）名显得更大、更重，同一任务行的文字基线和密度不统一。
- 根因：任务标题继承面板的 13px 正文，而项目名单独使用 12px；同时 Windows 字体栈以 Segoe UI 开头，中英文混排时容易分别回退到不同字库，进一步放大视觉差异。
- 修复：任务标题与项目名统一使用 `Microsoft YaHei UI` 优先的字体栈，并显式共享 12px 字号、400 字重、18px 行高和常规字形；项目名只通过次级文字色与右对齐表达层级。分组标题、“更多”和底部操作项同步使用同一字体系统，以 500 字重或色彩形成轻量层级，不再依靠字号跳变。
- 变更边界：仅调整托盘菜单样式，不改变任务数据、项目映射、分组顺序、点击行为、窗口尺寸或左侧“更多”浮层结构；可单独回退 CSS，无数据迁移。
- 验证：TrayMenu 组件 2 项测试通过，Node/Web TypeScript 检查及 Electron 生产构建通过；在真实构建产物中读取计算样式，任务标题和项目名的字库、字号、字重、行高分别完全一致为 `Microsoft YaHei UI` 优先、12px、400、18px。`lat search`、`lat expand` 与 `lat check` 均已尝试，但当前环境未安装/暴露 `lat` 命令。

## 2026-09-06：托盘左键快捷输入改为“智能体优先”轻量胶囊

- 需求：按方案 C 收窄托盘左键快捷输入，移除模型、思考等级和内置浏览器控件；显示默认智能体并支持当前任务切换。别针菜单同时提供上传文件和添加项目文件夹；窗口首次唤出位于 Windows 任务栏上方，并可由鼠标拖动后保留本次进程内的位置。
- 修复：快捷输入从 690×164 收敛到闭合态 560×96，取消内部蓝色长方形边框和双行工具栏，改为拖动柄、智能体头像、单行输入、别针、话筒与圆形发送按钮。智能体菜单读取现有 enabled Runtime 及用户头像/颜色；内置 Hermes 继续走原 `sendMessage`，其他 Runtime 走既有 `startAgentRuntimeTask`，不改 Runtime 配置。别针菜单复用 `ChatInput` 的附件暂存/校验，并经现有 Workspace capability 注册项目文件夹。
- 窗口行为：主进程只新增 sender-bound 的快捷窗口高度 resize 事件，限制在 96–420px，并在菜单/附件条展开时保持窗口底边稳定；无边框窗口改为透明背景和可移动，专用 drag region 负责拖动。首次按托盘图标定位在任务栏上侧，手动移动后不再被后续左键唤出重置。
- 变更边界与回退：修改 QuickComposer、ChatInput 的向后兼容插槽、托盘窗口展示参数、preload 窄 IPC 和对应样式/文档；不写 `desktop.json`，不修改 Runtime 注册、用户默认值、会话/历史格式、项目持久化或迁移。可分别回退 Renderer 布局与 `tray-composer-resize`，无需恢复用户数据。
- 验证：QuickComposer/ChatInput 定向测试 10 项通过；Node/Web TypeScript 检查与 Electron 生产构建通过。基于构建产物以 560px 视口渲染闭合态、智能体菜单和附件菜单，确认无溢出、无旧模型/思考/浏览器按钮、弹层向上展开且胶囊保持单行；PowerMem 已写入并通过语义检索复核。`lat search`、`lat expand` 与 `lat check` 均已尝试，但当前环境未安装/暴露 `lat` 命令，无法完成工具校验。

## 2026-09-06：托盘未关联项目留空与“更多”左侧悬停浮层

- 需求：没有关联项目的任务不显示“未关联项目”占位文案；鼠标移到“更多”时，剩余历史任务应在主菜单左侧展开，而不是向下拉长主菜单。
- 修复：项目展示名缺失时返回空字符串，任务行继续保留右侧网格列但不渲染文字；“更多”改为 hover/focus 触发的独立历史面板。紧凑版主菜单宽 344px、历史面板宽 384px，同一无边框窗口由 360px 扩至 744px；两面板间距为 0，仅保留边界线并共用一层外部阴影。正文从 14px 收到 13px，分组标题与项目名为 12px，行高和内边距同步收紧。右侧主菜单保持托盘锚点，历史面板按时间顺序展示其余已完成任务并支持纵向滚动；鼠标在两个面板之间移动时不会关闭。
- 变更边界：仅调整托盘展示值、现有窗口 resize IPC 的宽高参数、TrayMenu 组件与样式；不修改项目归属、会话/历史持久化、任务排序、Runtime、执行参数或左键快捷输入。
- 失败与回退：窗口宽度只接受预设的 360/744px，窗口高度继续限制在 310–720px；Esc、失焦和离开整个菜单区域仍可关闭。可单独回退展示与布局，不涉及数据迁移。
- 验证：托盘数据与组件定向测试 4 项通过，Node/Web TypeScript 检查及 Electron 生产构建通过。构建产物的 744px 悬停态渲染确认两个面板几何间距为 0、整体宽度与字体均已收紧，空项目列不出现“未关联项目”，两个面板项目名继续统一右对齐。`lat check` 已执行，但当前环境仍未安装/暴露 `lat` 命令。

## 2026-09-06：托盘项目名右栏不可见回归修复

- 现场现象：任务标题正常显示，但 `test`、`未关联项目` 等项目（文件夹）名在 Windows 托盘菜单中完全消失。
- 根因：原实现把项目名放入 Electron 原生菜单的 `accelerator` 栏，并关闭快捷键注册；Windows 只绘制合法快捷键文本，会直接丢弃普通中英文项目名，因此该栏不能承担任意项目名称展示。
- 修复：右键托盘菜单改为独立的轻量无边框窗口，任务行使用真正的两列网格；左列标题可省略，右侧项目列统一右对齐，运行中、近期和“更多”历史任务共用同一布局。Esc、失焦关闭、任务打开、新建任务、打开主窗口和退出程序行为保持不变。
- 变更边界：主进程仅增加托盘菜单窗口生命周期和 sender-bound 的只读数据/动作 IPC；Renderer 增加专用菜单界面。继续只读既有会话、运行状态和项目注册表，不修改 Runtime、会话/项目持久化、历史同步、任务参数或左键快捷输入。
- 失败与回退：菜单数据读取失败时保留空状态，窗口高度受 310–720px 限制，“更多”列表超出后内部滚动。可单独回退托盘菜单窗口与对应 IPC，不涉及用户数据迁移。
- 验证：任务分组与项目名单元测试、托盘菜单组件测试共 4 项通过；定向 ESLint、Node/Web TypeScript 检查、Electron 生产构建及目标文件 `git diff --check` 通过。基于构建产物的 460px 宽真实渲染确认 `未关联项目`、`test`、`Agents-One`、`Agent Console` 均稳定显示在统一右列，长标题只在左列截断。`lat check` 已按规范执行，但当前环境未安装/暴露 `lat` 命令，无法完成工具校验。

## 2026-09-06：托盘任务分组、项目名与新建任务入口优化

- 问题：托盘中的“正在运行的任务”和“近期任务”使用子菜单，用户无法在一级菜单直接扫描任务；“更多”仍是搜索入口；“新建任务”错误地打开了快捷输入框。
- 修复：文案调整为“运行中的任务”，运行中任务直接显示在标题下；近期任务直接显示最新完成的 3 条；“更多”按更新时间倒序显示其余已完成任务，且不重复近期 3 条。该阶段曾尝试用 Windows 原生菜单仅显示、不注册的快捷键栏承载项目名，后因实机不绘制普通项目名而由上方“两列无边框菜单窗口”修复替换。新建任务改为显示主窗口并复用既有 `menu-new-chat`，其下新增分割线；托盘左键快捷输入保持不变。
- 变更边界：托盘继续只读既有 Runtime 会话、普通会话缓存和项目注册表；普通对话运行期间仅在原有 `activeRuns` 内存记录中增加标题、项目展示名和开始时间，退出后即清除。不修改会话格式、项目持久化字段、Runtime 注册、任务执行参数或 Renderer IPC。
- 失败与回退：数据读取失败时显示对应空状态；无法从运行状态解析任务标题时保留数量兜底。回退只需恢复托盘菜单模板与 `activeRuns` 值类型，不涉及用户数据迁移或恢复。
- 验证：托盘分组/去重/项目名测试覆盖运行中优先、近期固定 3 条和更多排除逻辑。Electron API 虽接受普通文本作为未注册 accelerator，但后续实机复核证明 Windows 不会绘制该文本；最终验证结果以上方回归修复记录为准。

## 2026-09-05：公共底座 + OpenCode 第一阶段安全流程与纵向验收

- 配对流程收口：Connector-first 输入 10 位校验码后先调用无凭据的 `pair/preview`，展示设备名称、`sha256` 指纹摘要、Runtime 清单、Adapter/能力指纹和过期时间；用户二次确认后才 claim 并由 Main 保存 Runtime-scoped Token。预览响应不含 Gateway Token、Device Token 或私钥；旧的直接 claim IPC 保留兼容，但新设置页不再使用它。
- Hermes 识别收口：已有安装候选增加版本、可执行文件、配置和本地 API 状态；版本探测使用候选自身 CLI，API 仅做 loopback `/health` 只读检查，并将配置端口、`gateway.pid` 与监听进程归属交叉核验，无法确认时标记未知、发现无关进程时不绑定；不启动进程、不读取或展示凭据。采用成功后由用户选择立即重载或下次启动生效。
- OpenCode 灰度：增加独立 `AGENTS_ONE_REMOTE_OPENCODE_V1` 开关；测试/开发环境默认开放，打包环境默认关闭，发布时显式设为 `1` 才暴露远程 OpenCode Manifest 和执行入口，设为 `0` 可独立回滚；Pi、Codex、Claude Code 仍无远程位置声明。
- 纵向验证：Connect 服务测试 8/8（含 Desktop 预览/确认、Runtime Token 隔离、隧道限流和 Desktop → Connect → Connector → Host → OpenCode ACP 真实进程链路）；Installer Hermes 发现测试 22/22；Runtime Registry、Remote Gateway、OpenCode ACP、Runtime 管理页和 Runtime Chat 相关定向测试 163/163；Plugin SDK 22/22、Connector 6/6；Node/Web typecheck 通过，生产构建通过。完整主仓库回归此前为 202 个测试文件：198 个通过、4 个既有基线文件失败，测试断言为 2010 通过、9 跳过；4 个失败仍是 JSONL 审计格式、旧 `readLogs` API、旧 shutdown mock、旧 sibling Hermes 审计断言，未在本次无关修改中掩盖。
- Connect 命令面：补齐共享协议和服务端隧道白名单对 `/commands/catalog`、`/commands/execute` 的放行，并以 Connector WSS 契约测试验证；仍拒绝管理面、任意代理和路径穿越请求。统一 Gateway 终态错误码补充证书、Provider 登录、Runtime、Adapter、权限、Workspace Grant 和幂等冲突的分层恢复文案。
- 诊断与权限边界：Connect 设备状态现在保留脱敏 Connector 版本，Gateway probe 保存协议/Host 版本，能力快照重载后继续保留插件与事件流声明；设置页显示 Desktop、Gateway、Connector、Host/Adapter、Provider 和最近 Run 的分层信息。远程 Gateway 的“完全访问”只表示远端主机授权，本机项目 Workspace Grant 仍独立控制。
- OpenCode 远程探测：Remote CLI Host 的 OpenCode Adapter 已改为通过真实 ACP `initialize` 握手确认协议和运行时版本，不再仅以 `--version` 判定可用；同时对 Host 工作区做 realpath 边界校验，阻止符号链接越界。
- 远程会话与重启对账：Gateway v1 现在贯通并持久化 Provider 原生 `sessionId`，Desktop 后续回合可使用真实 ACP 会话恢复；Host 重启后的未完成 Run 在下一次查询时先进入显式对账，支持 Adapter 的 `reconcileRun` 恢复 Provider 终态/事件，不可恢复时返回带 `host_restart_reconciliation_required` 的确定性失败。
- 发布边界：当前纵向链路使用真实 OpenCode ACP 协议进程，但仍需在实际 OpenCode 支持版本、Provider 登录、Windows/Linux 普通用户、Connect/Host 重启恢复和发布包环境中完成人工验收后再打开生产灰度。
- TLS 部署边界：Connect 进程内 TLS 已明确区分服务端 full chain 与可选 mTLS client CA；`CONNECT_TLS_CERT_CHAIN_FILE`/`CONNECT_TLS_CLIENT_CA_FILE` 为新变量，`CONNECT_TLS_CERT_FILE`/`CONNECT_TLS_CA_FILE` 保留兼容，不因旧变量名称误把 client CA 当作服务端证书链。
- 公共底座安全补强：Remote CLI Host 增加 Adapter manifest 身份一致性、可选注册表白名单和信任回调；每个 Runtime 可设置独立并发上限。OpenCode 子进程只继承有限系统环境变量，Provider 环境变量必须显式加入 `allowedEnv`，工作区快照和 Artifact 大小均有上限。
- 重启与 Connect 隔离补强：Gateway `statePath` 现在把已发布 Artifact bytes 原子保存到旁车目录，Host 重启后仍可下载；Connect 对每设备/每 Runtime 的未完成请求、重复 requestId 和请求速率做 fail-closed 限制；Runtime-scoped Token 只能查看自身 Runtime、不能修改设备清单，移除授权时旧会话会被关闭。

## 2026-09-05：通知区域托盘与精简快捷任务输入

- 需求：主窗口右上角关闭按钮改为隐藏到 Windows 通知区域；托盘右键提供正在运行的任务、近期任务、更多、新建任务、打开 Agents One 和退出程序；托盘左键打开小巧的快捷任务输入框。
- 变更边界：主进程仅新增 `src/main/app/tray.ts` 与 `src/main/app/start.ts` 的窗口/托盘生命周期；preload 只增加关闭快捷弹窗和打开托盘任务的窄 IPC；Renderer 新增 `QuickComposer`，复用既有 `ChatInput`、附件暂存和项目 Workspace capability 选择。未改 Runtime 配置、会话格式、项目持久化字段或历史原始数据。
- 交互：快捷输入框保持截图中的输入、附件、项目、权限、模型、思考、网页搜索、语音和发送组件；发送仍走既有 `sendMessage`，可携带附件与 `contextWorkspaceId`。Esc 关闭快捷弹窗；托盘原生菜单由 Electron 负责 Esc 取消。
- 失败模式与回退：托盘初始化失败只记录诊断，不阻塞主窗口；历史/运行任务读取失败时显示空状态；关闭主窗口仅 `hide()`，显式“退出程序”才进入既有优雅 Runtime 关停流程。删除托盘模块及对应 preload 事件即可恢复原有窗口退出行为，不涉及用户数据回滚。
- 验证：`npm.cmd run typecheck` 通过；`npm.cmd run build` 通过；新增/相关文件定向 ESLint 无 error；相关 ChatInput/runtime 测试 15 项通过。生产 Renderer 的 `?tray=1` 视觉与交互冒烟通过：组件齐全、690×164 布局、发送任务和 Esc 关闭均正常。待在本机启动开发版后补充系统托盘实际鼠标路径验收。

## 2026-09-04：智能体接入类型文案与本地高级字段收敛

- 更新新增智能体三类运行域卡片的辅助文案：本地为“在当前电脑运行的智能体CLI或服务”，远程为“连接远端服务器或电脑上的智能体”，网页为“在隔离浏览器中连接网页端智能体服务”，让运行位置和接入对象更明确。
- 新建本地智能体的三步流程不再展示模型覆盖、旧版“默认 Agent”和“ACP 参数”字段；保留底层字段读取与既有配置兼容，避免影响已接入的本地 Runtime。
- 验证：AgentRuntimesPane 定向测试、Node/Web typecheck、构建和 `lat check` 通过。

## 2026-09-04：OpenCode 工具详情链路与旧构建误用修复

- 排查结论：OpenCode ACP 实际会发送 `tool_call`/`tool_call_update`，其中包含 `toolCallId`、`title`、`kind`、`rawInput`、`content` 和 `rawOutput`；最新源码适配器已能解析这些字段，但用户截图对应的历史运行仍只保存了无结构化字段的“工具调用已开始”。同时发现 OpenCode 回复流误调用通用输出事件函数，落入 Hermes 默认分支，导致会话中出现“ Hermes 正在生成回复”。旧工作区的 `<legacy-build>\Agent Console.exe` 时间戳为 2026-07-08，未包含本次 OpenCode ACP 修复；当前源码构建位于 `<repo>\out`。
- 修复：OpenCode 输出流在主进程中不再生成 Hermes 事件；主进程按 `callId` 合并重复 ACP 工具快照并补齐后续输入/输出；通用事件归一化器增加嵌套 `data`、`rawInput`、`rawOutput`、`toolCallId`、ACP 状态的兜底解析。新增主流程回归，验证 `read` 工具名、相对路径参数、输出、调用 ID 能持久化，且旧 Hermes 标记不再出现。
- 验证：OpenCode ACP、通用事件归一化、Runtime 主流程专项共 53 项通过；待完成最终 Node/Web typecheck、构建和打包产物检查。历史会话中已经保存的通用工具事件无法凭空恢复原始 ACP 参数，需要使用新构建重新执行任务。
- 操作边界：不修改 OpenCode 用户配置、不迁移或删除已有会话；启动测试必须使用 `<repo>` 的开发/构建产物，不能继续启动 2026-07-08 的旧便携包。

## 2026-09-03：OpenCode 工具事件详情与思考状态修复

- 排查结论：真实 OpenCode ACP 将工具拆成 `tool_call`/`tool_call_update` 多帧，工具名、`rawInput`、`content`、`rawOutput` 和 `toolCallId` 位于结构化字段中；旧适配器只把它们交给通用文本归一化器，未识别 ACP 专属字段，因此 UI 退化为“工具调用已开始”。同一工具的完成帧还可能把 `title` 替换成路径，不能直接使用最后一帧标题。另经真实 ACP 握手确认，当前 OpenCode 1.x 的 `session/new.configOptions` 只返回 `model`、`mode`，不返回思考等级/Reasoning Effort 配置；旧 UI 仅在 Runtime 命令目录含 `thinking` 时显示控件，导致 OpenCode 连状态提示也没有。
- 修复：OpenCode Adapter 先解析 ACP 工具事件，按 `toolCallId` 保留稳定工具名，补齐相对路径参数、输出内容和失败详情，并将工作区外绝对路径收敛为占位符；Renderer 按调用 ID 合并重复工具快照，持久化和实时显示均保留工具详情。工具事件新增 OpenCode ACP 回放测试，覆盖名称、参数、输出、调用 ID 和路径脱敏。工具栏为当前未声明可切换等级的 OpenCode 显示 `思考 自动` 只读状态和解释性提示；仍仅对 Runtime 实际返回的思考等级开放可选切换，避免伪造无效设置。
- 验证：`tests/opencode-acp.test.ts`、`runtimeChatMessageAdapter.test.ts`、`RuntimeChat.test.tsx` 共 3 个测试文件 83 项通过；Node/Web TypeScript 检查通过。真实 ACP 工具回放确认收到 `read` 的 pending/in_progress/completed 三帧，完成内容可还原为文件输出而非通用提示。
- 边界与回滚：本次不改 OpenCode 用户配置，不把 `big-pickle` 或任意模型强行映射为思考等级；若后续 ACP 返回 reasoning 配置，应由 Adapter Registry 能力探测后再接入真实 `session/set_config_option` 控制。移除 OpenCode 工具解析时，旧通用事件仍可显示生命周期摘要；移除只读状态分支时只影响提示，不影响对话和工具执行。

## 2026-09-03：OpenCode ACP 事件、模型身份与会话持久化修复

- 排查结论：真实 OpenCode ACP 将思考和答复都按 delta 发送；`session/new` 返回实际模型配置，`usage_update`/`session/prompt` 返回用量；当前适配器此前没有聚合思考、保留模型/用量，也没有约束客户端身份。另发现通用 JSON 脱敏把 `inputTokens/outputTokens/totalTokens` 误判成凭证，直接抹掉了用量元数据。实际本机 ACP 当前模型为 `opencode/big-pickle`；用户配置中的 `opencode/deepseek-v4-flash-free` 不在 ACP 可选模型列表，属于未生效请求。
- 修复：OpenCode 适配器将连续 `agent_thought_chunk` 合并为有界累积快照，仅 `agent_message_chunk` 拼接最终答复；从 `configOptions` 提取并规范化实际模型，从 `usage_update` 与 prompt 结果提取上下文/Token 用量，并实时写入 `AgentRuntimeRun`。加入 Agents One/OpenCode 身份约束，避免底层模型自称 Claude Code；Renderer 以已上报实际模型覆盖请求/配置模型。JSON 脱敏改为仅屏蔽凭证字段，保留 token 计数；会话存储安全忽略缺少 label 的不完整 Artifact，避免整条会话保存失败。此前已完成的 OpenCode kind 持久化兼容继续生效。
- 验证：真实 ACP 身份回放返回“我是 OpenCode……由 big-pickle 模型驱动”；OpenCode/本地进程/会话存储/RuntimeChat 相关 5 个测试文件共 89 项通过；Node/Web typecheck、定向 ESLint（无新增错误）和 Prettier 通过。待应用重启加载最新构建后，使用真实 UI 回放一次 OpenCode 问候与带项目任务。
- 回滚：移除 OpenCode prompt 身份约束不会影响协议；保留现有事件/模型/用量字段的向后兼容读取；旧会话和未知合法 Runtime kind 不删除。

## 2026-09-03：OpenCode 无项目对话与会话保存修复

- 问题：OpenCode 从智能体页直接发起普通问候时，自动权限模式按本地 Runtime 进入 `safe_write`，但没有当前会话项目工作区而被拒绝；同时 Runtime 会话存储仍保留旧的固定 `kind` 白名单，`opencode` 终态保存被丢弃并显示“本地会话记录保存失败”。
- 修复：OpenCode 纳入本地项目选择与附件入口；无项目且权限为“自动”时仅发送 `analysis`，明确保持只读对话；OpenCode 任务不再从 Runtime 默认工作区回退，只有当前对话显式选择或授权的工作区才可用于任务。会话存储改为受限格式校验，保留 OpenCode、OpenClaw 和未来合法 Runtime kind。
- 验证：Runtime conversation store、RuntimeChat、agent-runtimes、OpenCode ACP 定向测试共 113 项通过；继续保留 Adapter Registry、TypeScript、构建和静态检查验收记录。
- 回滚：保留既有会话文件字段和旧 Runtime kind；如停用 OpenCode Adapter，已保存的 OpenCode/未来 Runtime 会话仍可读取并显示，不会被静默删除。

## 2026-09-03：Adapter Registry 首批适配器落地（A3–A9）

- 问题：A0–A2 已建立 Registry，但仅有 Manifest 和兼容读取还不足以保证 OpenCode/OpenClaw 真正可运行；本地进程、结构化事件、取消、Artifact 证据和设置页字段仍需收口。
- 修复：新增通用 shell-free 本地进程启动器、stdout/stderr JSONL 分帧和脱敏事件归一化；设置页、PATH 检测和 preload IPC 消费 Registry Manifest；新增 OpenCode ACP over stdio 适配器，支持 initialize、session new/resume、prompt、增量消息、工具/权限事件、取消、safe-write 恢复和基于本地快照的相对路径/大小/SHA-256 diff Artifact；新增 OpenClaw Gateway v1 适配器，桌面端仅使用 Gateway 地址与受保护 Token，沿用已有 Run、事件、取消、Artifact、Workspace Grant 和 Connector 离线边界。
- 兼容与诊断：Runtime 新增受限的 `adapterOptions` 前向兼容配置；Registry 注册时校验 ID、版本、路由、字段唯一性和 Secret 类型；未知合法 kind 保留并以 `unsupported` 探测；OpenCode Windows `.cmd`、`.ps1` 和裸命令优先解析到真实 `.exe`/安全 Node 入口，禁止 `cmd /c`；进程取消对已退出子进程的 Windows `EINVAL` 做幂等兜底。
- 测试：Registry/Manifest、兼容读取、通用进程、OpenCode ACP（含取消与哈希 diff Artifact）、OpenClaw Gateway 和主 Runtime 生命周期专项共 56 项通过；设置页/Agents/ProfileSwitcher 3 个 Renderer 测试文件共 23 项通过；定向 ESLint、Prettier、Node/Web typecheck 和 `npm run build` 通过；真实本机 OpenCode ACP initialize 探测返回协议版本 1、版本 `1.18.23`。
- 未完成的外部验收：真实 OpenCode 对话、写入任务和长任务取消需要在用户实际授权/模型可用的环境回放；真实 OpenClaw 对话、Connector 重连、远程 Artifact SHA-256 下载需要部署中的 Gateway/Connector，当前已由 Gateway v1 mock/conformance 回归覆盖桌面侧协议和状态机。ZCode、Gemini CLI、Qwen Code、Kimi CLI 继续按 Manifest + Adapter + conformance 测试增量接入。
- 回滚：保留旧 `kind`、`agentTransport`、Gateway 配置、Token Secret key、会话和历史读取路径；删除新 Registry 元数据或停用对应 Adapter 时，未知/不可用 Runtime 显示为不支持，不会被静默删除。当前工作区原有未提交改动未被重置或覆盖。

## 2026-09-03：Adapter Registry 第一阶段（A0–A2）

- 问题：Runtime 类型、CLI 检测和设置页各自维护固定列表，无法安全增加 OpenCode/OpenClaw，也会使未知的未来适配器在读取配置时被静默丢弃。
- 影响范围：共享 Runtime 定义、主进程 Runtime 规范化与探测入口、CLI PATH 检测、Runtime Registry、preload IPC 类型和设置页标签；必须保留既有 Claude Code/Codex/Pi/Hermes 的 Runtime ID、凭据、会话、项目及运行记录。
- 修复：新增 `src/shared/runtime-adapters.ts` Manifest 契约和 `src/main/runtime-adapters/registry.ts` 唯一注册入口，注册 Hermes/Codex/Claude Code/Pi/OpenCode/OpenClaw/Web Agent；Runtime 增加可选 adapter 元数据，旧记录按 kind 自动补齐；未注册的合法未来 kind 保留并以 unsupported 探测，不进入执行链；CLI 检测改为消费同一 Manifest；新增 `list-agent-runtime-adapters` IPC 供后续表单动态渲染。
- 失败模式与回滚：显式错误 adapterId 与 kind 不匹配会拒绝保存；未知 adapter 不会被当作可执行 Runtime；OpenCode/OpenClaw 的真正执行适配仍未在本阶段打开，避免误把“已注册”当成“已验证可运行”。若需要回滚，可保留旧字段读取并移除 Registry 元数据调用，现有旧分支仍完整存在。
- 验证：Registry/Manifest 定向测试、CLI 检测测试、Node/Web TypeScript 检查；继续执行 A3–A9 前需补齐 OpenCode ACP、OpenClaw Gateway、Manifest 驱动表单、能力快照写入和完整回归。

## 2026-09-02：智能体管理页三类运行域重构

- 问题：智能体管理页原先只按本地/远程分组，网页智能体因持久化位置为 local 被混入本地列表，三类接入方式的边界不够清晰。
- 修复：Renderer 端将 `web-agent` 优先归入独立“网页智能体”，其余 Runtime 继续按 location 归入“本地智能体”或“远程智能体”；改为三列运行域卡片布局，保留健康探测、连接摘要、管理/对话动作，并为远程不可达状态增加诊断提示。健康探测为“不可达”时，卡片底部改显示红色“连接异常”，同时置灰“对话”按钮并提供悬停说明，避免用户点击后才发现连接失败。进一步统一网页智能体的 `degraded`、`unsupported`、`unknown` 状态：底部显示“连接受限”“暂不支持”“检测异常”，非正常状态均置灰“对话”，保留“管理”用于登录、验证和修复配置；探测接口异常不再静默丢弃。所有智能体头像框统一为网页智能体采用的 34×34px 方形圆角样式。删除“运行环境视图”及对应说明文案。
- 变更边界：仅修改 `src/renderer/src/screens/Agents/Agents.tsx`、该页样式、Renderer 测试、UI 验收脚本选择器与 `lat.md/sidebar-navigation.md`；未修改 Runtime 注册、配置写入、IPC、项目、会话或历史数据。
- 验证：`npx.cmd vitest run src/renderer/src/screens/Agents/Agents.test.tsx`（9/9）、`npm.cmd run typecheck`、`npm.cmd run build` 通过；新增回归确认网页 Runtime 不会出现在本地智能体分区，远程 Runtime 不可达及网页 Runtime 处于受限、不支持、检测异常时均会明确显示状态并禁用对话。

## 2026-08-28：对话空状态彩虹标志透明化

- 问题：对话空状态的 Agents One 标志在 SVG 中烘焙了白色圆角底板与浅灰底环，切换到深色主题时会显示为突兀的浅色方块。
- 修复：仅移除 `agents-one-welcome.svg` 的底板和底环；保留 Dawn 渐变彩虹圆环与轻微投影，SVG 画布其余区域保持透明。
- 变更边界：仅限 Renderer 图标资源；未修改主题设置、对话逻辑、Runtime、IPC、用户数据或会话历史。
- 验证：已检查 SVG 结构仅含透明画布上的渐变圆环；空状态组件测试（1/1）、`npm.cmd run typecheck` 和 `git diff --check` 通过。`lat check` 仍仅报告既有的 `sidebar-navigation.md:37` 样式文件链接错误，本次新增链接未报错。

## 2026-08-28：外观主题卡片排序调整

- 问题：GitHub 浅色与 Solarized 浅色主题位于第三行，浅色主题选择不够集中。
- 修复：仅调整 Renderer 中 `THEMES` 注册表的展示顺序，将两个主题置于深色、浅色之后；四列主题网格的第一行现在依次展示深色、浅色、GitHub 浅色、Solarized 浅色。
- 变更边界：未修改主题 ID、配色变量、用户已保存的主题设置、Runtime、IPC、会话或历史数据。
- 验证：`npm.cmd run typecheck` 通过；`git diff --check` 通过。

## 2026-08-21：Remote Gateway v1 部署 Profile 补充

- 更新 [AGENTS_ONE_REMOTE_GATEWAY_V1.md](./AGENTS_ONE_REMOTE_GATEWAY_V1.md)，明确三种远程接入方式：普通用户默认使用托管 Relay、组织/高级用户使用自托管 Relay、具备受信任 IP 证书的专家用户可公网 IP 直连。
- 明确远端 Hers 主机不必拥有域名或公网 IP；无公网 IP 的服务器/个人电脑通过出站 Connector 主动连接 Relay，Agents One 只连接 Relay 的可信 HTTPS 地址。
- 明确公网 IP 直连不是协议禁止项，但必须使用受信任 CA、IP SAN 和完整证书链；禁止自签名证书、`-k`、`rejectUnauthorized=false` 和公网 HTTP。新增私网联调与客户端向导选择规则。
- 文档校验：本地链接检查 262/262 通过。

## 2026-08-21：Hers SNI 阻断与 sslip.io 过渡入口复核

- Hers 远端反馈确认：`pkulyn.cloud` 在境内云厂商侧因未完成 ICP 备案被按 TLS SNI 精准重置；境外和本机多端口路径表现一致，根因不是单纯的自签名证书。
- IP 证书路线不作为默认解：当前使用的公网 IP 无法直接依赖 Let’s Encrypt 获取 IP SAN 证书，且公网 IP 直连仍需受信任链和 SAN，故继续定位为高级 Profile。
- `hers.115.191.47.168.sslip.io` 已解析到目标 IP，可作为无自有域名的过渡域名；但现场严格校验发现 443 当前仍返回 `pkulyn.cloud/www.pkulyn.cloud` 证书，尚未完成 `sslip.io` SNI 虚拟主机和证书切换。仅修改 Agents One 地址还不够，Hers/Nginx/Caddy 必须为完整 `sslip.io` 主机名申请证书、配置 `server_name` 并完成自动续期。
- `AGENTS_ONE_REMOTE_GATEWAY_V1.md` 新增 SNI 阻断、动态 DNS 回退和多网络分阶段验收规则。客户端不因连接成功率而关闭 TLS 校验。

## 2026-08-21：Agents One Connector 一键插件接入方向

- 统一方向：大多数远程智能体用户不应自行暴露原生 API、申请域名或配置端口映射；目标是安装一个 Agents One Connector 插件，由它主动通过 WSS/mTLS 连接托管或自托管 Relay，Agents One 只连接 Relay 的可信 Gateway v1 地址。Hers 是首个适配器，不是 Connector 产品名称。
- 安全配对：Agents One 生成短时一次性配对码/二维码，Connector 本地生成设备密钥对；Relay 将设备身份、稳定 `runtimeId` 和桌面端受限 Gateway Token 绑定。Connector 凭据、Gateway Token 和 Workspace Grant 三者分离，均可撤销和轮换。
- 当前差距：仓库已有 `agents-one-plugin-sdk`（Gateway/Adapter 协议与事件归一化），但还不是完整的一键安装器；当时的定向安装说明仍是 Relay 主机手工安装路径，已在文档中标注这一边界，现已转入受控私有归档。
- 下一阶段候选工作包：Connector 安装器/升级器、一次性配对 IPC/API、Relay 设备注册与撤销、Loopback Hermes 适配、离线/重连状态和 Windows/Linux 用户级运行方式。完成前不应把“安装 SDK”宣传为“安装即连通”。

## 2026-08-21：采用托管 WebSocket 配对作为默认用户体验

- 产品决策：参考 OpenClaw/飞书连接模式，Agents One 默认不要求用户部署 Relay；由官方运营统一的 Agents One Connect 提供配对、固定可信 WSS 入口、设备注册、在线状态和 Gateway v1 消息路由。Relay 仍存在，但成为云端基础设施而非用户侧部署物。
- 目标体验：用户在 Hers 主机安装 Connector，Agents One 创建一次性二维码/短码，扫码确认后双方通过出站 WSS 建立连接；无公网 URL、无域名、无 ngrok、无端口映射，个人电脑位于防火墙内也可工作。
- 安全约束：二维码只承载短时配对信息；Connector 本地生成设备密钥；Gateway Token、Connector 凭据和 Workspace Grant 分离；Connect 不提供任意 TCP/Shell/文件代理；断线、撤销和幂等恢复必须有明确状态。
- 现实前提：如果不运营官方 Connect，就无法同时满足“安装插件即连通”和“用户无需部署 Relay”；自托管 Relay 与公网 IP 直连继续作为企业/高级 Profile。当前 `agents-one-plugin-sdk` 仍是 Adapter SDK，托管 Connect、Agents One Connector 和扫码配对尚未实现。
- P0 已实现：新增 `src/shared/agents-one-connect.ts` 与 4 项定向测试，覆盖一次性配对码摘要/过期/撤销、可信 Connect Endpoint、Gateway v1 隧道帧校验、路径白名单和事件序号；Node/Web TypeScript 与改动范围 ESLint 通过。该核心尚未接入生产 IPC、桌面配对 UI 或 Connect 服务。
- P1 首个切片已开始：新增 `plugins/agents-one-connector`（包名 `@agents-one/connector-cli`），实现用户级目录凭据存储边界、`pair/status/revoke/diagnose` CLI、Ed25519 设备密钥生成、一次性配对码兑换和设备撤销客户端。Connector 自身 2 项 Node 测试通过；当前仍是预览实现，Windows DPAPI/Linux Secret Service、WSS 心跳和 Connect 服务端尚待完成。
- P1/P2 第二个切片：Connector 新增 Connector 侧 WSS hello、心跳、Gateway v1 request 回调和 event 接收；新增 `services/agents-one-connect` 内存 Connect MVP，提供配对 session、code exchange、设备状态/撤销、Desktop/Connector 双端握手和按 Runtime 路由 request/response/event。Connector 3 项 Node 测试、Connect 服务端端到端测试通过。该服务尚未用于生产：账户认证、持久化、TLS 终止、限流、审计、多实例和自动重连仍未完成。

## 2026-08-21：开发版智能体管理修复与 Hers 连接诊断

- 本地 Hermes 展示修复：注册表不再仅凭 `%LOCALAPPDATA%\\hermes` 下的 `desktop.json` 等残留数据创建内置卡片，只有实际的 `HERMES_SCRIPT` 可执行文件存在时才列出 `hermes-local`。因此未安装 Hermes 的电脑不会再出现“本地 Hermes / 不支持”，也不会出现无法删除的伪条目；保留该 ID 的删除保护，避免误删真正的内置适配器。
- 卡片信息收敛：移除 Agents 卡片中的能力徽章及对应 CSS（对话、任务派发、streaming、cancellation、工具、memory、产物、工作区等不再作为卡片信息展示），保留接入方式、连接提示、健康状态和管理/对话操作。健康状态增加 probe message 悬停提示，便于区分网络、认证和服务协议问题。
- Hers 现场诊断：当前配置仍使用 IP Gateway 地址；直接读取远端证书得到 `subject=CN=115.191.47.168`、`issuer=CN=115.191.47.168`、无 Subject Alternative Name，属于自签名证书（有效期为 2026-05-10 至 2036-05-07）。使用系统证书校验时 Node/Windows 返回 `DEPTH_ZERO_SELF_SIGNED_CERT`，因此 Agents One 的严格 HTTPS 请求在 TLS 阶段就会显示“不可达”；使用忽略证书校验的只读探测才会到达 `/capabilities` 并得到认证响应，不能据此判定现有 Token 已失效。仓库没有保存旧证书指纹，无法证明远端证书是否刚刚更换；可以确认的是，旧版客户端曾对明确的自签证书错误做兼容重试，而当前稳定化版本已按 S3 计划删除该不安全降级。根因优先是远端 HTTPS 证书链/域名配置（应改用受信任 CA 证书及匹配的 DNS 域名），不重新开启不安全证书降级。探测错误现在会在状态标签悬停提示中明确显示证书问题。
- 自动验证：`npm.cmd run typecheck` 通过；受影响文件 ESLint 0 error；`agent-runtimes`、`agents-one-remote-gateway` 与 `Agents` 三个定向测试文件共 52 项通过。新增回归确认未安装本地 Hermes 不出现在注册表、已安装时仍能显示、卡片不再渲染能力徽章，以及自签名证书被明确分类提示。

## 2026-08-20：稳定化 S4 — Dashboard 主进程代理与会话工作区 capability 迁移（自动化完成）

- Dashboard 边界：新增主进程一次性 WebSocket RPC 代理。Renderer 为 capability-backed Chat 创建 Dashboard session 或更新 `cwd` 时只传 `workspaceId`；主进程使用已登记项目根解析、realpath 校验后再向本地 Dashboard 发送实际目录。普通 Chat 的旧直连路径仅保留给历史 folder binding。
- 会话持久化：`desktop_session_context_folders` 无破坏性增列 `workspace_id`、`folder_name`；新记录写入空 `folder_path + id + 展示名`，不会把本机绝对路径写进新会话绑定。恢复接口同时返回新形态或带 `legacyPath` 的只读历史形态。会话缓存 `sessions.json` 同步保存 `contextWorkspaceId + contextFolder(展示名)`，不会把 capability 展示名误用为可打开路径。
- 防串会话：空白 Chat 接收新的父级初始路径时会清空旧的工作区 ID，避免已挂载组件在下一条消息意外解析到上一个项目。
- 协作派发：RuntimeChat 的本地角色运行优先把当前 `workspaceId` 交给 Runtime；仅没有 capability 的历史协作记录保留 legacy path 回退。
- 已验证：干净验证副本 `npm run build`（含 Node/Web 类型检查和三端 Electron Vite 生产构建）通过；Chat/Dashboard 传输、会话缓存与 RuntimeChat 联合定向测试 3 文件 69 项通过（此前会话工作区专项 3 文件 19 项、cache 12 项和 RuntimeChat 45 项也均通过）。RuntimeChat 套件仍输出既存 React `act(...)` 警告，但全部测试成功。
- 后续门禁：项目选择、最近项目侧栏和项目菜单已改为 capability ID；`projectFolder` 仅为历史只读兼容字段。Electron 43 二进制已恢复，剩余运行/打包外部前置条件为 `better-sqlite3` 的 ABI 148 原生重建环境。

## 2026-08-21：RC1 环境恢复复核 — Electron 可执行，原生构建仍待受支持环境

- Electron：干净验证副本已使用官方 `electron-v43.4.1-win32-x64.zip` 恢复缓存；文件 SHA-256 `c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a` 与包内 `checksums.json` 一致，`node_modules/electron/path.txt` 指向 `electron.exe`，`electron --version` 输出 `v43.4.1`。网络下载问题已解除。
- 生产审计：恢复网络后复跑 `npm audit --omit=dev --json`，总漏洞数为 0。
- 原生依赖：`electron-builder install-app-deps --arch=x64` 已明确到 `better-sqlite3@12.8.0` 的 Electron ABI 148 重建。当前普通用户 Windows 环境没有 Visual Studio C++ Build Tools，`node-gyp` 无法构建；上游该版本发布页没有 `electron-v148-win32-x64` 资产。对 npm 可用的 `12.9.0`、`12.10.0`、`12.10.1`、`12.11.1` 与当前 `13.0.3` 的 GitHub Release 资产复核也没有该 ABI/平台包，因此没有可审计的普通升级绕过。隔离验证上游未发布到 npm 的 `v12.12.0` 源标签在两分钟内未完成，未写入项目 `package.json` 或 lockfile，不能作为发布依赖方案。
- 结论：Electron 下载不再阻塞；正常 `npm ci`、完整当前源码三轮测试、`build:win`、安装包启动冒烟仍需在具备受支持原生编译环境的干净 Windows checkout 执行。此前 `--ignore-scripts`、定向测试和构建结果继续有效，但不能替代这条 RC1 门禁。

## 2026-08-21：桌面开发版启动故障定位

- 桌面快捷方式指向 `scripts/launch-agents-one.ps1`，不是已安装的 NSIS/portable 版本。启动脚本在进入 `npm run dev` 前检查 `node_modules/electron/dist/electron.exe`；该文件不存在时统一弹出“dependencies are not ready”提示。
- 当前源仓库的 `node_modules/electron` 是指向 `<legacy-upstream-repo>\node_modules\electron` 的 junction，目标包版本为 Electron 39.8.5，且缺少 `dist/electron.exe` 和 `path.txt`；Agents One 当前 lockfile 要求 Electron 43.4.1。`better-sqlite3` 的 native binary 也未生成，但它是后续运行/打包门禁，当前弹窗在 Electron 检查处已提前返回。
- 结论：快捷方式本身有效，故障来自共享 junction 指向的上游依赖树被清理/部分安装或与当前 lockfile 不一致；不应在未确认 junction 目标前直接对源目录执行递归删除。恢复开发版应先将当前 `node_modules` 物理目录可逆改名，再用当前 lockfile 建立独立依赖树；无 C++ 构建工具时可先使用 `npm ci --ignore-scripts` 加官方 Electron 二进制启动验证，完整 `npm ci`/`build:win` 仍需受支持的 Windows 原生编译环境。
- RC1 执行策略：用户确认不在办公电脑安装 Visual Studio C++ Build Tools，正式 RC1 改由 Windows CI 完成。新增手动 workflow `.github/workflows/rc1-windows.yml`，在 `windows-latest` 上执行正常 `npm ci`、Electron/native binary 检查、typecheck、无缓存真实 error lint、生产审计、连续三轮全量 Vitest、生产构建和 `build:win`，并上传 NSIS/portable 验收包。目标 GitHub 远端接入后，先以当前稳定化分支运行该 workflow，再进行五条 Runtime、调度、备份恢复和安装包启动人工回放。
- CI 接入前的源码复核：独立依赖树恢复后首次真实 typecheck 暴露两处 S4 侧栏迁移遗留类型错误（项目菜单测试仍传旧 `path`、最近项目菜单回调的可选 workspace ID 未收窄）；已改为 opaque `workspaceId` 并补齐局部收窄。当前 `npm run typecheck`、`npx eslint --no-cache --quiet src tests` 通过，项目 capability 与侧栏菜单定向测试 2 文件/7 项通过。
- 开发版恢复验证：关闭旧 Electron 进程后，将原 `node_modules` 可逆改名为 `node_modules.upstream-junction-backup-20260821`，执行当前 lockfile 的 `npm ci --ignore-scripts` 并安装 Electron 43.4.1 官方二进制。桌面启动脚本随后成功启动 Agents One 窗口（Electron 主窗口句柄有效，Vite main/preload 构建成功）；日志显示 `better-sqlite3` ABI 不兼容，应用按设计回退到 Node 内置 SQLite。旧依赖备份未删除，当前开发窗口保持运行。

## 2026-08-20：稳定化 S4b — 协作 capability 与交付材料收口（自动化完成）

- 协作记录：`TaskCollaborationRecord` 和保存输入新增 `projectWorkspaceId + projectName`。IPC 对新 ID 重新查询主进程登记表并覆写名称；ID 不存在时会清除同次请求中的路径，不允许降级为 Renderer 提供的绝对路径。存储层保证一个记录若存在 capability ID，绝不与 `projectFolder` 并存；旧路径记录仍只读兼容。
- 侧栏与项目菜单：项目列表只读取不含路径的 `ProjectWorkspaceCapability`；分组键优先为 `workspaceId`，新建项目任务、移动原生会话、打开、重命名、置顶、归档和移除均调用仅接收 ID 的 IPC。主进程会重新解析登记表；会话 workspace setter 同样拒绝未登记 ID。旧路径会话仅作为只读分组展示，不再向菜单操作回传路径。
- 运行工作树：implementation 模式由主进程在创建 Runtime run 后生成稳定 `worktree-*` 标识并传给本地适配器；运行记录和 Renderer 可引用该 ID，但实际 worktree 路径、artifact 路径继续留在主进程。协作交付材料仍只记录相对路径。
- 自动验证：干净验证副本的项目 capability 回归 6/6 通过（新增不依赖路径的更新/移除断言）；源仓库 `git diff --check` 通过。源仓库常规 typecheck/lint 仍被既有不完整依赖链接阻断；显式隔离编译未出现本轮文件错误，剩余诊断均来自既有 `agent-runtimes`、installer、mcp、Renderer 资产和缺失依赖。RC1 必须在正常安装 Electron 二进制后的干净副本重跑完整门禁。
- 执行链路：Layout 的配置、自动启动、恢复和协作看板均传递 ID＋展示名。RuntimeChat 选择新项目后只在 Renderer 状态中保留名称；本地角色以 ID 派发，远程只读证据包改由 `prepareProjectWorkspaceContext(id)` 生成。历史记录才调用旧 path API。
- 交付材料：协作 artifact 的 `path` 现在只接受工作区相对路径，拒绝绝对盘符、UNC、根路径、冒号、NUL 与 `..` 穿越；运行时转换和主进程持久化均执行该过滤。交接继续保留相对路径、SHA-256、来源机器、变更摘要与 source run id。
- 验证：Node/Web TypeScript 通过；RuntimeChat、协作配置弹窗、协作工作台 3 个测试文件 50 项通过；改动范围 ESLint 0 error。协作存储文件的独立单测在干净副本中会触发缺失 Electron 二进制下载，未将该次超时计入通过，留待 Electron 环境恢复后复跑。

## 2026-08-20：S1 Runtime 生命周期第一轮收敛（进行中）

- 本地 CLI 终止契约：Codex、Claude Code、Pi 的 `cancel()` 已从仅发送终止信号改为可等待的 completion 契约。它先终止整个子进程树，再等待真实 `close` 处理完成；Runtime 记录在此之前保持 `running`，不会提前写入 `cancelled` 或 `timed_out`。等待超过 15 秒会留下明确失败诊断，不将未确认退出伪装成已取消。
- 状态竞争：Runtime 记录新增终止意图，CLI 的迟到 completion 在用户取消或超时后只能收敛到对应终态，不能因非零退出码覆盖为失败；新增定向回归覆盖“超时已发信号、子进程尚未 close”仍为运行中，以及 close 后才变为超时。
- 退出与恢复：正常 `before-quit` 改为一次性 quiescing 协调器，停止 Runtime 入场、停止并等待调度 tick、取消 Runtime 后再关闭媒体、Dashboard 和数据库。备份恢复同样关闭 Runtime 入场，并要求取消结果与活动数一致，否则不替换 Profile 数据。
- 生命周期兜底：内存运行记录只驱逐终态记录，满额时保留所有 `running` 记录；同步等待 API 遇到运行记录异常丢失时返回明确失败，避免永久轮询。
- S2 前置修复：五字段 cron 现在由同一数值语法同时校验和匹配，支持 `*`、数值、列表、范围、范围步长及星期日 `0/7`；超界值、倒置范围、零步长和无法解析表达式无法保存，避免“保存成功但永不触发”。调度写入队列、跨操作竞争和错过执行策略仍按稳定化计划继续处理。
- S2 串行化第一轮：相同 Profile 的手动触发与后台 tick 已进入同一异步 mutation queue；首个触发在等待 Runtime 启动期间，第二个触发不会拿旧磁盘快照重复派发。新增回归以被挂起的 Runtime 启动模拟双击，确认只启动一个 Runtime，后续触发严格落入现有 `skip/queue/replace` 策略。
- S2 串行化第二轮：创建、编辑、启停与删除也已转换为同一 Profile 的异步 mutation；IPC/Renderer 原本即通过 Promise 调用，因此不改变前端契约。所有调度持久化操作现在不会与长时间 Runtime 启动或完成对账交叉写回旧快照。
- S3 TLS 与取消第一轮：Agents One Gateway 和 Remote Workspace Gateway 已删除自签名证书自动降级，HTTPS 证书链失败会保持为明确连接错误。远端取消只有 Gateway 返回终态才算确认；取消请求失败或仍为运行中时，任务保持运行并附加脱敏诊断，供轮询/重试与恢复门禁使用。
- S3 artifact 终态隔离：远端运行到达终态后，artifact 逐个下载和本机物化；任一 artifact 暂不可用只保留原始元数据并写入运行诊断，不再把已经成功的 Gateway 运行改写为失败。其余成功下载的 artifact 仍正常发布给 Renderer。
- S4 safe-write symlink 防护：受保护的原文件若在运行中被替换为 symlink，不再因 `existsSync` 而被放过；恢复逻辑会删除该替换链接并还原原文件。若父目录已被置换为 symlink，则拒绝写回以避免穿越工作区根。专项回归确认外部链接目标保持不变。
- S4 媒体路径授权根：主进程现在仅允许读取/打开/保存 Agents One 临时媒体目录或用户已登记项目根下的真实路径，并解析 symlink 后再判定包含关系。未授权绝对路径不再能借由 Renderer IPC 读取；Gateway 临时 artifact 与本地验证交付保持兼容。
- S5 依赖修复第一组：`tar` 已从 7.5.13 升至 7.5.21，`yaml` 从 2.8.1 升至 2.8.3；升级版本和 SRI integrity 均由 npm registry 查询后写入 lockfile。该组对应审计中的 tar critical/high 链与 yaml moderate 漏洞；Electron、updater、Vite 及其传递依赖仍需单独分组回归。
- S5 依赖修复第二组：Electron 保持 39 主版本，从 lockfile 中的 39.8.5 更新到 39.8.10，覆盖该主版本最后一个补丁版本。它并不能满足发布门槛：最新审计仍将 Electron/extract-zip 链列为 high，官方修复要求跨到 Electron 43；是否接受该主版本升级须经过完整兼容回归和单独决策。
- S5 依赖修复第三组：`electron-updater` 升至 6.8.9，随其精确依赖将 `builder-util-runtime` 升至 9.7.0，修复 updater 的跨源重定向凭据泄露链。lockfile 审计继续下降到 10 项（0 critical、8 high）；组合回归受 60 秒外层执行上限中断，后续需在干净 `npm ci` 环境完成 updater/package 冒烟与完整回归。
- S4 恢复身份保护：prepared restore journal 对原本不存在的目标不再无条件删除当前文件。恢复中若该路径已出现，因无法证明其是中断写入而非后续用户/新进程文件，系统会保留数据与 journal、阻止自动恢复并给出明确诊断；这是以可用性换取不可丢失用户数据的保守边界。
- S5 release workflow 收口：release.yml 的 macOS `.app` 路径和 GitHub Release 名称从 Hermes One/Hermes Desktop 同步改为 Agents One，并删除无实际构建/发布动作的 landing-page 等待 job。CI lint 暂保持非阻断，直到干净范围真实 error 清零后再切换，避免用配置掩盖存量失败。
- S5 lint 输入收口：ESLint flat config 现永久忽略 `.sandbox/**`、`.agents-one/**`、`.cache/**`、release 与构建输出，避免本地隔离 worktree、测试产物和打包文件污染干净仓库 lint 结果。真实源代码 error 清零及 Prettier/CRLF 治理仍作为独立工作包执行。
- S5 依赖修复第四组：`@wesbos/code-icons` 从 1.2.4 降至 1.1.5（现有 `getIconForFile/getSVGStringFromFileType` API 不变），移除其错误作为运行时依赖携带的 Vite 4 构建链。npm 重新生成一致 lockfile 后生产审计先从 11 项降至 3 项；最新复核为 2 项 high、无 critical/moderate/low，剩余均由 Electron 39 的 Electron/`extract-zip` 链造成。非强制 audit fix 未在 30 秒内完成且未改变当时审计结果，未视为修复。
- 定向验证：先前 `agent-runtimes`、CLI runtime、IPC 和 schedule 相关回归 97/97 通过。本轮在临时依赖链接层中重跑 `agent-runtimes`、`task-schedules`、`agents-one-backup`、`media`、`workspace-protection`，58/58 通过；`agents-one-remote-gateway` 与 `remote-workspace-gateway` 再通过 34/34，合计本轮 92/92；Node/Web TypeScript 通过；`lat.md` 本地替代检查 262 links、0 broken。链接层用于从一次受限时间内中断的 `npm ci` 中恢复测试可执行性，不可作为当前 lockfile 的最终依赖验证。PowerShell 策略会拦截未签名的 `npm.ps1`，验证统一使用同一便携 Node 的 `npm.cmd/npx.cmd`，未修改系统策略。S1 仍需补齐 Electron 退出级行为回归和本地子进程实际 PID 验证后方可标记完成。
- S5 lint 基线复跑：一次完整 `npm run lint` 在外层 60 秒时限内尚未完成，已确认其后台子进程只属于本轮命令后终止；因此没有把该次中断当作 lint 结论。后续需用可持续执行环境跑完并按真实源文件逐项清零，不能以超时或 ignore 规则替代门禁。
- S1 退出级回归补齐：新增 `main-process-shutdown.test.ts`，以可控的 Electron `before-quit` 事件与 Runtime 取消 Promise 验证 quiescing 次序：首次退出阻止默认关闭、停止 Runtime 入场和调度；重复退出不重复取消；直到全部 Runtime 取消确认后才清理临时媒体/Dashboard/数据库并重新调用 `app.quit()`。该测试覆盖协调契约，不替代 Windows 真 PID/进程树人工回放。
- S2 错过与隔离语义：`nextRunAt` 成为 tick 的持久游标；应用睡眠/重启后，过期游标只产生一轮 `trigger: missed`、带原 `dueAt` 的合并补跑，再从当前时间计算下一轮，避免按错过分钟回放。单个计划在查询或启动 Runtime 时失败会输出脱敏诊断，后续计划继续执行；新增两项专项回归。`task-schedules` 与退出协调器共 15 项、Node/Web TypeScript 均通过。
- S3 取消与产物收口：Gateway 的 `cancelling` 不再只依赖 Renderer 偶然轮询；取消/超时均保存请求意图，以 1 秒间隔、最长 60 秒查询真实终态，只有终态才写入 `cancelled`/`timed_out`，超期无法确认写为明确失败。远端 artifact 首次下载失败保留成功 Run，产物标注 `unavailableReason`；新增主进程重试入口（至多三次）及 IPC/preload 声明，重试成功会替换为本地已校验文件。Gateway JSON 响应改为流式限额读取（4 MiB），防止异常响应占满内存。专项回归覆盖取消、超时、artifact 重试和超大响应；S1-S3 定向 58/58 通过。
- S4 IPC 授权面收口：除媒体读取/保存/右键菜单外，`open-file-in-editor`、`read-image-file` 也先经过主进程 realpath 授权；`open-terminal` 进一步限制为用户已登记项目根，临时 artifact 目录不能借此启动终端。新增回归确认登记项目内容可用、临时媒体不具备项目终端能力，媒体/IPC/Runtime 定向 96/96 通过。
- S5 lint 与 CI 门禁：以 `eslint --no-cache --quiet src tests` 分离真实错误与 CRLF/Prettier 告警，修复 9 项实际 error（控制字符正则的显式安全注释、过时未用 import、BOM 写法和不规则空白）；该命令现 0 error。`.github/workflows/ci.yml` 的 lint 移除 `continue-on-error`，改为阻断合并。此次未进行全仓行尾重写，遗留 Prettier/CRLF 告警继续作为独立格式工作包；定向 73/73、Node/Web TypeScript、`git diff --check` 和 lat.md 本地替代校验 262/262 均通过。
- S4 附件来源收口：Renderer 选取、拖放和粘贴的二进制/文档附件不再把原始绝对路径传给 Runtime；统一读取用户 `File` 的字节后调用主进程 `stage-attachment`，再由 Runtime 从真实且位于 `desktop-staging` 根下的文件复制到每任务输入目录。主进程拒绝未 staging 的 `path-ref`，staging 同时校验 base64 和 20 MiB 上限。专项 `runtime-inputs`、附件 Renderer 与 Runtime 回归 40/40 通过。
- S2 竞争压力回归：新增 100 次并发手动触发与 100 次 edit/delete 竞争测试；前者只派发一个 Runtime，后者由同一 mutation queue 串行化，首次 edit/delete 完成后其余陈旧 mutation 都 fail-closed，不会让已删除计划被复活或重写 store。此实现避免了先前“100 次创建再逐项持久化”的低密度压力循环，保留每种竞争操作 100 次的覆盖且不放宽 Vitest 超时。`task-schedules` 与 `gateway-restart` 定向 32/32 通过，Node/Web TypeScript 与 `git diff --check` 通过。
- S5 默认并发全量回归（第 1/3 轮）：首次以正确的 `ELECTRON_OVERRIDE_DIST_PATH` 运行得到 180 文件、1795 通过、1 失败、9 跳过，唯一失败为上述新增长循环测试触发的测试时限；修正后以同一命令复跑，180 个文件、1796 项通过、9 项跳过（111.71 秒）。运行期间的预期网络/SQLite 分支日志、React `act` 警告与 Node localstorage 警告未影响结论。还需连续两轮相同结果；由于当前依赖来自临时可恢复链接层，这也不能替代 RC1 干净 checkout 验证。
- S5 默认并发全量回归（完成）：随后未改动源码、同一进程内连续再跑两轮，分别为 180 个文件、1796 项通过、9 项跳过（137.50 秒）与 180 个文件、1796 项通过、9 项跳过（153.44 秒）。至此默认并发全量 Vitest 的“三轮相同计数”门槛满足；不过该结论仅适用于当前临时依赖链接层，RC1 的干净 checkout 仍需独立重验。
- S5 工程门禁复核：`eslint --no-cache --quiet src tests` 在清理前一次被 60 秒外层时限遗留的 lint 子进程后独立通过（0 error）；`npm.cmd run build` 随后通过，包含 Node/Web TypeScript 与 Electron Vite 生产构建；`git diff --check` 通过，lat.md 本地替代校验为 262 links、0 broken。完整默认 `npm run lint` 仍会输出既有 CRLF/Prettier warning，行尾治理继续保持为独立工作包，不把 warning 当作 error 已清零的替代说法。
- S3 Workspace Grant 生命周期补齐：创建远程受控工作区授权时，过期时间现在取当前 Runtime 超时、桌面任务一小时上限和 Relay `maxGrantSeconds` 三者的最小值；Relay 未声明上限时也不会变成永久授权。Grant 撤销失败不再静默吞掉，主进程会记录已脱敏的 warning，并在该运行中追加“授权撤销未确认”的诊断，既不伪造撤销成功也不把已完成任务翻转为失败。纯函数回归覆盖三种上限组合，`agent-runtimes` 与 `remote-workspace-gateway` 41/41 通过，Node/Web TypeScript 与 `git diff --check` 通过。
- S4 staging 配额与清理补齐：附件 staging 的说明已与实际产品一致（所有二进制/文档附件都经主进程 staging，不再保留原始绝对路径）。除原有 20 MiB 单文件限制外，新增 100 MiB 单会话和 1 GiB 总量的常规文件配额；超限安全拒绝，并提示先删除旧会话。会话删除仍是清理策略，符号链接不计入配额或授权。附件、Runtime 输入及会话删除定向 25/25 通过，Node/Web TypeScript 与 `git diff --check` 通过。
- S1 Windows 真实进程树回归：Codex、Claude Code、Pi 不再各自以 fire-and-forget 方式调用 `taskkill`；三者共用可等待的 `terminateProcessTree()`，Windows 使用 `taskkill /pid <pid> /T /F` 并以有界直接 kill 作竞态兜底，Runtime 继续只在真实 `close` 后写终态。新增真实集成用例启动 Node 父进程及其 Node 子进程，确认取消后两个 PID 都不存在；连同三个 CLI Runtime、Runtime 生命周期和 Electron 退出协调器共 59/59 通过，Node/Web TypeScript 与 `git diff --check` 通过。S1 自动化验收完成；真实 Hermes/Pi/Claude Code/Codex/Hers-2 五 Runtime 人工回放留在 RC1。
- S2 civil-time 语义补齐：cron 保持运行桌面的本地时间解释；前跳中不存在的分钟不补发，回拨中同一“年月日时分”只派发一次，手工回拨也遵循同一 fail-closed 规则；时区变化不回放旧时区分钟，而是以当前本地时间寻找下一游标。新增回归模拟已执行过的 local minute 再次成为 `nextRunAt`，确认不派发、直接推进下一分钟；`task-schedules` 16/16 与 Node TypeScript 通过。S2 自动化验收完成，睡眠/时区实际切换留在 RC1。
- S3 SSE 与产物交付收口：标准聊天 SSE 和 Runtime Run SSE 已共用同一帧解析器，覆盖 LF/CRLF、`data:`/`data: `、多行 data、残留帧与 `[DONE]`，避免不同消费者对合法事件流作出不同解释。远程产物不可用不再只有后台 IPC 重试：任务对话会显示对应诊断和“重新同步”入口；每次只调用单产物的最多三次下载重试，不重新执行任务，成功后把已验证的本地路径回写到同一运行记录与持久化对话。RuntimeChat、Gateway、Grant 与 SSE 定向 121/121 通过，Node/Web TypeScript 与 `git diff --check` 通过；S3 自动化验收完成，真实 Gateway/Grant/产物人工回放留在 RC1。
- S4 主进程工作区能力与历史路径收口：原生文件选择器和新建项目目录现在在主进程登记临时工作区能力；项目注册只能使用该能力或既有登记项目，Renderer 不能凭任意绝对路径新增授权。`read-directory`、`read-file`、预览、默认应用打开、终端、项目上下文准备和 Runtime `workspace` 都校验 realpath 后的受权根；Windows 普通用户可创建的 junction 指向根外时被拒绝。历史 `[Image attached at: ...]`/vision fallback 仅在路径仍属授权媒体根时才去除标记并读取，其他旧记录保留原文且不转 base64。脱敏扩展到带引号 JSON 键值、Authorization/Cookie 与 URL 查询参数。授权、会话历史、媒体、Runtime 与调度定向回归 60/60、44/44、34/34 分批通过，Node/Web TypeScript 与 `git diff --check` 通过；持久化 opaque id + 相对路径迁移仍留作 S4 余项。
- S5 Electron 安全升级与本轮回归：锁文件及声明已从 Electron 39.8.10 升至 43.4.1（其 engines 要求 Node ≥22.12；本机为 Node 25.8.2），`npm audit --omit=dev --json` 复核为 0 critical/high/moderate/low。`npm.cmd run build`（两端 TypeScript + Electron Vite）通过；`eslint --no-cache --quiet src tests` 为 0 error；`git diff --check` 通过，lat.md 替代链接校验 262/262。使用隐藏后台进程规避外层 60 秒管道时限后，全量 Vitest 得到 183 文件、1809 通过、9 跳过（120.73 秒）。该运行仍基于临时可恢复依赖链接层，并未执行 Electron 43 的真实二进制安装、NSIS/portable 打包或连续三轮新基线回归，因此 S5/RC1 继续保持进行中。
- S4 Runtime artifact 不透明化：`AgentRuntimeRun` 在越过 IPC 到 Renderer 前统一移除 `worktreePath` 与 artifact 的绝对 `path`；本地 Adapter 未提供 id 的 artifact 会在主进程按运行记录补充稳定 id。RuntimeChat 的图片改为 `agents-one-artifact://runtime/<runId>/<artifactId>/<name>` 受限引用，非图片附件保存 `runtimeArtifact { runId, artifactId }`；Renderer 只能调用专用打开、预览和另存 IPC，主进程先从仍保留的运行记录解析并重新检查授权根。计划手动触发的返回结果同样脱敏，避免旁路。定向 `agent-runtimes` 27/27、RuntimeChat adapter/附件/媒体 18/18 通过，Node/Web TypeScript 通过；绝对路径不再进入新持久 Runtime 对话。项目与 worktree 的 opaque id + 相对路径迁移仍是 S4 后续项。
- S5 干净验证环境诊断：原工作区 `node_modules/electron` 是指向同级 upstream 的 junction，实际为 39.8.5 且缺失 Electron `path.txt`，与当前 43.4.1 lockfile 不一致；直接 `npm install` 因 junction/目录锁得到 `ENOTDIR`/`EPERM`，未修改源码。已建立独立验证副本并排除原仓库 `node_modules`；首个前台 `npm ci` 被 64 秒调用时限中断，随后清理该副本内明确命名的半成品依赖并以隐藏后台进程重新安装。完成前不得把当前副本当作 RC1 通过证据。
- S5 干净副本门禁结果：独立副本改按 `npm ci --ignore-scripts` 成功安装 945 个包；常规 `npm ci` 会在 `electron-builder install-app-deps` 重编译 `better-sqlite3` 时因无 Visual Studio C++ 构建工具失败，符合企业无管理员/无系统编译链环境的已知约束。单独 Electron 43 下载脚本因网络 `fetch failed` 未生成 `path.txt`，故 Electron 启动、完整 Vitest、NSIS/portable 打包仍不能验收。在该副本已通过 Node/Web TypeScript、`eslint --no-cache --quiet src tests`、生产 `npm audit --omit=dev`（0 漏洞）以及不依赖 Electron 二进制的 S4 定向组 6 文件 54/54；此结果证明 lockfile 的静态依赖和本轮路径/artifact 变更可复现，不替代 RC1 Windows 门禁。
- S4 项目 workspace capability id（第一段）：项目登记记录新增稳定的 `project-<sha256>` id，历史记录读取时按规范化路径确定性补齐，避免读取即写入的批量迁移。主进程新增 `resolveAuthorizedWorkspaceId()`，它先按 id 查找登记项目、再 realpath/目录校验与授权根复核；`AgentRuntimeTaskInput.workspaceId`、Runtime 对话 `workspaceId`、TaskSchedule `workspaceId` 已贯通。新选择项目后的普通 Runtime 派发和计划创建/编辑优先发送 id，主进程才解析绝对路径；旧 `workspace` 字段继续只读兼容。干净副本的 Node/Web TypeScript 通过；项目 id/授权/对话存储聚焦组 3/3、Runtime/计划聚焦组 2/2 通过。此前完整 `task-schedules` 文件曾在受限依赖层出现 5 秒超时和双派发；本轮该文件连续 3 次隔离复跑均为 17/17 通过，故降级为“只在干净 Electron 环境全量三轮中继续观察”的 S5 风险，不再称为稳定复现。
- S4 Runtime 工作树 capability id（第二段）：新增只接收 `workspaceId + 相对路径` 的主进程目录、文本/图片预览、默认应用打开和终端 IPC；相对路径拒绝盘符、绝对路径、`..` 与 NUL，解析后仍以 realpath 限制在登记根内。RuntimeChat 工作树恢复时只使用该能力，且新持久化对话在已有 `workspaceId` 时不再写入 legacy `workspace` 路径。Web TypeScript 通过；项目 ID/授权/Runtime/会话存储聚焦组 5/5、计划任务 ID 存储聚焦用例 1/1 通过。该计划任务用例在 Vitest 隔离模块加载偶发超过默认 5 秒，已仅为该新增存储断言设为 15 秒；完整 `task-schedules` 文件随后连续 3 次隔离复跑均 17/17 通过，仍须在干净 Electron 环境的全量三轮中确认。
- S4 项目选择 API 预备层：主进程新增不含本地路径的 `ProjectWorkspaceCapability { id, name, pinned }`、项目列表和登记接口，以及按 `workspaceId` 准备项目上下文的入口；旧项目记录/API 暂留兼容。该层尚未切换普通聊天和协作 UI，避免未完成迁移时让路径重新成为能力；Node TypeScript 与项目登记测试 5/5 通过。
- S4 普通聊天迁移前置复核：本地 Dashboard 传输是 Renderer 直接发送 `session.create { cwd }` 的独立通道，不能从已有主进程 `workspaceId` 解析器获益；若直接清除聊天路径会导致 Dashboard 模式丢失工作目录。后续先实现主进程代理或 Gateway 的受控 id 解析，并以 Dashboard/legacy 两条传输的同一授权断言验收，再迁移会话存储与侧栏。此项是架构依赖，不以“兼容保留路径”冒充已完成的不透明迁移。
- S4 Dashboard workspace capability 代理：新增主进程一次性 Dashboard WebSocket RPC，仅由 `workspaceId` 解析出真实路径后调用 `session.create { cwd }` 或 `session.cwd.set`；Renderer 得到/传回的仅是 session ID，仍用原有长连接接收事件。Dashboard transport hook 已在提供 workspace ID 时切换到该代理，legacy path 模式保持兼容。Node/Web TypeScript 通过，Dashboard transport 定向 12/12 通过；普通聊天尚待接入 workspace ID 状态与会话存储，当前用户路径不变。
- S4 会话 workspace 存储预备层：`desktop_session_context_folders` 在首次新写入时增补 `workspace_id`、`folder_name` 列；新增读取/写入 opaque workspace 的 IPC/preload API。新记录只写 id 与展示名，旧 `folder_path` 仍可只读恢复；旧 setter 会显式清空 capability 列，避免混合记录恢复到错误项目。未执行读时迁移或批量改写历史数据库。Node TypeScript 通过；Chat 和侧栏尚未切换调用，现有用户路径不变。
- S5 生产构建修复：隔离副本首次 `npm run build` 在 Renderer 打包阶段失败，根因是 `@wesbos/code-icons` 的默认入口静态引入 Node 专用 `stringify.js`，使 Vite 将 `fs/path/url` 外置后无法导出 `fileURLToPath`。文件树改用浏览器安全的通用文件图标，不再把该包打入 Renderer；同一隔离副本复跑通过 Node/Web TypeScript、main/preload/renderer 三端 Electron Vite 构建。该构建不依赖 Electron 二进制，不能替代后续启动、`build:win` 或安装包验收。
- S5 无用依赖收口：确认仓库已无 `@wesbos/code-icons`/`vscode-icons-js` 源码引用后，以 npm 在隔离副本生成并同步 `package.json`、`package-lock.json` 的最小删除；重新执行 `npm run build` 通过，`npm audit --omit=dev --json` 的生产漏洞总数保持 0。默认 audit 仍会列出开发依赖风险，发布判定继续以生产依赖口径为准。
- S5 干净依赖树复验：更新 lockfile 后的 `npm ci --ignore-scripts` 在外层 64 秒调用限制内转入后台，但随后自然完成；在这份重新安装的依赖树上，生产审计仍为 0 漏洞，`npm run build` 再次通过。这消除了“复用旧 node_modules 才构建成功”的疑问；Electron 43 下载、原生依赖重编译和 Windows 安装包测试仍不在此验证范围。
- S5 静态门禁复验：同一重新安装的隔离依赖树执行 `eslint --no-cache --quiet src tests` 通过（0 error）。CRLF/Prettier warning 治理仍按既定独立工作包处理，不把 warning 静默或混同为 error 清零。
- S2/S4 Windows 原子存储增强：隔离依赖树并行运行核心 capability 回归时，项目登记曾在同目录临时文件 `rename` 上遇到一次瞬时 `EPERM`（其余 58 项均通过）。`safeWriteFile` 现仅对 Windows `EPERM`、`EBUSY`、`ENOTEMPTY` 采用 15/35/75ms 的有界重试，其他错误立即失败并保留临时文件清理语义；不会删除或先移动旧目标。改后项目登记单测 5/5、核心项目/授权/Runtime/会话/计划联合组 59/59 通过。`safe-write-file` 在缺失 Electron 二进制的隔离测试环境与其他文件同批会挂起，未作为本轮通过证据；需在 Electron 43 真实运行环境补其完整回归。

## 2026-08-20：全面评测复核与发布前稳定化计划

- 决策：暂停 `AGENTS_ONE_OPENSOURCE_PLAN.md` 的 Phase 4 直接发布，先执行 [Agents One 稳定化与发布前详细开发计划](./AGENTS_ONE_STABILIZATION_PLAN_20260820.md) 的 S0-S5，再进入 RC1。既定产品方向不变：任务对话优先、项目是对话/任务容器、本地 CLI 保留原生能力、定时任务创建普通 Runtime 对话、远程统一 Gateway v1；不恢复 SSH、旧远程 Hermes、OpenClaw 私有传输或 Task Center 执行器。
- 源码复核：评测报告中的主要发布阻断得到确认，包括正常退出未取消并等待 Runtime 子进程、取消/超时先标终态、计划存储并发读改写与 cron 校验/匹配不一致、Gateway 取消确认和 artifact hydration 混淆终态、HTTPS 自签证书静默降级、文件/附件路径缺少授权根、safe-write symlink 与中断恢复文件身份风险。修复前仍要求按触发路径补红色回归测试，不能只依赖静态推断。
- 基线重跑：Node/Web TypeScript 和 Electron Vite production build 通过；lat.md 本地替代校验 253 个链接、0 失效。全量 Vitest 为 179 个文件，1782 项通过、1 项失败、9 项跳过；本轮失败是 `gateway-restart` 50ms 时序用例，而评测报告中的 RuntimeChat 用例与 Gateway 用例定向复跑 61/61 通过。结合两次全量运行失败点漂移，结论改为“存在至少两处负载型 flaky”，发布前必须连续三次全量稳定通过。
- 工程债校正：`npm run lint` 会扫描本地 `.sandbox` 历史 worktree，评测报告的 64 万级结果不能代表干净仓库。显式排除 `.sandbox/.agents-one` 后，无缓存复核为 13 个文件、54 个真实 error，以及约 70,781 个主要由 Windows CRLF 引发的 Prettier warning。真实 error 需清零，行尾治理必须独立提交，CI lint 之后改为阻断。
- 依赖安全：2026-08-20 执行 `npm audit --json --omit=dev` 得到 14 项生产依赖漏洞（1 critical、10 high、2 moderate、1 low）；直接用于备份归档的 `tar` 为 critical，`electron-updater`、Electron、Vite、YAML 等也需分组升级和专项回归。发布门槛调整为无未处置 critical/high，禁止无审计执行全量 `npm audit fix`。
- 报告勘误：`.github/workflows/ci.yml` 与 `release.yml` 实际存在，但 lint 非阻断、release 仍有旧 Hermes 品牌且未在目标仓库运行；`upstream/`、`_research/` 是旧父工作区下的同级目录，不是 Agents-One 仓库残留；日志、Hers ZIP 和本地测试文件为 ignored，本轮仅确认临时 PR 评论等跟踪文件需后续审计。Phase 1.7 修复的是协作轮询中的另一处 mock，不是报告本次失败的上下文占用测试。
- Git/发布现状：当前 `agents-one-slim-task-dialog` 分支领先 `main` 39 个提交，`origin` 仍指向本地 `<legacy-upstream-repo>`。RC1 前需将目标 GitHub 与 upstream 分开命名、整理分支、真实运行 CI 和 release dry-run，禁止误推送。
- 计划拆分：S0 基线与复现 → S1 Runtime 生命周期 → S2 定时任务一致性 → S3 Gateway 与 TLS → S4 文件/附件/恢复边界 → S5 可靠性、依赖和工程门禁 → RC1 五条 Runtime、定时任务、备份恢复与 Windows 普通用户发布回放。预计单人 15-22 个工程日，每个工作包独立测试、提交、回退和记录。
- 项目记忆：已通过 PowerMem stdio 兜底写入本次评测与发布冻结事实，memory id `745532351710232576`；详细计划落盘后再次同步权威文件和 S0-S5/RC1 顺序，memory id `745557842001395712`。语义复核已召回 2026-08-20 “Phase 4 暂停、先稳定化”事实；新记忆仍可能等待 infer 后台索引，本地计划与进展日志继续作为当前审计权威。

## 2026-08-13：Agents One 可迁移备份与恢复

- 产品边界：设置页“数据”已从 Hermes CLI 的导入导出切换为 Agents One 自有 `*.agents-one-backup`。备份覆盖配置档案、项目登记、任务/定时任务、Runtime/Quick Chat/原生会话、协作记录、SQLite 状态、记忆、技能、附件和 Runtime 输入证据；项目实际文件、worktree、日志、缓存与安装引擎不进入归档。
- 凭据边界：`.env`、账户/认证/钱包文件、Token、API Key、SSH keyPath、代理和原始 `config.yaml` 不导出。安全配置采用白名单迁移并合并进目标配置，保留目标机凭据与未知键；新的或变化的远程端点默认停用并要求重新授权，本机可执行路径/工作目录变化时清空并停用。
- 数据完整性：归档使用版本化 manifest、逐文件大小与 SHA-256；SQLite 通过 `VACUUM INTO` 生成含已提交 WAL 的单文件快照。导出先在目标旁生成临时归档并走完整导入校验，成功后才原子替换旧备份。
- 恢复安全：导入先拒绝路径穿越、链接/特殊文件、Windows 设备名与 ADS、超限归档、清单外文件、哈希错误、畸形核心 JSON、不安全配置和损坏 SQLite。恢复按“备份内托管数据快照”清理目标残留，同时保留目标独有凭据、未知文件及备份外配置档案；写前建立持久 `.restore-transaction` 日志和回滚快照，进程内失败立即恢复，断电/崩溃后会在打开窗口或写连接前自动回放，回滚失败保留救援目录。
- 运行一致性：应用取得 Electron 单实例锁，导出等待计划调度写入结束且拒绝活动聊天/Runtime；恢复先销毁旧 Renderer 形成全局写入闸门，再停止计划、活动运行、Dashboard、SSH 隧道、所有 Profile Gateway 和数据库连接，核心文件写入也统一受进程内闸门保护。迁移后的计划任务统一停用并清空 pending/active run，聊天不保留旧进程 run id；`desktop-staging` 只重绑定明确的附件 path，聊天正文保持原样；完成或中途失败后自动重启，避免其他实例、异步尾写或旧内存状态覆盖新快照。
- 兼容补齐：Quick Chat 从仅 localStorage 升级为按 Profile 的主进程持久化，并一次性迁移旧本地数据，确保快速聊天也能进入备份。Renderer、Preload、IPC 和中英文文案均改用结构化预检/确认/结果契约，不再声称备份 Hermes。
- 项目记忆：PowerMem 健康检查与长期事实写入成功，新记忆 ID 为 `743037391287091200`；即时语义复核仍优先召回既有备份/恢复事实，符合 `infer` 后台索引尚未完成的表现，本地进展日志与设计文档继续作为当前权威记录。
- 自动验证：备份专项 18/18 通过，覆盖真实 SQLite/WAL、凭据金丝雀、路径与归档攻击、哈希/JSON/SQLite 损坏、配置合并、远程重新授权、计划停用、托管快照删除、跨机附件重绑定、prepared/committed 崩溃日志恢复和完整往返；全量 Vitest 203 个文件、2006 项通过、13 项跳过，Node/Web TypeScript、Electron Vite 生产构建、`lat check` 与 `git diff --check` 全部通过。独立安全复核确认无遗留 P0/P1。完整设计和安全边界见 [Agents One 备份恢复设计](../lat.md/backup-recovery.md)。

## 2026-08-13：Task Center 执行器完整退役

- 全量可达性审计确认 Task Center 已无 Layout、IPC、Preload 或现役业务消费者；新建任务、项目任务和定时任务都直接进入普通 Runtime 对话。生产代码唯一残留是旧计划的读取、取消和结果回填分支，继续保留会形成双状态机与 5 秒轮询大文件的回归风险，因此 Task Center 已可判定为冗余执行层。
- 删除 `src/main/task-center.ts`、共享 Task Center 类型、专用单元测试和约 700 行孤儿样式，同时删除只验证旧 Project/Task Center 导航的 U1 历史脚本。定时任务只调用 `start/get/cancelAgentRuntimeTask`；设置页也移除了“任务中心选择实现”的过期 Pi 权限说明。
- 计划存储升级为 v5。旧 `activeTaskCenterTaskId` 不再是活动信号，也不会阻塞编辑、删除或重新触发；旧 `queued/running` 计划运行被幂等收口为明确失败并提示重新触发。已经完成的旧运行继续保留原状态、摘要、对话链接和历史指针，但程序不再打开 Task Center 数据库。
- 数据保护审计覆盖当前默认 Profile：`task-schedules.json` 为空且没有旧引用；`task-center.json` 有 19 条历史记录、0 条 `queued/running`，其中 10 条 `review_required`，3 个历史 worktree 仍被引用。当前文件及 worktree 均未删除或重写；最新 6,662,348 字节历史库已复制到 `<private-recovery-root>\agents-one-pre-task-center-retirement-20260813`，源文件和快照 SHA-256 均为 `0865F1CC909D4408B123A92EEE8649F9F5474E3E82E792DBF9A7B9653C658AA4`。
- 性能结论保持克制：当前无旧引用时正常调度本来就不会读取历史库，所以即时提速有限；核心收益是消除约 1,500 行死代码/测试/样式、双持久化和潜在的主线程大文件解析卡顿。任务对话内多智能体协作属于现役能力，与 Task Center 无关，完整保留。
- 项目记忆已同步更新 `lat.md/main-process.md`；PowerMem 健康检查和写入成功，新长期记忆 ID 为 `742997757165305856`。两次即时语义复核仍优先召回 8 月 6 日/12 日旧阶段事实，属于 `infer` 后台索引尚未完成，本地日志和恢复记录继续作为当前权威事实源。
- 自动验证：Task Center 退役边界、计划主进程和管理页首轮定向回归 3 个文件 20/20 通过，扩展调度/会话回归 26/26 通过；全量 Vitest 201 个文件、1973 项通过、13 项跳过。Node/Web TypeScript、Electron Vite 生产构建、`lat check` 和 `git diff --check` 全部通过。一次 99 项并行回归中的既有 RuntimeChat 时序用例偶发超时，单项复跑通过，随后全量回归也通过。

## 2026-08-12：定时任务收敛为普通 Runtime 任务对话

- 体验根因：旧调度会先保存一条只有用户提示词的 Runtime 对话，再把真正执行交给内部 Task Center；打开对话后没有可追踪的 Runtime run，只有等 30 秒调度轮询发现终态才一次性追加结果，因此思考、工具与进度长期空白，并存在两套任务状态和频繁全量对账开销。
- 执行模型：新调度直接调用与新建任务相同的 `startAgentRuntimeTask(..., conversation=true)`，继续使用用户配置的 Pi/Claude Code/Codex 原生技能、MCP、插件、Hooks、Shell、工作目录与文件权限；`runtimeRunId` 同时写入计划执行和持久 Runtime 对话，不再为新执行创建 Task Center 任务。
- 实时对话：Runtime 对话新增 `activeRuntimeRunId`。打开已触发的计划对话时，RuntimeChat 立即进入 loading 状态并恢复同一运行的轮询，沿用普通任务的思考、工具、进度、取消、最终回复和 session 持久化；终态清除活动运行字段。后台对账仍作为无人打开对话时的幂等结果投递兜底，避免重复回复。
- 通知与性能：Windows 系统通知由“执行完成后”前移到触发瞬间，正文为“XXX定时任务已触发，智能体已开始接手并推进任务”；完成事件只刷新页面。调度对账从 30 秒缩短到 5 秒，但新任务不再每轮读取 Task Center 全表，仅存在旧记录需要恢复时才加载，减少运行中卡顿来源。
- 兼容与恢复：旧 `activeTaskCenterTaskId/taskCenterTaskId` 继续只读兼容和一次性结果回填，不迁移、不删除历史；应用中途重启导致进程内 Runtime run 丢失时，计划和对话明确记录失败并允许用户在同一对话重发，不再永久停留“执行中”。数据变更仅新增可选字段，旧文件可直接读取，回退代码会忽略未知字段。
- 安全评估：未修改 Runtime id、智能体配置、凭据、头像名称、项目归属或既有消息；消费者仅限计划存储、Runtime 对话存储、Layout 恢复、RuntimeChat 与调度通知。主要风险为重复终态投递、活动状态不清除和旧记录失联，已通过 run-id 幂等、终态清除及遗留回填路径约束。
- 项目记忆：长期方案已明确“普通任务、项目任务和本地定时任务共享终端原生能力契约”；PowerMem 健康检查、写入与语义检索均成功，新记忆 ID 为 `742678542881390592`。
- 自动验证：调度、会话存储、RuntimeChat 与管理页定向回归 4 个文件 63/63 通过，覆盖启动事件、直接 Runtime 并发、实时恢复、后台/前台终态竞争幂等和重启失联；Node/Web TypeScript 检查、生产构建与 `lat check` 通过。变更文件 ESLint 为 0 error，仅保留代码库既有的 RuntimeChat `send` 与 Schedules 弹窗 Hook warning。

## 2026-08-12：定时任务结果投递到可见对话

- 现场证据确认“定时任务测试”并非未触发：计划时间为 11:20，调度器在 11:20:18 创建 Pi 运行，Pi 在 11:22 前生成完整问候和自我介绍，11:22:48 被对账为成功；但 `runtime-conversations.json` 未更新，因此用户侧没有任何可见回复。
- 每轮计划执行现在在派发前创建独立 Runtime 对话，并将 `conversationId` 写入该轮 `TaskScheduleRun`；终态对账把经过共享结构化输出解析器提取的最终回复（或明确失败信息）、执行事件和产物追加到同一对话，不再把 JSONL 前 500 字误当结果。
- 主进程完成事件通过受控 Preload 通道通知 Renderer；当前窗口显示完成/失败提示，窗口未聚焦时显示系统通知。定时任务页每 10 秒自动刷新并在完成事件到达时立即刷新，任务卡展示两行结果摘要和“打开最近执行对话”入口。
- 兼容旧数据：每条本地计划只回填最近一次已完成但没有 `conversationId` 的执行，恢复用户这次测试结果；回填不发送过期通知，重复对账不重复追加消息。远程旧记录仍不派发、不迁移。
- 自动验证：计划调度、会话持久化、结果解析和管理页 4 个测试文件共 17/17 通过，覆盖新执行投递、完成事件、管理页打开对话、旧执行一次性恢复及幂等性；Node/Web 类型检查通过。

## 2026-08-12：新建任务只打开默认智能体

- 根因：Shell 在 Runtime 目录异步加载前先创建一个空 Hermes 占位；默认智能体解析为 Pi/Codex/Claude 等 Runtime 后，“新建任务”旧逻辑继续追加新 Runtime 会话，没有替换未使用的 Hermes 占位，因此顶部同时出现两个“新对话”。
- 修复：新增统一的新任务状态转换，空且未运行的当前占位由默认智能体原位接管；已有会话、历史内容和运行中任务一律保留并正常新增标签。默认 Runtime 解析完成后会主动接管初始占位，侧栏“新建任务”、标题栏“+”和项目任务入口复用同一规则。
- 同源边界：只有内置 Hermes 使用旧 Profile 对话；用户自定义 Hermes Runtime 若被设为默认，继续保留自己的 Runtime id、连接和持久化通道。
- 改动限于 Renderer 会话状态转换和测试，未修改默认智能体的 localStorage 键、Runtime 注册、配置文件、历史记录或主进程传输。
- 验证：Layout 会话状态、标签栏和默认智能体选择 3 个测试文件共 25/25 通过，Web 类型检查、生产构建、目标文件 ESLint、Prettier、`lat.md check` 与 `git diff --check` 均通过；在真实开发界面以已配置默认 `pi` 复核，页面加载后及连续点击“新建任务”后均保持 1 个 Runtime 对话、0 个额外标签、无 Hermes 会话残留。

## 2026-08-12：定时任务收敛为本地 CLI 能力

- 功能边界调整：桌面定时任务只允许已启用且 `location=local`、`transport=cli` 的 Runtime。主进程在新建、重新启用、手动触发和后台轮询四处执行同一校验，非本地 CLI 任务不会被派发。
- 远程能力退役：定时任务页不再读取、创建或管理 Hermes 服务端 Cron，也不再展示“执行位置”；远程智能体如需服务端计划任务，由用户在对话中让智能体自行建立。
- 创建表单移除“执行方式”，默认沿用安全的分析任务契约；智能体下拉仅列出本地 CLI Runtime，并明确提示桌面应用需保持运行。旧的远程关联记录不删除、不迁移，仍保留在原数据文件中，但不会继续执行。
- 管理页改为单一“本地 CLI 任务”面板，统一标题、分区、卡片、状态与空状态字号，增加安全删除确认和 720px 以下响应式收敛。
- 自动验证：定时任务 Renderer/主进程 6/6 用例通过，Node/Web 类型检查和 `git diff --check` 通过；1024×768 的管理页与创建弹窗 U5 步骤通过并完成截图。完整 U5 在后续 768 宽聊天检查遇到既有的双 `.chat-input-area` 严格定位冲突，与本次定时任务变更无关。
- PowerMem 已写入本次能力边界事实（memory `742573171885998080`）；服务健康、写入成功。由于 `infer` 后台处理，紧接写入的两次语义检索尚未召回该条目，本地进展日志仍作为当前可审计事实来源。

## 2026-08-10：Claude 本地 CLI partial-stream 轨迹修复

- 复盘真实协作运行 `runtime-conv-9b498ccb-debc-427a-9b0d-df04ecbbdea4`：Claude 的持久会话包含多段 thinking，Agents One 也保存了 9 次工具调用及其 5 次成功、4 次失败结果，但旧输出过滤器丢弃 `--include-partial-messages` 产生的 `stream_event`，因此 thinking 只能依赖最终 assistant 帧，工具参数也无法在 partial 阶段重建。
- 解析修复：Claude 本地 Adapter 只放行 `thinking/tool_use` block 的 start/stop，以及 `thinking_delta/input_json_delta`；普通文本增量、签名和 SessionStart/system 噪声继续丢弃。Runtime 按 block index 累积思考和工具 JSON，按稳定 callId 更新既有工具调用，并把调用时工具名带到后续 tool_result，避免笼统显示“Claude Tool”。
- 兼容与边界：最终 `assistant.content[].thinking/tool_use` 和 `user.tool_result` 仍是权威兜底；partial 与最终帧按 callId/内容快照去重。新增状态只存在于单次 Runtime 的内存中，不改变 CLI 参数、Runtime 配置、用户凭据、Gateway、会话格式或既有历史。
- 真实只读冒烟：Claude Code 2.1.224 在 `plan` 模式读取项目 `package.json`，退出码 0；捕获 526 个 `thinking_delta`、20 个 `input_json_delta`、2 个 thinking block 和 1 个 tool block，验证新适配覆盖当前真实输出结构，冒烟未修改工作区文件。
- 自动验证：Claude Runtime、RuntimeChat、消息适配和 MessageList 5 个相关测试文件 85/85 通过；Node/Web TypeScript 检查、变更文件 ESLint、生产构建、`lat check` 与 `git diff --check` 均通过。

## 2026-08-10：单智能体授权、远程环境边界与运行状态显示修复

- 现场复盘任务 `runtime-conv-c388a8af-1be5-4abb-ad33-7d7dd131ea14`：用户只要求 Hers 执行 PowerMem 备份方案，Hers 却自行输出协作提案；客户端仅校验提案 JSON 和 runtimeId，未再次核验当前用户请求是否明确授权协作，因此自动创建了协作记录。
- 协作现在以当前用户请求的明确意图为硬边界：普通任务、“开始执行”、任务复杂度或模型自认为适合分工都不构成授权；这类运行不再收到协作控制协议，即使模型自行输出合法提案标签，客户端也会剥离控制块且不自动启动。明确要求多智能体、协作或角色分工的请求仍保留自动编排。
- 远程 Runtime 的原生工具/路径与 Agents One 桌面本地项目正式区分：未关联项目的远程角色默认在“智能体所在设备”执行，不再自动套用“只读证据包”并要求选择本地文件夹；只有明确选择 Workspace Grant、远程映射或证据包时才进入相应预检。
- 等待回复的三点气泡移除了无实际信息的旋转彩虹 Agents One 标识；输入栏模型标签在新 run 尚未上报 metadata 时沿用该对话最近一次真实 provider/model，收到新模型后再更新，不再短暂清空为“未提供模型”。
- 改动边界仅限共享协作意图解析与 Renderer 派发/展示；未修改 Runtime 注册、身份外观、Gateway 协议、凭据、历史记录或持久化格式。定向回归 54/54、Node/Web 类型检查、生产构建、`lat check` 与 `git diff --check` 均通过。默认并发全量测试仅有 2 个既有 Gateway 重启 50ms 定时用例偶发失败；对应测试文件立即独立复跑 17/17 通过，判定为并发时序抖动，与本次改动无关。

## 2026-08-06：旧管理功能瘦身完成

- 已在分支 `agents-one-slim-task-dialog` 完成两步可回退删除：`2a69749` 退役独立 Task Center、Project Center、旧对话任务侧栏和控制面 IPC；`200686b` 退役 Hermes Kanban 页面、命令、IPC、本地/SSH 桥接、样式与翻译。
- 任务对话内多智能体协作完整保留，包括协作建议、角色配置、顺序编排、工作区访问、人工介入、产物和历史恢复；项目文件夹分组、Runtime、Gateway v1、Workspace Grant、媒体产物和定时任务均保留。
- 定时任务继续复用 `src/main/task-center.ts` 作为内部执行/恢复引擎，但 Renderer 和 Preload 不再暴露旧任务中心；旧 `project-control.json`、`task-center.json` 和 `task-collaborations.json` 未删除、未迁移。
- 自动验证：生产构建通过；全量 Vitest 189 个文件、1885 项通过、13 项跳过；核心边界定向回归 67 项通过、4 项跳过；`lat check` 通过。全量测试完成汇总后仅外层进程退出超时，无失败用例。
- 删除后用户数据复核：六个文件 SHA-256 与备份一致；`remote-session-cache.json` 仅顶层 `updatedAt` 因运行中应用刷新而变化，histories 和 38 条 sessions 内容一致。完整恢复命令与本机数据路径已转入受控私有归档；公开日志只保留验证结论。
- 已将“退役旧管理面、保留任务对话协作、基线标签与拆分提交”同步写入 PowerMem；当前会话未加载 MCP 注册，按项目兜底规范通过本地 stdio server 完成，未输出或持久化 API Key。

## 2026-08-06：旧管理功能瘦身前恢复基线

- 产品边界确认：保留项目文件夹分组、任务对话和任务对话内多智能体协作；计划退役独立 Task Center、Project Center 项目/协作管理控制面与 Hermes 原生 Kanban。
- 代码恢复点预留为标签 `agents-one-pre-slim-20260806`；瘦身将拆成独立提交，发生核心回归时优先逐提交 revert，也可从标签建立恢复分支。
- 已将当前桌面数据逐文件复制到 `<private-recovery-root>\agents-one-pre-slim-20260806-1120\desktop-data` 并记录 SHA-256。备份覆盖项目控制、项目文件夹、远程会话缓存、Runtime 对话、会话覆盖层、Task Center 和任务协作数据；原文件未移动、未修改、未删除。
- 当前真实数据包括 8 个旧控制面项目、12 个项目任务、104 条事件、10 个产物引用、16 条 Task Center 记录和 7 条任务对话协作记录。瘦身只停止旧控制面入口和写入，不自动删除历史数据。
- 完整恢复命令、数据哈希、保留边界和停止门槛已转入受控私有归档；公开日志只保留验证结论。

## 2026-08-06：Hers-2 输出图片发布契约与运行指示位置修复

- 现场确认图片失败不是 PNG 格式问题，而是远端智能体只在最终答复中打印了 `artifact.created` 元数据和 `MEDIA:` 文件名，没有把真实字节上传到 Connector Artifact 存储；桌面端无法从文件名或远端路径还原图片。
- Plugin SDK 升级到 v0.1.1：运行上下文新增 `publishArtifact({ name, mime, bytes/contentBase64 })`，统一完成大小与 SHA-256 校验、Run 产物登记、`artifact.created` 事件和 `GET /artifacts/{id}` 下载；已生成 `plugins/agents-one-plugin/agents-one-plugin-sdk-0.1.1.tgz`。Hers-2 Connector 必须把该回调注册为智能体可调用的真实工具，打印 JSON 不算上传。
- RuntimeChat 改为优先读取最新 Runtime Catalog 中的头像、名称和颜色，已打开的对话在保存显示信息后也能刷新；工具调用历史前不再放 Agents One 标志，彩虹动态圆环只保留在下方实时运行指示位。
- 自动验证：Plugin SDK 8/8、桌面端定向回归 64/64、Node/Web 类型检查和生产构建全部通过。现场复测前需升级并重启 Hers-2 Connector，同时确认 `hermes-home2` 的头像已单独保存。

## 2026-08-04：统一复用成熟对话界面开发方案形成

- 已完成内置 Hermes 与 RuntimeChat 两套消息渲染链路的现状审查，确认后续由各 Runtime 适配统一事件，前端复用现有 `MessageList`、`MessageRow`、`AgentMarkdown` 和媒体组件。
- 明确 Hers-2 本次图表测试返回的是办公电脑本机路径，第一阶段优先打通 `MEDIA:C:\...` 在 RuntimeChat 中的原生呈现；跨机器 artifact 下载作为后续阶段。
- 详细方案、TODO、验收矩阵和停止门槛见 [统一对话渲染与成熟界面复用开发方案](./AGENTS_ONE_UNIFIED_CONVERSATION_RENDERING_PLAN.md)。

## 2026-08-04：Phase 1 RuntimeChat 接入原生对话渲染器

- RuntimeChat 已切换到现有 `MessageList`，统一复用原生的思考、工具、错误、Markdown、媒体和附件呈现；Runtime 专属控制面板继续保留。
- 新增纯适配器 `runtimeChatMessageAdapter.ts`，兼容当前只有 summary 的 Runtime 事件，并为工具调用/结果建立稳定的本轮 callId 配对。
- Hers-2 返回的本机 `MEDIA:C:\...` 路径会继续交给 `MessageRow` 媒体解析链路，不再由 RuntimeChat 自己渲染 Markdown。
- 验证：RuntimeChat 与适配器定向测试 24/24；Web 类型检查通过；受影响文件 lint 0 errors。全量测试超过 120 秒未完成。

## 2026-08-04：Phase 2 细化 Runtime 事件与本机媒体路径

- 去除 RuntimeChat 传入原生 `MessageList` 的重复“正在处理”进度文案；保留原生思考/工具行作为唯一运行中反馈。
- Gateway 原始事件的工具类型、调用 ID、输入摘要、输出摘要、错误详情已进入统一时间线，工具/技能结果可在原生折叠行中展开查看具体内容。
- 主进程统一处理 `file:///`、引号和 JSON 双反斜杠 Windows 路径，补齐本机 `MEDIA:` 读取回归。
- 放宽远程任务终态判定：已交付 `MEDIA:`、`artifact.created` 或 Gateway 产物时，不再因没有 workspace audit 被误判失败；普通工作区修改仍保留审计门槛。
- 验证：Phase 2 定向测试 51/51、Node/Web 类型检查通过；lint 0 errors，仅保留 RuntimeChat 原有 Hook 依赖 warning。

## 2026-08-04：Phase 2 本地 CLI 结构化事件适配

- OpenClaw Gateway、Codex `item.started/item.completed`、Claude Code `tool_use/tool_result`、Pi `toolCall/toolResult` 现在统一写入工具名、kind、输入、输出和 callId；旧 summary 仍保留兼容展示。
- 新增四类 Runtime 结构化事件 fixture，确保原生工具折叠行能展开到具体调用参数和结果内容，并验证 OpenClaw 的模型/usage 元数据保留。
- 验证：Runtime 定向测试累计 54/54；Node 类型检查通过；R-05 事件 fixture 已完成。

## 2026-08-04：Phase 2 R-07/R-08 模型元数据与远程产物暂存

- 本地 Codex、Claude Code、Pi 的 model/usage 事件已在主进程统一归一化：支持 Codex `turn.completed`、Claude `result/modelUsage`、Pi assistant message，并保留 provider 回传的上下文窗口。
- 新增统一 Gateway `GET /artifacts/:id` 下载适配器：限制下载大小，校验 Base64、声明大小和 SHA-256；远程 artifact 在进入 `AgentRuntimeRun` 前由主进程暂存到短期媒体目录。
- 暂存后的产物复用现有本机媒体/产物路径，渲染器不持有 Gateway 凭据，也不直接访问远端文件系统。远程 artifact 在原生消息中的图片/文件组件绑定列入 R-09。
- 验证：R-07/R-08 定向测试 44/44；Node 类型检查通过。

## 2026-08-04：Phase 2 R-09 artifact 原生界面绑定启动

- Runtime 对话执行记录现在同时保留 events、artifacts、model、usage，历史重开时不会只剩最终文本。
- 图片 artifact 通过原生 `MEDIA:` 段进入既有 `MessageRow`/`MediaImage`；非图片 artifact 通过既有 `AttachmentChip` 的 `path-ref` 形式展示，未新增第二套 artifact 渲染器。
- 已补适配器回归；真实 Electron 窗口中的远程图片读取、文件芯片操作和历史重开仍是 R-09 的人工验收项。

## 2026-08-04：Phase 3/4/5 本机自动回归收口

- Phase 3：图片 artifact 统一转为原生 `MEDIA:`，普通文件转为原生 `path-ref` 附件芯片；远程 artifact 在主进程完成下载、大小/Base64/SHA-256 校验和短期暂存，Renderer 不接触远端凭据或绝对路径。
- Phase 4：模型名称只取真实 Runtime 元数据或本地配置；上下文占用只在真实 `contextUsedTokens + contextWindowTokens` 同时存在时显示；Runtime Markdown 链接复用共享 `web-preview:navigate` 事件和原生 Web Preview 面板。
- Phase 5：删除 RuntimeChat 已不再使用的旧进度、执行记录和任务面板 CSS，保留权限、工作区、协作、产物和人工介入控制。
- 自动验证：RuntimeChat/适配器/Gateway/媒体/主进程 hydration 定向测试 66/66；U5 真实 Electron 1024x768 与 768x800 双视口共 15 张截图通过，覆盖对话、项目、任务列表/看板、定时任务、智能体和设置页面。
- Hers-2 真实 Connector 现场 smoke test 已通过：`artifacts.upload/download=true`、`modelMetadata/usageMetadata=true`、`maxGrantSeconds=null`；`artifact.created` 与 `GET /artifacts/{id}` 的 mime、size、SHA-256 一致，HTTP 200，Base64 解码正确，7 个事件 sequence 单调递增。

## 2026-08-04：补齐 Plugin SDK 远端 artifact 下载路由

- 发现 Plugin SDK 原先只在 `/capabilities` 声明 `artifacts.download`，却未实现 `GET /artifacts/{artifactId}`，会导致真实远端图表下载稳定返回 404。
- 已补齐该路由：支持 `getArtifact(artifactId, context)` 返回 `contentBase64` 或 `bytes`，统一输出元数据与 `contentBase64`，并增加 SDK 回归测试。
- Plugin SDK 测试 6/6 通过，已重新生成干净包：`plugins/agents-one-plugin/agents-one-plugin-sdk-0.1.0.tgz`。Hers-2 现场 smoke test 前必须使用此包升级 Relay/Connector。

## 2026-08-04：工作区成功操作不再显示空泛 workspace_gateway 错误

- 针对 Connector 在同一轮已完成 list/read/write 后仍附带一个无错误详情的 `tool.failed`/`workspace.blocked` 事件，桌面端不再把它渲染为误导性的“工具 workspace_gateway”。
- 只有同一轮已经出现成功工作区事件时才过滤该空泛标记；包含 `error`、`detail`、`code`、具体输入或路径信息的真实失败仍保留，便于排查授权、路径和网络问题。
- 验证：Agent Runtime 与 Event Stream 定向测试 22/22 通过，Node/Web 类型检查通过。

## 2026-08-04：Relay 丢失运行记录时停止无效重试

- `GET /runs/{runId}` 返回 `HTTP 404 run_not_found` 现在被识别为终态，不再伪装成网络抖动并重试 120 秒。
- 运行会立即提示 Relay 重启/热更新或状态清理导致的原因；客户端不会自动重放旧消息，避免远程工作区写入被重复执行。
- 验证：统一 Gateway 与 Runtime 定向测试 33/33，Node/Web 类型检查通过。

## 2026-08-04：Hers-2 工作区授权改为显式撤销与根路径兼容

- 工作区 Grant 默认以 `expiresAt: null` 注册，不再由桌面端设置 600 秒倒计时；运行结束、取消或显式撤销时仍会调用 revoke，避免留下无人管理的远程授权。
- 对旧 Relay 返回 `grant_expired` 的情况增加当前 Grant 自动重新登记兼容；Relay 应升级为接受 `expiresAt: null`，并将 `maxGrantSeconds` 改为 `null` 或省略。
- 远端 `list` 请求传入 `/` 时归一化为已授权项目根目录 `.`；目录丢失时改为脱敏、可操作的提示，不再泄露 Windows 绝对路径。
- 验证：Workspace Gateway 与统一 Gateway 定向测试通过；新增永久 Grant、根路径和目录丢失回归覆盖。

## 2026-08-04：Hers-2 工作区 Grant 联调恢复与模型名称展示优化

- 工作区网关 URL 校验允许 `localhost`、回环地址和 RFC1918 私网 IPv4 的 HTTP 联调；公网 HTTP 仍拒绝，必须改用 HTTPS，避免 Bearer Token 明文出站。
- Relay 在轮询时返回明确 `grant_not_found`/未知 Grant 的情况下，桌面端会用当前仍有效的 Grant 自动重新登记一次；已撤销或已过期的 Grant 不会被自动复活。
- RuntimeChat 模型标签取消原先 `10vw / 150px` 的硬限制，改为响应式最大宽度并允许长模型名换行，同时保留完整无障碍标签。
- 验证：remote-workspace-gateway 11/11、RuntimeChat 20/20；Node/Web 类型检查通过。

## 2026-08-04：Hers-2 RuntimeChat 输入与运行元数据补齐

- 统一 Gateway 的远程附件链路已闭环：能力探测区分 `artifacts.upload`，桌面端安全暂存并上传附件到 `/artifacts`，再将不可变 `artifactIds` 写入 `/runs.input`；插件 SDK 增加可选 `adapter.uploadArtifact` 端点。
- RuntimeChat 的模型与上下文显示支持 Event Stream 常见字段，包括 `model_name`、`modelId`、`context_used`、`context_max`；只展示远端真实回传值，不猜测模型或上下文窗口。
- 网页预览改用对话壳的右侧面板布局，并增加 WebView 加载失败提示与重试按钮。
- 验证：RuntimeChat、Agent Event Stream、Remote Gateway、Agent Runtime 定向回归与插件 SDK 测试通过；Node/Web 类型检查通过。

## 2026-08-02：Gateway 失败事件保留详细诊断

- 共享事件模型现在保留 Gateway 事件中的 `code`、`error`、`detail` 字段，避免 `agent_offline` 被通用的 `failed` 覆盖。
- 失败原因按详细错误码优先呈现，并将 `agent_offline` 映射为可执行的 Connector 注册/在线检查提示。
- 当同一运行同时包含详细失败事件和通用 `run.failed` 终态时，界面过滤重复的通用失败记录，只保留可诊断原因。
- 验证：Gateway 定向回归测试 12/12 通过，Node/Web 类型检查通过，完整构建通过。
- 边界：该修复改善客户端诊断，不会自动启动远端 Connector；若远端仍返回 `agent_offline`，需先让对应 Runtime ID 的 Connector 在线并完成注册。

## 2026-08-02：共享 Gateway 路由补充 runtimeId

- 根因：自定义远程智能体 `Hers-2` 的界面名称与远端 Connector 身份不同。桌面端调用统一 Gateway `/runs` 时此前没有携带运行时 ID，共享 Relay 无法把任务路由到 `hermes-home2`，最终返回 `agent_offline`。
- 修复：桌面端现在始终把已配置 Runtime 的稳定 `runtimeId` 放入 `/runs` 请求；显示名称仍可自定义，不能作为路由身份使用。单智能体专用 Gateway 可忽略该字段。
- 协议约束：共享 Gateway 必须按 `runtimeId` 绑定对应 Connector；Connector 未注册或离线时返回结构化 `agent_offline`，不能只返回无诊断信息的 `failed`。
- 验证：Gateway 定向回归测试 12/12、Node/Web 类型检查和完整构建均通过。

## 2026-08-02：Remote Gateway 适配器显式传递 runtimeId

- 现象：桌面端已向 `/runs` 传入 `hermes-home2`，但共享 Gateway 仍返回 `agent_offline`，说明远端适配器可能只读取旧的 `startRun` 上下文而没有检查请求体顶层路由字段。
- 修复：SDK 调用 `adapter.startRun(input, context)` 时显式提供 `context.runtimeId`，同时保留顶层请求字段以兼容旧适配器；协议文档明确适配器的读取顺序和 Relay 路由要求。
- 远端要求：Hers/Relay 更新插件后，必须用稳定 ID `hermes-home2` 注册并保持 Connector 在线；仅 `/capabilities` 健康或“统一 Gateway 已连接”不能证明目标 Connector 在线。

## 2026-08-02：补齐 runtimeId 的双位置兼容

- 现象：部分已部署适配器只读取 `input.runtimeId`，而 v1 标准字段位于请求顶层，可能造成共享 Gateway 收到请求却无法定位目标 Connector。
- 修复：桌面端 `/runs` 同时发送顶层 `runtimeId` 与嵌套 `input.runtimeId`；SDK 在调用适配器前按“顶层优先、嵌套回退”归一化，并传入 `context.runtimeId`。不改变 v1 规范，兼容旧适配器。
- 验证：Gateway 定向回归测试 12/12、插件 SDK 测试 3/3、Node 类型检查通过。

## 2026-07-31 - Gateway 插件识别与事件呈现收口

- 桌面端 Gateway v1 探测现可识别标准 `plugin`，并兼容 SDK 迁移期的 `pluginInfo`；连接测试将显示已识别的插件版本。
- Workspace Gateway 能力同时兼容标准嵌套声明和早期扁平声明，避免已具备 Workspace Grant 的远程智能体被错误收起文件夹和权限控件。
- 移除了桌面端把“远程智能体已返回新的答复”写入执行过程的合成事件；最终答复只显示为答复气泡，不再伪装为“思考”。历史中的同类合成事件也会在界面过滤。
- 任务输入栏会在 Gateway 实际回传 `model`、`usage.contextWindowTokens` 后显示真实模型和上下文占用；不再猜测模型或上下文长度。
- 仍待远程插件完成：Hers/OpenClaw 必须回传真实的 `reasoning.summary`、工具生命周期事件、模型与用量元数据。若无法取得真实事件，不应声明富事件能力或伪造思考记录。

本日志记录开发、体验迭代、测试验证和重要产品取舍。路线图仍以
[Agents One 可用性重构计划](./AGENTS_ONE_USABILITY_REBUILD_PLAN.md) 和
[Agents One 项目与任务中心实施计划](./AGENTS_ONE_PROJECT_TASK_EXECUTION_PLAN.md)
为准；本文件用于后续总结、回顾和升级优化。

## 2026-07-26：按需转为多智能体协作的入口与隔离存储

### 产品决定

Agents One 保持“对话优先”：新建任务（包括项目中的任务）默认都是单智能体对话。多智能体协作是少数、由用户明确发起的工作方式，而不是自动路由或默认编排。

### 已完成

- 项目标题右侧新增任务入口：可选择“新建任务”或“新建多智能体协作任务”。原有项目区总 `+` 仍只负责“新建空白项目 / 使用现有文件夹”，职责不混淆。
- 任务右键菜单在“重命名”后新增“转为多智能体协作”，可把已有单智能体任务按需升级。
- 协作弹窗支持指定协调者、实施、测试、复核四个角色，并默认将原任务智能体带入协调者；未选择的角色保持“暂不指定”。
- 协作分工单独保存至本地 `task-collaborations.json`，只以任务 ID 关联，**不改写** Runtime 注册、既有对话正文、项目文件夹或历史索引。
- 左侧项目/任务记录会以轻量“协作”标识区分已配置协作分工的任务；该标识查询失败时只隐藏标识，不影响任何历史记录或任务操作。
- 已配置协作的任务在右侧“对话任务”栏展示实际角色分工，并按智能体的自定义名称显示。该栏只用于回看分工与当前执行信息，不会因打开任务而自动创建、派发或重跑工作。
- 首版仅保存明确分工和项目关联，不自动派发、不自动共享敏感上下文、不自动合并任何代码；后续协作执行和项目侧进度面板须在此元数据稳定后单独实现。

### 验证

- `TaskCollaborationDialog` 定向测试覆盖“继承原任务智能体为协调者”和“保存明确角色分工”；`ConversationSidePanel` 覆盖协作分工展示且不自动创建/派发任务。
- `npm.cmd run typecheck`：Node/Web 类型检查通过。

### 风险控制

- 本次改动仅增加协作元数据和 Renderer 入口；不触及智能体接入、凭据、默认 Runtime、会话持久化和项目恢复逻辑。
- 若协作元数据文件损坏或不可读，协作功能显示为空配置，不会影响原任务的打开、发送或历史显示。

## 2026-07-25：自定义 Hermes 接入档案补全

### 背景与边界

“新增智能体”中的 Hermes 曾沿用通用 Runtime 的 `HTTP / CLI` 表单，缺少 Hermes 实际需要的连接模式、Dashboard 凭据和对话传输选择，容易与系统默认 Hermes 的连接设置混淆。本次仅扩展**用户自定义 Hermes Runtime**的配置、受保护凭据与按模式探测；不改动系统默认 Hermes 连接、既有 Runtime、项目、任务或会话数据。

### 已完成

- 自定义 Hermes 支持三种模式：**本地**、**远程**、**SSH 隧道**；SSH 模式保存主机、用户、端口、远端 API 端口和私钥路径。
- 远程/SSH Hermes 提供 API 密钥、Dashboard 地址、Dashboard 令牌，以及三种对话传输策略：**自动**、**Dashboard**、**基础模式**。
- Hermes 不再显示与其语义冲突的通用 `HTTP / CLI` 连接方式下拉框；该下拉框继续仅服务其他 Runtime。
- API 密钥和 Dashboard 令牌不写入 Runtime 定义或 `desktop.json`，分别保存在受保护的环境变量/凭据通道中；Runtime JSON 只保存非敏感连接元数据。
- 连接测试按模式分流：本地检测本机 Hermes 健康端点，远程使用已配置 API 密钥检测远端健康，SSH 使用隧道连接参数检测可达性。

### 验证

- `npm.cmd test -- tests/agent-runtimes.test.ts src/renderer/src/components/settings/AgentRuntimesPane.test.tsx`：20 个用例通过，覆盖三种 Hermes 模式、三种传输方式、API/Dashboard 凭据不落盘和远程探测。
- `npm.cmd run typecheck`：Node/Web 类型检查通过。
- `git diff --check`：通过；仅报告现有工作区文件的 CRLF 提示，无空白错误。

### 后续注意

- 系统默认 Hermes 的实际 Dashboard/基础模式收发仍由既有全局连接管理器负责；自定义 Hermes 的对话执行适配应单独设计与验证，不能为了复用表单而回写或覆盖默认连接配置。

## 2026-07-24：Runtime 顶部任务标签外观与标题统一

### 现象

Hermes 任务对话在窗口顶部能显示头像和任务标题，但 Pi、Codex、Claude Code、OpenClaw 等 Runtime 对话被统一渲染为通用机器人图标和“新对话”。侧边栏已经正确识别用户自定义的名称与头像，顶部标签栏却没有复用同一份展示数据。

### 改动边界

本次仅修改 Renderer 层的顶部标签显示与恢复历史对话时的内存映射；不修改 Runtime 注册、`desktop.json`、IPC、会话存储或任何历史数据。

### 已完成

- 顶部标签栏改为按当前 Runtime 的用户配置解析显示名称、颜色和头像；Runtime 有自定义头像时显示头像，否则保持带 Runtime 色彩的通用图标。
- 顶部标签标题优先使用 Runtime 对话已保存的标题；新任务发送首条用户消息后继续沿用该消息作为标题。
- 恢复 Runtime 历史对话时，把持久化的标题、颜色和头像带入临时 `ChatRun` 与 Runtime 展示目录，避免历史标签重新回退成“新对话”。
- Hermes 仍使用其 Profile 外观，未改变原有表现。

### 验证

- `npm.cmd test -- src\\renderer\\src\\screens\\Layout\\ActiveSessionsBar.test.tsx`：4 个用例通过，包含 Runtime 自定义名称、头像和任务标题回归场景。
- `npm.cmd run typecheck`：Node/Web 类型检查通过。

### 后续注意

- 顶部标签、左侧项目/任务列表与对话正文应共用 Runtime 外观解析策略；新增智能体不得再单独写一套图标或标题回退逻辑。

## 2026-07-24：远程工作区启动避免误入首次安装页

### 现象

重启开发版后，已配置远程 Hermes 的用户被带到“Welcome to Agents One / Get Started”首次安装页。该页面会提示安装本地组件，不符合远程工作区的启动语义，也容易让用户误以为需要重新登录或重新安装。

### 根因与改动边界

启动流程把连接配置读取、远程健康检查放在同一个宽泛的 `try/catch` 内。远程健康检查本身已允许失败后继续进入主界面，但只要其中任一步 IPC 暂态失败，外层就直接回退 Welcome。此次仅调整 Renderer 启动流程的失败降级，不改动远程配置、凭据、Runtime 注册或会话数据。

### 已完成

- 主启动检查异常后，额外调用主进程 `checkInstall` 作为兜底；远程模式下该检查只验证已保存的远程连接配置，不检查本地 Hermes 安装。
- 兜底识别到已配置的远程工作区后直接进入主界面，而不是首次安装页。
- 本地开发版启动时显式继承现有 `%LOCALAPPDATA%\\hermes` 数据目录，避免开发环境的目录解析差异影响人工验收。

### 验证

- `npm.cmd run typecheck`：Node/Web 类型检查通过。
- `git diff --check`：通过。

## 2026-07-24：变更安全门禁与最小化修改原则

### 事件与教训

在统一 Runtime 对话输入栏布局的过程中，原本应局限于 Renderer 的视觉改动不当牵连了 Runtime 默认注册和历史外观解析，造成 Pi Agent 不可达、设置页不可编辑、智能体头像/名称回退等回归。用户明确要求：任何后续优化必须坚持最小化原则，能不动的代码先不动；确需跨层修改时，先做清晰的影响评估与风险预案。

### 已固化的执行规则

- 新增 [Agents One 变更安全守则](./AGENTS_ONE_CHANGE_SAFETY_PROTOCOL.md)，定义 UI、Runtime、持久化与历史数据的默认边界。
- 项目级 `AGENTS.md` 增加强制门禁：UI-only 改动默认不得触碰 Runtime 注册、配置写入、迁移、IPC 和历史对账；跨层变更必须先说明影响数据、消费者、失败模式、回退路径和验收清单。
- 配置写入必须读取并保留未知键；用户管理的 Runtime、头像、名称、项目和会话不可因局部功能改动被覆盖或重建。
- 后续采用“小补丁 - 定向测试 - 重启冒烟 - 再继续”的节奏，不将视觉调整与运行时逻辑、数据迁移混在同一不可拆分变更中。

### 当前限制

- 项目要求使用的 `lat` 命令在当前终端不可用，因此本次无法执行 `lat search` / `lat check`；已直接在项目级执行规则和进展日志中留下可审计记录。恢复该工具后，应补做知识库索引与校验。

## 2026-07-20 至 2026-07-21：产品信息架构与真实使用打磨（追溯补录）

说明：本节为 2026-07-22 根据连续对话、截图反馈、代码状态和既有验收文档补录。此前部分内容已散见于 U5 验收文档、发布矩阵和代码测试记录，但没有集中形成进展日志。

### 背景

前期实现已经证明 Hermes、OpenClaw、Codex、Claude Code 与 Pi Agent 可以作为 Runtime 接入，但用户在真实使用中发现：界面仍残留 Hermes Desktop 的旧信息架构，任务、项目、对话、智能体管理之间边界不够清晰；CLI 类智能体虽然能执行，但交互体验不如直接在 Terminal 使用。

### 产品方向确认

- **对话优先没有改变**：用户所谓“任务”本质上仍是原来的对话工作流；任务列表就是高价值对话列表。
- **项目是对话/任务的容器**：一个项目围绕同一目标组织多轮对话、多个智能体和产物，不再把“项目”做成孤立功能页。
- **任务中心收敛为计划/定时任务与验收视图**：不再让用户为了查看一次对话结果频繁跳转。
- **聊天是轻量浮窗**：用于临时问答，必要时把内容追加到当前任务/对话，而不是打开完整任务工作台。
- **智能体协作替代重复的智能体管理入口**：接入配置在设置中维护，主界面关注项目协作角色和当前可用智能体。

### 已完成的关键调整

- 主导航和左侧栏继续向“新建任务/任务列表/项目列表/聊天/智能体协作”收敛，去掉与当前阶段重复或不可用的旧入口。
- 项目列表支持“新建空白项目”和“使用现有文件夹”；选择后会把对应目录作为上下文文件夹进入新建任务/对话。
- 修复新建项目后任务错误进入普通任务列表的问题；项目任务应显示在对应项目分组下。
- 统一 Hermes、OpenClaw、Codex、Claude Code、Pi Agent 的对话窗口布局和输入框能力，尽量复用 Hermes 默认对话体验。
- 对话右侧栏从压缩主对话区改为右侧任务/产物信息面板，侧边栏按钮移入输入框下方工具栏，避免遮挡消息气泡。
- 默认智能体从旧 `default profile` 改为可从已接入智能体中选择；左下角展示默认智能体头像和名称，新建任务默认使用该智能体。
- 智能体头像、名称、颜色改为统一外观元数据，任务列表和项目任务中的头像/名称应与用户设定保持一致。
- 智能体接入类型扩展为可自定义，支持 Pi Agent CLI 这类新增本地 CLI Runtime。
- 调整权限控制：对话输入区由“只读/实现”改为“权限”，保留“只读”和“完全访问”；完全访问用于本地 CLI 智能体，删除类操作仍应有确认。
- 取消每次对话弹出的完全访问安全提示，改为在权限状态和高风险动作上做明确控制。
- 完成 Agents One 新品牌方向调整：应用名从 Hermes One 全面调整为 Agents One；补齐彩虹 O 圆环方案、任务栏图标、桌面快捷方式图标与欢迎页资产的多轮视觉修正。

### Runtime 与真实使用测试

- Hermes：远程对话、附件传递和 Dashboard/API 恢复后继续可用；重复回复、会话分裂和历史列表混乱已多轮修复。
- OpenClaw：远程 Bridge 健康、对话和 artifact 能力已接入；修复了后续对话超时、布局不一致和产物预览相关问题。
- Codex：本地 CLI 对话和任务执行可用；继续保持受控工作区、项目目录和运行过程反馈。
- Claude Code：本地 CLI 作为 Runtime 参与对话与项目任务；与 Codex 共用本地 CLI 工作区/附件/产物处理方向。
- Pi Agent：新增本地 CLI Runtime 接入；完成连接测试、连续对话、权限控制、工具过程展示和格式清理的多轮修复。

### 测试与验证

- 多轮执行针对性组件/主进程测试，覆盖 Runtime 接入、对话持久化、项目列表、远程文件夹选择、智能体设置和 RuntimeChat。
- 多轮执行 `npm.cmd run typecheck`，确保 Node/Web 类型检查通过后再重启开发版。
- 多次重启 Agents One 开发版并由用户进行手工截图验收。
- 安装包、便携版和发布候选版本继续冻结，等待 UI 与核心路径人工体验验收稳定后再恢复。

### 遗留与注意

- 由于本节为追溯补录，部分中间测试命令和截图没有逐条落入文档；后续每轮关键修复完成后应即时追加本日志。
- PowerMem 工具当前未在 Codex 会话中暴露；可用后应同步写入“对话优先的信息架构”“项目作为任务/对话容器”“CLI Runtime 事件分流”等长期记忆。

## 2026-07-22：Pi Agent CLI 执行过程展示收口

### 背景

用户在真实测试中发现 Pi Agent CLI 的执行过程存在大量重复思考快照、空参数工具调用和无意义完成记录。对比 Terminal 端同类任务后确认：Pi Agent CLI 的 `thinking` 输出是流式 snapshot，Terminal 更接近“覆盖/折叠当前状态”，而 Agents One 之前把每个 snapshot 当成独立历史事件 append，导致界面噪音。

### 产品判断

- 执行过程不是原始日志面板，应面向用户展示可读、可复查的关键步骤。
- `thinking` 只作为过程摘要，不进入正式对话正文；默认折叠，避免占用主阅读区域。
- 大模型普通回复不算产物；只有文档、代码、diff、测试报告、链接或不可变 artifact 才算产物。
- 空参数工具调用、started/completed 这类无决策价值事件默认隐藏。

### 已完成

- Pi Agent `thinking` snapshot 改为合并/替换逻辑：半截与完整版本只保留最长版本。
- 前端对旧记录也执行去噪：过滤短半句、`Pi 思考：` 前缀、`任务已开始执行`、`任务执行完成`、普通最终回复提示。
- “思考”分组默认折叠，只保留最近 2 条完整摘要。
- `write` 仅展示目标文件路径和写入结果，不再展示“写入 N 个字符”等中间噪音。
- 空参数工具调用（例如 `read: {}`）在主进程不再保存；旧记录展示层也会过滤。
- 保留有效工具过程：List Files、Read File、Write File、Terminal、Search 等按工具分组展示。

### 验证

- `npm.cmd test -- --run tests/agent-runtimes.test.ts src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx`
  - 2 个测试文件通过
  - 18 个用例通过
- `npm.cmd run typecheck`
  - Node 类型检查通过
  - Web 类型检查通过
- 开发版 Agents One 已重启并完成用户截图确认：Pi Agent 过程展示基本达到预期。

### 后续注意

- 如果继续接入新的 CLI 智能体，必须将 provider event stream 分为 `thinking snapshot`、`tool_call`、`tool_result`、`final message` 和 `artifact`，不能全部 append 到对话历史。
- 后续若 PowerMem 工具可用，应同步写入本轮“Pi Agent snapshot 处理策略”和“执行过程展示原则”，便于跨会话召回。
- 发布前仍需用 Hermes、OpenClaw、Codex、Claude Code、Pi Agent 各跑一次连续对话与附件/项目目录回归。

## 2026-07-23：记录丢失问题排查与修复

### 现象

用户反馈之前的项目记录和昨天跟 Hermes 的对话记录再次消失。截图中左侧只剩项目 `test` 下的 Pi 对话，以及少量 Claude/OpenClaw 任务记录。

### 根因

- 远程 Hermes 的正文历史并未全部丢失：本地 `remote-session-cache.json` 中仍有 16 条 `histories`。
- 但同一缓存文件里的 `sessions` 索引被覆盖为空数组，导致左侧列表无法展示这些历史。
- 代码层面原因是 `remoteListCachedSessions(limit, offset)` 会把当前远端返回页直接写回缓存；当远端列表 API 临时返回空、分页返回空、或请求失败时，可能把完整索引覆盖成空/残缺。
- 项目栏此前主要依赖“对话的工作目录分组”，用户刚选择的项目文件夹如果没有稳定注册表，也容易在对话索引异常时看起来像项目消失。

### 已完成修复

- 修改远程会话缓存策略：
  - 空 `sessions` 不再覆盖已有非空索引；
  - 只有第一页且非空的远端列表结果才刷新缓存索引；
  - 当远端列表为空但 `histories` 存在时，从历史正文自动重建侧边栏会话索引；
  - 重建出的索引会写回缓存，避免下次启动继续空列表。
- 对当前开发环境缓存做了一次数据修复：
  - 已备份原文件为 `remote-session-cache.json.bak-*`；
  - 已从 16 条 Hermes 历史正文恢复出 16 条会话索引，包括 `agents one建立新项目测试`、`agents one连接测试` 等记录。
- 新增项目文件夹注册表：
  - 新建/选择项目文件夹后写入 `desktop/project-folders.json`；
  - 侧边栏项目分组会合并“注册项目文件夹”和“已有对话工作目录”；
  - 没有对话的项目文件夹也能稳定显示。

### 回归验证

- `npm.cmd test -- tests/project-folders.test.ts tests/remote-session-cache-recovery.test.ts tests/remote-sessions.test.ts tests/runtime-conversation-store.test.ts`
  - 4 个测试文件通过
  - 19 个用例通过
- `npm.cmd run typecheck`
  - Node 类型检查通过
  - Web 类型检查通过

### 后续注意

- 远程会话缓存必须区分“远端明确删除”和“列表 API 临时空结果”。在没有明确删除信号前，不允许用空列表清空本地索引。
- 项目入口必须有独立持久化来源，不能只依赖某条对话是否仍在列表中。
- 后续如果接入 PowerMem，应同步写入“远程 Hermes 历史正文和会话索引分离，空列表不得覆盖本地缓存”的长期经验。

## 2026-07-23：项目列表启动后闪退修复

### 现象

用户反馈 Agents One 刚启动时项目栏曾短暂显示 3 项项目记录，随后其中 2 项闪一下消失，只剩 `test` 项目。

### 根因

- 左侧项目分组首先根据已缓存的任务/对话工作目录渲染，能读到多项项目。
- 运行时配置加载完成后，前端会再次归一化列表；旧逻辑会把“任务工作目录等于该智能体配置 workspace”的记录视为默认工作区并隐藏。
- 该规则原本用于避免把开发目录误显示为项目，但它会让真实已有记录在二次加载后消失，形成“记录丢失”的错觉。
- 同时，重复会话折叠逻辑此前只按“智能体 + 标题”判断相近记录，没有纳入项目目录，存在跨项目同名任务被误合并的风险。

### 已完成修复

- 取消“工作目录等于 runtime 默认 workspace 就隐藏项目”的自动过滤。
- 已存在任务/对话的 `contextFolder` 一律保留并参与项目分组。
- 项目是否显示不再依赖 runtime 配置加载时机，避免启动时先显示后消失。
- 重复会话折叠键加入项目目录，避免不同项目下同名任务互相吞并。

### 验证

- `npm.cmd run typecheck`
  - Node 类型检查通过
  - Web 类型检查通过
- `npm.cmd test -- tests\project-folders.test.ts tests\runtime-conversation-store.test.ts`
  - 2 个测试文件通过
  - 3 个用例通过

### 后续注意

- 不应通过隐式规则自动隐藏已有项目记录；如果用户认为某个项目是误归类，应后续提供显式的“隐藏项目/移出项目/清理旧记录”操作。
- 新建或选择项目文件夹后仍应写入 `project-folders.json`，项目列表需要同时合并“注册项目”和“已有任务工作目录”两个来源。

## 2026-07-23：远程 Hermes 历史缺少用户消息修复

### 现象

用户发现部分 Hermes 历史对话打开后只有智能体答复、工具过程或思考记录，看不到用户当时发出的消息。

### 根因

- 远程 Dashboard/API 返回的历史并不总是包含完整 user 行；部分旧会话只返回 assistant/reasoning/tool 记录。
- Agents One 前端已有本地 `desktop_session_continuations` overlay，用来保存用户 prompt 和本地流式对话副本。
- 但 `remoteGetSessionMessages` 在远端拉取成功后直接把远端 canonical 历史写入 `remote-session-cache.json`，没有合并本地 overlay，导致本地已保存的用户消息被远端不完整历史覆盖。
- 同 id 会话合并时，`desktop-overlay` 还可能覆盖远端恢复出的 `messageCount`，造成列表元数据不完整。

### 已完成修复

- 远程历史加载成功后，统一调用 `mergeSessionContinuationWithCanonical` 合并本地 overlay，再写入远程缓存。
- 远程拉取失败回退到本地缓存时，也会先合并 overlay，避免继续显示缺 user 的缓存。
- `fillPlaceholderCachedSessionTitles` 改为使用同一合并逻辑，标题优先来自恢复后的用户消息。
- 同 id 的 `desktop-overlay` 与 `remote-cache` 合并时，保留更完整的 `messageCount`、`startedAt` 和非 overlay 来源，避免 overlay 降级远程恢复结果。
- 对当前开发环境执行一次数据修复：
  - 已备份 `remote-session-cache.json` 为 `remote-session-cache.json.bak-user-merge-*`；
  - 已从 SQLite overlay 合并修复 4 条历史，包括 `这是agents one连接测试...`、`文档见附件`、`读取附件中的 Marker...`、儿童床垫研究记录。

### 不可恢复项

本地和远端都没有 user overlay 的极早期旧记录无法准确恢复原始提问。本轮检查剩余 3 条 userless 历史：`从之前的会话看...`、`Hermes U5 第一轮通过。`、`老大好！连接正常...`。后续应在 UI 上标注为“历史缺少原始提问”，但不应伪造用户消息。

### 验证

- `npm.cmd test -- tests\remote-session-cache-recovery.test.ts tests\remote-sessions.test.ts tests\session-continuation-store.test.ts`
  - 3 个测试文件通过
  - 25 个用例通过
- `npm.cmd run typecheck`
  - Node 类型检查通过
  - Web 类型检查通过

### 后续注意

- 远程 Hermes 历史永远不能被视为唯一可信来源；本地 overlay 是恢复用户消息和附件上下文的必要层。
- 任何“同步远端历史后写缓存”的路径，都必须先合并本地 continuation overlay。
- 对真实不可恢复的旧记录，只能做残缺标记或隐藏，不能把 assistant 标题伪造成用户输入。

## 2026-07-23：Runtime 对话输入栏与 Hermes 布局统一

### 现象

用户反馈 Hermes 对话框输入栏与 Pi、Claude Code、Codex 等 Runtime 智能体输入栏不一致；Runtime 输入栏中的项目文件夹名和模型名容易被挤掉或只显示为空图标。

### 根因

- Hermes 对话页使用完整的 `ModelPicker + ContextFolderChip` 控件组合。
- Runtime 对话页此前手写了一套简化工具栏：项目目录只显示文件夹图标，且没有复用最近文件夹、目录名、省略和清除逻辑。
- Runtime 页面没有把 `runtime.config.workspace` 初始化到输入栏状态，导致已有默认工作目录参与任务执行，但 UI 上看不到目录名。
- 权限芯片文案较长，占用了输入栏工具区宽度，进一步压缩模型和文件夹显示空间。

### 已完成修复

- Runtime 对话页复用 `ContextFolderChip`，本地 Codex、Claude Code、Pi Agent 的项目目录显示方式与 Hermes 保持一致。
- Runtime 工作目录初始化改为优先使用 `initialWorkspace`，其次使用 `runtime.config.workspace`，保证配置中的项目目录能在输入栏显示。
- Runtime 模型显示改为统一的 `chat-model-trigger` 芯片，配置了模型时显示模型名，未配置时显示“默认模型”。
- 权限控件保留，但压缩为“只读 / 完全访问”的短标签，避免挤占模型和项目目录显示。
- `ContextFolderChip` 增加 API 兜底和无障碍名称，旧测试环境或未暴露最近文件夹 API 时不会报错。

### 验证

- `npm.cmd run typecheck`
  - Node 类型检查通过
  - Web 类型检查通过
- `npm.cmd test -- src\renderer\src\screens\RuntimeChat\RuntimeChat.test.tsx`
  - 1 个测试文件通过
  - 7 个用例通过

### 后续注意

- 后续新增智能体的新对话输入栏应默认复用 Hermes 的输入栏控件组合，不再为单个 Runtime 手写一套独立布局。
- 如果某个 CLI Runtime 无法探测真实模型，只能显示“默认模型”或配置中的模型覆盖值；后续可在 Runtime probe 中增加模型发现能力。

## 2026-07-23：Pi Agent 默认接入与侧边栏智能体外观恢复

### 现象

用户反馈输入栏统一后，之前接入的 Pi Agent CLI 从“智能体协作/可参与协作的智能体”列表里消失；项目和任务记录中的智能体名称、头像也退回成通用机器人或旧名称。

### 根因

- 当前 `desktop.json` 的 `agentRuntimes` 只剩 Codex、OpenClaw、Claude Code，Pi 的用户配置已不在本地 runtime 配置中。
- 主进程此前只内置 Hermes，其余智能体完全依赖用户配置；Pi 配置缺失时，虽然代码支持 `kind: "pi"`，但 UI 不会再列出 Pi。
- 侧边栏历史记录只按 `runtimeId` 命中当前 runtime 外观；一旦旧记录的 id/name 与当前配置不一致，就会错误回退到 Hermes 外观，导致原智能体名称和头像丢失。
- 内置远程 Hermes 的默认展示名仍是 `Remote Hermes`，而运行位置已经由副标题单独展示，列表里会显得像旧英文名称。

### 已完成修复

- 新增内置 Pi Agent CLI runtime：
  - id：`pi`
  - name：`Pi`
  - kind：`pi`
  - location：`local`
  - executable：`pi`
  - 默认紫色标识
- 如果用户后续自己配置了任意 Pi runtime，则优先使用用户配置，不重复插入内置 Pi。
- 内置 Hermes 展示名统一为 `Hermes`，远程/本地位置继续通过副标题展示。
- 侧边栏智能体外观解析改为多级匹配：
  - 优先按 `runtimeId` 匹配；
  - 再按 `runtimeName` 匹配；
  - 再按 `runtimeKind` 匹配；
  - 只有真正缺少 runtime 信息或 Hermes 会话才回退 Hermes 外观。
- 这次修改不删除、不迁移已有项目、任务或对话记录；只是修复运行时列表与历史记录的显示解析。

### 验证

- `npm.cmd run typecheck`
  - Node 类型检查通过
  - Web 类型检查通过
- `npm.cmd test -- tests\agent-runtimes.test.ts src\renderer\src\screens\RuntimeChat\RuntimeChat.test.tsx`
  - 2 个测试文件通过
  - 18 个用例通过

### 后续注意

- 运行时接入配置和显示外观要分离：配置缺失不能导致历史记录丢失，外观缺失时应尽量从 id/name/kind 推断。
- 用户重新给智能体设置头像和名称后，项目/任务列表必须立即使用当前 runtime appearance，而不是保留历史旧名称。
- Pi Agent 作为本地 CLI 智能体应和 Codex、Claude Code 一样保留在默认可接入智能体集合中，避免配置文件意外缺项后从 UI 消失。

### 追加修正

用户复测发现 Pi 虽然重新出现在列表中，但显示为“不可达”，且智能体接入设置页里的 Pi 字段不可编辑。

根因是第一次补救把 Pi 当成 `managed: builtin` 的内置项插入，并使用裸命令 `pi` 作为可执行文件。Windows/Electron 子进程环境下裸命令解析不如 PowerShell 稳定，测试机真实可执行入口是 `<portable-node>\pi.cmd`；同时 builtin 状态会让设置页禁用类型、位置、可执行文件、工作区等字段。

已修正：

- Pi 默认项改为 `managed: user`，因此接入设置页可编辑名称、图标、类型、位置、可执行文件、工作区、模型覆盖、超时和启用状态。
- 默认 Pi 可执行文件改为按 Windows PATH 探测 `pi.cmd`，测试机解析为 `<portable-node>\pi.cmd`。
- 如果用户已有自定义 Pi runtime，则继续优先使用用户配置，不插入默认 Pi。
- 用主进程 `probeAgentRuntime("pi")` 实测通过，返回健康状态和版本 `0.81.1`。

验证：

- `npm.cmd run typecheck` 通过。

## 2026-07-26：协作任务改为“原任务对话 + 角色分工”启动

### 产品决策

- 多智能体协作属于按需能力，不能另起一套孤立的对话、项目或历史存储。
- 从项目加号创建“新建多智能体协作任务”，或将现有任务转换为协作任务后，首屏直接显示“角色设置 + 任务说明”面板：上半部分配置项目负责人、实施、测试和可选复核角色；下半部分输入首条任务说明。
- 用户点击“发送并启动”后，任务说明仍通过原有正式任务对话的发送逻辑写入同一会话。角色配置作为该任务的独立协作元数据保存，不迁移、不重写 Runtime 注册表、项目记录或对话历史。

### 已完成调整

- 角色配置增加“角色、智能体、职责、共享上下文”四列；默认提供项目负责人、实施、测试，可按需增加复核。
- 首条协作说明复用现有 Hermes/Runtime 对话的发送与持久化链路：既有标题生成、会话 ID、项目文件夹上下文、历史恢复和错误处理均不复制实现。
- 协作元数据新增 `responsibility`、`context` 和显式启动状态，仅保存在独立的 `task-collaborations.json` 中；历史任务即使没有这些字段也可兼容读取。
- 原协作进度看板不再在创建后抢占任务界面；它仅作为启动后由对话侧栏进入的补充查看入口。

### 当前边界与下一步

- 当前版本已完成“角色设置 + 首条共享任务说明 + 原任务会话持久化”。首条说明由当前任务对话所绑定的智能体执行，角色分工不会自动派发或自动合并。
- 要让多个 Runtime 真正以不同头像/名称在同一个任务时间线中回复，需要新增受控协作调度层：统一消息归档、共享上下文快照、逐角色派发/取消、跨 Runtime 结果回写和人工确认。这必须独立实现并做端到端回归，不能通过修改现有单智能体会话存储来“硬接”。

### 回归验证

- `npm.cmd test -- TaskCollaborationDialog.test.tsx TaskCollaborationWorkspace.test.tsx ConversationSidePanel.test.tsx`：3 个测试文件、10 个用例通过。
- `npm.cmd run typecheck` 通过。
- `npm.cmd test -- tests\agent-runtimes.test.ts tests\pi-runtime.test.ts src\renderer\src\components\settings\AgentRuntimesPane.test.tsx` 通过，22 个用例通过。

## 2026-07-24：移除“智能体协作”页的本地 Hermes 档案兼容区

### 决策

“本地 Hermes 档案（兼容）”是 Hermes Desktop 时代的遗留管理界面。Agents One 当前以已接入 Runtime 为统一智能体入口，远程 Hermes 和本地 CLI 智能体均在同一列表中管理；继续在协作页展示未配置的 `default` 本地档案会造成重复入口和误导。

### 已完成调整

- 从“智能体协作”页面移除了本地 Hermes 档案的加载、创建、切换、编辑和表格渲染。
- 移除了只服务于该表格的页面样式与测试桩；协作页现在只展示已接入智能体、外观编辑、对话入口和项目协作入口。
- 移除了 Layout 中仅由该旧表格调用的 UI 回调。
- 保留主进程的 Hermes profile 存储、兼容 IPC 和历史恢复逻辑，不迁移、不删除任何本地档案数据，也不影响远程 Hermes 配置。

### 回归验证

- `Agents.test.tsx` 新增断言：协作页只加载 Runtime，不展示“本地 Hermes 档案（兼容）”或“新建本地档案”。
- Runtime 外观编辑测试继续保留。
- 完整 TypeScript 类型检查和差异检查在本次修改后执行。

### 后续边界

- 不再把 local profile 作为 Agents One 的主要产品功能暴露。
- 如未来确实需要导入旧 Hermes profile，应单独设计“旧数据导入/迁移”流程，而不是恢复旧档案管理页面。

## 2026-07-24：移除首次安装启动门槛

### 问题

桌面快捷方式启动时，旧 Hermes Desktop 的本地安装检测可能把已配置的 Agents One 导向“Welcome / Get Started”首次安装页。该页面会要求安装本地组件，与 Agents One 的远程及多 Runtime 聚合模式不匹配，也会让用户误以为已有数据或接入配置丢失。

### 已完成调整

- 启动路由现在只保留“启动页 → 主界面”。
- 移除了启动阶段对 `checkInstall`、`verifyInstall`、Welcome、Install、Setup 的页面跳转依赖。
- SSH 连接仍会在启动阶段尝试建立隧道；连接或配置读取异常仅写入诊断日志，不再阻止进入主界面。
- 移除了 Layout 中“重新安装”警告横幅的入口；未接入智能体时应通过“设置 → 智能体接入”完成配置。

### 验证

- `npm.cmd run typecheck` 通过。
- `npm.cmd test -- src\\renderer\\src\\screens\\Agents\\Agents.test.tsx src\\renderer\\src\\screens\\Layout\\ActiveSessionsBar.test.tsx` 通过，6 个用例通过。

## 2026-07-24：智能体统一管理入口与安全接入流程

### 产品调整

- 左侧导航“智能体协作”统一更名为“智能体”，作为已接入智能体的主入口。
- 管理页按“本地智能体 / 远程智能体”分组展示，移除了协作页中的说明性文案、旧的项目协作入口和重复的本地 Hermes 档案区。
- 卡片操作调整为“管理”和“任务对话”：
  - “管理”打开当前智能体的统一接入管理页；用户 Runtime 可保存配置或移除注册，移除不会删除项目、任务、对话或聊天历史。
  - “任务对话”改为创建正式任务对话，不再错误打开右下角的轻量聊天窗口。

### 接入与连接

- “新增智能体”使用统一 Runtime 表单：名称、头像、颜色、ID、类型、位置、连接方式、远程地址或本地 CLI/工作区均可配置。
- 新增 Runtime 采用“连接测试 → 保存”两阶段流程：测试使用临时草稿，不会提前写入 `desktop.json`；仅在测试健康且测试内容未变化时允许保存。
- OpenClaw 的 Bearer Token 仅在受保护凭据存储中保存；草稿测试时 Token 只用于该次请求，不写入 Runtime 定义或日志。
- 原“设置 → 智能体接入”入口已移除；原“设置 → 连接”的 Hermes 远程/本地/SSH 配置复用原有受保护存储，并嵌入到内置 Hermes 的“管理智能体”页面，避免产生第二套连接配置。

### 实现边界

- 继续使用既有 `agentRuntimes`、外观覆盖、Hermes 连接和受保护凭据存储；本次只调整入口与调用关系，不迁移、不清空、不重置已有接入信息。
- 新增 `probeAgentRuntimeDraft` IPC：主进程基于草稿进行探测，未持久化的凭据不会返回给 Renderer，也不会被记录。
- 删除 Runtime 仅从 Runtime 清单取消注册；历史记录仍按已持久化的 runtimeId/name/kind 显示。

### 验证

- `npm.cmd run typecheck` 通过。
- `npm.cmd test -- tests\\agent-runtimes.test.ts src\\renderer\\src\\screens\\Agents\\Agents.test.tsx src\\renderer\\src\\components\\settings\\AgentRuntimesPane.test.tsx` 通过，3 个测试文件、19 个用例全部通过；覆盖草稿探测不会写入 Runtime 注册表。
- `git diff --check` 无空白错误；现有工作树的 CRLF 提示为历史文件行尾提示，不代表本次差异错误。

## 2026-07-25：修复正式启动误入测试沙箱导致的“数据丢失”假象

### 现象与根因

- 用户通过桌面“启动 Agents One”快捷方式启动后，界面仅显示本地 Hermes、Pi 和少量测试项目/任务；远程 Hermes、Codex、OpenClaw、Claude Code 及大量历史记录看似消失。
- 排查确认正式数据没有被删除：`%LOCALAPPDATA%\hermes\desktop.json` 仍保存远程 Hermes 配置以及 `codex`、`openclaw-remote`、`claude-code`、`pi` 四个用户 Runtime 和外观覆盖；正式历史仍位于该目录的 `desktop` 存储中。
- 根因是桌面启动脚本错误调用 `scripts/hermes-sandbox.ps1 dev`。该脚本为自动化测试而设计，必然把 `HERMES_HOME` 指向项目 `.sandbox\hermes-home`，并把 Electron 用户目录指向 `.sandbox\electron-user-data`，因此加载的是隔离测试数据而不是用户正式数据。

### 已修复

- `scripts/launch-agents-one.ps1` 改为使用正式 `npm run dev` 启动，不再调用沙箱脚本。
- 启动时明确设置 `HERMES_HOME=%LOCALAPPDATA%\hermes`，并清除所有 `HERMES_DESKTOP_SANDBOX`、`HERMES_DESKTOP_USER_DATA_DIR` 与沙箱端口环境变量。
- 正式启动日志转存到项目 `.agents-one\launcher`，避免与测试沙箱日志混用。
- 沙箱脚本仍保留，但仅允许通过 `npm run dev:sandbox` 或自动化测试显式调用，不能再作为用户桌面入口。

### 恢复验收

- 重启后的 Electron 已使用正式用户目录 `%APPDATA%\agents-one`，不再使用项目 `.sandbox` 目录。
- 通过 CDP 只读验收确认：智能体页同时显示 Codex、Claude、Pi、远程 Hermes、OpenClaw；左侧恢复正式项目和任务历史。
- 远程 Dashboard 当前的 `502 Bad Gateway` 会记入运行诊断，但不影响本地 Runtime 注册表、项目或历史读取，也不会再触发首次安装/本地 Hermes 降级界面。

## 2026-07-25：补齐自定义远程 Hermes 的 API 密钥接入

### 问题与边界

- “新增智能体”表单中，自定义远程 Hermes 仅有服务器地址，缺少与内置 Hermes 管理页一致的“API 密钥”输入；OpenClaw 已有单独的 Bridge Token 输入。
- 不能把远程密钥放入 `agentRuntimes` 或 `desktop.json`，也不能让自定义 Hermes 在探测失败时回退使用默认 Hermes 的全局密钥，否则会造成凭据串用和误报健康。

### 已完成调整

- 自定义远程 Hermes 表单现显示“远程服务器地址”和“API 密钥”；既有 OpenClaw 保持“服务地址”和“Bridge Token”。
- 自定义 Hermes 的 API 密钥与 OpenClaw Token 一样进入受保护凭据存储，Runtime 定义、普通配置和日志均不保存明文。
- 连接测试只临时使用当前表单密钥；保存后，后续探测和远程调用读取该 Runtime 自己的受保护密钥。
- 内置 Hermes 仍继续使用原有“连接”配置的 API 密钥，未迁移或改写既有远程配置。
- 自定义 Hermes 端点探测失败时不再回退默认 Hermes 连接，避免把错误的端点显示为健康。
- 智能体卡片“任务对话”文案收敛为“对话”；点击行为不变，仍创建正式任务对话，不会打开轻量聊天窗口。

### 验证

- `npm.cmd test -- tests/agent-runtimes.test.ts src/renderer/src/components/settings/AgentRuntimesPane.test.tsx src/renderer/src/screens/Agents/Agents.test.tsx` 通过：3 个测试文件、21 个用例。
- `npm.cmd run typecheck` 通过。
- 测试覆盖自定义远程 Hermes：临时 API 密钥参与连接测试与受保护存储，但不会进入保存的 Runtime 定义。

## 2026-07-26：多智能体协作任务改为“原任务对话 + 自定义分工”

### 产品约束

- 协作任务不是独立的项目管理页面，而是在原任务对话上增加协作分工；单智能体任务保持默认路径不变。
- 角色、承担智能体、职责和共享上下文均为任务级数据，用户可逐行新增、编辑和移除，不再限定“负责人/实施/测试/复核”四个预设角色。
- 协作设置完成后，原任务对话顶部显示默认折叠的“协作分工”区；展开可回查角色、智能体、职责和共享上下文。

### 已完成实现

- `TaskCollaborationAssignment.role` 已从固定枚举调整为受长度限制的自定义字符串；协作存储同时支持旧记录，并为新角色行保存稳定 id。
- 协作设置面板保留三个可编辑的常用初始行，但不限制角色名称；支持“添加角色”和逐行移除。
- 智能体选择行会同步显示该 Runtime 已配置的头像、名称与颜色，提升跨智能体辨识度。
- 点击“发送并启动”后，用户可见的任务消息保持原文；平台为每个已选择 Runtime 分发同一份受控协作提示，其中包含完整角色表、各自职责、共享上下文、关联项目目录和任务说明。
- 非当前 Runtime 的结果会以该智能体的头像、名称和角色标识汇入同一个 Runtime 任务对话。提示中明确要求智能体不要用未登记的 subagent 取代平台已分配角色。

### 安全与边界

- 仅向用户在角色行中明确选定的智能体派发；“暂不指定”的行不会运行。
- 分发沿用当前任务的只读/完全访问权限与项目目录，未扩大已有 Runtime 权限。
- 首版只在协作任务启动时做一次并列分发；后续跨角色自动追问、依赖编排、取消汇总和结果验收仍需要下一轮专门实现，不能假装已经具备自动项目经理能力。

### 回归验证

- `npm.cmd test -- TaskCollaborationDialog.test.tsx RuntimeChat.test.tsx` 通过，9 个用例。
- `npm.cmd run typecheck` 通过。

## 2026-07-26：协作任务实测诊断（待进入协作编排 Phase 2）

### 实测任务

- 项目目录：`<workspace-root>\test`
- 任务：`协作测试`
- 分工：Pi（项目负责人/验收）、Claude（实施）、Hermes（测试）。

### 已确认问题

- Pi 会话收到完整分工提示，但 Claude、Hermes 没有收到同一任务说明；本次实际只运行了 Pi。
- Pi 在首轮正确说明“平台未实际派发”且自身仅有只读工具；用户后续发送“批准，请落地交付”后，Pi 将其理解为可代替实施与测试角色执行，因此自行写入、测试并验收，产生了“报告显示多人完成、实际单人完成”的假闭环。
- 本次协作配置在 `task-collaborations.json` 中被写成两个记录（`runtime-conv-*` 与实际 Pi session），且两个记录的 `assignments` 都为空；运行时提示拥有正确分工，但配置无法恢复、无法展示角色状态，也不能作为后续阶段的可信来源。
- 当前实现是启动时并列 fan-out，没有子任务记录、依赖关系、产物交接、阶段门禁或跨角色结果回灌；即使分发成功，测试和验收也无法可靠等待实施产物。

### 后续改造原则

- 协作配置必须先以唯一父任务 ID 原子保存，再启动任何 Runtime；空分工不得覆盖已有非空分工，运行 session 只能作为关联字段而不能创建第二份协作记录。
- 每个角色必须生成可追踪的子运行记录，明确状态、输入、预期输出、日志、产物和失败原因；父任务仅在必要角色达到相应阶段后才推进。
- 初版采用受控顺序：负责人规划 -> 实施交付 -> 测试复核 -> 验收结论。只有在用户显式配置为并行时，才允许并列执行。
- 平台而非协调智能体负责派发、上下文封包、产物交接与状态门禁；协调智能体不得把未收到的他人结果表述为已完成，也不得以自身工作替代已登记角色。

## 2026-07-26：协作编排 Phase 1/2 实施完成

### 修复目标

- 消除同一协作任务被会话 ID、对话 ID 重复保存为多条记录的风险。
- 让用户设定的角色分工变成平台真实执行的依赖链，而不是仅写在首条提示词里的说明。

### 已完成实现

- `task-collaborations.json` 现在以任务 `taskId` 作为唯一父记录；Runtime 对话 ID 与 Hermes session ID 只作为该父记录的关联字段，不再创建第二条协作记录。
- 存储层禁止“空角色数组”覆盖已经保存的非空角色配置；未配置任何执行智能体的协作任务不能进入 `active` 状态。
- 每个已分配角色都会保存平台生成的执行记录：角色、Runtime、启动/完成时间、Runtime run ID、真实交接摘要、失败原因和阻塞状态。
- 首版调度采用严格串行门禁：按用户配置顺序运行。前一角色成功后，平台把其真实输出作为限定长度的交接材料发送给下一角色；中间角色失败、不可用或取消时，未开始角色标记为“已阻塞”，不会被静默跳过或由其他智能体代办。
- 协作提示明确禁止角色越权、虚构其他角色完成状态和创建未登记 subagent；仅职责包含实施/开发/交付等语义的角色，在用户选择“完全访问”时才获得写入权限，其余角色保持只读。
- 原任务对话顶部的默认折叠“协作分工”区会显示每个角色的 `待执行 / 执行中 / 已交接 / 失败 / 已阻塞` 状态；所有角色消息仍汇入同一任务时间线并保留智能体头像、名称和角色。

### 自动化验证

- 新增 `tests/task-collaboration-store.test.ts`：覆盖空配置保护、唯一父任务关联和无执行智能体时拒绝启动。
- 扩展 `RuntimeChat.test.tsx`：覆盖三个 Runtime 的严格启动顺序、真实交接材料传递，以及中间角色失败后阻止后续角色派发。
- `npm.cmd run typecheck` 通过。
- `npm.cmd test -- --run tests/task-collaboration-store.test.ts src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx` 通过：2 个测试文件、12 个用例。

### 仍需真实联调的边界

- 旧的“test / 协作测试”历史记录当时已将角色配置保存为空，无法安全地从 Pi 的自然语言回复反向推断职责；历史不删除，但需重新配置角色后再运行。
- 当前是安全的串行 MVP；并行依赖图、人工批准后继续、跨 Runtime 取消汇总、统一产物提取和正式验收看板属于下一阶段，不能被视为已完成。

### 全量回归基线

- `npm.cmd test -- --run`：1,848 个用例中 1,831 个通过、13 个跳过、4 个失败。
- 失败项均不属于本次协作编排改动：两项断言仍使用未包含 Pi Agent CLI 的旧文案（`project-control`、`task-schedules`）；一项计划任务页面测试仍期待旧标题；一项 Gateway 重启测试在 50ms 健康检查窗口内超时，属于既有时序不稳定项。
- 本次新增的协作存储与顺序编排定向测试全部通过；后续处理上述基线失败时，应作为独立、最小范围的修复任务，避免与协作功能混改。

## 2026-07-27：协作编排 Phase 3 - 人工介入与安全恢复

### 交互原则

- 人工介入绑定到单一角色，不作为普通任务消息广播；用户必须显式选择“同步给协作组”，后续角色才能看到该指令。
- 角色无法执行、方向偏差或需要额外资料时，协作不会伪装完成，而是停在“等待人工处理”。后续角色保持阻塞，直到用户明确恢复。

### 已完成实现

- 协作执行记录新增 `waiting_for_user`、`paused`、`retrying`、`needs_review`、`cancelled` 等角色级状态，以及任务级等待/暂停/取消状态。
- 每条人工指令持久化保存目标角色、内容、可见范围和时间；原始任务说明也保存于协作执行记录，支持重启应用后安全恢复。
- 原任务对话顶部的折叠“协作分工”区为每个角色提供“介入”入口；抽屉内可查看该角色最近的私有指令、保存新的修正要求、选择是否同步给协作组，并在适用时“保存并继续”。
- 对运行中的角色可执行“暂停此角色”；平台停止该 Runtime 后把角色转为已暂停，而非把它误判为失败或完成。
- 从等待/暂停角色恢复时，平台只从该角色重新派发，并携带此前成功角色的真实交接、该角色私有指令及用户明确共享的指令；后续角色仍须等待新的真实交接。

### 回归验证

- `npm.cmd test -- --run tests/task-collaboration-store.test.ts src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx`：2 个文件、13 个用例通过。
- 新增用例验证：私有人工指令仅传给目标实施角色，恢复后平台依次运行实施、测试；测试角色不会收到该私有指令。

## 2026-07-27：协作编排 Phase 4 - 真实产物归集与验收

### 产物口径

- 普通模型答复、思考过程和“任务已完成”等状态文本不再被当作产物。
- 平台只归集 Runtime 明确提供的工作目录、代码差异，以及工具事件中具有测试语义的真实执行结果；分别记录为文件、代码变更和测试结果。
- 每项产物都绑定来源角色、Runtime、运行记录和时间。存储层会校验角色归属、产物类型和引用 id，防止一个角色伪造另一个角色的交付物。

### 已完成实现

- 协作执行记录新增 `artifacts` 和 `acceptance`；历史记录兼容读取，新的记录可在应用重启后恢复。
- 原任务对话的协作分工区域下新增默认折叠的“产物与验收”区，集中展示真实文件、代码差异、测试结果及验收结论。
- 验收角色会收到平台整理的可追溯证据编号，而不是未经核实的上游自然语言摘要。
- 验收回复必须使用结构化格式并引用实际证据，例如 `状态：通过` 与 `依据：#1、#2`。缺少验收角色、结论格式或真实证据时，任务会停在“需人工复核”，不会伪装为成功。

### 自动化验证

- 新增协作用例：Codex 生成 worktree 与 diff、Claude Code 返回测试结果、验收角色引用实际 `#1/#2/#3` 后才可通过。
- 存储回归用例验证：无效产物类型、伪造引用会被过滤；重新加载存储后真实产物和验收结论仍存在。

## 2026-07-27：协作编排 Phase 5 - 联调与可靠性回归

### 覆盖范围

- 覆盖 Hermes、OpenClaw Bridge、Pi Agent CLI、Codex CLI、Claude Code CLI 的 Runtime 探测、任务启动、输出归档、取消、超时、失败和历史恢复契约。
- 协作层覆盖成功交接、实施角色超时后下游阻塞、人工介入后恢复、取消和重启后读取协作配置/产物/验收记录。
- 所有涉及外部服务的自动化测试均使用受控 Bridge/Runtime 模拟，不向用户已有项目目录或远程服务器派发写入任务；本地 `codex`、`claude`、`pi` CLI 已确认可解析，版本分别为 `0.144.1`、`2.1.209`、`0.82.1`。

### 本轮修复

- 将项目控制面和定时任务的测试契约更新为当前真实能力：实现型任务支持 Codex、Claude Code 与 Pi Agent CLI。
- 将定时任务页面测试标题更新为“本地智能体定时任务”和“远程 Hermes 定时任务”。仅更新过时断言，未改动 Runtime、历史、连接或凭据配置。
- 全量并发运行时，部分带临时目录/模拟网关的旧用例会相互争用并超时；串行运行后全部通过。因此未为测试噪声放宽产品超时或修改网关逻辑。

### 验收结果

- 定向跨 Runtime 契约：10 个测试文件、97 项通过。
- 产物与协作交互定向回归：2 个测试文件、16 项通过。
- 串行全量回归：`npm.cmd test -- --no-file-parallelism --maxWorkers 1`，186 个测试文件、1,839 项通过、13 项按设计跳过。
- `npm.cmd run typecheck` 通过；`npm.cmd run build` 通过。

### 明早手工验收建议

- 新建含实施、测试、验收三个角色的协作任务，确认“产物与验收”默认折叠、仅显示真实文件/差异/测试结果，验收角色需引用证据才能通过。
- 分别让 Hermes、Pi、Codex、Claude Code 执行一轮受控任务；对其中一个角色触发超时或暂停，确认后续角色阻塞且仅通过“介入”恢复。
- 重启应用并重新打开任务，确认角色配置、运行状态、产物与验收结论完整恢复。

## 2026-07-27：协作编排补强 - 权限恢复与无产物门禁

### 用户实测触发的问题

- Claude Code 在协作实施角色中以 `plan` 模式运行时无法编辑，但原“介入”抽屉只能追加文字，不能改变该角色实际的 CLI 权限；用户无法在原任务内纠正后继续。
- 编排器此前把 Runtime 的成功退出视作可交接，实施角色即使没有生成任何可核验文件或代码变更，测试角色仍可能继续执行，形成“无产物测试”。

### 本次最小范围修复

- 人工介入记录新增可持久化的、角色级 `只读 / 完全访问` 覆盖。实施类角色在介入抽屉中可选择权限后“保存并继续”；该覆盖只作用于目标角色，后续角色不会继承。Claude Code 的完全访问重试将使用其 CLI 的 `acceptEdits` 权限模式。
- 实施/开发/交付类角色成功返回后，平台现在必须先收到 Runtime 发布的实际文件或代码变更证据。没有证据时，该角色转为“等待人工处理”，后续角色标记为“已阻塞”，不会再启动测试或验收。
- Claude Code 的本地完全访问任务新增有界工作目录快照：运行前后仅比较常见项目文件（排除 `.git`、`node_modules`、构建目录等），只有检测到新增或修改文件时才发布“已写入文件”证据；模型文字声称完成不会被当成产物。

### 自动化验证

- `npm.cmd run typecheck` 通过。
- `npm.cmd test -- --run src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx tests/claude-code-runtime.test.ts tests/task-collaboration-store.test.ts` 通过：3 个测试文件、25 个用例。
- 新增断言覆盖：实施角色无真实产物时测试角色不启动；人工介入选择“完全访问”后，目标角色以 `full_access` 重新派发且仅该角色收到私有指令。

## 2026-07-27：协作入口收敛为任务内按需能力

## 2026-07-27：协作建议必须经过平台真实派发

- 排查“多智能体协作新测试”：该对话仅有 Pi 的普通 Runtime 记录，没有对应的协作记录或角色运行。Pi 在终端内自行调用其他 CLI，属于单智能体模拟协作，不能作为 Claude、Hermes 已执行的证据。
- 普通任务 Runtime 增加协作协议：需要协作时只能输出受控的结构化建议，禁止把 Shell/CLI 子进程伪装为已接入智能体协作。
- 客户端解析建议并显示“配置并启动协作”；用户仍可编辑角色、上下文和任务说明后确认。确认后沿用既有平台调度链，真实启动各 Runtime 并将每个角色的过程、答复、产物写回同一任务对话。
- 安全边界：模型文本从不自动启动协作；没有用户确认，不会创建协作运行记录或派发任何其他智能体。

### 产品决策

- Agents One 保持“对话优先”：普通任务始终是默认入口，项目只是任务对话的容器。
- 多智能体协作是少数、按需启用的执行能力，不再作为一种单独的新建任务类型，也不再通过任务右键菜单强行转换。
- 主智能体后续可以在任务对话中提出协作与分工建议；用户确认后才建立协作配置并调度其他已接入智能体。用户也可以主动从当前任务开启“协作方案”。

### 已完成实现

- 左侧项目 `+` 菜单仅保留“新建任务”；已移除“新建多智能体协作任务”。
- 任务右键菜单已移除“转为多智能体协作”，避免误将已有单智能体任务改造成协作流程。
- Hermes 及所有 Runtime 任务对话的输入工具栏新增“制定协作方案”按钮。它只打开现有的角色/智能体/职责/共享上下文配置面板，不会改动 Runtime 注册、连接配置、历史记录或项目归属。
- 用户在配置面板中确认角色并发送任务说明后，现有协作持久化与执行链路才会启用；取消面板则不会写入协作记录。
- 对已经存在的任务，协作设置保存成功后会立即同步写回当前对话的协作元数据，确保首条协作任务说明派发后，任务内的协作角色区能够正常显示。

### 回归验证

- `npm.cmd run typecheck` 通过。
- `npm.cmd test -- --run src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx src/renderer/src/screens/Layout/TaskCollaborationDialog.test.tsx` 通过：2 个测试文件、16 个用例。
- `npm.cmd run build` 通过。
- 新增断言覆盖：协作方案只能由当前任务中的用户显式点击打开。

### 后续实施边界

- 本轮只调整入口和交互边界，刻意不修改智能体注册、凭据、项目/任务存储或 Runtime 执行器。
- “主智能体自动提出结构化协作方案、用户确认后按图调度常驻智能体”是下一步编排层能力，应在独立任务中实现，并增加提案校验、用户确认和失败回退测试。

## 2026-07-27：真实协作复盘 - 跨机器工作区与角色身份

### 实测结论

- “多智能体协作新测试2”已由平台真实串行派发：Pi 负责拆分与终验、Claude Code 负责实施、远程 Hermes 负责验收。三个角色均有独立 `runtimeRunId`、运行时间、交接文本和 Runtime 事件；这不是 Pi 在终端内模拟调用其他 CLI。
- 远程 Hermes 对办公电脑本地目录 `<workspace-root>\test` 进行验收时，实际落在远程机器自身的同名路径并得到空目录。Claude 的本地写入与 Hermes 的远程验收没有共享同一个文件系统，最终“不通过”是正确且有价值的验收结果。

### 已修复

- Runtime 对话存储此前在清洗消息时遗漏了 `agentRuntimeId`、名称、头像、颜色和协作角色字段；协作消息重开后会退化为主智能体身份。现已保留这些字段，后续新协作任务会稳定显示各角色自己的名称与头像。
- 验收角色明确输出“不通过”时，协作总状态此前仍会被标记为“成功”。现已改为 `failed`，确保筛选、恢复和后续自动化不会误判任务完成。

### 待实施的最高优先级

1. **工作区可达性预检**：协作启动前逐角色标明“本地直连、远程映射、仅证据包”三种工作区访问方式；远程角色若无法访问项目路径，不允许被分派“独立文件系统验收”。
2. **可验证交接契约**：实施角色的交付除 Runtime 文件/差异证据外，增加路径、摘要、哈希和来源机器；测试角色只能验收同一可达工作区或平台生成的只读证据包。
3. **失败恢复闭环**：验收失败时在“产物与验收”中直接列出失败原因、责任角色与可执行操作（重派实施、改派本地验收、人工介入），而不是仅显示一段结论文本。
4. **协作时间线**：在折叠的协作区以 Pi → Claude → Hermes 的顺序展示开始、交接、产物、验收和阻断点，并可定位到对应角色消息，减少用户在长对话中查找的成本。

### 自动化验证

- `npm.cmd test -- --run src/main/runtime-conversation-store.test.ts src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx`：2 个测试文件、16 项通过。
- `npm.cmd run typecheck` 通过。

## 2026-07-27：协作可靠性闭环 - 可达性、证据、恢复与时间线

### 本轮目标

- 将“运行成功”与“可交接、可验收”明确拆开：跨机器工作区不可达、实施未发布可验证交付、验收引用不足时，平台必须阻断后续阶段。
- 保持对话优先和现有 Runtime 注册、历史记录、项目存储不变；改动限定在协作编排、协作元数据与协作视图。

### 已完成

- 协作角色增加工作区访问声明：`本地直连`、`远程映射`、`只读证据包`。启动前逐角色预检：远程角色不能直接使用本地路径；选“远程映射”但未提供映射路径、或实施角色只拿到证据包时，任务会在派发前进入“等待人工处理”，并给出改派本地角色或配置映射的原因。
- 协调/主负责角色在全部角色之后自动执行一次“终验汇总”。该运行只能基于实施交付和验收结论作结论，不允许自行补做其他角色的工作。
- 实施角色提示词新增交付契约，要求发布文件路径、SHA-256、来源机器与变更摘要。平台从运行输出和真实 Runtime 文件/差异中归集证据；验收角色若无法引用完整交付证据，不能得到“通过”结论。
- 验收失败面板新增三个恢复入口：`重派实施`、`改派验收`、`介入并继续`。改派验收会保留已完成实施/测试记录，仅重新运行验收及其后的终验汇总；不应继续的下游阶段保持阻断。
- 协作视图新增可折叠时间线，按预检、启动、交接、产物、验收、阻断和恢复记录事件。点击事件可滚动定位到对应角色在同一任务对话中的原始答复和工具记录。
- 运行消息增加协作角色标识持久化，重开任务时仍可被时间线精确定位。

### 自动化验证

- `npm.cmd test -- --run src/renderer/src/screens/RuntimeChat/RuntimeChat.test.tsx src/main/runtime-conversation-store.test.ts src/renderer/src/screens/Layout/TaskCollaborationDialog.test.tsx`：3 个测试文件、20 项通过。
- 新增覆盖：远程实施角色仅有只读证据包时不派发；指定主负责角色会在实施和验收之后执行终验汇总。
- `npm.cmd run typecheck` 通过。
- `npm.cmd run build` 通过。

### 下一轮手工验收建议

1. 在本地项目中设置 Pi 为主负责、Claude Code 为实施、Hermes 为验收。Claude 使用“本地直连”，Hermes 先选择“只读证据包”；确认 Hermes 不会被错误派发本地路径验收，并收到改派或共享访问提示。
2. 让 Claude 生成一个真实文件，确认交付区显示路径、哈希、来源机器和变更摘要；再让验收角色引用该证据给出结论。
3. 制造一次验收不通过，分别验证“重派实施”“改派验收”“介入并继续”只影响目标阶段，且时间线能跳回各角色的原始记录。

### 2026-07-28 热修：远程证据验收误阻断

- 用户实测发现：远程 Hermes 被配置为“测试验收 + 只读证据包”时，预检错误地把职责描述中的“实施交付”理解为该角色需要写入本机目录，导致协作未启动。
- 已改为以**角色名称**优先判断写入能力：`测试/验收/复核/审核` 类角色始终作为只读证据消费者；只有实施、开发、编写等明确实施角色才要求本地直连或远程映射。
- 回归：远程“实施 + 只读证据包”仍会阻断；远程“测试验收 + 只读证据包”可正常启动。`RuntimeChat.test.tsx` 18 项通过，`npm.cmd run typecheck` 通过。

## 2026-07-28：协作流程复盘与远程本地工作区方案

### 回归结果

- 协作相关定向回归：`task-collaboration-proposals`、协作存储、协作设置面板、RuntimeChat 共 4 个测试文件、27 项通过。
- 当前端到端流程已覆盖：显式确认协作方案、逐角色派发、实施无产物阻断、证据化验收、终验汇总、验收失败恢复、重开任务与时间线定位。

### 仍需收口的风险

1. `远程映射`目前是角色配置中的引用值，不会由客户端验证远程端是否真正能访问该目录、Git 引用或共享工作区。应在派发前做能力探测/读目录探测，并把结果显示为“已验证/不可达”。
2. 当前交付契约允许从实施角色的文本输出补齐路径、哈希和摘要；模型文本不能作为哈希的最终来源。后续应优先采集 Runtime 实际发布的文件元数据，或由本机工作区代理重新计算哈希。
3. 只读证据包应由平台生成不可变清单（文件名、内容哈希、来源、时间、可选内容副本），而不是依赖用户在消息中粘贴路径和内容；远程验收只可引用该清单编号。
4. 远程智能体尚无直接、安全操作办公电脑本地项目的通道。共享盘、VPN 或 Git 引用可作为外部映射，但不是客户端自动建立的能力。

### 推荐架构：本地工作区代理（下一阶段）

- Agents One 主进程持有本地项目根目录与权限策略；远程 Hermes/OpenClaw 不获得 Windows 路径、SMB 凭据或直接入站访问权限。
- 客户端通过出站 TLS 长连接向已认证的远程 Bridge 注册短生命周期 `workspaceRef`；远程智能体只能对该引用发起受控的 `list/read/write/patch/move/delete` 请求。
- 主进程逐项执行并校验根目录约束、路径穿越、符号链接、文件大小、任务令牌和角色权限。读取可直接返回证据；创建/编辑生成前后哈希、差异和审计记录；删除始终要求用户逐次确认。
- 每个操作回写协作时间线和真实产物证据，验收角色引用本机代理计算的哈希，而非模型自行声明的哈希。
- 不能部署本地代理时，降级顺序为：受限 Git worktree/合并请求、受限共享目录（VPN/ACL）、只读证据包；不允许远程智能体直接操作任意本机目录。

### 下一阶段验收矩阵

- 本地临时项目：读取、创建、修改、删除确认、取消中断、路径穿越与符号链接拒绝。
- 远程 Bridge 模拟：令牌过期、重复操作、离线重连、超时、角色越权和审计完整性。
- 真实 Hermes/OpenClaw：仅在测试目录中验证只读证据验收与代理写入，确认远程端无法绕过项目根目录或删除确认。

### 2026-07-28：远程只读证据包接入协作执行

- 协作运行会在存在“远程 + 只读证据包”角色时，先由本机生成受限项目快照；快照准备失败或未选择项目时，协作停在“等待人工处理”，不会静默降级。
- 每份项目快照现附带平台计算的文件相对路径、入包字节数和 SHA-256 清单，远程角色可据此引用证据；不会包含本机绝对路径。
- 证据包已接入 OpenClaw 的 Bridge Artifact 上传链路和 Hermes 的受控文本附件链路，远程测试/验收角色可以基于同一份平台生成证据参与任务。
- 增加远程提示词脱敏：远程角色不会收到选定项目的本机绝对路径；前序交接和验收证据中的 Windows 路径会替换为占位符。本地角色不受影响。
- 定向回归：`RuntimeChat.test.tsx` 与 `project-context.test.ts` 共 21 项通过；`npm.cmd run typecheck` 通过。
- 已新增 [REMOTE_LOCAL_WORKSPACE_ACCESS.md](REMOTE_LOCAL_WORKSPACE_ACCESS.md)，定义只读证据包、未来出站受控写入、远程映射和安全验收边界。
- PowerMem 云记忆健康检查、写入和检索于 2026-07-28 通过；已同步本次远程证据包与出站受控工作区授权的长期设计事实。

### 2026-07-28：本机出站工作区网关基础

- 新增独立的本机工作区网关执行器：不监听端口、不暴露 SMB/HTTP 文件服务；仅由 Agents One 主进程主动向受信任 Bridge 轮询操作请求。
- 每个授权绑定任务、智能体、项目根目录、读写权限、过期时间和单次数据上限。远端注册信息只包含短时授权 ID 与能力，不包含办公电脑绝对路径。
- 首版受控操作为 `list/read/write/move/delete`：所有路径必须位于项目根目录内，拒绝路径穿越和符号链接跳转；写入拒绝覆盖冲突；删除必须回到本机单次确认后才会执行。
- 操作结果生成受限审计记录，记录相对路径摘要、状态、时间与结果哈希；不记录 Token、完整请求头或本机绝对路径。
- 新增 [OUTBOUND_WORKSPACE_GATEWAY_BRIDGE_REQUIREMENTS.md](OUTBOUND_WORKSPACE_GATEWAY_BRIDGE_REQUIREMENTS.md)，明确 Hermes/OpenClaw Bridge 需要提供的能力发现、授权注册、长轮询取件、结果回传、撤销和审计协议。

### 自动化验证

- `npm.cmd test -- --run tests/remote-workspace-gateway.test.ts`：4 项通过，覆盖根目录逃逸、只读授权、写入哈希冲突、删除确认、出站注册不泄露根路径、轮询执行与撤销。
- `npm.cmd run typecheck:node` 通过。

### 待联调

1. Hermes/OpenClaw Bridge 按协议实现 `/workspace-gateway` 能力端点，并在 capabilities 中显式声明支持。
2. 桌面端仅在用户对具体远程任务明确授予权限且 Bridge 探测通过后，创建短时授权并启动轮询；普通远程对话继续保持只读证据包。
3. 首次真实联调限定在测试项目目录，覆盖读取、创建、哈希冲突、取消、过期和删除本机确认；通过后再接入协作编排。

### 2026-07-28：远程受控工作区生命周期接入

- Hermes 与 OpenClaw 已分别声明并完成 `outboundWorkspaceGateway` 协议测试；桌面端已接入每任务短时授权、主动轮询、受控执行、结果回传和任务结束自动撤销。
- Runtime 可选配置独立的受控工作区网关地址；这用于 OpenClaw 的独立 `/workspace-gateway` 服务，避免误拼接到其 `/oc-bridge` 地址。网关 Token 独立保存到受保护的本机连接配置，绝不写入 Runtime JSON、日志或对话。
- 首版只允许 `list/read/write/move/delete` 结构化请求。删除仍只回传“需要本机确认”，不由远程侧自动执行。
- 下一步：为已配置的远程 Hermes/OpenClaw 执行真实测试目录的只读与写入测试，再将同一受控访问方式接入协作角色调度。

### 2026-07-28：Gateway 协议联调准备完成

- 远程 Hermes Bridge 已完成 `/hermes-api/workspace-gateway` 的能力声明、短时授权、请求入队/拉取、结果回传、撤销和审计接口；远程 OpenClaw 已完成独立 `https://<host>/workspace-gateway` 服务的同等协议。两端均已在服务器侧完成安全回归。
- 桌面端适配两种部署形态：Hermes 可从常规 API 地址推导 `/workspace-gateway`；OpenClaw 可单独填写完整网关地址，避免把独立服务错误拼到 `/oc-bridge` 下。
- 远程任务选择项目目录并显式授予只读或完全访问后，桌面端会探测能力、创建与任务绑定的短时 Grant、主动轮询队列、在本机项目根目录内执行结构化操作、回传结果，并在任务结束/取消时自动撤销 Grant。Grant、审计和对话不会保存本机绝对路径、Token 或完整文件内容。
- 本轮验证：`tests/remote-workspace-gateway.test.ts` 与 `AgentRuntimesPane.test.tsx` 共 12 项通过；`npm.cmd run typecheck` 与 `npm.cmd run build` 通过。

### 真实验收前置条件

- Gateway HTTP 接口可用并不等于远端模型已经具备操作本机项目的能力。远程 Hermes/OpenClaw 还必须把 `workspaceRef` 绑定为真实工具：模型发起 `list/read/write/move/delete` 时，Bridge 使用 Grant 向相应 `/workspace-gateway` 队列提交结构化请求，而不是让模型输出本机路径或直接运行 Shell。
- OpenClaw 当前声明的独立 Gateway 服务不会自动修改 OpenClaw Gateway 的工具注册；需要在 OpenClaw 端单独注册该工具/适配器。Hermes 也需要确认其 Bridge 在收到 `workspaceRef=desktop-gateway:<grant>` 时会调用相应接口。
- 首次真实验收仅限测试目录的 `list/read` 与新文件 `write`。删除确认的本机交互界面尚未接入，首版会安全地返回“等待本机确认”，不会自动删除。
- 本轮长期设计事实已同步至 PowerMem 云记忆；本地日志仍作为可审计的完整记录。

## 2026-07-28：统一远程接入协议定稿 - Agents One Remote Gateway v1

### 产品决策

- 后续每个远程智能体在 Agents One 中只保留一个 Gateway 地址和一个 Bearer Token。名称、头像、ID、类型仍可按用户偏好自定义。
- Hermes API、Dashboard、OpenClaw Bridge、独立 Workspace Gateway 等多地址、多 Token 只允许作为远端 Adapter 的内部实现；桌面端不再感知或要求这些私有配置。
- 本地 CLI Runtime（Codex、Claude Code、Pi Agent）不迁移到 Gateway，继续采用本地进程适配器。

### 规范产物

- 新增 [AGENTS_ONE_REMOTE_GATEWAY_V1.md](AGENTS_ONE_REMOTE_GATEWAY_V1.md)，定义统一配置、能力发现、Run、SSE 事件、Artifact、工作区 Grant、协作交接、鉴权、安全、兼容迁移和一致性验收。
- Gateway v1 明确区分“接口服务存在”与“远端模型拥有真实工具”。只部署请求队列不算完成；远端 Runtime 必须把 `workspaceRef` 绑定为结构化 `workspace_gateway` 工具，并等待本机的真实结果哈希。
- 迁移采用新增统一 Adapter、保留旧配置、用户主动验证、可回退的顺序；禁止客户端自动覆盖或删除现有 Runtime 凭据、项目、任务和对话历史。

### 下一步

1. Hermes 与 OpenClaw 分别在远端部署 `/agents-one/v1` Adapter，将现有私有端点归一化并签发单一 Gateway Token。
2. Agents One 客户端新增统一 Gateway Runtime 连接模式和 v1 capabilities 探测；旧 Hermes/OpenClaw 配置保持兼容。
3. 用单地址/单 Token 完成 Hermes、OpenClaw 的对话、任务、产物与受控本机工作区真实验收，再逐步将 Claude Code 等远程 Runtime 接入同一协议。

### 本地 CLI 边界确认

- 用户确认本地接入 Codex CLI、Claude Code CLI、Pi Agent CLI 的目标是获得更好的可视化、交互、历史、产物和项目协作体验，而不是减少 CLI 的原生能力。
- 因此本地 CLI **不接入** Agents One Remote Gateway v1，也不使用远程 Grant 或单地址/Token 模型。它们继续由本地 Runtime Adapter 直接启动，保留原生会话、工具、子智能体、终端、工作目录和权限语义。
- 统一的是上层的 Runtime 生命周期与事件呈现：Agents One 将原生输出映射为工具卡片、思考摘要、产物和状态；未能结构化的内容保留可折叠原始记录，避免 UI 优化造成信息或功能损失。

### 统一 Gateway 试点策略

- 先接入一个全新远程智能体作为 Gateway v1 试点，不修改 Hermes、OpenClaw 或现有客户端连接配置。
- 新增 [AGENTS_ONE_REMOTE_GATEWAY_V1_PILOT_GUIDE.md](AGENTS_ONE_REMOTE_GATEWAY_V1_PILOT_GUIDE.md)，按“对话与 SSE → 产物 → 受控本机工作区”的递进顺序实施和验收。
- 试点通过后，Hermes、OpenClaw 只需按同一 Adapter 契约适配；客户端不再为每个 Runtime 发明新的连接表单或凭据字段。

### CGNAT 远程智能体接入策略

- 家庭电脑等无公网 IP Runtime 不采用逐台反向代理或端口映射；Gateway v1 增加“出站 Agent Connector”部署 Profile。
- 家庭电脑上的 Connector 主动通过加密长连接连接公网 Agents One Relay；桌面端仍只配置 Relay 的一个地址和一个 Gateway Token，不感知家庭网络、IP、DDNS 或设备内部凭据。

### 2026-07-29：统一 Gateway 接入界面第一阶段

- “新增/管理智能体”对远程 Runtime 增加 **统一 Gateway (v1)** 与 **兼容模式** 两种协议选择。统一模式只显示 `Gateway 地址` 与 `Gateway Token`，不显示 Hermes API、Dashboard、独立工作区网关或其内部凭据。
- 统一模式的连接测试固定请求 `<gatewayUrl>/capabilities`，要求返回 `protocolVersion: 1.x` 和结构化能力声明；HTTP 200 但不符合 v1 合约会明确拒绝，不会误标为健康。
- Gateway Token 使用受保护的本地密钥存储，运行时定义、项目记录、列表数据与日志均不保存 Token。已有 Hermes/OpenClaw 兼容配置不迁移、不覆盖，也不会因为切换 UI 而删除。
- 当前完成范围是“安全配置 + capabilities 探测”。首个 Relay 提供真实地址后，再按 v1 `/runs`、SSE 事件、取消、Artifact 和短时 Workspace Grant 进行真实联调；在此之前不把统一 Gateway 伪装为已具备正式任务派发能力。
- Connector 只转发规范化的 Run、事件、Artifact 和受控工作区消息，不成为任意 TCP 隧道、Shell 通道或远程文件服务器。

### 2026-07-29：家庭电脑 Hers Gateway v1 首次真实运行验收

- 发现并修复自定义远程 Hermes Runtime 的路由缺陷：过去前端按 `kind === hermes` 直接进入内置 Hermes Profile 对话，导致 Hers 等用户自定义 Hermes 被错误发送给默认 Hermes，且不会使用 Runtime 对话持久化层。
- 路由现改为只有 `managed: builtin` 的内置 Hermes 使用旧 Profile 对话；所有用户接入的 Runtime（包括 Hermes 类型）都会创建携带 `runtimeId` 的独立 Runtime 对话，因此保留自身名称、头像、会话和任务记录。
- Gateway v1 桌面端已补齐正式 Run 生命周期：`POST /runs`、`GET /runs/{id}` 轮询、`POST /runs/{id}/cancel`，并映射状态、答复、错误和结构化产物。远端没有返回 `conversationId` 时，客户端仍以本地 Runtime conversation ID 保存历史；后续消息会携带已保存的上下文，不会丢失左侧记录。
- Hers（家庭电脑 Relay）真实验收：`/capabilities` 返回 `protocolVersion=1.0`，声明 conversation 与 task 的启动/查询/取消能力；发送最小 conversation Run 后由 `queued` 成功结束为 `succeeded`，收到预期答复，未产生 Artifact。测试过程未输出或保存 Gateway Token。

### 2026-07-29：Hers 项目对话与会话连续性复测

- 修复统一 Gateway 对话误阻断：桌面端选中本地项目不再等同于已经授予远程工作区权限。未建立 Workspace Grant 时，普通对话继续以只读模式运行；客户端不会向远端发送本机绝对路径或文件内容。
- 远程 Gateway 对话会继续在本地保存项目关联，确保任务记录显示在对应项目下；项目关联仅是桌面端元数据，不代表远端获得目录访问权。
- 在 Workspace Grant 尚未接入前，统一 Gateway 的“完全访问”入口禁用并明确提示，避免界面承诺实际不存在的本地文件读写能力。
- 自动化回归：`tests/agent-runtimes.test.ts` 与 `RuntimeChat.test.tsx` 共 35 项通过；Electron 主进程、Preload 和 Renderer 生产构建通过。
- Hers Relay 双轮 Run 均成功，且每轮均返回非空 `conversationId`。Relay 当前采用逐轮更新 continuation token 的形式，桌面端可以保存最新值。
- 随机标记连续性测试未通过：第二轮没有召回第一轮标记。说明 Relay 已补充 `conversationId` 字段，但尚未把传入的 `conversationId` 绑定/恢复到同一个 Hermes 会话。家庭端需继续修复会话映射后再进行连续对话验收。

### 回归结果

- `npx.cmd vitest run src/renderer/src/screens/Layout/chatRuns.test.ts tests/agent-runtimes.test.ts`：29 项通过，覆盖自定义 Hermes 不回退、Gateway v1 Probe、Gateway v1 Run 派发、旧 Hermes 流式回归。
- `npm.cmd run build`：TypeScript Node/Web 校验与 Electron-Vite 生产构建通过。

### 当前边界

- Gateway v1 的对话、任务、轮询、取消和 Artifact 回传已进入桌面端；SSE 将作为性能优化接入，轮询是当前可靠的兼容路径。
- Gateway v1 的本机工作区 Grant 尚未复用旧 Hermes/OpenClaw 私有 `/workspace-gateway` 实现。用户为 Gateway v1 Runtime 选择本机项目目录时，客户端会明确阻断并提示使用只读上下文包，直到 `workspace-grants` 统一协议完成，避免误把请求发送到旧私有端点。

### 2026-07-29：Hers Workspace Grant 真实协议探测

- Hers Relay 已声明 `outboundWorkspaceGateway.enabled: true`，且统一 Gateway 的 `/workspace-grants` 注册、拉取和撤销路由真实存在；测试 Grant 已成功创建、拉取空队列并撤销，全程未发送本机绝对路径、文件内容或输出 Token。
- 当前 Relay 声明仍缺少 `operations`、`maxOperationBytes`、`maxGrantSeconds`，尚不足以让客户端按能力边界开放“完全访问”。
- Relay 与 Gateway v1 当前契约存在四项差异：注册要求额外的 `workspaceRoot`；Relay 改写客户端 Grant ID；拉取响应使用 `requests: []` 批量结构而非单条 `request`；服务端过期时间未按客户端请求的短时授权收紧。
- 因此“完全访问”继续保持禁用。开放条件是：Relay 对齐统一 Grant 契约、远端 Runtime 将 `workspaceRef` 绑定为真实结构化工具、桌面端把 v1 Grant 接入现有受控本机执行器，并通过临时测试目录的读取、写入、哈希冲突、撤销、过期和删除确认回归。

### 2026-07-29：桌面端 Gateway v1 Workspace Grant Adapter

- 统一 Gateway 已复用既有的 `OutboundRemoteWorkspaceGateway` 本地安全执行器，并将兼容端点映射为 v1 的 `/workspace-grants`。路径约束、符号链接拒绝、单次大小限制、SHA-256 冲突检查、删除逐次确认和审计逻辑未重写。
- Gateway v1 Runtime 关联本机项目后，桌面端会使用同一 Gateway 地址和 Token 探测完整能力、注册短时 Grant、主动拉取结构化请求、在授权根目录内执行并回传结果；`workspaceRef` 采用 `desktop-gateway:<grantId>`，本机绝对路径不出站。
- “完全访问”改为能力门控：只有远端完整声明 `list/read/write/move/delete`、`maxOperationBytes` 和 `maxGrantSeconds` 后开放。仅声明 `enabled: true` 仍保持只读，避免能力误判。
- 远程 Gateway 任务默认超时由 5 分钟调整为 30 分钟，允许显式配置到 60 分钟。Run 状态轮询增加指数退避和 120 秒恢复窗口，短暂 Relay/Connector 断连不再立即终止任务。
- 新增 Hers 定向 Workspace Grant 对齐记录，记录能力声明、Grant ID、`workspaceRoot`、pull 响应、到期时间、真实工具绑定和长任务保留等要求；该环境交接资料现已转入受控私有归档。
- 自动化验证：Gateway/Runtime/RuntimeChat 3 个测试文件共 41 项通过；Node 与 Web TypeScript 检查通过。

### 2026-07-29：Hers Workspace Gateway 真实端到端验收

- 修复 Hers 旧 HTTP 地址和自签名 HTTPS 的兼容问题：Runtime 已切换为 HTTPS；Gateway 与 Workspace Grant 请求仅在识别到明确的自签名证书错误时使用受限重试，普通证书、网络和协议错误不会被放宽。
- 增加 `scripts/verify-hers-workspace-gateway.js`，使用受保护配置发起真实 Grant、Run、请求拉取、文件操作核验和撤销，不打印 Token，也不采信模型口头完成声明。
- 两轮真实测试均完成 Grant 注册与撤销，但桌面端未收到任何 `list/read/write` 请求，测试文件未生成；远端却返回“全绿”。结论：Hers Relay 只完成了能力声明和队列接口，Connector 尚未向 Hermes 注入真实 `workspace_gateway` 工具。
- 客户端新增终态验收闸门：已建立 Workspace Grant 的远程 Run 若返回成功但审计中没有任何真实工作区操作，将改判失败并提示检查 Relay 工具绑定；同时正常执行 Grant 撤销，避免授权仅依赖过期自动清理。
- 自动化验证：`tests/remote-workspace-gateway.test.ts` 与 `tests/agent-runtimes.test.ts` 共 22 项通过；完整生产构建通过。

### 2026-07-30：Hers 真实工具绑定端到端复测

- Hers 声明完成 `workspace_gateway` 工具绑定后，重新执行真实 Grant/Run/list/read/write/SHA-256/撤销测试。
- 标准 Grant 注册返回 `201 active`，并保留桌面端生成的 ID；测试脚本新增返回 ID 校验和独立 `conversationId`，防止 Relay 替换授权或误复用旧会话。
- 标准 `input.workspaceRef=desktop-gateway:<grantId>` 仍被 Connector 判定为“当前会话未关联 Grant”，操作统计为 `list=0, read=0, write=0`。
- 兼容诊断确认：顶层 `workspaceRef` 被严格模式拒绝；裸 `grantId` 虽触发工具操作，但 Relay 将刚注册的有效 Grant 错判为 `grant_revoked`。
- 结论：桌面端 v1 字段、注册顺序和 Grant ID 正确；当前阻塞在 Hers Relay/Connector 对 `workspaceRef` 的解析，以及 Run/工具队列之间未共享同一 Grant 状态。完整远端修复清单已转入受控私有归档。

### 2026-07-30：Hers Grant 状态关联修复后二次验收

- 再次运行完整端到端测试，真实 Run 中的工具仍返回 `grant_revoked`，未产生桌面端 `list/read/write` 请求或测试文件。
- 新增独立状态探针，不经过 Hermes 会话直接验证同一 Relay：Grant 注册 `201 active`、请求入队 `202`、桌面拉取 `200` 且获得真实 `list` 请求，证明 Relay Grant 数据库和队列本身正常。
- 根因已收敛到 Connector 的运行时绑定：它仍复用上一轮已撤销 Grant，未在每个新 Run 上使用当前 `input.workspaceRef` 创建独立工具上下文。
- 保持安全边界：桌面端不会通过延迟撤销、复用旧授权或发送裸本机路径规避该问题。Hers 必须改为 Run 级 Grant 绑定后再验收。

### 2026-07-30：Hers Run 级 Grant 绑定修复后验收

- Run 级绑定已真实打通：完整测试观察到桌面端执行 `list=1`、`read=1`，不再出现“会话未关联 Grant”或复用旧 Grant 的问题。
- 完整验收仍未通过：Relay 把标准 `permission: "write"` 注册成 `permissions.write=false`，真实写入被 `permission_denied:write_required` 拒绝，未生成验收文件。
- 协议探针确认标准结果体中的 `data` 被 Relay 丢弃，结果查询返回 `result:null`；只有非标准 `result` 字段会被保存，导致 Hers 无法读取桌面端返回的目录和文件内容。
- `denied` 结果状态仍被 Relay 以 `400 invalid_status` 拒绝；Connector 还尝试调用未声明的 `hash` 操作。相关环境修复要求已转入受控私有归档。
- 自动验收脚本新增权限保真和结果载荷往返断言，今后会在协议入口直接失败，不再等待长任务结束后才暴露错误。
- 本机回归保持正常：`tests/remote-workspace-gateway.test.ts` 与 `tests/agent-runtimes.test.ts` 共 22 项通过。

### 2026-07-30：Hers Gateway v1 Workspace Grant 正式验收通过

- Hers 完成权限映射、标准 `data` 结果载荷和状态枚举修复后，完整真实 E2E 首次通过。
- 测试 Run `run_63a334d1be3e46789dca161b72087365` 产生并完成 `list=1`、`read=1`、`write=1`，没有使用模型口头声明代替本机证据。
- 办公电脑授权目录真实生成 `agents-one-gateway-e2e.txt`；独立读取确认内容为 `Agents One Gateway v1 E2E passed`，大小 32 字节，SHA-256 为 `1d2d9765d1c2a8aaa2c7bb8db02c2efebc18e85a284de81dc0d81378e0e346c5`。
- 失败路径补充验证通过：Relay 接收 `denied` 返回 HTTP 200，结果查询保持 `denied`；短时 Grant 在测试结束后主动撤销。
- 桌面端 `remote-workspace-gateway` 与 `agent-runtimes` 回归共 22 项全部通过。
- 结论：Hers 已成为首个完整通过 Agents One Remote Gateway v1 对话、Run 和受控本机工作区读写闭环的远程智能体。

### 2026-07-30：后续发布前推进方案与 Hers 复验

- 新增 [AGENTS_ONE_NEXT_STAGE_PLAN.md](AGENTS_ONE_NEXT_STAGE_PLAN.md)，将后续工作收敛为：安全基线、统一任务对话界面、Hermes/OpenClaw Gateway v1 迁移、任务与项目软归档、客户端备份恢复、发布前回归与体验收口。
- 强制最小化变更原则：展示层不得修改 Runtime 注册、受保护凭据、项目关系和消息持久化；Gateway 迁移保持既有 `runtimeId`，禁止以删除重建方式迁移智能体。
- 独立验证脚本 Run `run_229c17e43e3b4c71a03b986808db3b27` 成功完成 `list=1`、`read=1`、`write=1`，生成 `agents-one-gateway-e2e.txt`，SHA-256 为 `35628d96ca85a6a6c56cf8ee5dc813d44e0c558c5ecfa7966ea7e59690776248`，随后主动撤销短时 Grant。
- 新建任务复测仍出现 `Workspace request id is invalid`，证明脚本覆盖的直接协议路径与桌面运行时 `pull` 响应形状不完全一致，原先将截图判定为旧错误的结论已撤回。
- Hers Relay 审计确认：请求 `req_58b33b8ddc97480c` 已入队且被桌面拉取；桌面回传结果的 `requestId` 却为空，导致结果查询持续 404。根因是 Relay 返回 `requestId`，而桌面轮询器此前只读取 v1 标准字段 `id`。
- 修复：桌面端在受控工作区请求适配层优先读取 `id`，仅在缺失时兼容读取同一服务端标识 `requestId`；若两者同时存在但不同则拒绝。该修复不创建、不修改请求标识，不放宽任何路径、权限或操作校验。`tests/remote-workspace-gateway.test.ts` 新增兼容回归，Node TypeScript 校验通过；待重启应用后以新任务执行真实复测。

### 2026-07-30：Hers 续聊编辑与新建文件修复

- 复现“首轮读取成功、同一对话后续编辑与新建失败”：桌面端每轮都会建立新的短时 Workspace Grant，但续聊请求此前使用 `mode=conversation`。Hers 只在任务运行入口挂载本轮 `workspace_gateway`，因此第二轮虽然保留了会话上下文，却没有重新挂载新 Grant。
- 最小修复：存在 `input.workspaceRef` 时固定以 `mode=task` 启动本轮 Run；对话连续性继续由 `conversationId` 保留。没有 Workspace Grant 的普通续聊仍使用 `mode=conversation`，不改变既有对话行为。
- 新增序列化回归测试，确认带 Grant 的续聊保留 `conversationId` 和 `workspaceRef`，同时发送 `mode=task`；无 Grant 的续聊保持 `mode=conversation`。
- 新增真实双轮验证脚本 `scripts/verify-hers-workspace-continuation.js`：第一轮 `list=1/read=1` 后撤销 Grant；第二轮沿用同一 `conversationId`、注册新 Grant，实际执行 `read=3/write=2`，成功保留并编辑已有文件，同时新建另一份 Markdown 文件。
- 自动化验证：Gateway、Workspace Gateway、Runtime 三个测试文件共 25 项通过；Node TypeScript 检查通过。Agents One 已以原用户数据目录重新启动并加载修复。

### 2026-07-30：远程删除逐次授权

- Hers 已通过 Gateway v1 完成项目文件读取、编辑和新建；删除测试被 Relay 以 `permission_denied:delete_required` 提前拒绝，桌面端未收到删除请求。
- Agents One 在既有受控工作区执行器上增加本机逐次确认：远端删除请求被拉取后，办公电脑显示智能体名称与项目内相对路径；仅“允许本次删除”会继续执行，关闭、取消或拒绝均不删除。
- 用户允许后仍会重新检查 Grant 有效期、写权限、路径边界和 `expectedSha256`，防止确认期间文件被替换；不会把本机绝对路径或长期删除权限交给远端。
- Gateway v1 权限保持 `read/write` 两级。`permission=write` 且 `operations` 包含 `delete` 表示允许提出删除申请，不代表自动删除；Relay 不得要求私有的 `delete_required` 权限，应把请求入队并等待桌面端最终 `succeeded/denied` 结果。
- 回归验证：Workspace Gateway 与 Runtime 测试共 25 项通过，覆盖允许删除、拒绝删除、结果 `requestId` 回传和既有读写行为；Node TypeScript 检查通过。

### 2026-07-30：任务对话框展示层统一收口

- 产品基线明确为“原生 Hermes 丰富事件展示”：思考、工具、技能、文件和终端事件继续使用现有图标、动画、折叠结构；本地 CLI、OpenClaw 和 Gateway v1 远程智能体统一转换到同一套展示组件，不再各自维护一套对话布局。
- 修复首轮消息顺序：仅对会话开头、尚未出现用户消息前的智能体跟踪事件做展示层重排，确保首条用户消息先出现，再展示本轮思考、工具调用和答复；不修改远端原始事件、时间戳和持久化内容。
- 统一身份展示：消息区和顶部任务标签使用用户配置的智能体名称、头像和颜色；运行中在头像外增加活动环，保留工作反馈感，不再用活动圆圈替代智能体身份。
- 上下文容量映射补充 GLM-5.2 `1,000,000` tokens，容量仪表按模型元数据计算；长期方案仍应由 Runtime/Gateway 能力响应上报模型与上下文上限，静态映射只作为兼容回退。
- 输入区收敛为：上传文件、上下文文件夹、访问权限、模型、网页预览、发送。移除上传按钮后的多余分隔线、协作方案快捷入口、右侧任务侧栏按钮及对应侧栏；访问权限按钮采用无边框样式。
- 原生 Hermes 的“完全访问”保持禁用，并明确提示迁移到 Gateway v1 后开放，避免界面允许但底层没有真实权限约束。CLI 和 Gateway Runtime 继续沿用各自已实现的权限执行逻辑。
- 严格遵守最小变更边界：本轮仅修改 Renderer 展示、事件排序和模型容量元数据，没有修改智能体注册、受保护凭据、会话持久化、Gateway 协议、Workspace Grant、Runtime Adapter 或历史数据。
- 自动化验证：ChatInput、ActiveSessionsBar、RuntimeChat、消息排序和上下文容量 5 个测试文件共 34 项通过；完整 TypeScript 检查和生产构建通过。
- 实际页面验收：在 1440×900 桌面视口检查新任务与既有 Hers 任务，确认无横向溢出，顶部与消息区显示 Hers 配置头像，丰富工具/思考记录保留，输入工具顺序正确，右侧任务栏和废弃按钮不再出现。

### 2026-07-31：统一细粒度智能体事件协议基线

- 新增 [Agent Event Stream v1](AGENT_EVENT_STREAM_V1.md)，以 Hermes Dashboard 的可见反馈为基线，统一 `reasoning.summary`、工具、技能、MCP、终端、受控工作区、真实产物与协作交接事件；协议明确禁止传递原始思维链、高频快照、Token、绝对路径和完整敏感内容。
- Gateway 的 `GET /runs/{runId}` 现在可兼容读取有界 `events`、真实模型和用量元数据；桌面主进程会按稳定事件 ID 去重并转换到既有 Hermes 风格运行时间线。旧 Gateway 不返回事件时仍沿用最终答复路径，不会因增强展示破坏已有接入。
- 新增 [插件实施指南](AGENT_EVENT_STREAM_PLUGIN_GUIDE.md)，规定 Hers Relay、OpenClaw Gateway 及 Pi/Codex/Claude Code 本地 CLI Adapter 的映射边界、断线恢复、身份显示、脱敏和验收夹具；本地 CLI 保持原生调用能力，协议只约束其到 UI 的事件输出。
- 这是一层独立的协议与展示基础设施：未修改智能体注册、受保护凭据、会话/项目持久化、Workspace Grant 或历史数据。实际 Hers/OpenClaw 插件需按指南实现后，才能把真实细粒度事件带到桌面端。
- 自动化验证：新增远程 Gateway 事件快照解析和旧 Gateway 无事件兼容回归；与 Event Stream 归一化测试、Gateway 合同测试共同执行，待本轮代码完成后统一复验。

### 2026-07-31：Agents One Plugin SDK 预览实现

- 新增独立包 `plugins/agents-one-plugin`，提供 Remote Gateway Host、Local CLI Adapter、事件脱敏/去重/有界日志、Hermes/Hers、OpenClaw 和 JSONL CLI 映射示例，以及机器可读的 `agents-one-plugin.manifest.json`。
- Remote Gateway Host 实现 Bearer Token 校验、`/capabilities`、`/runs`、`/runs/{id}`、取消和事件增量读取；它将供应商 Run 映射为 Gateway v1 与 Agent Event Stream v1，而不会改写 Hermes/OpenClaw/Hers 的原生工具权限或工作区能力。
- Local CLI Adapter 只通过非 Shell 参数数组启动本机 CLI，处理 JSONL/Hook 分段输出，保留用户可见的推理摘要、工具、技能、MCP、产物和终态事件；它不使用 Gateway Token，也不会限制 Codex、Claude Code 或 Pi 的原生能力。
- 安全边界：原始思维链、凭据、绝对路径及未脱敏完整输出不进入事件流；真实文件、代码变更和测试报告才会作为 artifact。远程写入仍必须走 Workspace Grant，插件本身不会绕过桌面端逐次删除确认。
- 验证：插件独立 Node 测试 3 项通过（稳定事件去重/脱敏、Gateway Run 终态、CLI 分段 JSONL）；桌面端 `agent-event-stream` 与 `agents-one-remote-gateway` 回归 6 项通过，Node/Web TypeScript 检查通过。

### 2026-07-31：插件化新增智能体连接测试

- 新增智能体仍只需要填写 Gateway 地址和 Gateway Token；桌面端不会远程安装或保存插件代码。
- Gateway 的连接测试会读取 `/capabilities` 中可选的插件身份。`agents-one-plugin-sdk` 会声明版本、`remote-gateway` 类型及细粒度事件流能力，供用户确认远端已按统一规范适配。
- 这项识别信息仅存在于探测结果，不进入 Runtime 保存、受保护凭据、项目关系、会话历史或任务持久化路径。
- 新增 Hers 定向插件安装说明，涵盖无密钥插件包分发、Relay 事件映射、Gateway v1 探测和 Workspace Grant 验收；该环境交接资料现已转入受控私有归档。

### 2026-07-31：Hers 从 Relay 迁移到 Plugin Adapter

- Hers 已将旧 `relay.py` 的能力迁移至 Node `plugin-adapter.mjs`；共享 `agents-one-plugin` SDK 包保持未修改，便于后续独立升级。nginx 的 `/agents-one/` 流量已切换至插件宿主 `:8701`，旧 Relay `:8700` 仅临时保留且不再承接流量。
- 新适配器在 SDK 的 Gateway v1 路由基础上提供健康检查、产物 CRUD、`/workspace-grants` 全套接口及 Connector WSS 管理。`/workspace-grants` 与 Agents One 桌面端 Gateway v1 契约一致，不需要新增桌面兼容层。
- 修复远端运行事件重复与终态竞态：SDK 统一产生 `run.started`、`run.completed`、`run.failed`；适配器不再重复发送这些 WSS 事件，并在 `getRun` 中从已完成运行结果合成唯一的 `assistant.completed`。不依赖 SDK 基于 UUID 的 EventJournal 语义去重。
- Hers 已完成 14 项端点测试、无重复的运行生命周期、会话续接及 Workspace Grant 完整回路（含删除确认）。待桌面端真实验收：插件身份识别、细粒度事件展示、产物展示、读写移动删除与断线恢复。

### 2026-08-02：Gateway Event Stream 终态兼容与诊断

- Hers Event Stream v1 验收已能产生 `reasoning.summary`、工具事件、模型和用量元数据；桌面端截图中的 `failed` 暴露出终态事件顺序兼容问题：运行先报告完成时，后续 `assistant.completed` 可能尚未被客户端读取。
- 最小修复：Gateway 运行快照解析会从 `assistant.completed.data.text` 回填最终答复，并兼容从事件读取模型、用量和字符串型错误；不改动任何智能体配置、Token、会话、项目或历史数据。
- 对“已成功但尚未提供最终答复”的 Gateway Run，桌面端仅额外进行 3 次、每次 750ms 的短轮询；仍缺失时显示明确的 Event Stream 契约错误，避免把有效答复截断或只显示模糊的 `failed`。
- 进一步修复成功终态错误字段兼容：若 Gateway 返回 `status: "succeeded"`，桌面端忽略遗留的字符串型 `error` 状态标记（例如 `"failed"`），避免其覆盖已提取的 `assistant.completed` 答复并渲染为空白失败气泡。
- 连接测试在 Gateway 没有声明插件元数据时明确提示“未声明 Agents One 插件信息”；Hers 需在 `/capabilities` 根对象提供 `plugin: { id, version, kind: "remote-gateway" }`，才能显示已识别的 SDK 插件版本。

### 2026-08-02：Gateway 失败详情与事件错误透传

- 修复远程 Gateway 失败运行只显示一个 `failed` 的问题。桌面端现在优先读取 `run.failed`、`tool.failed` 或 `workspace.blocked` 事件中的 `message`、`error`、`reason` 摘要，失败原因会进入运行记录和对话气泡。
- 兼容 Gateway 直接返回、`{ run, events }` 以及嵌套 `data.run` 的响应包，避免插件已经返回失败详情但客户端因响应层级不同而丢失。
- 事件归一化会把 `message`、`error` 作为安全摘要保存到事件数据，后续时间线可以显示可诊断信息；仍不会显示 Token、请求头、绝对路径或完整敏感内容。
- 当远端确实没有提供详情时，界面显示“任务执行失败，但远程网关未返回详细错误”，不再显示无意义的英文 `failed`；HTTP 错误也会附带脱敏后的服务端错误摘要。
- 自动化验证：Gateway 与事件流回归测试 11 项通过，Node/Web TypeScript 检查通过，`git diff --check` 无格式错误。

### 2026-08-02：Gateway v1 失败事件可见性修复

- 根因：部分 Gateway adapter 返回 `error: "failed"`，真实原因只在 `run.failed`、`tool.failed` 或 `workspace.blocked` 事件中；旧解析只显示状态词，前端又把失败渲染成系统气泡，导致界面只剩孤立英文 `failed`。
- 修复：兼容直接运行对象、`run` 包装、`data.run` 和 `data` 运行包；从失败事件提取脱敏摘要；通用状态词不再覆盖真实错误；无详情时显示中文兜底；终态带事件的运行统一按选中智能体消息渲染，保留头像、名称和可折叠事件轨迹。
- 回归：Gateway v1 与事件流相关测试 12 项通过；Node/Web 类型检查通过；生产构建通过；`git diff --check` 通过。
- 待人工验收：关闭旧窗口后重新启动最新 Agents One，创建新的 Hers Gateway v1 对话测试。预期不再出现孤立英文 `failed`，应显示 Hers 头像/名称、失败原因（或中文兜底）及事件明细。旧对话中已经持久化的 `failed` 文字不会自动重写。

### 2026-08-02：远程 Gateway `agent_offline` 诊断修复

- 根因：Gateway 在线只代表 `/capabilities` 可访问；Hers-2 的 Connector 离线时，`/runs` 会返回 `agent_offline`。该错误还可能嵌套在 `{ error: { code } }` 中，旧解析只读取顶层字段，随后界面只剩终态 `failed`。
- 修复：Remote Gateway 错误解析递归读取嵌套 `error`；`agent_offline` 和 `connector_offline` 转换为明确的中文恢复指引；保留真实失败状态与原始事件，不做静默重试或降级到其他智能体。
- 验证：`npm.cmd exec vitest run tests/agents-one-remote-gateway.test.ts` 11 项通过；`npm.cmd run typecheck` 通过；生产构建通过；`git diff --check` 通过。
- 手工验收：先在 Hers-2 所在设备启动 Agents One Plugin/Connector，确认它连接到与该 runtime 相同的 Gateway 地址和 Token；然后新建任务对话重试。仅连接测试通过不代表 Connector 在线；旧失败记录不自动改写。

### 2026-08-03：Gateway 事件语义与模型元数据收口

- Hers Connector 的真实联调根因已完成复盘：运行时注册 ID 与桌面 runtimeId 不一致、Connector Token 与 Gateway 不一致、单连接适配器缺少 runtimeId 路由、日志曾泄露 Token；均已改为多连接按 runtimeId 路由、Token 脱敏日志，并完成 ID/Token 对齐。
- 另发现计划任务僵尸态和手动/计划实例互踢：界面显示运行而 Connector 进程已退出，两个同 ID 实例每约 1.2 秒互相断开。现已清理为单实例，并由 `start_connector.bat` 启动且持续落盘日志。
- 桌面端增强 Event Stream v1 兼容：读取 `model_name`、`modelId`、`context_window_tokens` 等常见别名；运行或事件上报真实元数据后，输入区可显示对应模型和真实上下文窗口，不再回退为虚构默认值。
- 屏蔽两类伪思考：静态“远程智能体已返回新的答复”状态，以及内容与最终答复完全一致的 `reasoning.summary`。该屏蔽只影响展示与持久化噪声过滤；插件仍须从源头停止生成伪事件。
- 恢复数据层 `completed` 终态事件以保持 Runtime API、历史和测试契约；Renderer 继续隐藏这条通用完成标记，避免它混入用户可见的对话过程。
- 自动化验证：`agent-event-stream`、`agents-one-remote-gateway`、`agent-runtimes` 三个定向测试文件共 32 项通过。后续人工验收应覆盖 Hers、OpenClaw、Pi/Codex/Claude Code 的真实思考、工具、模型、上下文、错误、产物和重连路径。

### 2026-08-03：Event Stream v1 嵌套元数据与伪思考过滤补强

- Gateway 运行解析新增 SDK/Relay 常见响应信封兼容：从 `data`、`metadata`、`response`、`result`、`output`、`state`、`run` 中提取插件标识、模型、上下文窗口和用量，不要求远端必须把字段放在顶层。
- 模型字段兼容 `modelId`、`model_name`、`provider`，上下文窗口兼容 `contextWindowTokens`、`context_window_tokens`、`context_window` 等别名。远端真实上报后，任务输入区会显示该模型与实际容量；缺失时保持“默认模型/未知容量”，不伪造 1M。
- 伪思考过滤从“完全相等”扩展为“最终答复被完整复述或包裹在摘要中”的识别；`reasoning.summary` 只有在确为独立、简洁的工作摘要时才会展示和持久化。
- 影响边界：仅修改远程 Gateway 事件归一化与展示链路，未改写、删除或迁移已有智能体配置、对话历史和项目记录。
- 自动化验证：定向 Vitest 34 项通过，`npm.cmd run typecheck` 通过，`npm.cmd run build` 通过；构建仅保留既有 Vite 包体积提示。
- 插件对齐要求：`capabilities` 应返回 `plugin`（含 `id`、`version`、`kind`）和真实 Event Stream v1 能力；运行或事件应返回真实 `model`/`usage`，不得用最终答复冒充 `reasoning.summary`。

### 2026-08-06：对话错误与产物提醒卡收口

- 问题：Hers/Agents One 图片联调已经通过，但运行事件仍在答复前显示独立“错误”卡和“任务已发布新的产物”卡；它们没有补充用户可操作的信息，反而打断对话阅读。
- 根因：`runtimeChatMessageAdapter` 把 `error`、`timed_out` 和 `artifact_published` 事件统一转换为对话 `system` 消息；真实图片和文件其实已由执行记录中的 artifact 元数据独立渲染。
- 最小改动：仅在 Renderer 事件适配层停止生成错误、超时和产物发布系统卡。匹配到工具调用时仍保留失败状态，事件持久化、Runtime/Gateway 协议、诊断数据、智能体配置和历史记录均未修改。
- 回归保护：新增适配器测试，确认错误和产物提醒不进入对话，同时 hydrated 本地图片仍生成 `MEDIA` token 并正常走原生图片渲染。
- 验证：定向 Vitest 7 项通过，Node/Web TypeScript 检查通过，`lat check` 全量通过，`git diff --check` 在最终交付检查中执行。
- 已知风险与下一步：现有历史事件重新打开时也会按新适配器隐藏这两类卡，这是预期展示变化；错误诊断仍应通过工具失败状态、任务中心或日志查看。
- PowerMem：已通过本机 MCP stdio 兜底写入长期记忆 `740405127453605888` 并执行语义检索复核；当前会话未自动加载 PowerMem 工具，且 `codex mcp get powermem` 未找到注册项，后续应恢复全局注册以便新会话直接调用。

### 2026-08-06：多智能体协作冒烟失败修复前评估

- 改动原因：协作确认卡依赖远程智能体先返回结构化 proposal；但绑定工作区的 Gateway 成功轮次会被“必须有工作区审计或产物”规则统一拦截，合法的 proposal 控制轮次也被误判。单改 Renderer 无法恢复该终态，因此必须同时收窄主进程审计边界。
- 影响数据：不迁移、不删除、不重写 Runtime 配置、Workspace Grant、会话历史或用户文件；仅调整未来运行的终态判定、协作协议提示，以及历史/实时事件的展示过滤。
- 下游消费者：`RuntimeChat` 协作提案解析与确认卡、Gateway v1 终态协调、运行事件到 Hermes 风格消息的 Renderer 适配器。
- 失败模式：无效 proposal 绕过工作区审计、真实文件任务被错误标记成功、平台授权状态被误当作模型推理、协作指令仍被模型忽略。
- 防护与回退：只允许能够通过已启用 runtimeId 校验的 proposal 绕过本轮工作区产物审计；真实工具/文件任务的审计保持不变；授权事件仅从“思考”展示中过滤，不删除持久化记录。本修复作为 `1baedf5` 之后的独立提交，可整体回滚。
- 验证清单：先补 proposal 解析/协议、Gateway 审计和消息适配器失败用例；再运行相关 Vitest、Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check`；人工冒烟继续使用“编排 → 用户确认 → Pi 执行 → Claude 复核”的原任务。
- 实施结果：协作规则现在位于用户请求之前；明确多智能体/角色分工以及“为何没有确认界面”的重试轮次必须先返回 proposal，并禁止先调用工具。只有所有 assignment 都指向已启用 runtime 的有效 proposal 才能作为无工作区审计的控制结果放行。
- 展示结果：未来不再生成 Workspace Grant 建立/缺失的伪思考事件；既有会话中已经持久化的两类事件也会在 Renderer 适配层隐藏，真正的模型 reasoning、工具事件和诊断数据不受影响。
- 自动验证：协作 proposal、RuntimeChat、消息适配、Gateway Runtime 与协作存储 5 个测试文件共 63 项通过；Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check` 均通过。仍需在最新开发版执行一次真实 Gateway 冒烟，确认卡出现后由用户点击确认再派发。
- PowerMem：当前会话未自动注册 MCP 工具，已按 stdio 兜底写入长期记忆 `740449803531452416` 并执行语义检索；服务端提示 infer 索引异步处理，首次检索先召回了既有“任务对话是唯一交互式协作入口”等相关记忆。

### 2026-08-06：明确分工的协作确认改为平台本地生成（修复前评估）

- 二次冒烟现象：协调智能体已开始输出 `<agents-one-collaboration-proposal>`，但内容进入 `reasoning.summary` 且 JSON 中途截断；Gateway 没有最终答复，确认卡仍无法解析。继续加强提示词无法提供确定性保证。
- 改动边界：仅在共享 proposal 纯函数与 `RuntimeChat` 提交路径增加“明确点名多个已接入智能体并使用‘负责’分工”的本地识别与序列化；不修改 Runtime 注册、Gateway、Workspace Grant、IPC、配置和历史迁移。
- 影响数据与消费者：命中条件时不再创建远程运行，而是在当前对话新增一条可持久化的 agent proposal 控制消息；现有 proposal 卡、确认回调和后续协作执行继续消费同一格式。既有会话不重写。
- 失败模式与防护：名称误匹配可能生成错误分工，因此要求明确协作意图、至少两个不同已启用 Runtime、每个角色具有“负责”职责；runtimeId 始终来自当前目录而非用户文本。未满足条件时仍走原模型建议通道。
- 回退与验证：作为 `27a9482` 之后的独立提交，可整体回滚；测试覆盖“你负责…Pi 负责…Claude 负责…”解析、未知名称/单角色不触发、RuntimeChat 直接出现确认卡且不启动远端任务、持久化后可恢复，并复跑协作测试、类型检查、构建及 `lat check`。
- 实施结果：明确分工由共享纯函数在本地解析，名称/别名只映射到当前启用 Runtime；当前协调智能体即使未出现在外部 catalog map 中也会纳入可信集合。命中后写入与既有模型 proposal 完全相同的可持久化控制消息，直接显示确认卡，不创建 Gateway Run。
- 回退兼容：只有明确协作意图且至少两个角色带有职责时才走本地路径；单角色、概念咨询和开放式“请推荐协作方案”仍交给协调智能体。现有模型 proposal、用户确认、协作配置和后续派发链路均保留。
- 自动验证：proposal 纯函数、RuntimeChat、消息适配、Gateway Runtime 与协作存储 5 个测试文件共 66 项通过；生产构建（含 Node/Web TypeScript 检查）通过。`lat check` 与最终差异检查在提交前执行。
- PowerMem：已通过 MCP stdio 兜底写入长期记忆 `740454907009564672` 并执行语义检索；新记忆仍按服务端提示异步进入 infer 索引。

### 2026-08-06：同一对话多智能体自动闭环（修复前评估）

- 改动原因：最新冒烟已经能显示单个 Runtime 的思考与工具事件，但协作仍要求用户先打开配置对话框并再次提交同一任务；实施角色的文字交付契约还可能被贴到未验证的工作目录或 diff 证据上，导致目标文件不存在时复核角色仍被错误推进。单改展示层无法建立可信闭环，因此必须同时收窄 Renderer 编排器、Layout 协作持久化回调和本地 Runtime 产物登记边界。
- 影响数据：不删除、不迁移、不批量重写 Runtime 配置、头像名称、历史消息、项目文件或既有协作记录；新任务会自动保存同一份 `TaskCollaborationRecord`，角色运行记录只增加重试次数等向后兼容字段，本地 CLI 仅为未来完成的 full-access Run 补充主进程验证过的文件 artifact。
- 下游消费者：`RuntimeChat` 发送/轮询/顺序派发与消息身份展示、`Layout` 的协作保存和当前 Run 映射、`agent-runtimes` 本地 CLI 终态归档、协作状态面板/时间线/历史恢复逻辑。
- 失败模式：误识别普通对话并自动启动协作、重复写入用户消息、主进程接受越界路径或伪造 SHA、验收失败无限重试、重试读取旧产物、运行中显示错误智能体头像、旧协作记录无法恢复。
- 防护与回退：自动启动仅接受已通过当前启用 runtimeId 白名单的结构化 proposal；复用当前用户消息，不再派发第二次 submit 事件；文件必须位于已选择工作区、真实存在且主进程重算 SHA-256 与声明一致；自动回派设置有界次数并保留每次消息/时间线；新增字段均可选。修改按“可信文件 artifact”和“自动闭环 UI”分层，可分别回滚到 `a4b2a3c`。
- 验证清单：先补本地文件 artifact 的路径边界/存在性/SHA 回归，再补明确分工自动启动且不重复用户消息、实施无真实交付不启动复核、验收不通过自动回派实施并重新复核、运行中切换当前角色头像的 Renderer 回归；随后执行定向 Vitest、Node/Web TypeScript、生产构建、`lat check`、`git diff --check`，最后用 Hers-2 → Pi → Claude → Hers-2 真实冒烟。
- 实施结果：明确点名分工由客户端白名单解析后直接保存并启动，不再打开首次配置对话框，也不再通过 `agents-one:submit-task-message` 重复写入同一用户要求；开放式请求仍由主智能体输出 proposal，但该可见规划轮次会直接作为负责人交接，平台从下一角色继续执行。
- 对话可见性：每个角色的完成消息继续保存独立 Runtime 名称、头像、颜色、角色和执行事件；运行中的思考/工具行改用当前正在执行的 Runtime 身份。负责人首次编排和最终验收是两个真实可见轮次，实施与复核也各自保留完整消息和事件。
- 可信交付：本地 Codex、Claude Code、Pi 的 full-access 终态新增主进程文件核验。只有声明路径位于所选工作区、文件真实存在且重算 SHA-256 与声明一致时才发布 `file` artifact；Renderer 不再用模型文字覆盖 worktree/diff 路径。实施没有可信文件或 diff 时不会启动复核。
- 闭环恢复：复核输出“不通过”时，平台保留失败消息和时间线，清除本轮陈旧证据，把复核结论注入对应实施角色后自动重试，再次进入复核；最多三次实施尝试，超过上限才等待人工介入。最终只有负责人基于登记证据输出“通过”才把任务标记成功。
- 自动验证：本地交付、三类 Runtime、proposal、协作存储、RuntimeChat、消息适配、协作查看与手动配置 8 个测试文件共 74 项通过，其中 RuntimeChat 27 项覆盖开放式 proposal 自动接力；Node/Web 类型检查与生产构建通过。当前 PowerShell 找不到 `lat` 可执行文件，已更新并人工核对新增 `lat.md` 源码锚点，待工具恢复后补跑 `lat check`；最终 `git diff --check` 通过。
- PowerMem：当前会话未加载 MCP 工具且 `codex mcp get powermem` 未找到注册项，但服务脚本、API Key 与健康检查正常；已按 stdio 兜底写入长期记忆 `740600315727839232` 并执行语义检索。服务提示 infer 异步处理，本次即时检索先召回了既有“任务对话是唯一协作入口”和真实审计门禁等强相关记忆。

### 2026-08-07：多智能体协作冒烟失败复盘与闭环修复

- 测试结论：8月7日冒烟未通过。真实任务记录显示角色顺序被 Runtime 注册顺序打乱为“负责人 → Claude 复核 → Pi 实施”，Claude 在实施前必然报告 `test.txt` 不存在；Pi 随后虽在本机写入文件，远程 Hers-2 终验又把本机路径当作可直读目录，因远程环境文件系统不同而重复误判“不通过”。
- 头像根因：协作回复已经保存 `agentRuntimeId/agentName/agentAvatar/agentColor`，但 RuntimeChat 适配器将每条回复降级为公共 `MessageList` 身份，历史和实时消息都沿用了负责人头像。Pi 的自定义头像在桌面配置中存在，Claude 未配置自定义图片时应显示其稳定字母头像，而不是继承 Hers-2。
- 修复边界：新增依赖顺序排序（负责人/协调 → 实施 → 复核/验收），对旧记录重跑也在执行前收口顺序；远程终验只消费平台主进程已核验的文件证据，不再附带项目证据包诱导其访问错误文件系统；协作存储补齐文件大小、SHA-256、来源机器、变更摘要、重试次数、终验阶段和时间线；消息适配与实时事件行按生产 Runtime 渲染名称、头像、颜色和角色。未改写用户的 `desktop.json`、既有对话内容或项目文件。
- 回退与风险：排序保持同一阶段内原有相对顺序；旧协作记录继续可读，新增终验角色以 `::final-review` 关联基础负责人；无自定义头像的 Runtime 继续使用字母回退。若远程模型仍违反证据审查规则，平台仍会保留其不通过结论并进入有界重试/人工介入。
- 自动验证：协作 proposal、RuntimeChat 闭环、消息身份适配、任务协作存储和本地交付验证定向测试通过；Node/Web TypeScript 检查通过。待补生产构建、`lat check` 和最终真实 Hers-2 → Pi → Claude → Hers-2 冒烟。
- 新一轮复测定位：新建任务实际停在 Pi 实施阶段，Pi 运行 `300000ms` 后超时。Pi 会话被继承为只读工具集 `read/grep/find/ls`，没有 `write/edit/bash`，因此无法创建 `smoke-test.txt`；这不是 Pi 网络故障，也不是 Claude 复核先行。
- 修复：Pi 的 `implementation/full_access` 启动参数显式授予 `read,bash,edit,write,grep,find,ls`；协作启动前新增实施角色权限预检，未选择“完全访问”立即阻断并提示，不再无提示等待 5 分钟。远程负责人仍可先以只读方式编排，本地 Pi/Claude 实施角色按本机权限执行。
- 自动验证补充：Pi Runtime 与 RuntimeChat 定向测试 35 项通过；全量 190 个测试文件、1899 项通过、13 项跳过；Node/Web TypeScript 检查与生产构建通过。待重启开发版后，以 `<workspace-root>\\test` 目录重新执行完整 Hers-2 → Pi → Claude → Hers-2 人工冒烟。

### 2026-08-09：协作过程实时呈现与交付物文件交互

- 冒烟现象：Pi、Claude Code 和 Hers-2 的协作角色运行时只显示“处理中”，思考、工具调用与最终答复在终态一起出现；工具调用作为首条事件时没有可见智能体名称；本地交付物沿用下载按钮，无法像 Codex 文件链接一样直接打开和执行路径操作。
- 实时根因与修复：`RuntimeChat` 的协作循环虽然每 900ms 读取 Runtime Run，但中间快照只写入局部变量。现在每轮都通过单调事件合并更新活动 Run，终态薄快照也不会覆盖前序事件，因此三类 Runtime 只要上报事件即可逐步显示并持久化完整轨迹。
- 身份修复：思考行在角色首条记录显示 Runtime 头像与名称；没有 reasoning、直接从工具开始的 Claude/Pi/Hers 轨迹也由工具组显示对应身份，后续连续行仍共用一次身份，避免重复头像。
- 文件交互：本地 Runtime artifact 与正文识别出的本机文件路径统一渲染为文件链接；悬停显示完整路径，单击用默认应用打开，右键提供“打开文件、复制路径、复制文档内容、在资源管理器中打开”。URL/data 产物继续保留下载/另存行为。
- 变更边界评估：实时刷新与身份仅修改 Renderer 状态和展示；文件右键菜单复用现有 `read-file`、`open-file-in-editor`、剪贴板和 Electron shell 能力，新增最小 preload/IPC 通道，不修改 Runtime 注册、凭据、配置写入、会话结构或历史迁移。复制内容仅对存在且不超过 5 MiB 的文件启用；可按 Renderer、IPC 两层独立回滚。
- 自动验证：RuntimeChat、MessageList、MediaImage、AttachmentChip 和 preload API 定向测试 188 项通过；全量 191 个测试文件、1903 项通过、13 项跳过；Node/Web TypeScript 检查、生产构建和 `lat check` 均通过。最终差异检查在交付前执行。
- PowerMem：当前会话未自动暴露 MCP 工具且全局注册未加载，已按 stdio 兜底完成健康检查、写入长期记忆 `741341184399507456`，并以“协作运行思考工具实时显示、交付物文件链接”执行语义检索复核；新记忆按服务端提示异步进入 infer 索引，检索已召回既有同一对话多角色独立事件与可信 artifact 规则。

### 2026-08-09：协作中的定向多轮沟通（实施前评估）

- 改动原因：现有“介入”只能保存一条指令并立即恢复整条串行链路，无法点击角色头像进入与单智能体一致的多轮沟通，也无法在人工确认前持续阻断后续复核和验收。
- 改动边界：优先复用 Renderer 的 `MessageList`、角色执行循环和介入抽屉；共享类型只为介入记录增加可选回复与回复时间，主进程协作存储仅保留这两个向后兼容字段。不修改 Runtime 注册、用户配置、CLI 参数、历史迁移或既有消息内容。
- 影响数据与消费者：未来的 `TaskCollaborationIntervention` 可同时持久化用户指令与目标角色回复，角色运行记录可选保留 Runtime 会话 ID；`RuntimeChat` 将问答注入目标角色和明确选择共享后的后续角色，并在提供方支持时复用同一角色会话。旧记录缺少新字段时保持原行为。
- 失败模式：头像误指向同 Runtime 的其他角色、暂停后仍启动下游、介入回复未持久化、共享上下文越界、恢复时重复执行已完成角色。使用稳定 assignment id、显式 `role/shared` 可见性、单角色 hold 点和定向回归测试防护。
- 回退方案：新增字段均为可选，旧存储格式无需迁移；头像回调、定向发送和 hold/resume 参数可作为 Renderer 小补丁独立回退，现有“保存指令”恢复路径继续可用。
- 验证清单：覆盖角色面板与消息头像入口、自动暂停、连续两轮目标角色运行、共享回复进入后续角色提示、人工继续前下游不启动、继续后从下一角色开始、重启后介入回复仍在；再执行定向 Vitest、Node/Web 类型检查、生产构建、`lat check` 与差异检查。
- 实施结果：角色面板头像和对话消息头像均可进入定向沟通；打开时自动取消当前活动角色。每次发送只重跑目标角色并在成功回复后保持整条依赖链暂停，用户可继续多轮沟通、显式点击“继续后续任务”，或在抽屉中改派当前角色。
- 上下文与证据：默认共享本轮问答，也可切换为仅目标角色；用户消息和目标回复共同进入主对话及持久化介入记录。支持的 Runtime 会复用同一角色会话 ID；重新执行或改派时清除该角色及下游的陈旧 artifact/验收结论。
- 自动验证：定向 3 个测试文件 39 项通过；全量 191 个测试文件、1907 项通过、13 项跳过；Node/Web TypeScript 检查和生产构建通过。测试覆盖头像路由、活动角色暂停、连续两轮不启动下游、共享回复传递、会话复用、人工恢复、改派及重启持久化。
- PowerMem：当前会话未自动暴露工具且全局注册未加载，已按 stdio 兜底完成健康检查、写入长期记忆 `741360595361595392` 并执行语义检索；服务健康，新记忆仍按 infer 异步进入索引，当前检索已召回既有“任务对话是唯一协作入口”和“角色独立呈现”的强相关记忆。

### 2026-08-09：DAG 编排与任务/项目归档（实施前评估）

- 改动原因：现有协作仅按语义排序串行运行，无法表达独立并行分支和多前置汇合；侧栏任务只能直接删除，项目没有归档入口，用户也无法在设置中恢复或永久清理已归档对象。
- DAG 边界：为角色分配增加可选 `dependsOn`，新增共享纯函数负责校验未知依赖、自依赖、环路、拓扑层和下游集合。无显式依赖的旧记录继续使用原串行顺序；显式 DAG 才启用并行波次。调度仍由 Agents One 客户端掌握，不允许模型绕过 runtimeId 白名单、权限预检、artifact 和验收门禁。
- 归档边界：新增 profile 级独立归档 JSON 与最小 IPC/preload API，只保存任务/项目身份、标题、路径、Runtime 类型和归档时间；不改写会话正文、Runtime 配置或项目文件。侧栏读取归档索引后过滤，恢复只删除归档标记。
- 永久删除：仅设置中的归档管理可发起并要求二次确认；任务按原有原生会话/Runtime 会话删除路径清理，项目永久删除只移除桌面项目登记和归档记录，绝不删除磁盘目录或项目内文件。
- 下游消费者：协作配置对话、RuntimeChat 调度与恢复、协作存储清洗；侧栏项目/任务菜单、设置导航与归档管理面板、IPC 注册和 preload 类型。
- 失败模式与防护：环路导致死锁、并发完成覆盖状态、汇合节点提前启动、分支失败仍推进、旧记录顺序变化、归档任务重新出现在分页结果、跨 profile 误删。以纯图算法测试、按层启动/全部完成后汇合、失败后只阻断后代、旧串行回归、profile 归档存储测试和永久删除确认防护。
- 回退方案：`dependsOn` 和归档字段/API 均为可选增量；DAG 调度可回退到旧串行分支，删除归档索引即可恢复全部侧栏对象。项目文件不进入删除范围，因此归档功能回退不会造成磁盘数据丢失。
- 实施结果（DAG）：角色支持稳定 `id + dependsOn[]`；共享图模块完成缺失依赖、自依赖、重复 ID、环路、拓扑层、后代和汇合终点校验。显式 DAG 按 ready layer 并行派发，汇合节点等待全部前置成功；单分支失败只阻断其后代，其他独立分支继续。旧记录完全不含 `dependsOn` 时仍走原串行闭环。负责人终验自动依赖所有终点分支。
- 实施结果（配置与持久化）：配置对话增加前置角色多选和错误提示，删除角色会同步清理依赖；proposal 协议支持 DAG JSON。协作存储保留依赖、工作区访问和并行活动角色 `activeAssignmentIds`，字段均为可选，无历史迁移。
- 实施结果（归档）：任务菜单增加“归档任务”，项目标题增加项目操作/归档入口；归档任务、归档项目及项目内任务都会从侧栏隐藏。设置新增“归档管理”，支持搜索、任务/项目筛选和恢复；只有已归档任务显示永久删除并二次确认。原生、本地 Runtime、远程/SSH 任务按既有删除通道处理；项目始终只处理登记元数据，绝不删除目录。
- 自动验证：全量 194 个测试文件通过，1915 项通过、13 项跳过；新增用例真实保持两个 sibling Runtime 运行并确认 join 在两者成功前不派发，同时覆盖图校验、归档持久化、项目登记移除、协作存储和归档管理 UI。Node/Web TypeScript 检查、生产构建和 `git diff --check` 通过；`lat check` 在最终交付前执行。
- 明日人工检查：①配置一个“规划 → 前端/后端并行 → 验收汇合”真实任务，观察两个分支的实时思考/工具与汇合时机；②分别归档普通任务、项目及项目内任务，重启后确认仍隐藏；③在设置归档管理中搜索、筛选、恢复；④对临时归档任务执行永久删除，确认不会恢复且项目磁盘目录未受影响。
- PowerMem：当前长会话未加载 MCP 工具表且 `codex mcp get powermem` 未发现注册项；按既有 stdio 兜底完成健康检查并写入长期记忆 `741377466190266368`，随后语义检索成功召回相关 Agents One 记忆，新记录按服务端提示异步进入 infer 索引。

### 2026-08-09：项目/任务菜单补齐与侧栏分页稳定性

- 问题与根因：项目菜单只有归档且采用独立小卡片；任务菜单缺少会话 ID 和工作目录操作。侧栏分页把每轮固定查询的 Runtime 对话计入原生 `sessions.json` 的 offset 与 `hasMore`，造成后续页重复、`hasMore` 永远为真，并被初始同步反复重置到第一页，表现为列表底部持续“加载中”和界面跳动。
- 项目菜单：项目与任务统一复用同一套 Portal 浮层、样式、动画、视口钳制和关闭规则；项目增加置顶/取消置顶、在资源管理器中打开、重命名、归档和移除。浮层支持外部点击、侧栏滚动、窗口失焦和 `Esc` 关闭；内联重命名的 `Esc` 会取消并抑制卸载时的失焦保存。
- 任务菜单：增加“在资源管理器中打开”和“复制会话 ID”。只有存在上下文工作目录时才启用资源管理器操作；会话 ID 直接复制稳定任务 ID，不改写对话或标题。
- 数据边界：项目自定义名称与置顶状态只写入桌面项目登记，不重命名/移动磁盘目录。移除项目只删除桌面登记并解除原生及 Runtime 对话的项目关联，使任务回到“对话”分组；不会删除任务、历史、项目目录或任何文件。归档仍使用独立 profile 级标记。
- 分页修复：原生缓存分页拥有独立的 `loadedNativeCount`、lookahead 和 `hasMore`；Runtime 对话只在刷新时合并一次，不参与原生 offset。初始缓存同步保留已经加载的原生窗口，不能再把第二页压回第一页。新增纯分页函数覆盖满页、末页与 offset 推进。
- 回退方案：菜单 UI、项目登记 API 和分页 helper 可分层回退；项目移除没有磁盘删除副作用，且解除关联后的任务仍保留，因此回退不会造成历史或项目文件丢失。
- 自动验证：项目/任务菜单、原生分页、项目登记和 Runtime 项目解除关联 5 个定向测试文件共 9 项通过；全量 197 个测试文件通过，1920 项通过、13 项跳过；Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check` 均通过。
- 明日人工检查：①项目菜单样式与任务菜单一致，`Esc` 可关闭；②置顶排序、重命名、资源管理器打开和移除后任务回到“对话”；③任务复制会话 ID 与有/无工作目录时的菜单状态；④连续滚动超过两页，确认列表不跳动、不重复且最终停止加载。
- PowerMem：当前会话未暴露 MCP 工具，已通过本机 stdio 兜底完成健康检查并写入长期记忆 `741574340679565312`；新记忆按服务端提示异步索引。随后以“Agents One 任务对话、项目管理、协作”执行语义检索，召回 5 条既有相关记忆，最高相关度 0.713。

### 2026-08-10：归档项目任务清单、项目删除与字号收口

- 现场问题：归档管理使用浏览器默认 `h2/strong/select` 字号，明显大于设置页其他面板；归档项目无法查看被项目归档一并隐藏的任务，也没有删除入口。
- 展示修复：归档页改用设置系统一致的 13px 主文字、12px 辅助文字和紧凑控件；项目卡片增加“任务对话”折叠区，默认关闭。展开后同时列出原生会话缓存和 Runtime 对话索引中项目路径一致的任务，兼容 Windows 斜杠、大小写和末尾分隔符差异，不读取或改写对话正文。
- 搜索与加载：任务索引按 100 条分页并设置最大页数防护；项目折叠条在索引完成后显示任务数。归档搜索也能通过项目内任务标题命中对应项目，任务清单仍仅在用户展开时渲染。
- 项目删除：归档项目现在与任务一样显示删除按钮，但使用独立确认文案。确认后仅清除 Agents One 项目登记、归档标记和原生/Runtime 任务的项目关联，使保留任务回到“对话”；绝不删除项目目录、磁盘文件或任务历史。
- 回退与风险：折叠清单和字号仅为 Renderer/CSS 增量；项目删除沿用既有 `deleteArchivedItem` IPC，并补齐与普通“移除项目”一致的解除关联行为。所有底层对话仍保留，可按 UI、IPC 两层独立回退。
- 自动验证：归档 UI、归档存储、项目登记和 Runtime 解除关联 4 个定向测试文件共 9 项通过；降低并发后的全量 197 个测试文件通过，1921 项通过、13 项跳过；Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check` 均通过。两次默认高并发全量运行分别出现既有 Gateway 50ms 定时竞态和 Windows 临时文件 `EPERM`，相关用例单独复跑均通过，降低并发后全量无失败。
- PowerMem：当前会话未暴露 MCP 工具，已通过本机 stdio 兜底完成健康检查、写入长期记忆 `741693308794830848`，并以“归档项目、任务清单、删除不删除磁盘文件”执行语义检索，成功召回 5 条相关记忆。

### 2026-08-10：真实 DAG 会话复盘与多分支实时呈现

- 复盘对象：只读检查会话 `runtime-conv-0e41fcc3-36f8-45f3-bfc3-001324e1bc12` 及其协作记录，未重跑任务、未修改历史消息或测试交付物。会话主 Runtime 为 Hers-2；原 proposal 却把 `plan` 和 `acceptance` 指派给 Hers，并由平台额外补了一个无依赖的 Hers-2 负责人节点，形成两个根节点。Pi 与 Claude 的实际运行时间重叠，DAG 并行成功，但 Renderer 的单个 `taskRun/activeRuntimeId` 被后写入的 Claude 覆盖，导致 Pi 活动态直到终态才出现。
- 身份与调度修复：自动 proposal 在持久化前由平台把负责人、规划/编排/汇合与验收职责锚定到当前对话 Runtime；实施与独立复核仍可自由选择其他 Runtime。首个负责人规划节点复用当前可见 proposal 轮次；负责人已有显式末端验收节点时不再追加重复的合成终验。这样同类智能体不能在用户未指定时替换被直接交办的 Hers-2。
- 并行实时修复：显式 DAG 以 assignment 为键维护多条活动 Runtime Run；同一波次的 Pi、Claude 等分支分别保留头像、名称、角色、事件和占位状态，并同时呈现。停止任务会取消全部活动 Run，不再只取消最后写入的分支。
- 轨迹真实性：该实测中 Pi 有 29 条事件、Claude 有 18 条（含结构化工具名、调用 ID、输入与结果），Hers/Hers-2 各轮只有 4–5 条远程事件，主要是生命周期、最终答复及与最终答复重复的 summary。客户端会过滤冒充思考摘要的最终答复镜像；提供方未上报思考摘要或工具事件时明确显示“运行轨迹未上报”，不伪造内部思维或不存在的工具调用。完整远程摘要/工具轨迹仍需对应 Gateway Connector 实际上报 Agent Event Stream。
- 看板与措辞：协作分工、交付物与验收、时间线收成右下角紧凑悬浮看板，默认折叠，字号统一为 13px/12px，避免占据首条对话上方的大面积空间；头像介入和恢复动作保留。智能体提示、状态和用户答复统一使用“交付物”，新输出标记为 `[交付物]`，主进程继续兼容旧 `[交付契约]` 历史。
- 自动验证：负责人锚定、实施职责防误判、远程轨迹缺失/最终答复镜像、交付物新旧格式及并行双分支实时呈现等 4 个定向测试文件共 54 项通过；全量 Vitest 通过；Node/Web TypeScript 检查、变更文件 ESLint（0 error）及生产构建通过。全仓 ESLint 在 120 秒窗口内未结束，变更文件检查仅有既有格式与 Hook 警告。
- PowerMem：当前会话未暴露 MCP 工具且全局注册未加载，已按 stdio 兜底完成健康检查并写入长期记忆 `741713323166269440`；随后检索召回既有 DAG 并行、汇合和远程 Gateway 记忆，新记录按服务端提示异步进入 infer 索引。

### 2026-08-10：并行协作身份、思考提示与看板收起修复

- 复盘真实任务 `runtime-conv-9b498ccb-debc-427a-9b0d-df04ecbbdea4`：Pi 上报了 `progress` 与工具事件；Claude 只上报工具事件，Hers-2 验收只上报生命周期与最终答复，因此后两者本轮没有可展示的真实思考摘要，前端不得伪造。
- 根因一：并行执行时，最后启动的子 Runtime 被当成整段主会话的默认外观，导致 Hers-2 的历史头像/名称临时变成 Claude。现已分离“主会话默认外观”和“当前子任务事件身份”，每条子任务轨迹仍保留自己的 Runtime 身份。
- 根因二：“思考记录未上报”系统卡不渲染头像，却占用了同身份连续行的头像位，导致随后 Claude/Hers-2 最终答复没有头像和名称。现由下一条真实答复重新承担头像；Claude CLI 若实际返回 `thinking` 内容块，也会保存为真实思考记录。
- 根因三：自动协作先创建 Runtime 会话、后保存协作任务，旧关联回调可能在 `persistedTaskId` 尚未进入 Run 状态时提前返回。本轮自动启动入口会在会话 ID 已存在后直接补链；重开历史时优先按 `conversationId` 恢复协作，并可用消息执行与角色运行共享的唯一 `runtimeRunId` 恢复此前未链接的任务。
- 交互：右下协作看板新增“隐藏协作看板”按钮；隐藏后保留紧凑“协作看板”按钮，可随时原位调回，不影响角色状态、产物、验收或时间线。
- 变更边界：仅调整 Runtime 会话渲染、Claude 结构化事件解析、协作会话关联/恢复与看板 UI；未修改 Runtime 注册、用户凭证、智能体配置或既有历史内容。
- 自动验证：定向 Vitest 95 项通过，最终受影响测试 86 项复跑通过；Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check` 均通过。旧未链接任务的 run-id 恢复路径和看板隐藏/显示均有回归用例。

### 2026-08-10：Hers-2 Connector Agent Event Stream v1 最终验收

- 验收对象：Hers-2（`hermes-home2`）远端 Connector/Relay，Gateway 使用 `agents-one-plugin-sdk` v0.1.1。Connector 已将真实 Hermes SSE 推理摘要、工具生命周期、Workspace Grant 事件、最终答复、模型与用量映射到 Agent Event Stream v1；没有发送原始思维链或伪造工具事件。
- 能力声明：删除依赖 `_observedEventTypes` 的运行后动态声明，Connector 启动及重启后均稳定返回 `reasoningSummaries=true`、`toolEvents=true`、`modelMetadata=true`、`usageMetadata=true`，与实际 Adapter 能力一致。
- 独立远程复核：直接查询真实 Run `run_bda14bc2-b9ef-4125-a240-65a40ba57d12` 两次，均返回 HTTP 200、`succeeded`、12 个唯一事件；`sequence` 严格为 1–12，两次 event ID 列表完全一致。事件依次覆盖 `run.started`、三组真实工具开始/完成、`workspace.requested(list, .)`、`workspace.completed(list, .)`、`reasoning.summary`、带真实 text/model/usage 的 `assistant.completed` 和 `run.completed`。
- Workspace 验收：`workspace_gateway` 的 started/completed 复用稳定 `callId=call_run_7e10_3_workspace_gateway`，Workspace 事件保留 `operation=list` 和相对路径 `.`；成功路径与此前保留的 `workspace.blocked/tool.failed` 失败路径均有真实证据。
- 附带修复：修复 Hermes 工具结果含 `"error": null` 时的误判失败；在 SSE、Connector 与 Adapter 链路保留 Workspace args/operation/path；补齐 SDK EventJournal 对 `operation/path` 的白名单；修复 SDK 字符串输入导致的 `Buffer.concat` 崩溃。
- 最终结论：通过。当前 Gateway v1 能力声明、事件顺序、稳定 ID/sequence、成功与失败 Workspace 路径、最终输出以及模型/用量均有真实运行证据支撑。
- PowerMem：当前会话未暴露 MCP 工具，已通过本机 stdio 兜底成功写入本次最终验收事实；随后的语义检索复核因 PowerMem 五小时账户配额耗尽返回 429，写入本身成功，待配额于服务端提示时间恢复后可再次检索确认。

### 2026-08-10：Plugin SDK 0.1.2 发布包

- 发布原因：SDK 0.1.1 的 `refresh()` 在追加 Adapter 事件前先生成 `run.completed/run.failed`，迫使 Hers-2 Adapter 直接写内部 journal；Event Stream 四项增强能力又被固定声明为 `true`，无法表达 Adapter 的真实支持范围。现场还发现 Workspace `operation/path` 被白名单剥离，以及字符串请求 chunk 触发 `Buffer.concat` 崩溃。
- 核心修复：Gateway refresh 先合并 output/error/artifact/model/usage 和 `getRun().events`，最后应用终态；`eventStreamCapability` 只返回 Adapter 在 `capabilities.eventStream` 中稳定声明为 `true` 的标志，基础 Adapter 仍保留 protocol/transport。Connector 升级后可删除 `/capabilities` 拦截、直接 `record.journal` 写入和 SDK 本地白名单补丁。
- 事件与安全：EventJournal 保留允许的 Workspace `operation`、Grant 相对 `path`、稳定 `callId` 及非负工具时长；绝对路径和包含 `..` 的路径不进入持久事件。请求体读取统一兼容 Buffer、Uint8Array 和字符串 chunk。
- 版本与回退：`package.json`、插件 manifest 和 Gateway capability 版本统一升级到0.1.2；旧 `agents-one-plugin-sdk-0.1.1.tgz` 保留，可由 Connector 回装并恢复原 Adapter 备份。未修改用户配置、Runtime 注册、对话历史或 Hers-2 远端服务。
- 发布物：`plugins/agents-one-plugin/agents-one-plugin-sdk-0.1.2.tgz`，14,946 bytes，SHA-256 `a5a3836a3c9bf229ce2a6e467b9f16a734b9332c956fdc55dcd085cebebde61a`；包内 `package.json` 与 manifest 均确认版本0.1.2。
- 自动验证：SDK 自身13项测试通过；桌面端 Event Stream、Remote Gateway 和 Agent Runtime 定向47项通过；Node/Web TypeScript 检查和生产构建通过；`npm run verify`、pack 内容检查、`lat check` 与 `git diff --check` 均通过。
- PowerMem：已按 stdio 兜底尝试同步0.1.2发布事实，但 `memory_store` 与 `memory_search` 均因 PowerMem 五小时账户配额耗尽返回 429，未写入云记忆；完整事实已保存在本地进展日志，待服务端提示的 2026-08-10 17:32:46 +0800 后可重试。

### 2026-08-10：设置页品牌与关于信息收口

- 问题：设置左侧导航仍显示冗余的“Agents One”分组标题；“关于与更新”混入本地 Hermes 引擎维护卡片，桌面端又误用旧 Hermes 图标和上游 Hermes Desktop `0.7.3` 版本。
- 改动边界：仅调整设置 Renderer 展示、Agents One 产品版本元数据和对应文档；保留“关于与更新”“日志与诊断”等入口，不修改 Runtime 注册、用户配置、IPC、更新状态机或历史数据。
- 实施：所有设置入口合并到一个“通用”分组；关于页只保留 Agents One 桌面端卡片，使用正式 dawn-ring 标志；产品版本从重命名前的上游版本线重置为 Agents One `0.1.0`，界面仍通过 Electron `app.getVersion()` 读取真实构建版本。
- 回归保护：新增设置导航和关于页组件测试，覆盖单一分组、Hermes 卡片移除、正式 Logo、版本显示及桌面更新操作；相关设置测试 5/5、Node/Web 类型检查、生产构建和变更文件 ESLint 均通过。

### 2026-08-11：Pi 模型请求失败诊断与错误语义修复

- 现场结论：失败会话 `runtime-conv-e6b86741-a785-42b2-a1d0-6f516b1e7850` 使用 `openai-codex/gpt-5.6-luna`，用量为 0；对应 Pi 原生会话连续记录 `stopReason=error / errorMessage=fetch failed`，但 CLI 以退出码 0 结束，桌面端误记为成功并显示“没有返回可显示的最终答复”。
- 对照验证：用户切换至 `ark/deepseek-v4-flash` 后，会话 `runtime-conv-f5871dc5-0f87-47e8-bc55-2fedca0ed546` 连续两轮成功，分别返回 3150、3802 tokens。由此确认 Pi Runtime、工作区与会话 UI 正常，问题集中在原 OpenAI Codex 模型请求链路；原模型在修复逻辑下单独验证 120 秒仍未完成，未宣称已恢复该模型。
- 修复：Pi 子进程继续使用最小环境白名单，同时补传标准大小写代理变量；完成时解析 Pi JSONL 的最后 assistant 结果，将退出码 0 中的结构化模型错误转为失败状态。成功重试会覆盖较早的瞬时错误，`fetch failed` 会显示可操作的网络/代理提示，不再伪装成空成功。
- 变更边界：仅修改 Pi 本地 Runtime 的子进程环境与终态判定，以及对应测试/文档；未更改智能体注册、用户模型选择、认证信息、历史会话或 Ark 配置。诊断请求使用独立 Pi session，超时后确认无残留诊断进程。
- 自动验证：Pi Runtime 与输出摘要定向测试 15 项通过；Node/Web TypeScript 类型检查与生产构建通过；变更文件 ESLint 为 0 error（仅有仓库现存 CRLF/Prettier 警告），`lat check` 与 `git diff --check` 通过。

### 2026-08-11：Runtime 对话上下文占用与项目文件面板恢复

- 现场问题：Pi、Claude Code 等 Runtime 对话的输入栏没有上下文占用仪表；同一输入栏的项目树按钮虽然切换了 `worktreeVisible` 状态，却没有渲染右侧文件面板，导致浏览项目文件、查看文档和在项目路径打开终端全部无效。
- 元数据根因：RuntimeChat 只读取 `contextUsedTokens`。真实 Pi 使用 `input/cacheRead/cacheWrite`，Claude Code 使用 `input_tokens/cache_read_input_tokens/cache_creation_input_tokens`；现有归一化只保留部分输入/总量，既丢失缓存 tokens，也不能用包含输出的 `totalTokens` 代替上下文占用。
- 修复：本地 CLI 元数据边界把本轮输入与缓存读取/创建相加为 `contextUsedTokens`，明确排除输出 tokens；RuntimeChat 从当前 Run 或最近持久化回复恢复用量，优先采用实际上报的上下文窗口，本地模型缺失窗口时复用模型族映射。远程 Runtime 仅有 `inputTokens` 时仍不猜测占用。
- 文件面板：本地 Codex、Claude Code、Pi 对话重新复用原生 `WorktreePanel`；项目树在右侧展示、支持目录展开与文件查看、宽度拖拽，并通过既有 `open-terminal` IPC 在选中项目路径打开终端。远程路径不会交给本地文件面板。
- 变更边界：修改本地 Runtime 元数据归一化和 RuntimeChat 展示接线，未改写智能体配置、模型选择、会话正文、工作区文件或终端实现。
- 自动验证：Agent Runtime 与 RuntimeChat 定向测试 2 个文件、63 项通过；Node/Web TypeScript 类型检查与生产构建通过；变更文件 ESLint 为 0 error（4 条为工作区既有 Hook/Prettier 警告），`lat check` 与 `git diff --check` 通过。

### 2026-08-11：Runtime 上下文窗口按实际模型动态解析

- 现场问题：Pi 对话虽已显示上下文占用，但 `ark/deepseek-v4-flash` 的上限固定落到静态模型族兜底 `131072`，与 Pi 模型目录声明的 `1000000` 不一致；切换模型也无法同步更新分母。
- 根因：RuntimeChat 没有调用原生对话的异步模型窗口解析链，且 Hermes 模型库中该 Pi 自定义 Provider 模型没有 `contextLength`；仅凭模型名启发式无法知道 Pi 自己的自定义模型元数据。
- 修复：新增本地 Runtime 模型窗口 IPC。Pi 优先只读解析其 `models.json` 和 `models-store.json` 中当前 provider/model 的 `contextWindow`，随后依次尝试 Agents One 模型库显式值和原生 config/provider discovery；Renderer 在当前 Run 未上报窗口时异步取值，并在 provider/model 改变后重新解析。查询未完成期间不显示错误的 131K 瞬时值，所有权威来源均缺失时才回退静态模型族映射。
- 安全与边界：只读取模型 ID 与窗口数字，不返回、记录或改写 Pi 模型配置中的 API Key、Header 等字段；不启动 Pi 子进程，不修改用户模型选择、认证信息、会话正文或工作区文件。
- 自动验证：Pi Runtime 与 RuntimeChat 定向测试 2 个文件、52 项通过，覆盖 Pi 自定义/刷新目录解析以及 `ark/deepseek-v4-flash` 显示 `3680/1000000`；Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check` 通过。变更文件 ESLint 为 0 error，仅保留 RuntimeChat 中既有的 1 条 Hook 依赖 warning。

### 2026-08-11：启动字标、侧栏品牌与双手触碰动效

- 品牌收口：移除启动页和展开侧栏字标中独立的白色圆角 Logo 底板；统一由 dawn ring 直接替代 `ONE` 的字母 `O`。深色启动页使用白色字标，常驻浅色导航使用深色字标。
- 折叠兼容：折叠侧栏继续保留既有圆角渐变方形标记以及 hover/focus 切换展开图标的交互，未改变折叠宽度、命中区域或导航结构。
- 启动动效：以用户提供的机器手与人手照片为主视觉，使用连续背景层和两层羽化手部图层实现相向靠近；约 1.42 秒在指尖产生短促接触光，约 1.62 秒从接触点显现完整新字标。连续背景层随动效显现，避免运动遮罩产生斜向接缝。
- 可访问性与边界：支持 `prefers-reduced-motion`，减少动态时直接显示终帧；保留启动状态文本和远程连接的本地模式逃生按钮。未修改侧栏信息架构、智能体配置、会话数据或更新逻辑。
- 验证：启动页、品牌资产与侧栏关联定向测试 3 个文件、6 项通过；Node/Web TypeScript 检查、变更文件 ESLint、生产构建、逐帧视觉检查、`lat check` 与定向 `git diff --check` 均通过。
- PowerMem：当前会话未暴露记忆工具；本机 `powermem` MCP 全局注册当前缺失，直接 stdio 兜底调用超时，未写入云记忆。完整品牌规则、动效参数与验证结论已保存于本地品牌规范、架构索引和本进展日志。

### 2026-08-11：启动动效指尖、光效与 Logo 时长校准

- 反馈复核：原图本身保留了指尖间距，旧终帧回到原图位置，因此两只手没有真正接触；接触光和 Logo 使用的固定锚点又没有跟随视觉接触点；3 秒启动窗口只给完成入场的 Logo 留下约 0.6 秒稳定展示。
- 空间校准：机器人手和人手使用对称视口位移，在 1.15 秒终点闭合原图间距；统一以画面 `50% / 44%` 作为指尖、接触光和 Logo 的唯一锚点。隐藏 Logo 的独立验收帧确认光效核心正好位于两指接触处。
- 时间校准：接触光约 1.12 秒触发，Logo 约 1.30 秒开始出现；启动页最低时长从 3.0 秒延长至 4.2 秒，使 Logo 完成入场后稳定展示约 2 秒。前段反而更快，不用延长等待来弥补迟缓靠近。
- 可访问性：减少动态模式直接使用新的接触终帧，不再退回有明显指尖间距的原始照片位置。
- 验证：品牌资产与启动页定向测试 2 个文件、3 项通过；Node/Web TypeScript 检查、变更文件 ESLint（0 error）、生产构建和逐帧视觉检查通过。视觉检查包含临时隐藏 Logo 的接触帧，用于独立确认指尖闭合和光效中心位置。

### 2026-08-11：启动动画总时长收口至 2.9 秒

- 用户体验判断：4.2 秒虽然给 Logo 足够停留，但超过了启动反馈的合理等待感，容易让用户误判系统卡顿；确认将完整启动动画控制在 3 秒以内。
- 最终时间轴：双手约 1.1 秒接触，接触光约 1.06 秒触发，Logo 于约 1.20 秒开始出现并用 0.7 秒完成入场；启动页最低时长为 2.9 秒，Logo 总可见约 1.7 秒，其中稳定展示约 1 秒。
- 变更边界：仅压缩启动节奏，继续保留已验收的 `50% / 44%` 指尖、光效和 Logo 共用锚点、双手接触终帧及减少动态模式。
- 验证：自动时间点检查确认 2.5 秒仍显示启动页、3.0 秒已进入主界面；指尖接触帧和 Logo 停留帧视觉正常。定向测试 2 个文件、3 项通过，Node/Web TypeScript、生产构建、`lat check` 与定向 `git diff --check` 通过。

### 2026-08-12：启动页与导航栏字标切换为 Oxanium 700

- 用户确认：在 Space Grotesk、Sora、Oxanium、Rajdhani 四组同时覆盖启动页大尺寸与导航栏小尺寸的对比稿中，最终选择 `03 · Oxanium 700`，强化切角几何和未来科技感。
- 实施：启动页白色字标与展开导航栏深色字标同步采用 Oxanium 700；字母由 Google Fonts 官方字体文件生成并固化为两段 SVG 矢量路径，Dawn Ring 继续直接替代 `ONE` 的 `O`，渐变色、粗细、背景和启动动画时间轴保持不变。应用不内置字体文件，也不产生启动阶段的外部字体请求。
- 变更边界：仅替换两份 Renderer 字标 SVG，并更新品牌资产测试、品牌规范、架构索引与设计记忆；未修改 CSS 动画、侧栏布局、折叠标记、Runtime 注册、配置、IPC、会话或历史数据。
- 回归保护：品牌资产测试要求两份字标均包含两段路径和一个圆环，同时禁止 `<text>`、`font-family` 与白色底板，防止以后退回系统字体或旧版独立图标结构。
- 验证：品牌资产与启动页定向测试 2 个文件、3 项通过；Node/Web TypeScript 检查、变更测试 ESLint 和生产构建通过；隔离开发实例在 1920×1080 启动页、1920×1080 展开导航及 375×812 窄视口完成真实截图复核，字标居中且 30px 高度下清晰；`lat check` 与 `git diff --check` 通过。
- PowerMem：当前会话未加载记忆工具且全局注册项缺失，已按既有 stdio 兜底完成健康检查并写入长期记忆 `742432768968884224`；随后执行语义检索复核，新记录仍处于服务端提示的异步 infer 索引阶段，暂未进入检索结果。

### 2026-08-12：深色主题导航栏字标对比度修复

- 现场问题：导航栏通过外部 `<img>` 加载固定深色填充的 SVG；切换到深色主题后，字母仍为 `#171A21`，与侧栏背景接近而不可见。
- 修复：新增深色表面专用的 Oxanium 700 矢量字标，字母使用 `#F5F7FA`；布局依据主题注册表中的 `appearance` 语义自动选择深色或浅色表面资产，覆盖当前及后续登记的全部深色主题。Dawn Ring 的紫橙渐变在两份资产中保持一致，没有使用会改变品牌色的整图滤镜或反色。
- 变更边界：仅调整 Renderer 字标资产选择、品牌资产测试与文档；未修改主题配置值、侧栏结构、Runtime、IPC、用户设置持久化、会话或历史数据。
- 验证：品牌资产定向测试 4 项通过；Node/Web TypeScript 检查、变更文件 ESLint 和生产构建通过。隔离开发实例分别切换 `dark` 与 `light` 完成真实截图和 SVG 色值复核：深色主题使用浅色字母、浅色主题使用深色字母，两者 Dawn Ring 均保持原渐变。

### 2026-08-12：定时任务编辑与任务级工作区/权限修复

- 根因：普通 Runtime 新对话、项目任务入口以及 Codex/Claude Code/Pi 主进程适配器都会把智能体配置中的 `workspace` 当作任务兜底；RuntimeChat 同时默认使用 `analysis`，因此 Pi 会话被隐式带入 Agents-One 目录并显示“只读”。
- 任务语义：智能体配置中的工作区改为可选“检测工作区”，只参与连接检测，不再进入普通新对话、项目外任务或定时任务。普通新对话默认“自动 · 对话”；用户显式选择项目目录后，“自动”解析为可读写，仍可手动切换为只读或完全访问。Codex/Claude Code 无项目的普通对话在应用私有空目录运行，不暴露用户项目目录；写入任务必须显式选择项目文件夹。
- 定时任务：管理卡片新增编辑图标，复用新建表单修改名称、频率、提示词、本地 CLI 智能体、项目目录、文件访问和并发策略；活动执行期间禁止编辑。新任务默认 `auto` 且不设置工作区；选择项目后自动以 `full_access` 执行，显式完全访问必须有项目目录。v1 旧任务的隐式 `analysis` 在读取时迁移为 `auto`。
- 界面：定时任务标题、说明、分组标题、任务名称、正文与元数据字号统一上调；智能体编辑页将“工作区”更名为“检测工作区（可选）”，并明确项目目录在每个任务中按需选择，不存在跨项目冲突。
- 回归保护：新增定时任务编辑、旧模式迁移、自动可写与新对话不继承智能体工作区用例；相关 6 个测试文件 78 项通过，新增专项 3 个测试文件 53 项通过；Node/Web TypeScript 检查和生产构建通过，变更文件 ESLint 为 0 error，`git diff --check` 通过。

## 2026-08-12：统一“自动”为安全读写权限

- 权限入口统一只显示“自动”，不再根据是否选择项目目录显示“自动 · 对话”或“自动 · 可写”；说明统一为“可读写，无移动、删除文件权限”。新对话、定时任务以及选择/切换项目目录后都保持“自动”，不暗中切换成只读或完全访问。
- 实际执行新增 `safe_write` 模式：未选择项目目录时仍以无项目普通对话运行；选择目录后，Pi 仅开放 read/edit/write/grep/find/ls，Claude Code 开放 Read/Edit/Write/Glob/Grep 并禁用 Bash，Codex 使用 workspace-write 且禁用 shell tool。三者均在运行期间保护原有项目文件，若智能体尝试移动或删除，会在任务结束时恢复原路径并写入执行结果提示。
- 远程 Workspace Grant 同步支持操作级授权；“自动”只下发 list/read/write，不再下发 move/delete。显式“完全访问”仍保留移动、删除能力，显式“只读”仍只开放 list/read。
- 定时任务的持久化值继续使用 `auto`，触发时有项目目录映射到 `safe_write`，无项目目录映射到普通对话；旧任务和旧远程 Grant 保持兼容。
- 回归验证：权限/调度/CLI/Gateway 定向测试 96 项通过，界面与文件保护复测 63 项通过；Node/Web TypeScript 检查、生产构建和 `git diff --check` 通过，变更文件 ESLint 为 0 error（仅保留项目既有格式与 Hook warnings）。

## 2026-08-12：定时任务结果对话实时刷新与权限回显

- 修复“任务卡已有结果、已打开的任务对话仍只有用户提示词”：完成结果和 Runtime 执行事件原本已经持久化，但对话组件没有订阅后台完成后的 conversation 更新。现在完成事件会携带 conversationId 定向通知已打开对话重新读取；重新打开已有对话时也会主动同步最新持久化内容。
- Runtime 对话新增 `accessMode` 元数据。定时任务创建结果对话时写入本任务真实权限，打开结果对话后准确显示“自动 / 只读 / 完全访问”，不再总是回退到聊天默认“自动”。
- 定时任务文件访问第三项由“可读写”明确改名为“完全访问：可创建、编辑、移动或删除项目文件”，保存值保持独立 `full_access`；历史 `implementation` 计划迁移为 `full_access`，避免被新版默认值折叠为自动。
- 本机数据核验确认本轮“obsidian知识库整理”的最终回复与执行记录均已完整保存；专项 UI、调度、对话存储测试 59 项通过，扩展回归 113 项通过，Node/Web TypeScript 检查通过。
- PowerMem：当前会话未加载 MCP 注册，但本地 stdio 服务可用；已写入长期记忆 `742631226967326720`。随后的语义检索召回既有“仅本地 CLI 定时任务、移除执行位置/执行方式”等强相关记录，新记忆按服务端提示仍在后台 infer 索引。

## 2026-08-12：本地 CLI 任务恢复终端原生能力

- 现场复盘：该会话的 Pi 运行实际由当前 Electron 用户启动，并非 Windows 任务计划程序或 SYSTEM 账户；Pi 在会话中的 HOME/USERPROFILE 推断不符合 Agents One 的进程模型。
- 根因：Agents One 的统一 Pi Runtime 为所有普通对话、手动任务和定时任务固定传入 `--no-skills`，因此 `%USERPROFILE%\.agents\skills\llm-wiki\SKILL.md` 虽真实存在，也不会进入 Pi 的可用技能清单。首轮任务只读取了 Pi 自身文档和知识库文件，却错误声称已加载 `llm-wiki`。
- 产品目标：普通新任务与定时任务作为 Pi、Claude Code、Codex 的桌面入口，应继承对应 CLI 在终端中的用户配置、技能、MCP、扩展/插件、Hooks、项目指令、Shell 和自定义工具；Agents One 只负责工作目录、用户选择的文件权限、运行记录和结果展示，不再维护一套会导致能力缺失的工具白名单。
- Pi 修复：移除 `--no-skills / --no-extensions / --no-prompt-templates / --no-context-files` 以及可写模式的 `--tools` 白名单，让 Pi 自行加载 `~/.pi/agent`、`~/.agents/skills`、已安装 packages、MCP adapter 和项目资源；无项目的自动对话在应用私有目录运行，但仍保留完整工具能力。
- Claude/Codex 修复：移除自动模式下对 Bash/shell 的禁用与固定工具白名单；Claude 的可写非交互任务使用原生完整授权，Codex 自动模式保留原生 `workspace-write` 边界但不再禁用 shell，完全访问才绕过 sandbox。这样 MCP、插件、Hooks、子智能体和 Shell 不会被适配器裁掉。三个 CLI 子进程均继承桌面进程的完整用户环境，以兼容用户配置的任意本地工具变量。
- 权限边界：“只读”仍明确使用各 CLI 的 read-only/plan 能力；“自动”启用完整 CLI 能力，但选定项目时 Agents One 会在运行前后保护原有文件并恢复被移动或删除的内容；“完全访问”不做移动/删除恢复。当前“obsidian知识库整理”保存为 `full_access + D:\pkulyn_vault`，满足 `llm-wiki` 的写入、快照、索引及状态更新需要。
- 验证：Pi 原生技能加载器成功解析 `%USERPROFILE%\.agents\skills\llm-wiki\SKILL.md` 且无诊断错误；Pi/Codex/Claude/调度/RuntimeChat/文件保护 6 个定向测试文件共 84 项通过，Node/Web TypeScript 检查通过；相关 ESLint 为 0 error（仅有仓库现存格式及 Hook warning）。

## 2026-08-14：开源前优化启动 - Phase 0 提交基线

- 生成最终开发文档 [Agents One 开源前最终优化开发文档](./AGENTS_ONE_OPENSOURCE_PLAN.md)，含用户确认的 10 项决策（接入统一=方案 A/远程走 Gateway v1/本地 CLI+本地 API/SSH 删除/旧远程代码直接删除/上游遗留直接删除/旧页面界面删除数据备份保留/仓库 pkulyn-agents-one/i18n en+zh-CN/MIT Copyright 改 pkulyn）。
- 将 2026-08-06 至 08-13 的未提交工作整理为 8 个语义化提交：①gitignore 本地产物 ②备份/恢复/归档 ③Task Center 退役+计划任务收敛 ④协作 DAG ⑤safe_write+CLI 原生能力 ⑥侧栏菜单/分页/附件操作 ⑦品牌资产/启动动画 ⑧Plugin SDK 0.1.2+文档+lat.md ⑨Runtime 对话集成/计划任务 UI/统一渲染。
- 打标签 `agents-one-pre-opensource-baseline` 作为开源前回退点（此前基线标签 `agents-one-pre-slim-20260806`）。
- 全量验证全绿：Node/Web TypeScript 检查通过；Vitest 203 个测试文件、2010 项通过、9 项跳过；Electron Vite 生产构建通过。
- 两个本地测试产物（`Hers-2-Connector-Adaptation-Package-2026-08-10.zip`、`agents-one-test.md`）保持未跟踪，不入库。

## 2026-08-14：开源前优化 - Phase 2 遗留清理推进

- 用户确认执行顺序调整：Phase 2（旧页面删除）前置，Phase 1（接入统一）后置（SSH/旧远程模式与旧页面支撑模块深度耦合，先删旧页面可清掉大部分消费者）。
- ①删除孤儿屏幕：Discover、Office（含重型 3D 资源）、Providers、Tools、Gateway、Models、Install、Setup、Welcome；保留 Sessions（Cmd+K 会话搜索/恢复是活功能）；Layout 清理对应 View 类型/渲染/discoverFocus/remoteMode。renderer 产物从 11.7MB 降至 8.6MB。
- ②删除上游云/钱包/社区栈：agent-sync、hermes-account、account-store、wallet-store/balances/sync 及测试、shared/wallets/account/agent-sync/tokens；UI 组件 FollowUsModal、HermesAccountModal、OAuthLoginModal、ProviderKeysSection、ProfileWalletPane、CommunityPane；对应 IPC/preload API。
- ③删除 Skills/Memory/Soul 管理界面；ProfileModal 移除死掉的 persona/agentMemory/wallet 段；main 的 memory/skills/soul 模块保留为数据后端（备份仍快照 memories/skills 目录）。
- ④i18n 收敛为 en + zh-CN：删 10 个 locale 目录，重写 shared/i18n index/config/types，LANGUAGE_NATIVE_NAMES 2 项，更新三个 locale 测试。
- ⑤清理上游 hermesone/fathah 引用：菜单 issues 指向 pkulyn/agents-one；删除 hermesone provider setup card/PROVIDER_CARDS/BASE_URLS/SETTINGS_SECTIONS/url-key-map；删孤儿 i18n key；删除 stale detect-provider/office-url 测试并更新 layout-remote-gates、ProfileModal 测试。
- 全量回归：191 个测试文件、1912 项通过、9 项跳过；Node/Web TypeScript 与生产构建通过。
- 深层主进程清理（registry/messaging-platforms/tools 等 IPC 与 preload）与旧 Hermes 远程/SSH 传输耦合，延后到 Phase 1 一并处理。

## 2026-08-14：Phase 2 主体完成 + Phase 3 元数据

- Phase 2 遗留清理主体完成：除深层主进程 IPC（registry/messaging/tools，与 Phase 1 旧远程传输耦合延后）外全部落地——孤儿屏幕、上游云/钱包/社区、Skills/Memory/Soul 界面、i18n 收敛、hermesone/fathah 引用、上游 analytics 均已删除/清理。
- Phase 3 元数据完成：package.json author=pkulyn + repository/homepage/bugs；LICENSE copyright pkulyn（保留 MIT，注明 hermes-desktop fork 起源）；electron-builder appId=com.pkulyn.agents-one + publish 指向 pkulyn/agents-one；dev-app-update.yml 改 agents-one；删除上游 changelogs(0.4.5-0.7.0)、README.ja-JP/es-LATAM、CONTRIBUTING.ja-JP；CONTRIBUTING 链接改新仓库；.env.example 精简。
- 删除上游 analytics 客户端（utils/analytics.ts）与 PrivacyPane 隐私同意 UI、privacy 设置导航、VITE*ANALYTICS*_ / MAIN*VITE_HERMES_API*_ 环境变量与 workflow 引用。
- 全量回归：191 个测试文件、1912 项通过、9 项跳过；Node/Web TypeScript 与生产构建通过；renderer 产物降至约 8.1MB。
- 下一步进入 Phase 1：智能体接入统一（方案 A）——配置模型 transport=gateway-v1/local-cli/local-api、SSH 与旧远程 Hermes/OpenClaw 传输删除、注册表单统一为链接+Token 或路径。

## 2026-08-14：Phase 1 启动 - 配置模型与 transport 守卫

- Phase 1（智能体接入统一，方案 A）正式启动。已提交两个 slice：
- 1.1 配置模型（c414f23）：shared `AgentRuntimeConfig` 新增 `agentTransport` 字段（gateway-v1/local-cli/local-api）；新增纯函数 `deriveAgentTransport()` 从旧字段自动推导（向后兼容，无数据迁移）；main normalization 自动回填；内置 Hermes（local-api）/Pi（local-cli）显式携带；新增 4 个单元测试。
- 1.2 transport 分类器与 start 守卫（e393d9a）：main 新增 `isGatewayTransport/isLocalCliTransport/isLocalApiTransport` 三个分类器；`startAgentRuntimeTask` 的"派发不可用"守卫与 `full_access` 检查改按 transport 分类（行为不变，现有 27+18=45 个 runtime/gateway 测试通过）。
- 下一步（未开始）：1.3 SSH 删除、1.4 旧远程模式删除、1.5 注册表单统一、1.6 Agents 卡片增强、1.7 定向+全量回归。

## 2026-08-14：Phase 1.3 SSH 删除完成

- 目标（计划 D4）：移除 Hermes SSH 隧道模式。无公网 IP 场景由 Gateway v1 出站 Connector 模式覆盖；存量 SSH 配置只读迁移到统一远程模式并标记"需重新设置"。
- 类型收敛：shared `HermesRuntimeMode` 移除 `"ssh"`，删除 `HermesRuntimeSshConfig` 与 `AgentRuntimeConfig.hermes.ssh` 字段。
- 删除传输模块：`ssh-remote.ts`（3297 行）、`ssh-tunnel.ts`（339 行）、`ssh-options.ts` 及其测试整体删除。
- 主进程清理：`agent-runtimes.ts` 校验/probe/凭据分支去 ssh（存量 `mode:"ssh"` 归一化为 remote + `needsReauthorization:true` 提示重新设置）；`config.ts` 旧连接配置移除 `SshConnectionConfig`/`sshChatTransport`，读取时把存量 `connectionMode:"ssh"` 收敛为 remote 并暴露 `migratedFromSsh`；`hermes.ts`（getApiUrl/isRemoteMode/getRemoteAuthHeader）去 ssh；`dashboard.ts`、`cronjobs.ts`（删 sshRunCron 分支）、`hermes-agent-compat.ts`（删 SSH 补丁）、`claw3d.ts`、`office-start.ts`、`agents-one-backup.ts`（restore 兼容旧 ssh 配置）全部去 SSH。
- IPC 清理：`ipc/register.ts` 删除 `set-ssh-config`/`test-ssh-connection`/`start|stop-ssh-tunnel`/`is-ssh-tunnel-active` 处理器与全部 `conn.mode === "ssh"` 分支（约 150 处）；`activeSshProfile` 改名为 `activeProfileName`（remote 分支仍用它解析活动 profile）。
- preload/renderer：`preload/index.ts`+`index.d.ts` 删除 SSH API 与 ssh 字段；`ConnectionPane.tsx` 移除 SSH 模式按钮/表单与 SSH 对话传输，新增 `migratedFromSsh` 迁移提示横幅；`useSettingsData.ts`/`Chat.tsx`/`useDashboardChatTransport.ts` 清理 ssh 分支与状态；i18n 移除 SSH 文案键。
- 迁移验证：新增 `connection-config-security` 测试验证存量 `connectionMode:"ssh"` 只读收敛为 remote + `migratedFromSsh`，且不泄露 API Key；Agent Runtime 侧存量 `hermes.mode:"ssh"` 归一化为 remote 并标记需要重新授权。
- 自动验证：Node/Web TypeScript 检查通过；Vitest 全量 186 个测试文件、1843 项通过、9 项跳过；Electron Vite 生产构建通过。删除 4 个 SSH 专用测试文件（ssh-options/ssh-remote/ssh-remote-paths/cronjobs-ssh），更新 office-start/dashboard-remote/dashboard-chat-transport/remote-mode-url-and-spawn/connection-config-security/hermes-cli-session-id 等测试。
- 下一步：1.4 旧远程模式删除（NAS Hermes/OpenClaw 兼容、old remote 传输）。

## 2026-08-15：Phase 1.4 旧远程模式删除完成

- 目标（计划 D5）：删除 NAS Hermes/OpenClaw 旧兼容模式与旧远程传输，远程统一走 Gateway v1。
- 删除模块：`remote-sessions.ts`、`remote-models.ts`、`remote-memory.ts`、`remote-metadata.ts`、`remote-skills.ts`、`remote-config.ts`、`remote-dashboard-rpc.ts`、`remote-coordinator-bridge.ts`、`remote-tls.ts`、`openclaw-runtime.ts` 及 `hermes-agent-compat.ts` 的 remote-http 部分（保留本地 dashboard 兼容）。
- 类型收敛：shared `AGENT_RUNTIME_KINDS` 移除 `openclaw`；`HermesRuntimeMode` 收敛为 `"local"`；删除 `HermesChatTransport` 与 `hermes.chatTransport`。
- 配置模型：`ConnectionConfig`/`PublicConnectionConfig` 收敛为 `{ mode: "local" }`；`getConnectionConfig` 恒返回 local；存量 `connectionMode: ssh/remote` 读取时忽略（远程改走 Gateway v1）。`getRemoteDashboardSessionConfig`/`getRemoteDashboardUrl`/`normalizeRemoteChatTransport`/`resolveConnectionApiKeyUpdate` 移除或收敛。
- 主进程：`agent-runtimes.ts` 删除 OpenClaw probe/dispatch/poll/cancel、remote coordinator plan、远程 hermes probe（`conn.mode === "remote"`）、`remoteWorkspaceGatewayConfig`、旧凭证（hermesApiKeySecretKey/openClawBearerSecretKey/remoteRuntimeCredentialKey）；`setAgentRuntimeDashboardToken` 删除；`builtInHermesRuntime` 恒为 hermes-local（local-api）。`hermes.ts` 的 getApiUrl/isRemoteMode/getRemoteAuthHeader/getApiAuthHeaders 收敛为本地；`dashboard.ts`/`cronjobs.ts`/`mcp-servers.ts`/`messaging-platforms.ts`/`installer.ts`/`app/start.ts`/`office-start.ts` 全部去远程。
- IPC：删除 `check-openclaw`/`run-claw-migrate`/`set-agent-runtime-dashboard-token` 与全部 `conn.mode === "remote"` 分支（约 60 处）；`set-connection-config`/`set-connection-chat-transports` 变为 no-op。
- preload/renderer：preload 删除 OpenClaw IPC、dashboard token、远程连接字段（getConnectionConfig 返回 `{mode:"local"}`）；`ConnectionPane.tsx` 重写为 local-only（本地 API_SERVER_KEY 管理 + 网络设置）；`useSettingsData.ts`/`DataPane.tsx` 删除 OpenClaw 迁移功能与远程连接状态；`AgentRuntimesPane.tsx` 删除 hermes 远程/兼容模式与 dashboard/chatTransport 表单（自定义 Hermes 恒为 Gateway v1 远程模板）；`Chat.tsx`/`useDashboardChatTransport.ts` 收敛为本地；i18n 移除 remote 相关文案键。
- 测试：删除 `ssh-options/ssh-remote/ssh-remote-paths/cronjobs-ssh/messaging-platforms-remote` 等已删功能测试；重写 `connection-config-security` 为 local-only；更新 `agent-runtimes`（删除旧远程/OpenClaw/coordinator 测试）、`hermes-api`（http mock 补回调 + getApiServerKey）、`remote-mode-url-and-spawn`（删 startGateway 远程块）、`task-schedules`/`runtime-conversation-store`/`RuntimeChat`/`AgentRuntimesPane`/`ProfileSwitcher`/`dashboard-remote`。
- 自动验证：Node/Web TypeScript 检查通过；Vitest 全量 178 个测试文件、1775 项通过、9 项跳过（1 项 RuntimeChat 顺序敏感测试待稳定）；生产构建待跑。
- 下一步：1.5 注册表单统一（远程=链接+Token，本地=路径）。

## 2026-08-15：Phase 1.5 注册表单统一完成

- 目标：新增智能体表单统一为「远程 = 链接 + Token，本地 = 可执行文件路径（自动探测）」，与计划最终形态对齐。
- 本地 CLI 自动探测（核心）：新增 `src/main/local-cli-detect.ts`，跨平台 PATH 扫描（Windows 依次尝试 `.cmd`/`.exe`/`.bat`/裸名，POSIX 裸名）定位 pi/claude/codex 可执行文件；`detectLocalCliPaths()` 一次返回三者。新增 IPC `detect-local-cli-paths` 与 preload `detectLocalCliPaths`。
- 表单回填：`AgentRuntimesPane` 挂载时获取 PATH 检测结果，选择本地 CLI 模板时自动回填 `executablePath`（检测不到则回退裸命令名）；本地表单显示"已在 PATH 检测到：<路径>"或"未检测到，请填写完整路径"提示。
- 表单收敛：新增智能体时「位置」与「连接方式」由模板派生并禁用（Hermes → 远程 Gateway http；pi/codex/claude-code → 本地 CLI cli），表单心智模型对齐「远程 = 链接 + Token，本地 = 路径」；编辑已有智能体仍可调整。
- 验证：Node/Web TypeScript 检查通过；新增 `local-cli-detect.test.ts` 5 项单测（含 Windows `.cmd` 与 POSIX 裸名、未命中 null）；`AgentRuntimesPane.test.tsx` 新增 PATH 自动回填 + 派生位置/连接方式测试；全量 179 个测试文件、1782 项通过、9 项跳过；生产构建通过（renderer 约 8.07MB）。
- 下一步：1.6 Agents 卡片增强；1.7 定向+全量回归。

## 2026-08-15：Phase 1.6 Agents 卡片增强完成

- 目标：让 Agents 页的智能体卡片更清晰地呈现"接入统一"后的信息（接入方式、连接地址、能力）。
- 接入方式标签：卡片信息行新增统一接入标签（`deriveAgentTransport` → Gateway v1 / 本地 CLI / 本地 API），与 1.1-1.5 的 transport 模型对齐。
- 连接信息行：卡片新增连接提示——远程显示 Gateway 地址（截断），本地 CLI 显示可执行文件路径，本地 API 显示 `本地 API（127.0.0.1）`。
- 能力徽章：从 probe 的 capabilities 提取已启用能力（对话/任务派发/工具/产物/工作区）以徽章展示，帮助用户一眼判断智能体能做什么。
- 新增 CSS：`.agents-runtime-connection`（截断提示行）与 `.agents-runtime-capabilities`/`.agents-runtime-capability`（徽章行，跨整行）。
- 验证：Node/Web TypeScript 检查通过；`Agents.test.tsx` 新增接入标签/连接提示/能力徽章测试（能力容器内断言，避免与"对话"按钮歧义）；全量 179 个测试文件、1783 项通过、9 项跳过；生产构建通过。
- 下一步：1.7 定向+全量回归。

## 2026-08-15：Phase 1.7 定向 + 全量回归完成，Phase 1 收官

- 定向回归：重跑 Phase 1（1.3-1.6）涉及的全部关键测试（agent-runtimes/local-cli-detect/connection-config-security/ipc-handlers/hermes/hermes-api/dashboard-remote/task-schedules/runtime-conversation-store/remote-mode-url-and-spawn/Agents/AgentRuntimesPane/RuntimeChat/useDashboardChatTransport/i18n）——除 RuntimeChat 协作测试外全部通过。
- 修复 RuntimeChat 顺序敏感 flaky：协作测试的 `getAgentRuntimeRun` 第二个 mock 从 `mockResolvedValueOnce` 改为持久 `mockResolvedValue`（首个轮询返回 running 事件，之后所有轮询返回成功），消除负载下多轮询导致的「复核完成。」渲染缺失；连续两次全量套件稳定通过。
- 残留清理：删除 `settings.ts`（en/zh-CN）中已无引用的死 i18n 键（OpenClaw 迁移、远程连接、Dashboard/chatTransport、serverConfig、switchedToLocal 等）；更新 AgentRuntimesPane 用户提示与 ActiveSessionsBar/RuntimeChat 注释中的 OpenClaw 残留。
- 全量回归：Node/Web TypeScript 检查通过；Vitest 全量 179 个测试文件、1783 项通过、9 项跳过（两次运行一致）；Electron Vite 生产构建通过（renderer 约 8.06MB）；`git diff --check` 通过。
- Phase 1（智能体接入统一，方案 A）全部 slice 完成：1.1 配置模型 / 1.2 transport 守卫 / 1.3 SSH 删除 / 1.4 旧远程+OpenClaw 删除 / 1.5 注册表单统一 / 1.6 Agents 卡片增强 / 1.7 回归。下一步进入 Phase 3 收尾（README 重写描述统一接入模型）与 Phase 4 发布。

## 2026-08-16：Phase 3 开源准备收尾完成

- README 重写（项 16）：`README.md` / `README.zh-CN.md` 从上游 Hermes Desktop 内容整体重写为 Agents One 自述——定位（本地 CLI 智能体 + 远程 Gateway v1 的统一桌面工作区）、功能清单（统一对话壳/智能体注册表/本地 CLI Runtime/远程 Gateway v1/项目/任务与定时任务/多智能体协作/会话管理/归档/备份恢复/Plugin SDK/i18n）、快速开始（远程 = 链接 + Token，本地 = 路径）、架构说明（Runtime Adapter 契约、Remote Gateway v1、Agent Event Stream v1、Plugin SDK）、数据与隐私章节；删除全部上游徽章、Sponsors、Ko-fi、$HD Token、star-history、fathah/hermesone.org 链接与多语言入口。
- README 截图更新：现有 `previews/*.png` 均为上游旧界面（Discover/Gateway/Kanban/Office 等已删页面），用 Playwright `_electron.launch` 以隔离 userData + 隔离 `HERMES_HOME` 启动当前构建，截取当前实拍 `previews/agents.png`（智能体卡片，本地/远程分组）与 `previews/chat.png`（统一对话欢迎页）；隔离环境确保截图不含真实会话标题、项目名、个人路径或真实 IP（逐张经多模态识图复核）。
- 硬编码路径清理（项 18）：`scripts/verify-hers-workspace-gateway.js` 与 `verify-hers-workspace-continuation.js` 的 `workspaceRoot` 从默认值改为参数必填（main() 内校验，无参数时报用法错误退出）；相关测试的个人目录 mock 改为通用 `C:\Users\tester\...`；定向 Workspace Grant 对齐说明的可重复运行命令示例改为 `<workspaceRoot>` 占位符，该说明现已转入受控私有归档。
- lat.md 知识库同步（项 20）：删除 5 个描述已删除上游功能的文档（`agent-sync.md`、`analytics.md`、`hermes-account-login.md`、`provider-setup.md`、`wallet-token-balances.md`）并移除索引条目；`main-process.md` 删除 wallet IPC 段落；`sidebar-navigation.md` 删除 Discover/Office/Profile wallets 章节、更新 Profile 详情模态（单 Profile section，无 Persona/Memory/Wallet）、Footer 行动行（仅 update + ProfileSwitcher）、Settings 导航（Appearance/Language/Data/Archives/About/Logs）；`window-chrome.md` 删除 Follow-us 模态章节。链接验证 251 个全部有效、0 失效（lat.md CLI 未安装，用本地脚本验证 wiki 链接/代码引用目标存在性与格式规范）。
- 验证：Node/Web TypeScript 检查通过；受影响的 agent-runtimes / runtimeChatMessageAdapter 32 项测试通过；生产构建通过（renderer 约 8.1MB）；README 引用的 docs/ 与 previews/ 文件全部存在。
- 下一步：Phase 4 发布（干净目录全量验证 → 推送 `pkulyn/agents-one` + GitHub Actions CI → 发布后远程 502 错误分类降级与四 Runtime 端到端复测）。推进前需处理分支：当前 `agents-one-slim-task-dialog`（领先 main 38 个提交）。

## 2026-08-21：Agents One Connect P2-P5 首轮实现

- P0/P1/P2：新增共享 Connect 协议核心、通用 `@agents-one/connector-cli` 和 `@agents-one/connect-service` MVP。Connector 产品名称统一为 **Agents One Connector CLI**，Hers 仅作为首个适配器；已覆盖短码兑换、Ed25519 设备身份、设备撤销、Connector/Desktop hello、Gateway v1 request/response/event 路由、心跳和服务端配对状态查询。
- P3：桌面主进程新增 Connect 配对会话创建、状态查询、完成配对 IPC；智能体接入表单可生成一次性短码、检查配对并自动保存 Connect Runtime。Gateway Token 只在主进程完成配对后写入受保护连接配置，不进入 Runtime JSON。
- P3 补充 Connector-first 流程：远程智能体可通过 `request-pairing` 生成 10 位接入校验码，用户在 Agents One 中输入并确认，Connector 再通过短期 request token 获取设备凭据；不依赖二维码扫描。
- P4/P5 首轮：桌面 Gateway v1 请求已能通过 Connect WSS 隧道访问 Connector；Connector 新增 `run --adapter <module>` 用户级前台守护、指数退避自动重连和优雅停止。
- 验证：Connector 4 项、Connect 服务端 2 项（含 Connector-first claim）、服务端配对状态断言通过；根项目 Node/Web TypeScript 检查通过。
- 明确未完成：Connect 生产账户认证、持久化/TLS/限流/审计/多实例；Windows DPAPI/Linux Secret Service；Loopback Hermes 完整 capabilities/事件/Artifact 验收（当前已有参考适配器）；二维码图片和设备撤销 UI；事件去重、Artifact 分块、断线幂等恢复；Windows/Linux 用户级安装器、自动启动、签名升级和回滚。

## 2026-08-21：Hers Connect 部署指引

- 新增 Hers 定向部署与安装指引，覆盖 Connect 服务端部署、HTTPS/WSS 反向代理、用户级 Connector 安装、Loopback Gateway 配置、Connector-first 校验码配对、备用桌面端配对、systemd user、自检和安全注意事项；该环境交接资料现已转入受控私有归档。
- 明确 Hers 服务器无需公网 IP、域名、入站端口或 Relay；只有 Connect 服务需要可访问的 HTTPS/WSS 地址。当前 Connect 仍为开发 MVP，重启会丢失内存配对状态，不作为正式生产 Relay。

## 2026-08-22：参考 Herdr SSH 远程模式

- 阅读 Herdr 的工作方式与持久化/远程访问文档：其核心是远端持久会话服务器、本地瘦客户端、SSH 保活、远程二进制检查/安装和断线后重新连接。
- 对 Agents One 的结论：吸收远程目标档案、Connector 用户级守护、自动安装/版本匹配、断线恢复和未来 SSH Bootstrap/诊断通道；不把 SSH 作为默认业务数据通道，业务仍走 Agents One Connect + Gateway v1 WSS，以保留多 Runtime 路由、设备撤销、结构化 Event/Artifact/Workspace Grant 和无入站端口能力。

## 2026-08-24：定时任务项目归属与长时执行修复

- 问题与根因：定时任务保存了不透明 `workspaceId` 后，编辑界面只读取路径字段而显示为空；同一项目的旧路径会话和新 capability 会话被侧栏分别分组，导致重复项目、定时任务未归属及旧分组缺少“+”。
- 改动边界：仅调整计划任务表单、运行时对话的项目显示、侧栏分组和 Runtime 任务时限校验；不修改 Runtime 注册、已有项目记录或历史会话内容。编辑保存同时保留路径和 `workspaceId`，旧计划任务通过已注册项目反查路径；对话仅将 capability 解析为安全显示名称；侧栏以注册路径将旧会话归并为同一项目。
- 长时任务：计划编辑器新增每任务的最长执行时长（10 分钟至 24 小时，默认新建 2 小时）。运行仍具有 24 小时硬上限和原有手动停止能力，避免无限循环；已有计划任务保留其原先设置，需编辑后选择新时长。
- 验证：`task-schedules`、`Schedules`、`SidebarRecentSessions` 定向测试通过，Node/Web TypeScript 检查通过。`RuntimeChat` 全文件回归暴露了工作区 capability 迁移分支中既存的 9 个失败（选择目录测试 mock 仅返回 path、未返回 name/id），与本次显示名称查询无关，尚需在该分支合并时统一修复。

## 2026-08-24：启动页双手斜向接触动画重构

- 根因：矩形裁层会残留另一只手、背景与接触高光；完整生成场景序列又存在构图漂移，播放时表现为双手共同上抬、手指截断和接触点错位。
- 分层：改为固定无手背景、机器手透明前景和人手透明前景。机器手从左上向右下、人手从右下向左上，沿同一接触轴对称移动 1.65 秒；背景全程无位移，两个前景最终统一归零到确认过的接触构图。
- 蒙版与光效时序：重新清理两只手的像素级透明边缘，去除跟随指尖移动的烘焙高光、残影和人手上沿缺口；固定背景也移除预先存在的接触光点。接触光效仅使用终点锚点 `50.7% / 47.3%`，并在 1.65 秒双手靠近完成后才开始形成。接触反馈强化为 0.86 秒白蓝双闪：首次亮起后短暂回落，再以更大光芒二次闪烁并淡出；Logo 延后 0.14 秒，避免遮住首次闪光。
- 验证：Electron 渲染器实拍核对初始、中间和最终帧，变换分别为对称的 `(-86.88,-43.4)/(86.88,43.4)`、`(-20.66,-10.32)/(20.66,10.32)` 和 `(0,0)/(0,0)`，背景 transform 始终为 `none`；SplashScreen 单测、Web TypeScript、Electron Vite 生产构建与定向 `git diff --check` 通过。

## 2026-08-25：吸收 Pi“极简可塑”哲学的优化实施方案确认

- 产品方向：Agents One 保持为轻量、对话优先、能力驱动的多智能体控制面，不实现新的通用 Agent Loop；各 Runtime 继续拥有模型、工具、Skill、MCP、Extension、Provider 和原生上下文管理。
- 新增 [Agents One“极简可塑”功能与架构优化实施方案](./AGENTS_ONE_PI_INSPIRED_OPTIMIZATION_PLAN_20260825.md)，明确 Runtime Control Protocol、Pi 持久 RPC、原生事件映射、纠偏/跟进 UI、跨 Runtime 能力降级、会话条目三分离、会话树、隔离等级和 Skill/插件边界。
- 实施边界：近期仅按 `AO-PI-00 → AO-PI-06` 推进 Pi 试点；不修改 Runtime ID、现有配置与历史必填结构、Gateway v1、Connect、Workspace Grant 或多智能体 DAG。RPC 通过独立子进程运行，并保留 print-json fallback。
- 验收原则：每个任务独立测试、提交和回滚；只有真实 Pi 连续对话、steer、follow-up、abort、settled、重启、历史兼容和进程回收全部通过后，才讨论默认启用或推广到其他 Runtime。

## 2026-08-25：统一 `/model`、`/compact` Runtime 命令方案补充

- 现状确认：Hermes Chat 已有中央斜杠命令路由、目录冲突消解和命令面板；RuntimeChat 仍传入空命令目录，并通过普通 Runtime 任务入口提交文本，因此不能把 `/model`、`/compact` 宣称为原生控制。
- 方案更新：在“极简可塑”实施方案中新增 F5“统一斜杠命令与 Runtime 命令适配”，明确 `desktop`、`runtime-control`、`runtime-native`、`model` 四类命令、固定路由优先级、统一描述符与结果类型，以及未知命令禁止 Prompt fallback。
- 原生映射：Pi 使用 RPC 的模型、压缩和命令目录接口；Codex 使用 App Server；Claude Code 使用 Agent SDK；远程 Gateway 通过可选 capability、`commands.catalog` 和 `commands.execute` 协商，旧协议保持普通对话兼容。
- 实施拆分：新增 AO-CMD-00 至 AO-CMD-05，分别覆盖共享类型、共享命令面板、Pi、Codex、Claude Code 和远程命令能力；同步更新 Phase 0-3、测试矩阵、发布门槛、迁移回滚和近期主链。
- 变更边界：本次仅更新方案、架构知识和进展记录，不修改 Runtime、IPC、持久化配置或历史数据。

## 2026-08-25：F5 Runtime 统一斜杠命令实现

- 共享控制契约：新增 `runtime-commands`，统一 `desktop → runtime-control → runtime-native → model` 目录合并、命令名/别名规范化、元数据限长、冲突消解和未知命令建议；`requestId`、`RuntimeCommandResult` 和模型目录成为显式跨 IPC 类型。Runtime 控制不再允许无声降级为普通 Prompt。
- RuntimeChat：加载当前 Runtime 的命令目录并交给共享输入组件；`/new`、`/clear` 以主进程 desktop 目录保留优先级，Runtime 不能抢占。模型选择器、模型名按钮与上下文占用条分别复用 `/model`、`/compact` 处理器；压缩先显示影响与保留重点，确认后才调用 Adapter，取消会恢复输入。失败会恢复原文本与附件。控制结果写为带 `controlAudit` 的 system 记录，不写用户/assistant 气泡；审计包括压缩触发方式、可用时的 token 前后值和不透明摘要引用。重复提交受 in-flight 防护。只有 Runtime 明确返回 `send-prompt` 才会进入正常消息路径，且不会被二次解析。
- 本地 Runtime：Pi 使用 RPC `get_commands`、`get_available_models`、`set_model` 和 `compact`；Codex 使用 App Server `model/list`、`thread/compact/start`，并等待标准 `contextCompaction` 的 `item/started` / `item/completed` 生命周期（不再使用已废弃的 `thread/compacted`）；Claude Code 使用 Agent SDK 的 `supportedCommands()`、`supportedModels()`、`setModel()` 与同一会话的 `/compact`，等待 `compact_boundary` 返回触发方式和 token 边界。SDK 优先复用 Runtime 已配置的 Claude 可执行文件，绝不以伪终端键盘输入驱动 TUI。三类 Runtime 生命周期均经独立 IPC 进度事件显示为 Runtime 系统反馈，且按 `requestId + runtimeId` 隔离。Pi/Codex/Claude 模型参数会先与原生目录核验；任务运行中明确延后模型切换至下一轮，避免变更 live session。
- Remote Gateway：能力协商扩展为 commands/modelSelection/compaction；增强 Gateway 通过 `/commands/catalog`、`/commands/execute` 完成目录和控制调用，保留 requestId/runtimeId/conversationId。其返回内容在主进程中做类型校验、长度限制和敏感字段脱敏后才进入 IPC；旧 Gateway 保持普通对话，不展示虚假控制命令。
- 验证：`runtime-commands`、Pi、Codex、Claude Code Agent SDK、Remote Gateway、共享命令面板与 RuntimeChat 定向 Vitest 覆盖持续通过；RuntimeChat 全量回归 51 项通过（同步更新协作测试夹具，使其使用安全的相对交付路径）；Node 与 Web TypeScript 检查通过。
- Claude Agent SDK：经用户授权新增 `@anthropic-ai/claude-agent-sdk@0.3.241`。运行时使用 SDK 的正式流式控制契约，并在已配置路径时复用本机 Claude 可执行文件；实际调用仍需要用户自行配置 Anthropic API Key 或受支持的第三方 API provider 凭据，Agents One 不提供或转售 claude.ai 登录与订阅额度。

## 2026-08-25：F5 收口与 F6–F10 基础契约

- F5 Claude Code：会话型只读对话改为 Claude Agent SDK Streaming Input 的长驻 `Query`；同一 provider session 内发送普通消息、`/model`、`/compact` 和中断。SDK 初始化在消息入队前失败时才切回既有 Claude CLI，避免重复发送用户消息。文件写入、worktree 和附件任务继续走已验证的 CLI Adapter。
- F6：Runtime capability 新增显式 `steering`（native/cancel_resume/follow_up/none）与 `branching` 声明；共享 `runtimeSteeringPlan()` 规定 cancel-resume 必须二次确认，禁止 UI 静默中断运行。
- F7：Runtime Conversation Message 新增可选 `meta`（audience/origin/persistence）。旧消息按 role/controlAudit 推断；转录构造仅使用 `model` audience，平台审计和工具进度不会重复注入下一轮 Prompt。
- F8：会话持久化新增 `branch` 关系；`forkRuntimeConversation()` 只复制 fork 节点之前的历史且不修改父会话。实现型分支若未先分配独立 worktree 会被拒绝。
- F9：每个 Run 主进程生成真实 `isolation` 标签（Host/Worktree/Remote），并明确 Worktree 共享宿主系统、网络和凭据；无人值守预检禁止 Host 下的 full_access 任务自动启动。
- F10：新增只读 Skill 元数据发现器。它只读取 `SKILL.md` 头信息，记录来源、信任提示和执行边界；不复制用户目录、不载入 Skill 代码，也不允许“安装 Skill”进入 Electron 主进程执行。
- 验证：新增会话树/元数据、Runtime governance、Skill discovery 回归；相关 4 个测试文件 41 项通过，Node/Web TypeScript 通过。全量 Vitest 在 124 秒超时前无失败输出，最终完整回归仍须由 CI 或更长时限环境完成。
- F8 交互补充：RuntimeChat 已提供 `/branch [名称]`，会先持久化父会话，再创建关联的只读分析分支、清除 provider session 并切换界面；父会话、worktree 和文件均不被自动修改。分支 IPC 已进入 preload 白名单。RuntimeChat 单用例复跑通过；全文件中有一项既存随机会话 ID 夹具断言偶发失败，单独复跑通过。
- F5/F9 收口补充：Claude 已存在长驻 SDK session 时，`supportedModels()` 与 `supportedCommands()` 也从该 session 查询，避免目录发现另起临时进程；Run 的隔离边界同时随执行证据持久化，并在 RuntimeChat 工具栏以宿主/Worktree/远程/容器标签展示，tooltip 给出真实边界说明。
- F10 交互补充：新增 `/skills` 桌面命令和只读面板，通过受限 IPC 仅发现用户 `.codex/skills` 与项目 `.agents/skills` 下的 `SKILL.md` 元数据，显示名称、来源、信任等级与执行边界；无安装、复制、注入或 Electron 主进程执行路径。RuntimeChat 定向测试 51 项通过（另有 1 项文件级 fixture skip）。
- F6 交互补充：运行中输入会依据 fresh probe 的 `steering` capability 明确降级：`follow_up` 排队到本轮完成后发送；`cancel_resume` 必须用户确认才取消并恢复；`none` 恢复输入且不发送、不取消。Pi 从无实现的 `native` 修正为可验证的 `cancel_resume`，不再宣称虚假原生纠偏能力。RuntimeChat 定向 51 项通过，Web 类型检查通过。
- 全量回归：第二次完整 Vitest 运行通过，189 个测试文件、1859 项通过、9 项跳过。首轮的 Connect 配对码为单次抖动；侧栏“在资源管理器显示”按钮则修复为本地文件夹或 workspace capability 任一存在即可启用。F5 shutdown 补充：应用停止接收 Runtime 任务时主动关闭并清空全部 Claude SDK 流式会话，避免残留子进程。
- F8 安全收口：分析分支状态在运行时恢复时读取持久 `branch` 引用；`/branch` 创建的关联分支及重启后重新打开的分支均拒绝 `safe_write/full_access`，保留用户输入并要求先创建独立 worktree 的实现分支。此限制防止分支静默写入父分支项目目录。
- F7 持久化补充：会话 store 现对 `controlAudit` 进行字段限长、结果类型与时间戳清洗并持久化；重启后控制平面审计仍保留 `platform/audit` 语义，且不会被 transcript 注入模型。新增回归覆盖审计记录重读。
- F5–F10 收官验证：生产构建、Node/Web TypeScript、修改范围 Prettier 与 ESLint、`git diff --check` 均通过；完整 Vitest 最终基线为 189 文件、1859 项通过、9 项跳过。运行时需真实账户/凭据的 Claude、Pi、Codex 与 Gateway 连通性仍由用户部署环境决定；代码在凭据或 SDK 初始化不可用时保持明确错误/CLI fallback，不伪造端到端成功。

## 2026-08-25：任务对话语音转文字接入

- 目标：给共享任务对话输入框增加“录音 → 转写 → 回填草稿”，覆盖原生 Hermes 与 Pi、Codex、Claude Code、Gateway 等 Runtime 对话；转写结果不自动发送，继续复用原任务、附件、历史和发送链路。
- 现状复用：项目已有 `MediaRecorder` Hook、`transcribe-audio` preload/IPC、Hermes STT 和麦克风样式，但共享 `ChatInput` 的入口曾被移除。此次恢复麦克风入口并保留当前草稿拼接语义，不复制输入组件。
- 服务路由：Main 读取 `AGENTS_ONE_VOICE_API_URL` / `AGENTS_ONE_VOICE_API_KEY`，以 OpenAI 兼容 multipart `file` 请求调用外部 ASR；初版曾保留本地 Hermes/Python STT 回退，已在 2026-08-26 后续修订中移除。URL/token 不进入 Renderer，不写 Runtime、项目、任务或历史配置。
- v1 约束：大阪服务为非流式、单并发，客户端从旧的累计音频周期重传改为停止后只上传一次；录音最长 120 秒、音频最大 25 MB、请求超时 90 秒。错误只显示在输入栏，保留草稿与附件。
- 安全：已实测 `http://115.191.47.168/voice/health` 返回 ASR/TTS loaded、Ollama up；公网 HTTP 仅用于联调，正式发布前必须升级 HTTPS 后再启用 Bearer token。
- 验证：Hermes multipart/Bearer/原回退测试、ChatInput 草稿回填测试和 RuntimeChat 回归共 4 个测试文件、66 项通过；Node/Web TypeScript 检查通过。配置、回退和后续设置页演进见 `docs/AGENTS_ONE_VOICE_INPUT.md`。

## 2026-08-26：语音输入默认路由与录音反馈修复

- 问题：未在实际 Electron 进程配置 `AGENTS_ONE_VOICE_API_URL` 时，转写会回退到未启动的本地 Hermes API，导致 `Voice input needs the Hermes API server`；仅靠麦克风按钮红色闪烁也不足以让用户确认录音已开始。
- 修复：当前桌面版默认将录音提交到大阪 OpenAI 兼容 ASR 服务，环境变量仍可覆盖任意兼容服务；共享 ChatInput 在录音中于输入框上方显示带动画的声波、状态与停止提示，停止录音后立即消失。
- 边界：不修改 IPC 契约、Runtime 注册、项目/会话持久化和消息发送逻辑；转写文字继续只回填草稿，不自动发送。
- 验证：补充默认外部路由、已移除 Hermes 选择器和录音状态渲染测试；后续修订完成后，已通过定向测试、类型检查、生产构建与 `lat check`。

## 2026-08-26：语音输入移除 Hermes 回退与交互收口

- 路由：按确认的产品边界，完全移除语音输入调用本地 Hermes API 与 Python STT 的代码路径；未配置时仍使用大阪 ASR，语音服务配置只接受 HTTP(S) URL，避免再次出现“Hermes API server 未运行”的提示。
- 交互：麦克风紧接输入框工具栏中的小地球右侧；点击或 `Ctrl+M` 均可开始/停止录音。录音态的动态声波栏新增 `00:00 / 02:00` 计时，停止后消失。
- 阈值依据：120 秒和 25 MB 均为客户端保护阈值，而非服务端公布配额。ASR 目前非流式、单并发，限制单段时长/体积可避免误触长录音占用转写队列；请求仍保留 90 秒超时。
- 验证：`hermes.test.ts` 与 `ChatInput.voice.test.tsx` 共 11 项通过；Node/Web TypeScript 检查、Electron Vite 生产构建、`lat check` 与 `git diff --check` 通过。

## 2026-08-26：大阪 ASR v1.2 流式语音输入

- 协议升级：依据大阪服务 v1.2 接入说明，将任务对话语音输入从“停止后整段 multipart 上传”切换为 WebSocket `/v1/audio/transcriptions/stream`。Main 进程持有连接与可选 Bearer token，Renderer 通过受控 IPC 发送 16kHz/16-bit/单声道 PCM 分块，并接收 `partial`、`final`、错误与结束事件。
- 交互：`partial` 实时回填、替换未定稿部分；服务端 VAD 的 `final` 固化句子，连续说话可持续追加。点击麦克风或 `Ctrl+M` 停止采集，发送空 PCM 帧请求服务端补齐残余结果。声波栏显示已录制时长但取消 `02:00` 上限。
- 边界：流式模式按服务说明取消 120 秒与 25 MB 的整段阈值；仅保留每个 IPC PCM 分块 256 KiB 的传输健全性上限。仍不改动 Runtime、会话/项目持久化和发送逻辑；文本只回填草稿。
- 验证：既有语音输入与 ChatInput 定向测试共 12 项通过；Node/Web TypeScript 检查、Electron Vite 生产构建、`lat check` 与 `git diff --check` 通过；联调地址 `ws://115.191.47.168/voice/v1/audio/transcriptions/stream` 已实测可建立 WebSocket 连接。真实麦克风连续说话与 VAD 断句仍需在 Electron 窗口中人工验收。

## 2026-08-26：流式 partial 累加与标点责任澄清

- 问题：服务端前期 `partial` 帧会以新增片段而非完整累积句返回，客户端若直接替换未定稿文本，就会导致已显示文字被覆盖，直到 VAD `final` 才一次性恢复全句。
- 修复：Renderer 对 partial 使用前后缀重叠合并；完整累积帧直接采用、增量帧追加、重叠帧去重，VAD `final` 仍作为句子权威版本。新增单测覆盖三种帧形态。
- 标点：客户端未移除也不应凭规则伪造标点；流式文档承诺的自动标点应由大阪 ASR 服务端在 `final` 帧返回。若最终帧仍无标点，需要服务端检查/启用标点恢复模型或对应配置。

## 2026-08-26：大阪 ASR v1.4 Qwen3 逐句流式适配

- 协议：依据 v1.4 适配说明，流式服务已升级为 Qwen3-ASR-0.6B，并将事件收敛为带标点的 `final` 与 `error`；服务端以不少于 0.8 秒的自然停顿完成断句。Main 与 preload 不再向 Renderer 声明或转发 `partial`。
- 交互：Renderer 删除 partial 合并逻辑，收到每个完整 `final` 后立即按顺序回填草稿，因此界面表现为逐句出现，而非逐字预览。转写结果仍不自动发送，停止录音时仍发送空 PCM 帧以请求残余语音收尾。
- 边界：只调整既有语音流式事件契约、Renderer 回填逻辑、测试与说明文档；不修改 Runtime 注册、服务配置写入、项目/会话持久化或消息发送逻辑。服务端返回的标点原样保留。
- 验证：语音输入组件与旧版文件转写兼容测试共 12 项通过，Node/Web TypeScript 检查通过；知识库与差异检查见本次交付前的最终复核。

## 2026-08-26：语音流式客户端会话审计

- 原因：大阪 Qwen3 流式服务曾因长语音缓冲截断造成中间句缺失；服务端现已记录连接字节、断句与 final 序列，客户端需有同口径证据以快速区分采集/IPC/WebSocket 与服务端断句问题。
- 边界与数据：仅扩展既有 stop-streaming IPC 的可选统计参数，并在 Main 的内存会话上计数；不读取或写入 Runtime、Profile、项目、会话或历史数据。启用 `AGENTS_ONE_VOICE_STREAM_AUDIT=1` 才输出包含 final 文本的日志，默认关闭以避免转写内容进入普通日志。
- 消费者与回退：Renderer 传递采集块数、字节数和发送失败数，Main 对比实际 WebSocket 写入量并记录 final 到达序列；现有调用省略该可选参数仍可正常停止录音。删除该环境变量即可立即关闭审计，不影响语音功能。

## 2026-08-27：开源版语音输入服务设置

- 原因：大阪服务是联调/自建环境，不应成为开源用户的隐式外部依赖；新用户需要自行选择可信任的语音转文字服务，并清楚知道录音的发送目标。
- 改动：新增“设置 → 语音输入”页，按 Profile 保存启用状态和服务地址，支持基础地址或 OpenAI 转写地址、可选 Bearer Key、健康检查、密钥清除以及隐私/审计说明。新安装无默认语音服务，未启用时主进程拒绝转写；既有显式 URL 保持可用以避免升级中断。
- 兼容补充：服务地址亦接受 v1.4 文档给出的完整 `ws(s)://…/v1/audio/transcriptions/stream` 地址，并在保存/测试前归一为 HTTP(S) 基础地址；因此用户无需手工删除流式路径或修改协议。
- 安全边界：URL/开关仅由专用白名单 IPC 保存；密钥仅在保存或连通性测试时穿过 preload，读取接口只返回 `hasApiKey`。它继续走现有进程环境/secret provider/Profile `.env` 解析链，不进入普通配置、对话、项目、任务或备份。测试只调用 `/health`，不上传音频。
- 下游与回退：ChatInput、旧 multipart 转写和 WebSocket 流共同读取同一受控配置；关闭开关即可立即阻止新的录音会话，清除 URL/Key 或删除本次专用设置代码可恢复为未配置状态，不涉及 Runtime 注册、历史迁移或数据重写。
- 验证：Main 配置/健康检查、设置页、未配置时的麦克风门禁、既有流式审计与 ChatInput 语音交互共 23 项定向 Vitest 通过；Node/Web TypeScript 检查、生产构建、`lat check` 与 `git diff --check` 通过。

## 2026-08-27：语音设置页文案收口

- 设置导航和开关统一由“语音输入”精简为“语音”；移除设置页中的“隐私与联调”展示区。审计开关和受控传输行为保持不变，仅不再占用日常配置界面。

## 2026-08-26：Runtime 模型入口与执行边界文案收口

- 模型入口：工具栏模型名现在明确显示“模型 + 当前模型”，点击仍经统一 `/model` Runtime 控制链路读取原生目录；读取期间入口禁用，重复点击不会再写入“上一条命令仍在执行”的对话记录。
- 模型选择：目录返回后在输入框上方展示“模型”选择面板，使用临时选择值；只有点击“应用模型”并由 Runtime 成功处理后才更新当前会话模型。取消不会改变工具栏模型。`needs-input/model-picker` 不再持久化泛化的“Runtime 命令正在等待补充输入”，避免页面重载后留下无继续入口的历史提示。
- 执行边界：原“宿主”改为带图标的“本机执行”；同一徽标契约完整覆盖 `Worktree 分支`、`容器执行`、`远程执行`。悬浮提示保留由主进程生成的真实隔离说明。历史执行记录的 isolation 也会在重新打开会话时恢复显示。
- 验证：RuntimeChat 定向 Vitest 52 项通过；Node/Web TypeScript 检查通过；修改范围 Prettier、ESLint（零 error）与 `git diff --check` 通过。现有 RuntimeChat Hooks 依赖提示保持为既有 warning，未在本次扩大修改范围。

## 2026-08-26：Pi 思考快照与模型切换体验优化

- 思考链：Pi 会先发送极短的累积 thinking 前缀（例如“用户”），后续再发送完整快照；主进程的快照判定不再忽略 1–2 字符前缀，Renderer 也会合并相邻的历史 reasoning 快照。因此新旧会话都不会将同一思考链展示为多段。
- 模型目录：Pi 的 `/model` 优先只读其本地 `models.json`、`models-store.json` 中的 provider/model 元数据，不读取或暴露其中的凭据字段，也不为模型列表启动冷 Pi RPC。Pi 未保存本地目录时才回退原生 `get_available_models` RPC；Pi/Codex 的固定控制命令也不再因新 session 重做命令目录发现。
- 切换状态：选择器默认选中当前会话模型；改为“确认切换”，面板文案压缩为“仅作用于当前会话，不会修改默认配置”。确认后工具栏立即乐观显示目标模型并禁用重复点击，真实 Pi `set_model` 成功后保留，失败则回退至旧模型；因此不会出现模型未变与“上一条命令仍在执行”的组合误导。
- 验证：Pi runtime、Runtime control、RuntimeChat 与消息适配器共 4 个文件 115 项通过；Node/Web TypeScript 检查、ESLint（零 error）与 `git diff --check` 通过。RuntimeChat 全文件首次并行运行遇到既存随机会话 ID 夹具断言，随后的单文件和四文件复跑均全部通过。

## 2026-08-26：Pi 会话模型状态、最终答复与思考等级收口

- 模型状态：工具栏展示改以当前会话的确认模型为最高优先级；上一轮执行证据只在会话未选模型时作为回退。因此 Pi `set_model` 成功后，模型名称立即和“当前会话已切换到模型”一致，不再等待下一条消息的执行元数据回写。
- 最终答复：复核本机 Pi 原始 JSONL 后确认，图片识别异常轮实际已回传完整的 `type: "message"` assistant text（含 Markdown），没有 image/attachment 字段；并非 Pi 或 Markdown/图片渲染丢答复。主进程此前仅识别 `message_end`、`turn_end`、`agent_end`，漏掉 Pi print 模式的 `message` 终态帧，因而误报“未返回最终答复”。现已统一识别四种终态格式；真正只有 thinking/tool、没有 text 的终态仍明确判定为未完成。
- 思考等级：新增 Pi 原生 `/thinking [level]` 控制及输入栏“思考”状态徽标。打开时并行读取 Pi `get_available_thinking_levels` 与 `get_state`，只展示当前模型真实支持的等级与当前值；确认后调用 `set_thinking_level`。目录按 runtime/session 短缓存，模型切换即失效，避免确认时额外冷启动查询。任务运行中徽标持续展示当前等级，但置灰并提示任务结束后才可切换，避免看起来像配置消失。Pi 未建会话、模型不支持或其他 Runtime 不会伪造可切换能力。
- 验证：Pi Runtime、Runtime command 定向回归 53 项通过；Node/Web TypeScript 检查与生产构建通过。

## 2026-08-27：Runtime 对话控制响应与消息卡片体验优化

- 思考等级：`get_available_thinking_levels` 由短生命周期 Pi RPC 查询改为按 Runtime 的 10 分钟缓存与并发去重，模型切换会立即失效该缓存；每轮 Pi 会话结算后的命令目录刷新会后台预热该目录，通常点击即出。首次目录读取设置为 2.5 秒控制面时限，不再等待默认 20 秒；Pi 临时无响应时，若能读取 `get_state`，选择框仍展示当前已知等级；对话中只显示“Pi 暂未返回思考等级”，不泄露 RPC 超时内部文本。已建立会话后才展示 Pi 思考徽标，运行中仍可见但不可切换。
- 压缩反馈：移除 `/compact` 确认后的“正在请求 Runtime 压缩当前会话上下文…”平台中间消息；仍保留 Pi/Codex/Claude 原生返回的开始、进度或最终结果，方便用户判断压缩是否真正完成。
- 消息卡片：真实用户输入与智能体最终答复改为在气泡底部显示完整中文时间 `YYYY年M月D日（星期X）HH:mm` 和复制操作，移除右上角悬浮复制按钮。智能体答复另显示“模型 provider / model · 已用 X 分 X 秒”的运行事实；时间、模型与用时不再挤入头像区域。
- 会话分支：智能体最终答复左下新增分支图标。点击后先保存父会话，再以该答复为 `forkedFromMessageId` 创建新的只读分析对话；随后通过统一的“打开 Runtime 对话”通道新建并激活子任务标签，绝不把当前父标签改绑为子会话。新分支清除 provider session，不修改父会话、其分支点后的历史或项目文件；`/branch` 也复用同一行为。
- 控制信息：`system`/`controlAudit` 命令与功能提示统一标记为控制消息，保留文字与审计，但不显示复制、时间或分支操作，避免与真实对话混淆。
- 交互微调：复制、分支和时间操作栏改为消息卡片的同级底部区域，而非卡片内容；默认透明，仅当鼠标悬停消息卡或操作栏、或键盘焦点进入该消息时显示。这样既不会干扰卡内阅读/Markdown 排版，也可持续移动到按钮操作。
- 呈现修正：移除思考/工具记录与最终答复之间的模型名称。模型并非工具调用信息，放在该位置会让用户误解其归属；Runtime 耗时数据继续保留在消息元数据中，待确认后宜作为底部时间后的轻量“用时”文字呈现。
- 耗时展示：按确认启用智能体最终答复的运行耗时，位于消息卡外、悬停显示的底部操作栏中，紧跟完整时间，格式为 `· 用时 X 分 X 秒`；用户消息、思考、工具调用与平台提示均不展示。
- 滚动跟随：Runtime 对话默认持续跟随智能体的思考、工具调用与最终答复；用户通过滚轮、滚动条、键盘或右侧导航离开末尾后，自动跟随立即暂停，防止阅读历史时被新事件打断。输入框上方会显示“回到最新消息”浮动按钮，点击后平滑回到底部并恢复自动跟随。
- 验证：Pi Runtime、RuntimeChat、消息适配器与消息列表共 4 个定向测试文件 107 项通过；此次滚动跟随专项 RuntimeChat 55 项通过；Node/Web TypeScript 检查通过，`git diff --check` 通过。

## 2026-08-28：侧栏项目与任务栏目可见性强化

- 问题：侧栏“项目”“任务”使用 11px 浅灰文字与细下划线，作为导航地标不易快速扫读。
- 改动边界：仅在 Renderer 的 `SidebarRecentSessions` 和 `main.css` 增加已知栏目专属类名与表现；项目/任务列表、折叠状态、创建入口、数据、IPC 和 Runtime 均未修改。
- 修复：根据实机复核反馈，移除左侧竖条与粗体；两个栏目标题改为与“新建任务”“定时任务”一致的 13px 常规字重与主文字色，固定项目行与置顶栏保持原样。
- 验证：`SidebarRecentSessions.test.ts` 通过（1 项）；Web TypeScript 检查通过；已通过运行中开发版的窄侧栏截图复核项目、任务两个栏目。`lat check` 未执行，因为本机未发现 `lat` 命令。

## 2026-08-28：侧栏项目 / 任务创建入口与 Esc 关闭

- 改动：任务栏目折叠箭头右侧新增 `+`，左键打开含“新建任务”的提示卡片，并复用既有新建任务动作；项目 `+` 继续显示文件夹选择卡片。
- 交互：再次左键点击对应 `+` 或按 `Esc` 均会关闭项目、任务及项目行内的新建提示卡片，不触发创建或修改项目/任务数据。
- 边界：仅修改 Renderer 的侧栏组件、Layout 回调传递与样式；不修改 IPC、项目/会话持久化、Runtime 或任务执行路径。
- 验证：开发版实机点击已覆盖两个卡片的打开、再次点击关闭与 `Esc` 关闭；侧栏定向 Vitest 通过（1 项），Web TypeScript 检查与 `git diff --check` 通过。
- 后续样式修正：任务栏目为容纳新增 `+` 包裹了标题容器，原“直接子元素”选择器失效并回退为浅灰小字；已改为后代选择器，恢复与项目栏一致的 13px 常规字重和主文字色。
- 对齐微调：栏目折叠箭头向左收 8px；以项目行（如 `test`）的实测基线为准，栏目标题右侧 `+` 下移 4px。此偏移只作用于“项目 / 任务”标题，不影响项目行既有箭头与 `+` 的对齐；项目与任务使用同一规则。
- 焦点修复：按 `Esc` 关闭项目、任务或项目行内“新建任务”的创建卡片时，移除对应 `+` 触发按钮的残留键盘焦点，避免橙色焦点框停留；用专属 data 属性限定项目行内的 `+`，不影响右侧 `…` 操作按钮、创建动作或数据状态。
- 焦点修复（操作菜单）：项目行和任务行右侧 `…` 打开的浮动菜单会在捕获阶段处理 `Esc`，不经过创建卡片的关闭逻辑；菜单自身在 `Esc` 关闭前清除当前焦点，避免其触发 `…` 残留橙色描边。

## 2026-08-28：豆包 Web Agent Runtime 首发实现

- 范围：新增 `web-agent` Runtime、`local-web` Transport、共享错误/状态/回复契约、隔离 Electron Session Partition、豆包 Provider Adapter、会话映射 Store、受控附件上传与下载产物链路；正常任务隐藏网页，需要登录、验证码或页面恢复时显示同一受控窗口并支持继续执行。
- 交互：Runtime 设置新增豆包网页版模板、登录/打开窗口、连接检测和清除登录数据；Runtime Chat 复用现有附件与事件时间线，强制分析模式并展示用户接管状态，不授予工作区或 Shell 权限。
- 安全：BrowserWindow 使用 `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`；仅允许豆包 HTTPS 官方域名，文件只来自主进程暂存副本，配置与日志不写入 Cookie、Token、提示词或文件正文；同一 Provider/Profile 串行执行并拒绝重复远端会话映射。
- 验证：豆包 DOM 夹具、共享契约、会话映射与 Runtime 注册定向测试共 50 项通过；Node/Web TypeScript 检查与生产构建通过。全量 Vitest 1888 项通过、9 项跳过，另有仓库既有的 10 项失败（日志迁移、主进程 mock、ChatInput 语音 mock、preload 日志 API），与本次改动无关。`lat check` 仅报告既有 `sidebar-navigation.md:37` 断链。

## 2026-08-28：豆包网页提交兼容性修复

- 问题：豆包当前网页使用 TipTap/ProseMirror `contenteditable` 编辑器，发送按钮为无文字的 `#flow-end-msg-send`；原适配器直接写入 `textContent`，无法更新编辑器内部状态，因而报 `WEB_SUBMISSION_UNCONFIRMED`。
- 修复：改用浏览器编辑命令写入内容并保留回退路径，增加当前发送按钮显式选择器；同时兼容豆包当前 `data-message-id` 助手消息行与流式标记，确保答复读取和下载控件收集不依赖旧的助手类名。
- 补充修复：豆包“新对话”入口当前是带 `nav-link` 样式的 `div`，且新会话初始 URL 仅为通用 `/chat`；适配器现可点击该入口，映射存储不再持久化通用落地地址，并将会话映射延后到首轮答复获得具体会话 URL 后写入，避免失败重试污染多个本地会话。
- 提交回执修复：豆包发送后 TipTap 编辑器可能短暂保留原文，不能仅以“输入框为空”或固定 250ms 作为成功条件；现轮询停止/流式标记、用户气泡、具体会话 URL 和编辑器清空等明确证据，最长等待 5 秒后才失败，并覆盖当前用户气泡结构的回归测试。
- 验证：豆包 Provider 与会话映射定向测试 12 项通过，Node/Web TypeScript 检查和生产构建通过；真实账号需在重启最新 Electron 主进程后进行一次文本冒烟测试。

## 2026-08-28：豆包运行中续聊与附件入口修复

- 问题：豆包首轮仍在网页侧收敛时，RuntimeChat 将后续输入误判为需要“停止并恢复”，弹出中途纠偏确认框；ChatInput 同时按 `isLoading` 禁用了附件按钮，导致用户无法准备下一轮文件。
- 修复：豆包 Web Agent 的探测能力改为 `follow_up`，后续提示词及附件进入 Agents One 队列，在当前运行结束后自动发送，不再强制取消首轮；仅对声明可安全排队的 Runtime 放开运行中附件选择，其他 Runtime 保持原有门禁。
- 验证：ChatInput、RuntimeChat、豆包 Provider、Web Agent 契约与 Runtime 治理定向测试共 82 项通过；Node/Web TypeScript 检查通过。真实窗口需重启最新 Electron 后复测：首轮生成期间可选附件并发送，消息应显示跟进队列提示，首轮结束后自动继续。

## 2026-08-28：豆包附件入口兼容性修复

- 问题：当前豆包网页的附件按钮可能是仅图标控件，上传语义仅存在于 `data-testid`、`data-e2e` 或 CSS 类名中；旧适配器只读取按钮文字/ARIA 文案，因而报 `WEB_UPLOAD_REJECTED: 未找到豆包文件上传入口。`。
- 修复：上传入口识别扩展到受控的测试标识、动作属性、标题、`upload/attach` 类名及按钮内部 SVG/图标元数据；图标命中后优先点击可交互父元素。点击后等待动态创建的 `input[type=file]`，并将浏览器 FileList 作为附件已接收的补充证据，仍保留文件名预览和上传中/失败门禁。
- 验证：豆包 Provider 夹具测试 11 项通过；Node/Web TypeScript 检查与生产构建通过。真实账号需重启最新 Electron 后重新发送带附件的豆包任务。

## 2026-08-28：豆包对话 / 工作双模式附件入口修复

- 原因：豆包“对话”和“工作”模式使用不同的附件入口。对话模式通常直接暴露上传按钮或隐藏 `input[type=file]`；工作模式则先点击输入区“+”，再在菜单中选择“上传文件或图片”，此前全页猜测会点到无效的附件容器。
- 修复：Provider 先读取当前激活模式（`data-active` / `aria-selected` / 页面工作态文案），按模式过滤相反区域的控件；对话模式优先直接 file input/上传按钮，工作模式增加加号图标识别、工作菜单项二次点击和动态 file input 标记。上传始终使用当前模式选中的 input，不复用其他模式的 input。
- 验证：新增双模式隔离夹具，豆包 Provider、RuntimeChat、ChatInput、Web Agent 契约与治理定向测试共 85 项通过；Node/Web TypeScript 检查与生产构建通过。真实账号需重启最新 Electron 后分别在“对话”和“工作”模式复测文本及附件。

## 2026-08-28：豆包工作模式优先与额度降级

- 策略：新建豆包任务默认选择“工作”模式；已映射的历史会话保持原模式，避免续聊时悄悄改变上下文。
- 降级：仅当页面明确出现工作模式次数/额度/配额耗尽、上限、不可用或要求切换对话的信号时，自动切换到“对话”模式；网络错误、登录、验证码和普通生成失败不会触发重试。切换后会新建对话并原样重放本轮提示词与附件，最多降级一次，防止重复提交循环。
- 验证：新增工作模式选择、额度耗尽降级和提交拒绝夹具测试；豆包 Provider 定向测试 16 项，Web Agent/RuntimeChat/ChatInput/治理回归合计 88 项，Node/Web TypeScript 检查与生产构建通过。真实账号需重启最新 Electron，分别验证工作模式正常、工作额度耗尽两条路径。

## 2026-08-29：豆包工作模式仅思考节点修复

- 现象：Agents One 页面出现用户提示词和“已思考”，但网页侧最终答复未同步；运行中的豆包 DOM 仅挂载 `block_type:10040` 思考节点，未挂载答复节点。
- 根因与调整：新任务此前先点击“新对话”再切换“工作”模式，豆包可能按对话模式创建远端会话，随后工作模式页面只保留思考块。现改为先选定工作/对话模式，再创建远端会话；工作模式切换失败或明确不可用时才创建对话模式会话。历史会话续聊仍保持原模式。
- 回复提取补强：读取豆包消息时剔除 `block_type:10040`、`thinking_block` 和 `thinking-box-root`，仅思考节点不会再被识别为最终答复；思考与答复同处一行时只保留答复文本。
- 提交回执补强：豆包用户气泡的 CSS 类变化时，读取器同时检查稳定的 `data-message-id` 消息行和去除输入框后的可见提示词，避免已成功提交却被误报 `WEB_SUBMISSION_UNCONFIRMED`。
- 隐藏页生命周期修复：实机复核发现豆包 completion 请求已返回，但隐藏的 Electron 页面因 Chromium 后台生命周期停在“已完成思考”；豆包专属 BrowserWindow 现设置 `backgroundThrottling: false`，保持窗口隐藏同时继续处理流式答复。
- 答复节点优先：豆包最终 Markdown 答复当前位于同一消息行的 `block_type:10000` 节点；读取器优先提取该节点，再清理思考节点，避免页面结构短暂变化时发布思考片段。
- 思考竞态修复：实机再次复现后确认，豆包在思考阶段会短暂创建只有 `data-message-id`、尚未挂载 `10040/10000` 标识的消息行；旧读取器把其中的规划文字当成普通答复，稳定 1.2 秒后提前结束观察。新版豆包消息行现在必须等到明确的 `block_type:10000` 答复块才可发布；未标注消息行持续保持生成中，旧版语义助手容器仍保留兼容回退。
- 验证：Provider 夹具 23 项、Web Agent/RuntimeChat/ChatInput/治理回归 95 项通过；Node/Web TypeScript、ESLint、生产构建通过。真实账号需重启最新 Electron，验证新建工作模式任务能出现最终答复。

## 2026-08-30：豆包工作模式落地页与持续对话修复

- 工作模式：实机反馈确认，豆包“新对话”动作会返回落地页并可能重置分段模式，因此新任务改为先清理到新对话落地页、再选择“工作”，首条提示词提交时才创建具体远端会话。模式标签嵌套在可点击父控件时会点击真实交互节点，并轮询最多 3 秒确认激活态。
- 降级边界：未找到工作控件或切换未确认时不再静默切到“对话”，而是明确报兼容性错误；只有页面出现工作次数、额度或不可用信号时才创建新的对话模式会话并重放本轮输入。
- 持续对话：修复 RuntimeChat 会话 ID 检查点与终态检查点的并发保存竞态。会话 ID 只在首次变化时串行保存，并显式携带当前运行 ID；随后终态保存再清除运行 ID，避免旧保存反向把已结束任务恢复成“运行中”，导致跟进提示词永久排队。跟进回归同时验证第二轮复用同一个豆包 session ID。
- 验证：豆包 Provider、会话映射、Web Agent 契约与 RuntimeChat 4 个定向测试文件共 89 项通过；Node/Web TypeScript 检查与生产构建通过。

## 2026-08-30：豆包落地页异步挂载与窗口销毁修复

- 根因：Electron `loadURL` 完成时，豆包 React 页面可能尚未挂载 TipTap 输入框；旧实现只探测一次，将短暂的空落地页误判为不支持。若接管窗口随后关闭或被重建，原任务仍继续访问旧 WebContents，最终泄露 Electron 的 `Object has been destroyed` 原始错误。
- 修复：登录/输入框探测在无登录、验证码信号时等待页面挂载，最多轮询 5 秒；已确认登录或验证状态仍立即返回。Controller 同时校验 BrowserWindow 与 WebContents 存活状态，用户接管期间窗口被重建后重新取得 ManagedPage，下载监听和后续自动化只绑定新页面；已销毁对象统一转换为可读的 Web Agent 会话错误。
- 实机只读核验：当前豆包落地页最终挂载 `.tiptap.ProseMirror[contenteditable=true][role=textbox]`，并同时呈现“对话/工作”按钮，验证了异步挂载而非选择器失效。
- 验证：相关 4 个测试文件 90 项通过，新增“输入框延迟挂载”夹具；Node/Web TypeScript、生产构建通过，变更文件 ESLint 0 error。

## 2026-08-30：豆包任务成功但对话界面卡在生成中修复

- 现场证据：豆包具体会话已挂载完整 `block_type:10000` 最终答复，且无流式/停止生成标记；本机 `tasks.log` 显示对应 Web Agent Run 在 21.8 秒后 `succeeded`。紧随其后的 Renderer 日志显示 `save-runtime-conversation: Invalid runtime conversation`，证明 Provider 和答复提取已完成，卡点位于本地会话收尾。
- 根因：共享类型已经包含 `AgentRuntimeKind = web-agent`，但 Runtime Conversation Store 的运行时白名单仍只接受 Hermes、Codex、Claude Code 和 Pi。豆包首轮用户消息、session ID 和最终答复保存都被拒绝，`pollRun` 的异步异常发生在清除 loading/currentRunId 之前，界面因此永久停在“思考中”。
- 修复：Conversation Store 正式接受并持久化 `web-agent` 及其 resumable session；终态答复先展示，再尝试持久化，并在 `finally` 中无条件释放运行状态。即使未来磁盘/存储异常，已成功的答复仍会显示，可继续下一轮，并明确提示本地记录未保存；所有 fire-and-forget 保存均吸收已处理的 rejection，不再产生未捕获 Promise。
- 验证：新增 Web Agent Conversation Store 与“终态保存失败仍释放输入框”回归；5 个相关测试文件 96 项全部通过且无未处理错误，Node/Web TypeScript 检查及 Electron 生产构建通过。

## 2026-08-31：豆包最终答复结构化排版修复

- 现象：最终答复内容已经完整进入 Agents One，但标题、段落和列表都被压成连续正文；豆包网页端仍显示分节标题与项目符号。
- 根因：豆包适配器通过 `innerText/textContent` 提取纯文本，丢失了答复 DOM 中的标题、列表、强调等语义；纯文本单换行进入 CommonMark 渲染器后会折叠为空格。
- 修复：最终答复提取改为受控 DOM-to-Markdown 转换，保留段落、六级标题、有序/无序及嵌套列表、粗体、斜体、删除线、引用、行内代码、代码块和安全链接；继续排除思考块、按钮、脚本、隐藏节点等非答复内容。旧式语义消息容器复用同一转换链路。
- 验证：新增“豆包标题、段落和列表保留为 Markdown”回归；5 个 Web Agent 相关测试文件 97 项全部通过，目标文件 ESLint、Node/Web TypeScript 检查及 Electron 生产构建通过。

## 2026-08-31：豆包旧会话追加提问与工作模式附件修复

- 现场证据：已有豆包会话映射有效，首轮答复和格式均成功；无附件追问在 119ms 内以 `WEB_SUBMISSION_UNCONFIRMED` 失败，说明尚未进入答复观察阶段；带附件追问在展开工作模式入口后以“未找到当前豆包模式的文件上传菜单项”失败。
- 追问根因：恢复后的工作会话可能同时存在侧栏搜索框和底部 TipTap 编辑器，且底部控件会在输入状态提交后异步由麦克风切换为发送按钮。旧实现选择第一个可见 textbox，并在写入文本的同一 JavaScript 轮次立即查找发送按钮，因此会选错输入框或过早失败。
- 追问修复：按消息/任务编辑器语义、尺寸和页面位置选择并标记真正的底部编辑器，排除搜索框；等待最多 3 秒识别编辑器附近的发送控件；若已完成的工作任务不暴露稳定发送标识，则在已验证内容且已聚焦的编辑器上发送原生 Enter。提交回执不再把“已经处于具体会话 URL”本身视作新消息已发送，继续要求输入框清空、用户气泡、流式/停止标记等本轮证据。
- 附件修复：工作模式“+”菜单兼容无 ARIA role 的普通 `div/span` 菜单项，但只接受长度受限且完整匹配“上传文件/添加附件/文件”等标签的可见元素，避免从答复正文误点泛化的“文件”文字。
- 验证：新增“恢复会话时避开搜索框并等待异步发送按钮”“无命名发送按钮时使用原生 Enter”回归，并让工作模式附件用例覆盖无 role 菜单项；5 个 Web Agent 相关测试文件 99 项全部通过，目标文件 ESLint、Node/Web TypeScript 检查及 Electron 生产构建通过。

## 2026-08-31：豆包工作模式附件菜单异步挂载修复

- 现场证据：最新一次带附件任务在 326ms 内报 `WEB_UPLOAD_REJECTED`，说明点击“+”后立即检查菜单，未给工作模式的浮层挂载留下足够时间。用户截图确认该浮层中的实际目标项为“上传文件或图片”。
- 修复：工作模式点击“+”后，适配器轮询最多 3 秒寻找可见的上传菜单项，再逐项检查 `aria-label/title/data-testid/data-e2e/data-action/可见文字`，点击精确匹配“上传文件或图片”的交互元素；兼容无 ARIA role 的普通 `div/span` 门户浮层，不会把答复正文中的“文件”误作菜单项。
- 验证：新增“工作模式菜单延迟挂载至门户浮层”回归；豆包 Provider 30 项、5 个 Web Agent 相关测试文件 100 项通过，目标文件 ESLint、Node/Web TypeScript 检查、Electron 生产构建及 `git diff --check` 通过。

## 2026-08-31：豆包工作模式“+”图标容器兼容修复

- 现场证据：最新运行已不再报菜单项缺失，而是在 3.17 秒页面探测后报“未找到豆包文件上传入口”，说明当前网页的“+”控件没有被旧的 `button/role/button/upload` 候选选择器识别。
- 修复：候选集合补充 `cursor-pointer`、`add`、`plus` 类名及普通 `div/span` 图标容器；在已确认工作模式且位于编辑器左侧的 64px 以内圆形图标中启用受限兜底，同时排除语音、发送、停止、录音和表情图标，随后仍复用“上传文件或图片”菜单轮询与模式隔离逻辑。
- 验证：新增通用图标容器夹具（含右侧语音图标排除）；豆包 Provider 31 项、5 个 Web Agent 相关测试文件 101 项通过，ESLint、Node/Web TypeScript 检查及 Electron 生产构建通过。

## 2026-08-31：豆包附件菜单真实鼠标事件修复

- 现场证据：直接检查豆包页面 DOM 发现“+”使用 Radix `DropdownMenuTrigger`，只有真实的 pointer/mouse down/up 序列会把 `aria-expanded` 切换为 `true` 并挂载菜单；此前在 `executeJavaScript` 中调用 `.click()` 不会打开弹层，因此最终报 `WEB_UPLOAD_REJECTED: 未找到当前豆包模式的文件上传菜单项`。
- 修复：上传入口和“上传文件或图片”菜单项先在页面内标记，再由 Electron `WebContents.sendInputEvent` 对可见元素中心坐标发送原生鼠标移动、按下、抬起事件；测试夹具没有原生点击桥接时保留 DOM `.click()` 回退。针对豆包嵌套按钮结构，优先选择内部 `data-dbx-name="button"` 控件，避免点击外层空壳触发器。
- 验证：豆包 Provider 32 项通过（新增 Radix 指针事件回归）；目标文件 ESLint 0 error，Node/Web TypeScript 检查及 Electron 生产构建通过。通过 CDP 实测原生鼠标序列可打开工作模式菜单并呈现“上传文件或图片/选择云盘文件”两项。

## 2026-08-31：豆包隐藏窗口附件点击改用 CDP 输入事件

- 现场复核：重启主进程后仍在 7.6 秒（3 秒菜单轮询 + 5 秒输入框等待）报菜单项缺失；原因是正常任务的豆包 BrowserWindow 为隐藏状态，Electron `sendInputEvent` 未可靠触发隐藏页面的 Radix 指针处理。
- 修复：Controller 的原生点击桥接改用当前 WebContents debugger 的 `Input.dispatchMouseEvent`（`mouseMoved`、`mousePressed`、`mouseReleased`），仅在 debugger 已被外部 DevTools 占用时回退 `sendInputEvent`。菜单入口和菜单项仍通过页面标记定位，不扩大网页权限范围。
- 验证：重跑豆包 Provider 及 Web Agent 相关测试 77 项、Node/Web TypeScript、目标文件 ESLint 和 Electron 生产构建均通过。
- 发布注意：该修复位于主进程 Controller，开发模式热更新不会替换已运行的 Electron 主进程；必须完整退出并重新启动 Agents One 后再验证附件上传。仅刷新豆包页面不足以加载此修复。

## 2026-08-31：豆包附件交互会话与文件输入对象修复

- 现场证据：加载 CDP 点击版后，真实任务 `run-b34bc5a0-1db0-4d96-9730-c2d211c1477c` 仍在 6.8 秒后报“未找到当前豆包模式的文件上传菜单项”。对失败后保留的同一豆包 WebContents 进行 CDP 对照：鼠标事件发送完立即断开 debugger 时，触发器保持 `aria-expanded=false`；等待 180ms 后再断开则稳定出现“上传文件或图片”菜单。
- 第二处根因：原文件注入先用 `Runtime.evaluate` 获取输入框，再通过 `DOM.requestNode` 转为 `nodeId`。未先建立 DOM 文档树的 debugger 会话会让该 `nodeId` 在 `DOM.setFileInputFiles` 时失效。实测直接传递 `Runtime.evaluate` 返回的 `objectId` 可成功注入 `README.md`，豆包页面出现“解析中... · 7KB”。
- 修复：附件阶段把隐藏 Provider 窗口临时移到屏幕外并 `showInactive()`，整个菜单点击、文件选择器拦截、文件注入和上传确认共用同一个 debugger 会话；每次真实点击后等待 React/Radix 提交状态；`DOM.setFileInputFiles` 直接使用稳定的输入框 `objectId`。流程结束后立即断开 debugger、隐藏窗口并恢复原坐标，不展示外部浏览器窗口。
- 验证：对真实豆包页面完成“+ → 上传文件或图片 → 文件输入框 → `README.md` 解析中”链路验证；豆包 Provider/Web Agent 相关 77 项测试、目标 ESLint、Node/Web TypeScript 检查及 Electron 生产构建通过。

## 2026-08-31：豆包附件改用 Chromium 原生拖放

- 最终根因：豆包工作模式的上传菜单和临时 `input[type=file]` 依赖可见窗口、焦点、Radix 浮层及文件选择器的连续生命周期。隐藏的 Electron Provider 窗口即使可以单步打开菜单，也不能在完整任务中稳定保留临时输入框，因此菜单选择器修补无法消除 `WEB_UPLOAD_REJECTED`。
- 修复：主进程通过 CDP `Input.dispatchDragEvent` 向当前底部消息编辑器依次发送可信的 `dragEnter`、`dragOver`、`drop`，拖放数据只包含 Agents One 已完成安全暂存的附件绝对路径。豆包适配器优先使用该原生拖放桥接；原有“+ → 上传文件或图片 → file input”链路保留为无 CDP 环境和测试夹具的兼容回退。提示词发送也使用同一可信原生点击桥接，避免附件成功后因合成 `.click()` 无效而误报提交失败。
- 实机验收：重启最新主进程后，真实运行 `run-faae6296-8a0b-4be5-8a3e-bdef30f0ad9c` 上传 `upload-test-3.txt`，事件流先记录“豆包已接收本轮附件”，随后豆包返回“附件上传测试成功”，最终状态为 `succeeded`。
- 自动验证：豆包 Provider/Web Agent 相关 4 个测试文件共 79 项通过；Node/Web TypeScript 检查、目标文件 ESLint 及 Electron 生产构建通过。

## 2026-08-31：豆包失败上传草稿隔离修复

- 现场证据：用户运行 `run-86c4b7d3-8710-4d9f-8d64-ff07d5a8c4e0` 已进入原生拖放路径，但 30 秒后报“未能确认豆包已接收附件”；附件为 5,477 字节的 `领学发言稿（修改版）.md`。使用同一文件直接复现时，豆包先显示“上传中... 0%”，清空落地页后约 1.4 秒转为“Markdown · 5KB”并可正常读取。
- 根因：豆包已位于通用 `/chat/` 落地页时，点击侧栏“新对话”可能是 React no-op，前一次失败留下的“上传中... 0%”附件草稿继续存在。新附件即使上传完成，旧的全局上传标记也会让确认逻辑持续等待并最终超时。
- 修复：新建本地豆包会话时，在验证“新对话”入口后强制重新加载隔离分区内的 `/chat/` 落地页，清除旧编辑器内容、失败附件与上传标记；等待底部编辑器和对话/工作模式控件重新挂载后才进入工作模式选择和本轮附件上传。
- 验证：新增“通用落地页清除失败上传草稿”回归；4 个相关测试文件共 80 项通过，Node/Web TypeScript 检查及 Electron 生产构建通过。重启最新主进程后，真实运行 `run-9e5e5b9f-1d07-4553-85ae-2ea8b53f80f5` 上传同一份 `领学发言稿（修改版）.md`，事件流记录“豆包已接收本轮附件”，豆包返回文件标题，最终状态 `succeeded`。

## 2026-09-01：豆包附件成功后提交回执误报修复

- 现场证据：运行 `run-f2aae64b-c98e-4616-b958-0d11108e5edd` 已在豆包页面成功上传附件并生成完整答复，但 Agents One 在提交后约 13 秒提前报 `WEB_SUBMISSION_UNCONFIRMED`。页面中的用户消息把原提示词“105周年 / 10分钟”自动排版为“105 周年 / 10 分钟”，且提交后 React 替换了原 TipTap 输入框节点。
- 根因：提交回执用保留单词间空格的提示词做整句匹配，无法识别豆包插入的展示空格；原输入框被替换后，标记在旧节点上的“输入框已清空”证据也随之丢失，两条有效回执信号同时失效。
- 修复：回执比较先执行 Unicode NFKC 归一化并移除展示空白，再匹配用户气泡、`data-message-id` 与 `data-observe-row` 消息行；若原标记输入框已被 React 替换，则重新定位当前可见的底部非搜索编辑器并检查清空状态。
- 验证：新增“豆包重排数字空格并替换编辑器”夹具回归；4 个相关测试文件共 81 项通过，目标 ESLint、Node/Web TypeScript 检查及 Electron 生产构建通过。完整重启主进程后，真实运行 `run-a8f447a5-6bf9-44ea-9a38-767be1dd72be` 上传同一份 5,477 字节的 `领学发言稿（修改版）.md`，事件流记录附件已接收、开始生成和任务完成，最终返回“已读取 105 周年发言稿。”并以 `succeeded` 结束。

## 2026-09-01：豆包工作模式主体答复完整提取修复

- 现场证据：带附件任务曾在 Agents One 只显示“我先读取这份讲话原文，然后为你提炼要点”，而豆包网页已显示完整提炼。实际 DOM 显示同一助手消息行依次挂载阶段性 `block_type:10000`、思考块、主体 `block_type:10000`；阶段性块在主体出现前会被错误当作最终答复。
- 修复：现代豆包消息行在出现思考块时，必须等待其后的最终 `block_type:10000` 答复块；主体提取只读取最新思考块之后的答复块，避免提前结束和混入“我先读取……”状态句。另对豆包偶发泄露的 `<think>...</think>` 内部规划片段做 provider 级清理。
- 验证：新增阶段块等待、主体块提取和 think 标记清理回归；相关测试 84 项通过，Node/Web TypeScript 检查及 Electron 生产构建通过。真实任务 `run-8fc691a1-0ab3-43ea-9a8e-a52fd43763f3` 已完成附件上传和主体答复提取，最终状态 `succeeded`，输出约 1,603 字符；期间先返回约 904 字符主体，继续等待豆包生成结束后再收尾。

## 2026-09-01：ChatGPT 网页智能体 Provider 接入

- 新增 `ChatGPTProviderAdapter`，复用已验证的安全提交、流式响应、Markdown 排版、附件拖放/文件选择和下载收集链路；ChatGPT 使用独立 Electron 分区与登录档案，允许 `chatgpt.com`/`www.chatgpt.com` 来源。
- 工作模式优先：识别顶部“工作/聊天”切换并默认选择工作；仅在 ChatGPT 明确提示额度、次数、上限或不可用时自动切换聊天模式并重试，避免重复提交。
- 多轮会话：支持 ChatGPT `/c/{conversationId}` 稳定地址保存与恢复；运行时设置面板新增 Provider 选择（豆包/ChatGPT）及通用网页登录档案配置。
- 验证：新增 `tests/chatgpt-web-agent.test.ts`（登录探测、工作额度兜底、提示词提交）3 项通过；ChatGPT 与既有豆包相关测试、Node/Web TypeScript 检查及 Electron 生产构建通过。真实 ChatGPT 登录态验收需在应用内打开 ChatGPT Provider 后执行首轮登录确认。

## 2026-09-01：ChatGPT 登录 OAuth 跳转白名单修复

- 现场现象：ChatGPT 登录页首个登录按钮长时间转圈，页面未回到 Agents One 可识别的登录结果。
- 根因：Runtime 导航守卫原先只允许 `chatgpt.com`，而 ChatGPT 登录会经由 `auth.openai.com`、Google/Apple/Microsoft 登录域名完成 OAuth 跳转，认证页面被守卫拦截。
- 修复：新增仅用于登录导航的 Provider 认证域名白名单；普通会话 URL 校验仍只允许 ChatGPT/Doubao 自身域名，认证域名不会被写入会话映射。重启后实测 ChatGPT 已从登录页推进至 Google 密码验证页，说明 OAuth 跳转链路恢复。

## 2026-09-01：ChatGPT 工作模式回复完成与附件回执修复

- 现场证据：ChatGPT 页面已显示完整答复，但运行一直停留在“正在生成回复”，最终因 `WEB_CANCEL_UNCONFIRMED` 超时；其 assistant 行同时带有语义角色和 `data-message-id`，被豆包兼容逻辑误判为思考中的现代消息行。
- 修复：当消息行明确标记为 ChatGPT assistant 时，允许从该行提取 Markdown 正文，并不再套用豆包“必须出现 `block_type:10000`”的进行中判定；仍以停止按钮、流式标记和正文稳定时间作为完成条件。附件提交后的用户消息/会话路由可能延迟挂载，提交回执等待窗口由 5 秒扩大为 15 秒，避免附件已接收但回执尚未渲染时误报。
- 验证：真实 ChatGPT 工作模式首轮 `run-44aa0d05-7cb0-4ddc-b8a1-7a2dba2698b7` 返回“ChatGPT 工作模式第三轮测试成功。”并 `succeeded`；使用同一 `sessionId` 的追问 `run-3d6b5912-7b11-47b2-8365-0d80808b0830` 返回“ChatGPT 多轮会话追问成功。”并 `succeeded`。附件场景经“文件处理等待 + 原生发送按钮/Enter 兜底”修复后，`run-322245e7-72a1-42e0-b2d2-6bb6e21194ff` 成功接收 `chatgpt-test-8.txt`，返回“这是 ChatGPT 第八次附件测试内容。”并登记输入 artifact。相关 Web Agent 测试 47 项通过，Node/Web TypeScript 检查通过。

## 2026-09-01：ChatGPT 分段有序列表序号修复

- 现场证据：Agents One 提取 ChatGPT 附件答复时，第二、第三段有序列表重新显示为 `1.`；ChatGPT 页面 DOM 对应分段明确带有 `start="3"`、`start="4"` 等属性。
- 根因：共享的 DOM-to-Markdown 提取器对每个 `<ol>` 都固定使用 `index + 1`，忽略了 HTML 有序列表的 `start` 属性；ChatGPT 为长答复拆分列表时因此丢失连续序号。
- 修复：有序列表提取优先解析有效的 `start` 属性并按 `start + index` 输出；无该属性的列表仍从 1 开始，`data-start` 等字符偏移属性不会误用为序号。
- 验证：新增分段有序列表回归用例；豆包 Provider 与 ChatGPT Provider 定向测试 44 项通过，Node/Web TypeScript、Electron 生产构建及 `git diff --check` 通过。

## 2026-09-01：ChatGPT 追问提交焦点回退修复

- 现场证据：ChatGPT 页面仍保留追问文本和发送按钮，Agents One 等待 15 秒后报 `WEB_SUBMISSION_UNCONFIRMED`；页面当前焦点位于发送按钮，说明可信指针点击后未触发 React 提交处理。
- 根因：提交回执失败后的键盘兜底直接向当前焦点发送 Enter。发送按钮取得焦点后，Enter 不会回到 ProseMirror 编辑器，未发送草稿因此一直留在输入框。
- 修复：点击发送按钮后若草稿仍存在，重新定位并聚焦底部编辑器，再发送可信 Enter；保留原有用户气泡、消息行和输入框清空等回执校验，不会将未经确认的点击直接视为成功。
- 验证：新增“可信点击留下草稿时重新聚焦编辑器”回归；豆包/ChatGPT Provider 定向测试 45 项通过，Node/Web TypeScript、Electron 生产构建及 `git diff --check` 通过。

## 2026-09-02：ChatGPT 历史答复误读与超时取消提示修复

- 现场现象：ChatGPT 附件提炼任务偶尔返回上一轮的智能体简介；再次提问超时后，Agents One 仍显示“未能确认豆包网页是否已停止生成”。
- 历史答复根因：恢复已有 ChatGPT 会话时，底部编辑器会先挂载，历史助手消息稍后才异步 hydrate。若在空消息树阶段建立响应基线，首个 hydrate 的旧答复会被误判为本轮新答复。
- 修复：Controller 在已有会话和响应基线为空时增加最多 3 秒的有界 settle 窗口，先纳入历史助手消息再发送；工作模式降级到对话模式重试时复用同一基线逻辑，避免旧答复再次串入新任务。
- 取消提示修复：取消/超时路径按实际 Provider 显示 ChatGPT 或豆包；停止按钮先由页面标记，再通过可信原生点击桥接触发，避免合成 `.click()` 无效导致取消状态悬挂。
- 验证：真实 ChatGPT 同一会话连续追问两轮均按指定文本返回；带附件 `README.md` 的真实任务返回附件中的项目名“Agents One”，本地任务状态为 `succeeded`。补丁完成后 Provider 定向测试 50 项通过，Node/Web TypeScript、生产构建和 `git diff --check` 均通过；完整重启 Electron 后再次发送 `CHATGPT-FINAL-BUILD-OK`，任务成功收敛。

## 2026-09-03：Web Agent 发送过程闪屏与 ChatGPT 附件提交回退修复

- 现场现象：Agents One 向豆包或 ChatGPT 发送提示词/附件时，隐藏 Provider BrowserWindow 会短暂出现在桌面，形成明显闪屏。
- 根因：Windows 下隐藏 WebContents 对可信 CDP 鼠标事件支持不稳定，Controller 原先在交互阶段调用 `show()`、`focus()` 并设置 `opacity=0.01`；合成器会绘制出这一帧非零透明度的网页内容。
- 修复：交互阶段改用 `setOpacity(0)` + `showInactive()`，不再激活或聚焦 Provider 窗口；任务结束仍立即隐藏窗口、恢复原透明度/坐标/任务栏状态及此前焦点。登录/人工验证窗口仍由显式打开流程正常显示。
- 兼容回退：部分 Chromium 版本在透明窗口中会忽略 ChatGPT 带文件芯片的可信点击/Enter。若草稿仍在输入框，ChatGPT Provider 最后调用同页发送按钮的 DOM click，避免附件已接收但提交回执未确认。
- 验证：新增 ChatGPT 同页提交回退回归，豆包/ChatGPT/Web Agent 定向测试 51 项通过；Node/Web TypeScript、Electron 生产构建通过。完整重启 Electron 后真实运行：豆包纯文本 `run-ea89e95f-48dc-42f7-aa02-4ff1e456af1e`、豆包附件 `run-535659a4-a2bd-4d1b-a418-12a8ecefbd53`、ChatGPT 纯文本 `run-0a2a32ce-e49e-4c62-b550-be25b782f5f0`，以及最终“透明且不激活”策略下的 ChatGPT 附件 `run-e4ee2b9f-e6c7-4b1b-a3ea-5a90d51b3a46` 均以 `succeeded` 结束；附件分别返回 `FLASH_ATTACHMENT_CONTENT_OK` 与 `领学发言稿（修改版）(3)`。

## 2026-09-03：新增智能体三步接入向导

- 问题：原新增表单同时展示类型、位置、连接方式、Gateway、工作区网关和超时等信息，用户在尚未确定接入类型前就需要理解低频配置；超时以毫秒呈现，意义不够直观。
- 改动边界：仅修改 Renderer 的 `AgentRuntimesPane` 及其样式和测试；复用既有 Runtime 保存、受保护 Token 存储、连接测试和 Connect 配对接口，不改 IPC、持久化结构、历史或已接入智能体管理页。
- 修复：新增流程改为“选择类型 → 基础信息 → 连接设置”。第一步选择本地、远程或网页智能体；第二步配置头像、颜色、名称、ID 与受支持的智能体类型；第三步按类型显示 CLI、网页 Provider 或远程 Gateway v1 所需字段。远程智能体只有一条统一 Gateway v1 连接，新增流程直接提供服务地址和鉴权 Token；Agents One Connect 仅负责通过接入校验码完成配对并安全下发这两项信息，不再作为与 Gateway 并列的第二种连接方式。受控工作区 Gateway 地址和 Token 仍为高级兼容配置，不作为新增流程必填项；已有智能体的管理页仍保留兼容性配置。
- 超时：底层仍保存 `timeoutMs`，界面改按秒输入，三类智能体默认均为 300 秒，并说明它限制连接检测与对话请求的等待时间。
- 验证：`AgentRuntimesPane` 8 项定向测试通过，Web TypeScript 检查通过；已有 Runtime 仍使用原管理路径。

## 2026-09-05：公共底座与 OpenCode ACP 远程 Adapter 第一阶段落地

- 按统一接入 PRD v1.1 将交付范围明确为“公共底座 + OpenCode”：Pi、Codex、Claude Code 远程 Adapter 仅保留后续阶段方案和独立开关，不在本阶段宣称可用。
- 已落地通用 `Remote CLI Host`：多个 Runtime 共用一套 Gateway v1，按显式 `runtimeId` 分发 Adapter，统一处理运行、事件、模型、用量、取消和 Artifact 路由，并拒绝未注册 Runtime。
- 已落地 OpenCode ACP 远程 Adapter 首个纵向切片：shell-free ACP JSON-RPC、会话创建/恢复、助手答复与思考摘要分流、工具事件、实际模型/用量、权限策略、取消、工作区边界和 Artifact 发布。
- 已落地 Connector/Connect 多 Runtime 兼容：一个设备可声明多个 Runtime，旧版单 Runtime 凭据和 hello 仍可读取；桌面端按 Runtime 独立保存和路由，Artifact 隧道请求携带受控 Runtime 标识。
- 验证：Plugin SDK 16 项、Connect 服务 3 项、Connector 4 项、Renderer 13 项定向回归通过；`npm run typecheck`、Electron 生产构建、核心 lint、`lat check` 和 `git diff --check` 通过。全量 Vitest 为 202 个文件、2,009 项，其中 1,996 项通过、9 项跳过、4 项既有失败；失败位于 API key 审计日志、主进程 mock、旧版 preload `readLogs` 和 Hermes drift 审计日志测试，不涉及本阶段变更。

## 2026-09-05：第一阶段底座收口与 OpenCode 远程模型/状态修复

- 连接安全：Desktop-first 配对不再把 Connect 返回的 Runtime-scoped Token 交给 Renderer；完成配对和多 Runtime 接入时优先为每个 Runtime 保存独立 Token，旧版聚合 Token 仅作为兼容回退。Connect 服务补齐可选原子状态持久化、进程内 TLS/WSS、版本不兼容握手、配对尝试限流、Runtime 审批与离线错误文案。
- OpenCode 入口：远程 OpenCode 探测优先走 Gateway v1，不再先在 Desktop 上执行本地 ACP probe；Manifest 和新建向导将 OpenCode 纳入第一阶段远程 Host 实际开发，Pi、Codex、Claude Code 仍保持后续阶段。
- 模型真实性：Gateway/Host/Run/会话历史贯通 `requestedModel` 与 Provider 返回的 `actualModel`；当上游只返回 `actualModel` 或实际模型与请求模型不一致时，主进程和 Runtime Chat 工具栏优先显示实际模型。
- 状态可读性：Runtime 管理列表和详情区分本地、远程服务、已配对和手动直连，避免把自托管 Gateway 误标为“已配对”。
- 验证：Plugin SDK 19 项、Connect 服务 6 项、Connector 5 项、Runtime Agent/Settings 相关 63 项通过；`npm run typecheck` 通过，受影响文件 ESLint 0 error（仅有 Prettier 警告），相关 MJS `node --check` 通过。生产发布前仍需真实 OpenCode Windows/Linux E2E、Provider 登录、Connect 重连、Host 重启和独立灰度门槛。

## 2026-09-05：第一阶段完整验证收口

- 验证：远程 Gateway、Runtime 管理向导、Runtime Chat 相关 3 个测试文件共 102 项通过；Plugin SDK 19/19、Connect 服务 6/6、Connector 5/5；主工程 `npm run typecheck` 和 `npm run build` 通过；受影响文件 lint 0 error；核心 MJS `node --check` 通过；`lat.md check` 全部通过。
- 全量基线：主工程 202 个测试文件中 198 个通过，2,001 项通过、9 项跳过、4 项失败。4 项失败仍为仓库既有的 API key/Hermes 审计日志、shutdown mock、旧版 preload `readLogs` 兼容测试，不涉及本阶段代码；在本阶段变更前后均可复现。
- 发布边界：代码和自动化回归已覆盖第一阶段底座及 OpenCode 远程结构化链路；真实 OpenCode CLI、跨主机 TLS/WSS、Connect 重连/Host 重启和灰度环境仍需外部环境验收后，才能打开生产发布开关。

## 2026-09-07：Agents One 旧 Hermes 产品品牌清理（实施前安全评估）

- 改动原因：应用已完成 Agents One 品牌切换，但默认头像、默认人格、回退名称、双语文案、贡献指南、构建元数据及内部 Renderer 命名空间仍混有 Hermes Desktop/Hermes One 产品身份；需要在不移除 Hermes Agent Runtime 的前提下完成品牌收口。
- 改动边界：允许修改品牌资产、Renderer 显示文案、默认人格、贡献指南、构建 vendor、preload 全局 API 别名、Renderer 本地存储键/事件名、Desktop 专属环境变量和 Windows 应用身份迁移逻辑。明确保留 Runtime kind/id、`.hermes`、`HERMES_HOME`、Hermes CLI、Dashboard/Gateway、`X-Hermes-*` Header、`hermes.tool.progress`、安装/更新/Doctor 与对应兼容测试。
- 影响数据与消费者：主题、字体、语言、圆角、侧栏状态和版本缓存使用旧 localStorage 键；Renderer、E2E 脚本和测试使用 `window.hermesAPI`；启动代码读取旧 Desktop 环境变量与旧 Electron userData 目录；Windows 通知和任务栏曾使用 `com.hermes.desktop`。
- 失败模式：直接改键会丢失界面偏好和置顶会话；直接删除 preload 名称会使旧脚本失效；直接切换 Windows 身份可能造成通知/任务栏分组变化；误改 Hermes Runtime 标识会破坏本地安装、远程 Gateway、历史会话和协议兼容。
- 回退方案：preload 同时暴露 `agentsOneAPI` 与 `hermesAPI`；新存储键首次读取旧键并复制，保留旧值；Desktop 环境变量优先读取 `AGENTS_ONE_*` 并回退 `HERMES_DESKTOP_*`；旧 userData 目录仅作为迁移来源；Runtime 和协议标识完全不改。每一层均可独立回退，不批量重写用户配置或历史。
- 验证清单：资源零引用检查、品牌文案审计、默认头像/托盘提示组件测试、preload 类型检查、存储迁移单测、启动兼容测试、Node/Web TypeScript、相关 Vitest、生产构建、`git diff --check`；最后确认 Hermes Runtime 注册、CLI、Header 和 `.hermes` 引用仍存在。

## 2026-09-07：Agents One 旧 Hermes 产品品牌清理完成

- 视觉资产：删除 8 个未使用或已被替代的旧 Hermes 图标、字标、背景和启动页素材；默认档案头像改用 `agents-one-mark.svg` 彩虹圆环；删除旧 `HermesLogo` 以及未使用的 `BrandLogo` 组件。已完成全库零引用检查，任务提示框继续复用同一彩虹圆环。
- 产品身份：默认人格不再自称 Hermes；通用回退名称、聊天导出说话人、错误提示和密码窗口改为 Agents One 或中立的 Agent；真实 Hermes 功能统一标注为“Hermes Agent Runtime”。中英文档案、聊天、记忆、设置、安装、Gateway、欢迎页等文案已按该边界收口。
- 元数据与文档：贡献指南、Linux vendor、旧社区死链接、开发/远程脚本提示和活跃架构文档已切换为 Agents One；两个活跃计划文件更名为 `AGENTS_ONE_FIVE_PHASE_PLAN.md` 与 `AGENTS_ONE_RELEASE_REGRESSION_MATRIX.md` 并同步引用。历史进展日志、上游发布研究和 LICENSE 归属保留原文。
- 兼容迁移：preload 主入口改为 `window.agentsOneAPI`，旧 `window.hermesAPI` 仅作为废弃兼容别名保留；Renderer、测试和自动化脚本已切换新入口。主题、字体、语言、圆角、侧栏状态、面板宽度和版本缓存使用 `agents-one.*` 新键，首次读取会复制旧值且不删除旧键。新 Renderer 事件使用 `agents-one:` 命名，监听端继续接受旧事件。
- 启动兼容：Desktop 专属环境变量改为 `AGENTS_ONE_*`/`VITE_AGENTS_ONE_*` 优先并回退旧变量；Windows AppUserModelId 与构建 appId 统一为 `com.pkulyn.agents-one`。旧 Electron userData 目录只作为一次性迁移来源，复制缺失项、不删除源目录；迁移完成后写入标记，避免每次启动重复扫描。
- Runtime 保护：保留 `kind: "hermes"`、`hermes-local`、`.hermes`、`HERMES_HOME`、Hermes CLI、Dashboard/Gateway、`X-Hermes-Session-Id`、`X-Hermes-Session-Token`、`hermes.tool.progress`、安装/更新/Doctor 与对应测试，未批量重写 Runtime 配置、用户档案或历史。
- 验证：Node/Web TypeScript 与 Electron 生产构建通过；Renderer、preload、安全、安装器、Hermes API/CLI 和 Runtime 注册相关定向回归共 140 项，其中 139 项首轮通过，1 项在并发负载下超过 5 秒，单独重跑通过。另一个 Renderer/托盘批次 111 项全部通过。`lat check` 与旧产品标识/旧视觉资源审计通过；`git diff --check` 的唯一尾随空格已修复。

## 2026-09-09：豆包网页任务间歇失败修复（实施前安全评估）

- 改动原因：豆包普通对话与定时任务共用的 Provider 适配器间歇出现 `WEB_PAGE_UNSUPPORTED` 和 `WEB_SUBMISSION_UNCONFIRMED`。本机日志显示失败耗时分别与新会话短暂挂载窗口、提交回执等待窗口吻合；失败现场保留完整草稿和可用发送按钮，而同一账号通过完整 Agents One 入口的后续固定标记任务可以成功。
- 改动边界：仅允许修改 `src/main/web-agent/providers/doubao.ts`、对应 DOM 夹具测试、`lat.md/web-agent-runtime.md` 与本进展日志；不修改 Runtime 注册、IPC、调度数据结构、用户登录分区、会话历史或持久化配置。
- 影响数据与消费者：不新增或改写持久化字段。普通 Runtime Chat 与桌面定时任务均消费同一豆包适配器行为，因此会同时获得更长的新会话挂载等待和一次受证明未提交后的恢复动作。
- 失败模式：等待过短会把慢挂载误报为页面不支持；未经证明就重复点击可能造成重复发送。恢复动作必须同时确认草稿完整保留、无用户消息回执、无生成标记且发送控件仍可用，并且每轮最多执行一次。
- 回退方案：补丁局限于 Provider 文件，可单独回退；原错误码、会话映射和安全失败语义保持不变。
- 验证清单：新增延迟挂载和未提交恢复回归，运行豆包/Web Agent 定向测试、Node/Web TypeScript、目标 ESLint、生产构建、真实账号固定标记冒烟、`lat check`（若本机命令可用）及 `git diff --check`。

## 2026-09-09：豆包网页普通对话与定时任务恢复完成

- 根因：豆包冷页面偶尔超过原 5 秒新会话挂载窗口，随后模式选择只能报 `WEB_PAGE_UNSUPPORTED`；透明非激活窗口中的可信发送点击也会偶发被 Chromium 确认、但未被豆包 React 提交处理接收，草稿原样保留，15 秒后报 `WEB_SUBMISSION_UNCONFIRMED`。普通对话与定时任务共用同一 Provider 适配器，因此同时受影响。
- 修复：豆包新会话等待编辑器与模式控件的窗口延长到 15 秒，超时后给出准确页面加载错误；提交回执新增新会话 URL 证据，并在草稿完整、无对应用户消息、无生成态且精确发送控件仍可用时，最多执行一次同页 DOM 恢复提交。其他网络、慢回执或未知页面状态仍安全失败，不会盲目重发。
- 自动验证：豆包、ChatGPT、Web Agent 会话/边界和定时任务共 5 个测试文件、76 项通过；Node/Web TypeScript、目标 ESLint、Electron 生产构建和 `git diff --check` 通过。
- 实机验收：完整重启主进程后，普通 Web Runtime `run-c115fe0c-4495-4996-a453-c958f0392486` 返回 `DOU-FIXED-ORDINARY-20260909` 并 `succeeded`；现有“测试-豆包”计划运行 `run-d2f3a4eb-9a00-4012-9bf8-e400dc61657c` 成功生成 3,894 字 AI 周报并 `succeeded`。账号登录态、Runtime 注册、调度入口和结果持久化均正常。

## 2026-09-09：Windows 任务栏彩虹圆环图标修复

- 问题：开发运行的 Agents One 主窗口在 Windows 任务栏仍显示 Electron 原子图标，虽然窗口、托盘和安装包资源已经指向彩虹圆环。
- 根因：主进程使用 `@electron-toolkit/utils` 的 `electronApp.setAppUserModelId`。该封装会在开发模式刻意把应用标识替换成 `process.execPath`；现场 Renderer 命令行因此携带 `--app-user-model-id=...\\electron.exe`，Windows 按 Electron 身份分组并取其原子图标。
- 改动边界：仅调整主进程 Windows 应用身份设置及对应启动测试，不修改 Runtime、IPC、持久化配置、历史记录或用户数据。改为在 `app.whenReady()` 前直接调用 Electron 原生 `app.setAppUserModelId("com.pkulyn.agents-one")`，使开发版与打包版共用稳定身份；主窗口继续使用现有 `resources/icon.png`，打包继续使用 `build/icon.ico`。
- 验证：启动身份测试确认固定 AppUserModelId 在 readiness 之前设置；定向 Vitest 2 项通过，目标 ESLint 通过，Node/Web TypeScript 与 Electron 生产构建通过。视觉资源核验为 512×512 RGBA PNG，ICO 包含 16、20、24、32、40、48、64、128、256px 九档彩虹圆环。现有运行进程需完整退出并重新启动后，Windows 才会为新窗口应用更新后的任务栏身份。

## 2026-09-09：开源发布收口 PRD v1.1 修订（复核后补强）

- 依据：当日全量实测复核——`npm run typecheck` 通过；Vitest 205/209 文件、1,969 通过/82 失败/9 跳过（4 个失败文件：preload API 重命名 79、托盘 IPC 静态扫描 1、配置审计日志 2）；ESLint 发布范围 11 errors；`npm audit --omit=dev` 6 漏洞（2 high/4 moderate，全部 `npm audit fix` 可修）；`origin` 仍指向本地 Hermes 目录；main 停留在上游 tip `8a4268f`，功能分支领先 39 提交；`safeStorage` 全库零引用。
- 修订内容（仅文档，未改代码）：新增 OR-007（Git 历史安全扫描）、OR-008（公开范围内容审计）、OR-009（已跟踪开发环境杂物处置）；OR-004 补功能分支整合与 CI 默认 ref 切换；OR-505 扩为「版本线与历史 tag 命名空间」三项决策（历史 tag 推送、version bump、版本线二选一）；OR-501 补 `format:check` 脚本与 `rc1-windows.yml` 草稿复用；G0/DoD/建议提交切片/里程碑与工期（8–11 工程日）同步更新；基线表补分支行与漂移注记；修正 OR-006 绝对路径表述（活跃文档已干净，仅 `tests/agent-runtimes.test.ts` 1 处夹具）。
- 遗留：PRD 中各项任务仍未执行，发布结论维持 No-Go，待按 OR 顺序推进。

## 2026-09-12：英文核心界面收口第一批

- 定时任务：主导航、概览、筛选、任务表格、运行状态、调度描述及新建/编辑表单全部接入中英文词典，组件源码不再包含硬编码中文；新增真实 Electron 双语验收脚本，覆盖 1024×768、768×800 与新建表单。截图复核发现并修复 768px 内容区标题被工具栏挤压的问题。
- 智能体总览：三类接入分区、健康状态、连接信息、空状态、操作与管理弹窗入口全部接入中英文词典；新增英文组件回归。截图复核发现并修复 768px 下远程/网页卡片内部横向滚动，验收脚本进一步检查 `html`、`body`、主内容和页面容器的嵌套溢出。
- 验证：定时任务相关 18 项、智能体总览相关 19 项测试分别通过；Node/Web TypeScript、目标 ESLint、`lat check` 和 `git diff --check` 通过；真实隔离开发实例生成中英文各 4 张核心截图并通过自动检查。对应代码提交为 `2a25e74`、`6247a2d`。
- 边界：英文 UI 的 P1 阻断尚未解除。智能体管理/接入向导、Runtime Chat、轻量聊天、项目/任务空状态与协作界面仍有硬编码中文；本轮截图中的侧栏项目空状态即为可见证据。继续保持 No-Go，不创建 tag 或 Release。
