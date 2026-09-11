# Agents One 分支与远端政策

> 生效日期：2026-09-10
> 适用范围：Agents One 公共仓库及发布候选分支

## 1. 远端命名

- `origin`：Agents One 产品仓库，目标为 `https://github.com/pkulyn/agents-one.git`。
- `upstream`：Hermes Desktop 上游参考仓库，不接受 Agents One 产品分支推送。
- 在 `origin` 尚未建立或当前账号不可见时，允许保留目标 URL，但禁止把 Agents One 代码误推到 `upstream`。

## 2. 默认分支

`main` 是唯一默认产品分支。历史开发分支 `agents-one-slim-task-dialog` 已在本地以纯快进方式整合到 `main`；目标仓库建立并确认远端 `main` 后才删除该恢复引用。

发布、RC 验证和文档示例均以 `main` 或显式固定 SHA 为输入。禁止把历史开发分支名作为 workflow 默认 ref。

## 3. main 保护规则

目标 GitHub 仓库建立后，应在任何公开 Release 前应用并验证以下规则：

1. 禁止删除和 force-push `main`，要求线性历史。
2. 普通变更必须通过 Pull Request 合并，至少 1 名维护者批准，并要求所有 review conversation 已解决。
3. 必须要求与 release gate 对应的状态检查；OR-501 完成前至少包括 install、typecheck、lint、主测试、三个子项目测试、生产依赖 audit、build 和格式检查，检查名称以最终 workflow 实际 job 为准。
4. 分支必须在合并前与最新 `main` 同步；管理员不得绕过发布 P0 门禁。
5. 发布只允许受保护 tag 或人工 `workflow_dispatch` 从固定 SHA 触发，普通分支 push 不得发布资产。

目标私有暂存仓库已于 2026-09-11 建立，默认分支为 `main`。当前 GitHub Free 私有仓库对 branch protection 返回 403（需 GitHub Pro 或公开仓库），因此本节仍是转公开前必须原子应用并查询复核的权威策略，不伪称规则已经启用；限制与远端 SHA 已写入进展日志。

## 4. 回退与上游同步

- 分支整合前的旧 main tip `8a4268f` 由 OR-001 bundle、Git 历史及 `upstream/main` 保全。
- 若本地远端命名需回退，可移除尚未使用的目标 `origin`，再把 `upstream` 重命名回 `origin`；不得因此向 Hermes 仓库推送 Agents One 提交。
- 从 Hermes 同步变更必须在独立分支完成，以显式 cherry-pick/rebase/merge 进入 Agents One PR，不得把产品 main 重置为 upstream/main。
