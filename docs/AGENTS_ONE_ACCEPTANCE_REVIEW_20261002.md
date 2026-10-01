# Agents One 7dfcb50 测评复核与修复计划

本记录复核 2026-10-01 独立 Windows 报告与随附证据，并按变更安全守则记录上下文续接修复的边界。原始附件保留不改写，公开发布结论维持 No-Go。

## 输入与证据身份

三份附件的原始字节哈希已复算；报告与 CSV 和证据 ZIP 内的同名副本、SHA256SUMS 一致。

| 文件          | 字节数  | SHA-256                                                            |
| ------------- | ------- | ------------------------------------------------------------------ |
| 报告 Markdown | 32780   | `73dcdf7437bda2f082217f27a103d58b28e17cbea27eff2ace6ecb0255de8830` |
| 测试矩阵 CSV  | 7843    | `0157dcfcd71d09e2bad2bab9cc683af6efbca015030ecbfb7b194c7ff6bede26` |
| 证据 ZIP      | 1800004 | `6e04e7f0a919adb865ce0635859244f3bed7b7289b1dd69347938f42553fa9d5` |

构建 SHA `7dfcb50d10e9098331a27d0e133012d028f703b5`、Gate `36844292900`、artifact `11153244191` 与前轮上传记录一致。ZIP 中的制品核验 JSON 给出了四文件完整哈希；本轮未重新下载 393 MB 制品，因此其 EXE 哈希属于验收方实测证据，不冒称本轮复算。

## 结论纠正

候选验收应为“部分完成 / No-Go”，不能把存在 P1 Fail 和必验未决项的结果概括成 Test-level Pass。

- 测试机已有 Agents One、Hermes 和历史数据；隔离 profile 能验证隔离首启，但不能证明真正干净系统的依赖与安全提示路径。静默安装没有触发 SmartScreen 也不能替代常规下载首启测试。
- 多轮上下文在远程 Hermes/Gateway 与本地 OpenCode 均失败，是发布阻断项；报告根因推断需由契约回归验证，不能把两个症状直接认定为同一根因。
- 协议取消通过，桌面取消未决；Host 重启证据证明同一 Run 终态对账和新 Run 成功，桌面证据主要是卡片健康与历史仍存在，还需桌面内该运行的状态闭环。
- T05.5f 无有效路径对照，不能作为正常调度与失效路径保护的 Pass。T05.7 A/C 验证构造事务的启动回滚/清理，B 验证不确定来源文件保护；均不能替代真实恢复中途写入失败的事务回滚。
- T06 维护者目检属于报告转述的人工证言，应保留来源并补具体用例/时间/候选身份；未直接取得本会话的维护者签字。证据 ZIP 缺少 T03 多轮及 T05 恢复/事务注入的完整原始记录。
- 已目检桌面缩略图和托盘区域图：桌面主窗口可见，托盘区域没有直接显示应用图标。这不能替代托盘溢出菜单、退出行为或不同 DPI 的逐项验收。
- T07 两行方向标签与安装缓存身份说明相反；原始执行日志缺失，仅保留“报告称候选覆盖安装保留数据”，不登记跨版本升级或旧包读取新数据通过。
- 删除 `.restore-transaction` 是验收环境中的处置实验，不能照搬为真实用户通用恢复方法；必须先完整保留事务快照、日志及目标数据并诊断。

## P1 修复前风险评估

本次功能变更限于 Gateway 对话身份传递与 OpenCode ACP 会话恢复，不改 Runtime 注册、配置写入、历史迁移、头像名称或权限边界。

1. 原因：SDK 在 Run 记录上生成 conversationId，却把未含该 ID 的原始首轮 input 传给 adapter；本地 OpenCode 只判断 `sessionCapabilities.resume === true`，忽略标准对象形式 resume 和 `loadSession`，随后静默创建新会话。Renderer 一旦有 sessionId 就省略 transcript，因此丢失上下文。
2. 数据：仅涉及新请求的 conversationId、Run 的续接 sessionId、ACP initialize/load/resume/new 和历史回放通知；既有会话字段保持兼容，不批量改写持久化文件。
3. 消费者：RuntimeChat 发起/轮询、main Gateway 调度、SDK adapter.startRun、OpenCode CLI/远程 adapter，以及对话历史后续续接。
4. 风险：首轮/后续身份不一致，幂等 fingerprint 改变，load 回放被拼入本轮答复，错误恢复降级为新会话，跨会话污染。Gateway conversationId 与 Provider sessionId 必须分开；旧客户端保存的 Provider ID 只允许在同 Runtime 解析别名。恢复失败须显式失败，不静默丢上下文。
5. 回退：各修复可按文件/提交独立回退；保持请求输入与持久化 schema 不变，保留所有历史和用户配置。SDK 修复需另打新版本包，已有远端 0.1.4 不会随桌面更新自动升级。
6. 检查：先新增失败回归，覆盖首轮/后续同 ID、幂等与持久化、标准 ACP resume 对象、loadSession/空响应、回放抑制、无恢复能力时显式错误，以及桌面取消的调用与终态；随后类型检查、受影响测试和生产构建。最终仍需新固定 SHA 安装包的真实四轮与重启回放。

## 后续验收顺序

先完成 P1 修复及本地定向验证，再冻结新候选并通过 GitHub Gate；新包优先复验两类 Runtime 四轮续接和重启后续接，再补 UI 取消、正常计划触发对照、真实恢复写失败/中断、干净系统与旧包读新数据回退。仓库保护、发布审批、首发范围和许可证由维护者确认后才可改变公开发布结论。

## 本轮实施与验证

源码修复已覆盖两个上下文根因与诊断脚本的槽位占用问题；实机和发布门禁的未决项保持开放。

- 桌面首次生成 conversationId，后续保留 Gateway 身份；SDK 首轮传递同 ID，并从持久化 Run 恢复独立 Provider sessionId。兼容同 Runtime 的旧 ID 别名，幂等原始输入不变。
- 本地和远程 OpenCode 使用标准 ACP resume/load，接受空恢复响应，忽略历史回放。无恢复能力或恢复失败明确报错。依据 [ACP v1 session setup](https://agentclientprotocol.com/protocol/v1/session-setup)。
- 新增用例先复现失败：本地 ACP 5 项、SDK 首轮身份 1 项、诊断脚本单槽位 2 项。修复后主进程/ACP/诊断共 68/68，SDK 全部 27/27；Node/Web 类型检查及 production build 通过。
- 本机独立 profile 的 OpenCode 1.18.27 初始化实测为 protocolVersion=1、resume={}、loadSession=true，与修复的能力形态一致；仅探测初始化，未将其登记为实机四轮通过。定向 ESLint 与 lat check 通过。
- SDK 升为 0.1.5。现有远端 0.1.4 需由维护者升级并保留 statePath，再做真实 Connector 验收；本轮不凭附件中的授权转述操作生产服务。
- 新候选从原 7dfcb50 取独立工作树，仅纳入本轮功能修复、SDK 包和验收文档。主工作区既有 UI、许可证、README 等未提交改动不自动进入此候选。固定身份及 GitHub Gate 结果随后写入候选清单。
