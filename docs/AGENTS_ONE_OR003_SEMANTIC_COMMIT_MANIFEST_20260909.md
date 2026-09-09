# Agents One OR-003 语义提交清单

> 日期：2026-09-10（执行启动于 2026-09-09）
> 基线：`333cf4d29b6a9cbd5cf527c6b4eba9b7def889f1`
> 分支：`agents-one-slim-task-dialog`
> 状态：已完成；当前发布结论仍为 No-Go

## 1. 暂存约束

OR-003 全程只把已复核的文件路径作为独立参数传给 `git add --`。没有使用 `git add .`、`git add -A`、目录通配符、强制提交或历史改写。每次提交前均检查 `git diff --cached --name-status`、staged diff、统计信息与 `git diff --cached --check`。

Git commit 自身的 tree 是权威逐文件清单，可用以下只读命令复核任一切片：

```powershell
git show --name-status --format= <commit>
git show --stat --oneline <commit>
```

## 2. 语义切片

| 顺序 | Commit | 文件边界 | 文件数 | 验证与回退 |
| --- | --- | --- | ---: | --- |
| 1 | `7227256` `chore(repo): isolate local artifacts and curate developer assets` | `.gitignore`、`.prettierignore`，以及审计决定移除的第三方 skills、失效 Codex hook、陈旧 `skills-lock.json`；不含产品源码 | 12 | Git/Prettier/ESLint/Vitest 排除规则已验证；单独 `git revert 7227256` 可恢复 |
| 2 | `a4d6691` `build(release): align dependencies packaging and CI baseline` | 2 个既有 workflow、RC1 Windows workflow、Electron Builder/Vite/ESLint 配置、根 package 与 lockfile | 8 | lockfile 根依赖与 package 一致，staged check 通过；依赖它的后续代码应先回退，再回退本提交 |
| 3 | `10b80f8` `feat(extensions): add connector adapters and connect service` | Plugin SDK、Connector CLI、Connect Service 的实现、说明及同目录测试 | 25 | Plugin SDK 22/22、Connector 6/6、Connect Service 8/8 通过；可在桌面提交之后单独回退 |
| 4 | `714632b` `feat(desktop): integrate unified agent workspace workflows` | `src/`、`tests/`、`scripts/` 与 `lat.md/` 中相互依赖的桌面功能、测试、脚本和架构说明 | 308 | typecheck 通过、定向测试 15/15、`lat check` 通过；全量测试的 82 个已知失败登记到 OR-101～103 |
| 5 | 本文件所在提交 `docs(release): add open-source readiness plan and audit trail` | 根贡献指南、全部待提交公开文档、OR-008/009 审计、OR-003 清单，以及已判定不公开文档的删除 | 44 | 五份启动文档链接 0 缺失、绝对路径复扫仅保留审计事实说明、staged check 通过 |

第 4 个切片没有按 UI、Runtime、Web Agent、语音和托盘继续做文件级拆分，因为这些变更共同修改 `src/main/ipc/register.ts`、preload API、Runtime 注册表、共享 DTO 与 Renderer 消费者。仅按文件拆开会制造无法 typecheck 的中间提交；如需进一步拆分，必须进行逐 hunk 重构和逐提交构建，属于 OR-0 之外的高风险历史整理，不在本轮执行。

## 3. 验证基线

- `npm run typecheck`：Node/Web TypeScript 全部通过。
- `npm test --prefix plugins/agents-one-plugin`：22/22 通过。
- `npm test --prefix plugins/agents-one-connector`：6/6 通过。
- `npm test --prefix services/agents-one-connect`：8/8 通过。
- `npm exec -- vitest run src/renderer/src/components/settings/AgentRuntimesPane.test.tsx`：15/15 通过。
- `npm exec --yes --package lat.md -- lat check`：全部通过。
- `npm test`：205/209 文件通过；1969 通过、82 失败、9 跳过。失败集合与 PRD 2026-09-09 基线一致，分别由 OR-101、OR-102、OR-103 修复，OR-003 不以跳过或降低断言制造绿灯。

## 4. 回退顺序

若只撤销单一切片，先确认其消费者和依赖；若完整回退 OR-003，应从最新提交开始按下列顺序执行普通 revert：

1. 文档提交（本文件所在提交）。
2. `714632b` 桌面产品。
3. `10b80f8` 扩展组件。
4. `a4d6691` 构建与依赖。
5. `7227256` 仓库卫生。

OR-001 私有恢复快照在 OR-007、OR-005 和 OR-006 完成前继续保留。回退不授权删除旧目录、用户数据、凭据、构建外缓存或仓库外恢复资料。
