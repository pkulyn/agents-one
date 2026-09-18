# Agents One RC1 最终仓库闸门审计

> 审计日期：2026-09-19
>
> 应用候选：`521503af9abf7ec99a1258193d8f816b5f435030`
>
> 结论：**G0、G8 通过；G5、G6 的仓库内实现通过，但外部 GitHub 设置与新 artifact 尚未闭环。RC1 总体继续 No-Go。**

本记录只收口不依赖独立 Windows 业务回放的仓库闸门，不提前改写 `AGENTS_ONE_RC1_RELEASE_CHECKLIST.md`。OR-702、OR-704、最终 artifact 和维护者签字仍按原清单执行；禁止创建 tag、GitHub Release 或公开仓库。

## 1. 候选 Gate 与 GitHub artifact 配额

- 固定应用候选为 `521503af9abf7ec99a1258193d8f816b5f435030`。后续文档或 CI 修复提交不替代该应用候选身份。
- Windows Alpha Release Gate [run 35307657941](https://github.com/pkulyn/agents-one/actions/runs/35307657941) 的 Attempt 5 已完成 clean checkout、不可变 SHA/lockfile 校验、连续三轮格式/类型/lint/主子项目测试/audit/build、Windows NSIS/portable 打包、包体 smoke 和校验和生成。
- Attempt 5 仅在 step 12 `Upload immutable Windows candidate` 失败。GitHub 返回 `Artifact storage quota has been hit`，并明确说明删除后的使用量每 6–12 小时重新计算；待上传文件共 6 个，路径与 artifact 名均校验有效。
- 同一 run 的 Attempt 1～4 也只在上传阶段受相同配额错误阻断。配额重新计算前不再重复消耗 runner；下一轮只在确认可上传后重跑固定候选。
- GitHub 中历史 Actions artifacts 已全部删除，API 当前返回 0 项。最后删除的旧候选 artifact ID 为 `10437172828`；删除不可直接撤销。
- 删除前已把旧 `8c4e5ce` 候选下载到仓库外 `D:\Agent Console\_release-artifact-archive\8c4e5ce` 并复核内部清单。安装包、portable、blockmap、`latest.yml`、发布说明和校验清单均存在；其中四项发布文件 SHA-256 分别为：
  - setup：`9b32abfac3e08a8f6bd144dadd4c019d478325c92c13e46345228ac6fd715af8`
  - portable：`4019eb602e05a597ad952ef4c9d88636eabaf1468a30ab1ca9aa21ae96c12868`
  - blockmap：`9a44e6c08a845d2b4bf40f9420f1c12853faf8471260e3754140c6e97c32851c`
  - `latest.yml`：`afdb38caf5c5f0981a6ff674262c9fcb05d6b0872f86c973d402239b2af77b34`

## 2. RC1 wrapper 修复

旧 RC1 wrapper [run 35307619401](https://github.com/pkulyn/agents-one/actions/runs/35307619401) 在 job 创建前以 `startup_failure` 结束。调用方只允许 `contents: read`，而被调用的发布工作流包含一个条件式 draft Release job，其权限上限为 `contents: write`；GitHub 会在计算 `publish_draft` 条件前校验嵌套权限上限。

提交 `988de4089feb56f2b391303f48f812ccd82cd4c8` 将权限上限放到 wrapper 的调用 job。被调用的 Gate job 仍限制为 `contents: read`，wrapper 仍固定传入 `publish_draft: false`。验证 [run 35372730737](https://github.com/pkulyn/agents-one/actions/runs/35372730737) 已成功创建嵌套 job，完成固定 SHA 检查、checkout 和身份记录并进入 Node 设置；确认调度修复后主动取消，避免在配额重算前重复完整 Gate。未创建 tag 或 Release。

## 3. G0：仓库与目录独立性 — 通过

- 权威目录为 `D:\Projects\Agents-One`，位于旧 `Agent Console` 目录之外；分支为 `main`。
- `origin` 为 `https://github.com/pkulyn/agents-one.git`，`upstream` 为 `https://github.com/fathah/hermes-desktop.git`；目标仓库默认分支为 `main`，当前仍为 private。
- 远端无发布 tag、无 GitHub Release。历史 Hermes `v*` tag 未推送到目标仓库。
- Gitleaks 8.30.0 以 `--redact=100` 对全部 refs 的 957 个提交复扫，仍只有 2 个 `generic-api-key` 命中，文件为 `tests/sibling-hermes-home-drift.test.ts` 与 `tests/validation.test.ts`，与 OR-007 已分类的显式测试假值一致，无新增命中。
- 固定候选已在 GitHub clean Windows runner 完成连续三轮门禁和打包；目录迁移、公开内容和历史安全边界继续由 OR-006～008 审计记录支撑。

## 4. G5：安全合规 — 仓库内通过，外部设置待闭环

- 桌面 Remote Token、Connector Windows DPAPI、Linux 安全后端提示、Web Provider 默认禁用与逐 Provider 风险边界已有代码、测试和公开文档证据；`SECURITY.md` 已列出支持版本、响应目标与 Runtime/Gateway/Connector/WebView/更新/备份边界。
- 当前私有 GitHub Free 仓库的 Private Vulnerability Reporting API 返回 404。必须在转公开时启用并验证私密报告入口，不能以公开 Issue 替代。
- 因外部私密报告入口尚不可验证，G5 暂不在 RC1 Checklist 签为最终通过。

## 5. G6：发布链路 — 仓库内通过，artifact 与外部保护待闭环

- 发布工作流只接受完整 40 位 commit SHA；同一 job 校验 checkout、lockfile 和干净工作树，再执行三轮门禁、Windows 打包、smoke、校验和与不可变命名上传。
- Alpha 明确未签名，自动更新默认关闭；Windows x64 是唯一公开目标。当前仓库无 tag、无 Release。
- `release` Environment 已存在，但当前没有 protection rule；`main` branch protection 在私有 GitHub Free 仓库返回 403。转公开前必须配置并验证分支保护、Environment reviewer 和 PVR。
- RC1 wrapper 已恢复可调度，但 `521503a` 的新 artifact 仍待 GitHub 配额重算后上传。因此 G6 暂不签为最终通过。

## 6. G8：开源材料 — 通过

以下公开入口均存在：中英文 README、中英文贡献指南、`LICENSE`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`CHANGELOG.md`、`KNOWN_ISSUES.md`、PR 模板，以及 Bug/Feature Issue Forms 与 Issue 配置。

本轮 `npm run format:check` 通过；`npm exec --yes --package lat.md -- lat check` 扫描通过；最终差异仍须执行 `git diff --check`。G8 可据 OR-6 与本轮复核签为通过，但按既定顺序暂不改 RC1 Checklist。

## 7. 下一步

1. 等待 GitHub artifact 使用量完成 6–12 小时重算；确认配额后重跑固定候选 `521503a`，取得新 artifact ID、大小和 digest。
2. 远端 adapter 安装 Plugin SDK 0.1.3、移除自定义 SSE/journal 补丁、配置稳定 `AGENTS_ONE_HOST_STATE`，完成服务端分层回归。
3. 独立 Windows 只回归新 artifact 身份、OR-702 连续对话/取消/失败/Host 重启恢复，以及 OR-704 尚未签字项；不重复已通过的广泛回放。
4. OR-702、OR-704 与外部 GitHub 设置全部闭环后，再统一更新 RC1 Checklist、完成风险签字并决定是否创建 RC tag。此前继续 No-Go。
