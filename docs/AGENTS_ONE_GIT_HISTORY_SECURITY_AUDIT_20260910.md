# Agents One Git 全历史与本地产物安全审计

> 审计日期：2026-09-10
>
> 对应任务：OR-007
>
> 公开属性：仅脱敏摘要；包含候选秘密值的原始报告不得进入 Git、Release 或迁移目录

## 1. 结论

Agents One 拟公开 Git 历史中没有发现真实密钥、Token、Cookie、私钥或用户数据。两个历史命中均来自测试夹具中的显式假值，不需要轮换凭据或改写历史。

机器本地 `.sandbox` 与一个中断依赖备份存在候选命中；它们都未被 Git 跟踪，已被忽略并明确排除于打包和 OR-006 迁移范围。一个旧的本地 `dist` 包被确认曾错误吸收机器状态，属于禁止分发的污染产物。打包配置已修正，重新构建的 Windows unpacked 包及解包后的 `app.asar` 内容均为 0 命中。

## 2. 工具与证据控制

- 工具：[Gitleaks 8.30.0](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.0)，Windows x64 便携版。
- ZIP SHA-256：`54FE94F644B832DD08E8C3A5915EFB3BFA862386D59FB27CA0792CB687A83573`，与官方 checksums 文件一致。
- 所有扫描使用 `--redact=100`；大文件目录扫描设置 20 MB 或 50 MB 单文件阈值，并另行检查被跳过的归档/包结构。
- 原始 JSON、工具和解包验证目录位于 `<private-security-audit-root>`，不提交、不上传、不复制到独立源码目录。公开文档不记录任何候选秘密值。

## 3. Git 历史扫描

扫描范围为仓库全部 refs 的完整历史，共 866 个提交。结果为 2 个 `generic-api-key` 命中：

| 位置 | 判定 | 处置 |
| --- | --- | --- |
| `tests/sibling-hermes-home-drift.test.ts` 的历史版本 | 测试夹具显式假值 | 保留历史，无需轮换 |
| `tests/validation.test.ts` 的历史版本 | 测试夹具显式假值 | 保留历史，无需轮换 |

原始历史报告 SHA-256 为 `05F061AB2E0065EC3A53A88F414EA2E19D06D02689663EF8870A76709E150F1D`。报告本身含匹配上下文，只能在私有审计位置保存。

## 4. 当前树、本地状态与备份

| 范围 | 命中 | 判定与处置 |
| --- | ---: | --- |
| `out`、`build`、`.agents-one`、`tmp` | 0 | 通过 |
| OR-001 权威快照 | 0 | 通过；继续私有保管 |
| `.cache` | 0 | 扫描普通内容；大体积下载缓存不迁移、不发布 |
| `.sandbox` | 28 | 测试假值与机器本地环境、会话/缓存候选；不判断其有效性，全部按敏感材料隔离 |
| 中断依赖备份 | 52 | 48 个通用 key、2 个 JWT、2 个私钥规则命中；均位于第三方依赖源码、README 或测试样例，不是项目凭据 |
| upstream junction 备份 | 0 | 不迁移；由 lockfile 重建依赖 |

`.sandbox` 原始报告 SHA-256 为 `C6BEC8CEBC5D506FAE3A84782DFBBB4D84BEF8FFDD78F96E3168759DB631B8A8`；依赖备份报告 SHA-256 为 `242DB7B31B09F633F2E33D885AB1EEE27498765917875635C49DC2BC31E8B3E7`。两者包含匹配上下文，不得公开。没有删除、修改或复制这些本地目录。

## 5. 历史打包产物风险

旧本地产物 `dist/visual-fix-20260824` 中的 `app.asar` 约 3.8 GB、121,691 个条目。结构审计确认它错误包含 `.sandbox`、`.cache`、`.agents-one`、`dist`、测试、文档、脚本、依赖备份以及环境/浏览器状态文件名。其 SHA-256 为 `B2A2670F4395A935D0E526555BB9A62CBC7C3CBEDA5054E235A3B33DA0EFF615`。

该产物从未被 Git 跟踪，本次明确判定为：

- 禁止分发、上传、签名或作为 RC 输入；
- 不复制到 OR-006 独立目录；
- 在旧工作区仅作为本地污染证据保留，后续是否删除由维护者单独决定。

根因是 Electron Builder 的 `files` 清单没有显式排除机器本地目录；`.gitignore` 不等于打包排除规则。

## 6. 修复与再验证

`electron-builder.yml` 已显式排除：

- `.sandbox`、`.agents-one`、`.cache`、`.belt`；
- `tmp`、`dist`、`release` 与日志；
- 中断依赖备份和 upstream junction 备份。

验证结果：

1. `npm run build` 通过。
2. 新 Windows unpacked 包生成成功，目录级 Gitleaks 扫描 0 命中。
3. 新 `app.asar` 为 161,553,074 字节，SHA-256 为 `32FB97F3E348F03B01C61573C5D7EE28121AE60BF5E82319E089D0E44C13EE90`。
4. `app.asar` 共 17,078 个条目：`node_modules` 16,860、`out` 217、`package.json` 1；所有禁入路径命中为 0。
5. 将新 `app.asar` 解包到私有审计目录后再次运行 Gitleaks，结果仍为 0。

## 7. 大文件扫描边界

目录扫描为控制资源占用跳过了超过阈值的 Electron 二进制、下载缓存 ZIP 与 `app.asar`。处置如下：

- Electron 官方运行时二进制和下载缓存不是项目源码，不进入 Git；OR-006 由 `npm ci` 重新获取。
- 新 `app.asar` 已通过结构枚举、禁入路径断言和解包后扫描补足覆盖。
- 旧 3.8 GB `app.asar` 已因结构中存在机器状态文件直接判定污染，不需要提取或公开其内容来证明可分发性。

## 8. OR-007 验收判定

- Git 历史命中已逐项分类，无真实秘密证据，无需历史改写。
- 本地敏感候选均处于忽略目录，禁止发布和迁移。
- 污染历史包已禁止分发，根因已通过显式打包排除修复。
- 修正后的包及其实际应用内容扫描为 0。
- 本文档提交后必须对全部 refs 再运行一次完整历史扫描；结果不应出现除两项既有测试假值外的新命中。该复扫通过后方可建立 OR-005 迁移恢复标签。
