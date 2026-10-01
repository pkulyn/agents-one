# Agents One 上下文修复候选清单

新候选以原 7dfcb50 为基础，包含本轮上下文修复、SDK 0.1.5、诊断脚本与测试同步修正。未完成的实机验收继续阻断正式发布。

## 构建与插件身份

Windows Gate 成功后已重新下载 ZIP，复算远端 digest、内部四文件 SHA-256 及 latest.yml SHA512，构建身份以 Gate checkout 与制品为准。

| 项目               | 身份                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基础 SHA           | `7dfcb50d10e9098331a27d0e133012d028f703b5`                                                                                                           |
| 修复分支 / 草稿 PR | `codex/rc1-context-recovery` / [PR #6](https://github.com/pkulyn/agents-one/pull/6)                                                                  |
| 实际构建 SHA       | `f4ecde936f2df2570261e812c872828f30fa3c6f`                                                                                                           |
| Windows Gate       | [36912267125](https://github.com/pkulyn/agents-one/actions/runs/36912267125)：三轮检查、打包、启动 smoke、上传成功；publish_draft=false              |
| Windows artifact   | [11188917424](https://github.com/pkulyn/agents-one/actions/runs/36912267125/artifacts/11188917424)                                                   |
| ZIP 字节 / SHA-256 | 393,005,013 / `4c2b215ef6368e89a1c3bc8c407cd8622d2e61d4dd4ea81a0d2886ce8cce34cb`                                                                     |
| Artifact 到期时间  | `2026-10-15T19:34:44Z`（UTC，届时需重新提供同 SHA 制品）                                                                                             |
| SDK                | `plugins/agents-one-plugin/agents-one-plugin-sdk-0.1.5.tgz`；35418 bytes；SHA-256 `aa910c7f5c9cf5133e1f7559a12e9de295e89eacebb4f703581b5e9c16d56c06` |
| 发布判定           | **No-Go：新包的真实四轮/重启续接与其他必验项仍待验证**                                                                                               |

工作流页面的 head SHA 来自主分支工作流版本，后续文档提交也不等于上述实际构建 SHA。旧 `efcba08` Gate `36909292678` 第三轮失败且未打包/上传；该候选不得代测。测试同步修正后从头执行新候选全部三轮。

## 制品文件复算

以下哈希均由本轮下载的 ZIP 读取原始文件字节复算，并与包内 SHA256SUMS.txt 一致。

| 文件                                          |        字节 | SHA-256                                                            |
| --------------------------------------------- | ----------: | ------------------------------------------------------------------ |
| `agents-one-0.1.0-alpha.1-setup.exe`          | 196,457,236 | `fc1159d6670deb8a0dd7f307185f3a6fc8e1f079e06f0ec1f4a78064d96704dc` |
| `agents-one-0.1.0-alpha.1-portable.exe`       | 196,270,858 | `abdbb953790571d9bfba7a79fb412501f08b42eeff35fbf222f63cca5fe400e7` |
| `agents-one-0.1.0-alpha.1-setup.exe.blockmap` |     205,203 | `81e46f63d618b953f0e6e0189a9df090d94519c07edac7758b4c252913f17aa3` |
| `latest.yml`                                  |         373 | `7785bf8d2250d427874549c06fbb70d4ad309f64098be4340376c87f7e67b5c7` |

## 复测资料

按 [复测提示词](./AGENTS_ONE_WINDOWS_RETEST_PROMPT_20261002.md) 执行，参照 [原报告复核](./AGENTS_ONE_ACCEPTANCE_REVIEW_20261002.md)。SDK 更新需远端维护者保留 statePath 并重启自身服务，桌面更新不会自动升级远端插件。当前工作区其他 UI、许可证及 README 改动未进入此候选；正式发布前仍须确认冻结范围与发布门禁。
