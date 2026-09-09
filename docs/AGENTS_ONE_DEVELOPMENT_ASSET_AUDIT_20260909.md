# Agents One 开发环境资产审计（OR-009）

> 审计日期：2026-09-09
> 状态：处置及 OR-003 精确提交完成
> 权威计划：[Agents One 开源发布收口阶段 PRD](./AGENTS_ONE_OPENSOURCE_RELEASE_READINESS_PRD_20260909.md)

## 1. 决策摘要

项目仓库只保留直接服务 Agents One 设计意图和跨智能体开发流程的指令资产。通用第三方技能、不完整来源锁、失效或用户级工具配置不进入公开树。

| 资产 | 决定 | 理由 |
| --- | --- | --- |
| `AGENTS.md` | 保留 | Agents One 变更安全、`lat.md` 与交付门禁的项目权威指令 |
| `CLAUDE.md` | 保留 | Claude Code 的项目入口，与 AGENTS 主体一致且不含凭据 |
| `.agents/skills/hermes-agent/` | 保留 | Hermes Runtime 上游架构参考，文件声明来源与 MIT 许可；仍服务当前 Hermes Runtime 维护 |
| `.agents/skills/lat-md/` | 保留 | 本项目知识图谱编写规范，直接支撑强制 `lat` 工作流 |
| `.claude/skills/hermes-agent/`、`.claude/skills/lat-md/` | 保留 | Claude Code 的发现目录；当前内容与 `.agents` 对应文件 SHA-256 完全一致 |
| `.claude/settings.json` | 保留 | 仅注册 `lat hook claude UserPromptSubmit/Stop`；本地 `lat` CLI 明确支持这些 agent/event，不含机器路径或凭据 |
| `.agents/skills/electron-pro/` | 移除 | 通用第三方技能，仓库文件没有完整许可证声明，不是 Agents One 构建或运行依赖 |
| `.agents/skills/typescript-expert/` | 移除 | 通用社区技能及脚本/参考资料，缺少随附许可证，不是产品源码依赖 |
| `.claude/skills/electron-pro`、`.claude/skills/typescript-expert` | 移除 | Git mode 为 symlink，但无管理员权限 Windows checkout 会退化为普通文本，且目标第三方 skills 已移除 |
| `skills-lock.json` | 移除并忽略 | 列出 4 个第三方来源，其中 2 个在树中不存在，也不覆盖保留的 Hermes/lat skills；不能作为准确供应链锁 |
| `.codex/hooks.json` | 移除并忽略 | 内容误调用 `lat hook claude`；当前 `lat hook` 只声明支持 `claude/cursor`，不能伪装成有效 Codex hook |
| `.claude/settings.local.json` | 忽略 | 约定为用户/机器级 Claude 覆盖，不属于项目公共配置 |

## 2. 删除与恢复边界

本次只删除上述明确无运行消费者、无完整许可或无效的开发辅助资产，不删除 `.agents/skills/hermes-agent`、`.agents/skills/lat-md`、Claude 对应副本、`AGENTS.md`、`CLAUDE.md` 或 `.claude/settings.json`。

所有删除内容均已被 OR-001 私有权威快照同时保存在 tracked patch/完整 Git bundle 中。需要回退时只能从该固定快照恢复目标文件，不得恢复整个旧工作树或两个 node_modules 副本。

## 3. 一致性验证

- `.agents` 与 `.claude` 的 `hermes-agent/SKILL.md` SHA-256 均为 `7F384597A9BAC9701C7129C04A7C758587385E74E2E7F41A0B9F19FD1B793888`。
- `.agents` 与 `.claude` 的 `lat-md/SKILL.md` SHA-256 均为 `93A8CB38FAD719ED05ADF1E42DC2891D9294ED1872AF136CDD7A522E9AE9BA52`。
- `.claude/settings.json` 与被移除的 `.codex/hooks.json` 原内容相同；CLI 帮助确认 `lat hook` 的 agent 参数只列出 `claude, cursor`。
- 全仓消费者扫描没有发现产品源码、构建、测试或脚本依赖被移除的第三方 skills 或 `skills-lock.json`。
- 保留的 skill 文档不得被打入 Electron Release 产物；`electron-builder.yml` 继续只包含运行所需的 `out/**`、resources 与 native module。

## 4. OR-003 交接

1. 将本报告与 `.gitignore` 的本机工具忽略规则纳入仓库卫生/文档类提交。
2. 精确暂存 10 个删除项，复核 staged tree 中只剩 Hermes/lat 两类项目 skills。
3. 不使用 `git add .`、`git add -A` 或 `.agents/`、`.claude/` 目录级暂存。
4. 运行 `git diff --cached --name-status`、完整 staged diff、`git diff --cached --check` 和保留 skill SHA-256 对比。
5. OR-007 继续对这些文件的历史版本做敏感信息与许可来源复核；本次当前树处置不清除历史 refs。
