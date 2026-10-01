# Agents One 上下文修复候选清单

新候选以原 7dfcb50 为基础，只包含本轮上下文功能修复、SDK 0.1.5、诊断脚本与复测资料。尚未完成的实机验收继续阻断正式发布。

## 构建与插件身份

本节随冻结和 Gate 结果补充；有明确完整 SHA 和上传成功的 artifact 后才可下载复测。

| 项目                           | 身份                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基础 SHA                       | `7dfcb50d10e9098331a27d0e133012d028f703b5`                                                                                                           |
| 修复分支                       | `codex/rc1-context-recovery`                                                                                                                         |
| 修复候选完整 SHA               | 待冻结                                                                                                                                               |
| Windows Gate                   | 待运行（publish_draft=false）                                                                                                                        |
| Windows artifact / ZIP SHA-256 | 待成功上传                                                                                                                                           |
| SDK                            | `plugins/agents-one-plugin/agents-one-plugin-sdk-0.1.5.tgz`；35418 bytes；SHA-256 `aa910c7f5c9cf5133e1f7559a12e9de295e89eacebb4f703581b5e9c16d56c06` |
| 发布判定                       | **No-Go：新固定候选的真实四轮/重启续接和其他必验项待验证**                                                                                           |

## 复测资料

按 [复测提示词](./AGENTS_ONE_WINDOWS_RETEST_PROMPT_20261002.md) 执行，并参照 [原报告复核](./AGENTS_ONE_ACCEPTANCE_REVIEW_20261002.md)。SDK 更新需远端维护者保留 statePath 并重启自身服务；桌面更新不会自动升级远端插件。
