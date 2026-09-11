# Agents One OR-6 开源文档与治理验收记录

验收日期：2026-09-10

验收范围：OR-601～OR-605

结论：通过。公开入口、贡献路径、治理文件、当前/历史计划口径及已知问题清单已与 `v0.1.0-alpha.1` 的真实未发布状态一致；本阶段不改变 OR-507/OR-7 的 No-Go 结论。

## 验收矩阵

| ID     | 结果 | 证据                                                                                                                                                                                                                                                        |
| ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OR-601 | 通过 | README 中英文互链，明确“暂无公开 Release”、Windows x64 Alpha、未签名/校验值/自动更新边界、数据路径、凭据/备份/网页 Provider 隐私事实，并链接安全策略与已知问题。                                                                                            |
| OR-602 | 通过 | 保留并复核 `SECURITY.md`；新增 Contributor Covenant 行为准则、Changelog、Bug/Feature Issue Forms、Issue 配置与 PR 模板。安全与行为问题均有私下入口，模板禁止提交凭据或私有数据。                                                                            |
| OR-603 | 通过 | PRD 与进展日志记录 OR-6；稳定化计划明确降级为历史依据；回归矩阵更新当前 2026-09-10 基线并把 2026-07/08 的“冻结、格式未治理、不得打包”等语句标为历史，不再覆盖现行 PRD。Runbook 同步未发布、数据路径、签名与远端验收边界。                                   |
| OR-604 | 通过 | 英中贡献指南删除不存在的日文入口；远端实测后将最低版本校准为 Node.js ≥24（`node:sqlite` 工具链要求）；提供无管理员 Windows 官方 ZIP/用户级 PATH 方案，以及 `install:clean`、format、typecheck、0-error lint、全量主/子项目测试、audit、build 的可复制命令。 |
| OR-605 | 通过 | 新增 `KNOWN_ISSUES.md`，以 AO-KNOWN-001～007 记录远端发布阻断、未签名、非 Windows 平台、网页实验、9 项跳过测试、Linux keyring 与体积/覆盖率技术债，并为每项定义退出标准。                                                                                   |

## 公开入口清单

- `README.md` / `README.zh-CN.md`
- `CONTRIBUTING.md` / `CONTRIBUTING.zh-CN.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`
- `CHANGELOG.md`
- `KNOWN_ISSUES.md`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`

## 当前发布声明

- 版本：计划中的 `v0.1.0-alpha.1`，尚未公开发布。
- 平台：Windows x64 only；macOS/Linux 不产生公开 Alpha 资产。
- 签名：候选未签名，SmartScreen 可能告警，自动更新关闭。
- 安全报告：目标仓库启用 Private Vulnerability Reporting 后使用 GitHub 私密入口；不可用时不得以公开 Issue 替代。
- 发布阻断：OR-507 远端 workflow/草稿 Release 与 OR-7 干净机/真实 Runtime 回归未完成。

## 验证

- 全仓 `npm run format:check` 通过。
- 三个 GitHub workflow 和三个 Issue Form/config YAML 可解析。
- README、贡献、安全、行为准则、已知问题、Changelog、Runbook 与两份现行计划中的本地 Markdown 链接目标均存在。
- `lat check` 与 `git diff --check` 通过。
