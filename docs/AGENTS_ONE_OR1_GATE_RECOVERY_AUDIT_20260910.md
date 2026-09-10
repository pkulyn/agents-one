# Agents One 自动化门禁恢复验收记录（OR-1）

> 日期：2026-09-10
> 验证提交：`0f10679447243f60513f5b4351f2cb86d4a06a1d`
> 结论：**OR-101～OR-105 全部通过**。既有 82 项测试失败和 11 项 ESLint error 已归零。

## 1. 修复范围

| ID | 修复 | 验收结果 |
| --- | --- | --- |
| OR-101 | preload 表面测试改为解析真实 `AgentsOneAPI`，校验 `readDiagnostics` 并反向禁止旧 `readLogs` | 154/154 通过；实现与声明继续双向比对 |
| OR-102 | IPC 一致性扫描显式纳入实际注册托盘 handler 的 `src/main/app/tray.ts` | 66/66 通过；缺失与多余 channel 继续双向检测 |
| OR-103 | API key 迁移与 sibling home drift 测试将 `AGENTS_ONE_LOG_DIR` 隔离到临时目录，并恢复原环境变量 | 18/18 通过；真实 JSONL 字段、动作和密钥脱敏断言保留 |
| OR-104 | 托盘测试用窄 mock 类型替代 `any`；语音 WebSocket 用 `createRequire` 和窄 CommonJS 运行契约替代裸 `require()` | `src tests plugins services` 完整范围 0 errors；Node 类型检查和生产构建通过 |
| OR-105 | 在同一固定提交上连续三轮执行 typecheck、test、lint、build | 三轮全部通过，无重试或改码后续算 |

全量并发首轮曾使 `task-schedules` 的一个冷模块加载用例在 5.19 秒触发 Vitest 默认 5 秒超时；单独运行耗时约 2.6 秒且断言通过。该用例专属超时调整为 15 秒以覆盖 Windows 高负载抖动，业务断言、轮询和全局超时均未放宽。调整后完整套件及 OR-105 三轮均通过。

## 2. 连续三轮门禁

三轮均在工作树干净、HEAD 固定为 `0f10679447243f60513f5b4351f2cb86d4a06a1d` 的条件下执行：

| 轮次 | `npm run typecheck` | `npm test` | ESLint 发布范围 | `npm run build` |
| ---: | --- | --- | --- | --- |
| 1 | 通过 | 209/209 文件；2,051 passed、9 skipped、0 failed | 0 errors | 通过 |
| 2 | 通过 | 209/209 文件；0 failed | 0 errors | 通过 |
| 3 | 通过 | 209/209 文件；0 failed | 0 errors | 通过 |

测试运行仍会输出部分既有 React `act(...)`、安全阻断演示和本地存储参数 warning；它们不改变退出码，也不属于本轮原始 82 项失败。后续可作为非阻塞测试降噪处理，不能替代 P0/P1 发布工作包。

## 3. 跳过项登记

| 数量 | 文件与原因 | 责任边界 |
| ---: | --- | --- |
| 3 | `tests/api-server-key-secrets-provider.test.ts`：真实 `/bin/sh` command-provider 链路仅适用于 POSIX，Windows 跳过 | OR-501 的 Linux CI lane；发布工程维护者 |
| 3 | `tests/api-server-key-status.test.ts`：同上，真实 command-provider 状态链路仅适用于 POSIX | OR-501 的 Linux CI lane；发布工程维护者 |
| 3 | `tests/config-value-paths.test.ts`：登记 `yaml-path.ts` 尚未实现的严格层级/顶层键语义，不伪装为已实现能力 | 配置模块维护者；进入独立缺陷单后再解除 skip |

Windows 专属的 `tests/process-control.test.ts` 在本机实际执行，不属于 9 个 skip。上述 skip 均已有代码内原因说明；不得在 CI 中把其他失败批量改为 skip。

## 4. 回退

- 测试契约修复可按文件独立回退，但回退会重新打开 OR-101～103 对应门禁缺口。
- `voice-stream.ts` 的 `createRequire` 仅改变模块加载表达方式，不改变 `ws` 运行依赖、WebSocket 协议或 Renderer 契约；生产 build 已验证。
- OR-1 不修改用户配置、会话、Runtime、任务计划或凭据数据，无用户数据回滚步骤。
