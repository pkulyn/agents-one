# Agents One 凭据、安全与隐私验收记录（OR-2）

> 日期：2026-09-10
>
> 代码提交：`1eb3099`、`16af81d`、`a791314`
>
> 结论：**OR-201～OR-205 全部完成**。桌面托管 Remote Token 和 Windows Connector 凭据已建立受保护落盘路径，公开文档已改为事实边界描述。

## 1. 验收结果

| ID     | 实施内容                                                                    | 验收结果                                                                                                                                       |
| ------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| OR-201 | 重写中英文 README 的凭据与备份说明                                          | 不再声称“所有 Secrets 均在受保护存储”；分别说明 `.env`、进程环境、命令型提供器、Remote Token、Connector 与 Linux 回退                          |
| OR-202 | 新增桌面受保护秘密存储，接入 Remote Gateway 主 Token 与工作区 Gateway Token | 安全后端可用时使用 Electron `safeStorage`；密文原子写入并回读验证后才删除 `.env` 旧值；迁移幂等；保留上一代密文用于损坏回滚                    |
| OR-203 | Windows Connector 使用当前用户 DPAPI 保护设备 Token、设备私钥和待配对秘密   | 真实 Windows 默认路径通过；秘密只经标准输入进入 PowerShell/DPAPI，不进入命令行；其他平台继续使用目录 `0700`、文件 `0600`                       |
| OR-204 | 新增 `SECURITY.md`                                                          | 包含支持版本、GitHub 私下报告入口、3/7/14 个工作日响应目标，以及 Runtime、Gateway、Connector、WebView、更新、备份/诊断信任边界                 |
| OR-205 | 新增和扩充安全回归                                                          | 覆盖旧值迁移、密文损坏、上一代回滚、换用户/换机、无 keyring、后端暂时不可用、清理失败、Windows 明文零落盘和 Connector 幂等迁移；均使用显式假值 |

## 2. 桌面凭据迁移与失败语义

桌面受保护文件位于 Electron `userData/protected-secrets.json`，不位于 Hermes 数据目录或备份源目录。每个记录只包含 base64 编码的操作系统保护密文、更新时间、迁移来源和可选上一代密文；文件本身不包含明文 Token。

解析顺序保持外部秘密管理边界：进程注入值优先；桌面受保护值次之；只有桌面历史写入 `.env` 的同名值会迁移；命令型 secrets provider 的值不会被复制到桌面文件。迁移步骤为“加密 → 回读等值校验 → 原子持久化 → 删除旧 `.env` 项”。写入或清理失败时旧值仍可读取，不会静默丢失。

当前 Runtime 鉴权调用链为同步接口，因此使用 Electron 同步 `safeStorage` 方法。Electron 43 同时提供异步 API并建议新代码优先使用；后续若 Runtime 鉴权契约异步化，可在不改变文件格式的前提下替换。当前发布验收依据是 [Electron safeStorage 官方安全语义](https://www.electronjs.org/docs/latest/api/safe-storage)：Windows 使用 DPAPI，macOS 使用 Keychain，Linux 需检查 `basic_text`。本实现不把 `basic_text` 视为安全后端；新值继续走受限旧文件并在设置页显示警告。已有密文遇到后端不可用时标记为不可读，不误报为“未配置”。

密文被破坏时先尝试上一代密文并自动回滚；换用户、换机或两代密文均无法解密时，不删除密文、不记录其内容，要求用户重新授权。损坏的 JSON 文件在用户重新录入时先改名保全为 `.corrupt-<timestamp>`，再建立新存储。

## 3. Connector Windows 保护

Windows 默认实现调用 .NET 对 Windows DPAPI 的 `ProtectedData` 封装，保护范围为 `CurrentUser`，未使用 machine-wide 标志。依据 [Microsoft CryptProtectData 文档](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)，密文通常只能由同一登录凭据并在同一机器解密；因此复制凭据目录不是迁移方法，换用户/换机应重新配对。

Windows 的 `device.json` 只保存公开元数据和受保护设备 Token 包装，`device-key.pem` 保存受保护私钥包装，`pairing-pending.json` 整体受保护。旧明文文件在首次成功读取后重写为受保护格式，重复读取不再迁移。DPAPI 调用失败只返回通用错误，不回显 PowerShell 标准错误或秘密材料。非 Windows 平台不伪称 OS keyring，继续依赖严格用户级权限；同用户任意代码执行和整盘失陷仍不在该权限机制的防护范围内。

## 4. 验证证据

- `npm test`：210/210 测试文件通过，2,057 passed、9 skipped、0 failed，共 2,066 项。
- `npm --prefix plugins/agents-one-connector run test`：Connector 契约回归通过；在 Windows CI 使用注入式保护器验证受保护包装与失败边界，避免 GitHub 非交互服务账户的 DPAPI profile 初始化阻塞污染传输回归。
- `npm --prefix plugins/agents-one-connector run test:dpapi`：仅在真实交互 Windows 用户会话执行当前用户 DPAPI 加密/解密回环；该命令是发布前 Windows 手工验收项。生产调用保留 60 秒有界冷启动超时，且无论失败均不输出子进程错误或秘密。
- `eslint --no-cache --quiet src tests plugins services`：0 errors。
- `npm run typecheck`：Node/Web 均通过。
- `npm run build`：main、preload、renderer 生产构建通过。
- `git diff --check`：通过。

全量测试首轮唯一失败是原配对码测试把最后一位固定替换为 `A`；随机码本身以 `A` 结尾时“错误码”与正确码相同。测试改为根据末位选择 `A/B` 中的另一个字符，安全断言未降低；随后定向 4/4 与全量 210/210 均通过。

## 5. 公开发布前外部边界

`SECURITY.md` 已给出目标 GitHub 私下报告 URL，但 `pkulyn/agents-one` 仍不存在或当前账号不可见。仓库创建后必须启用 GitHub Private Vulnerability Reporting 并实际验证该入口，才满足公开 Release 的外部配置门槛；普通 Issue 不能作为敏感报告回退渠道。

桌面受保护存储不接管通用 Provider/API Key，也不把外部 vault 值复制到本地。用户主动把秘密粘贴进对话、工具输出或任意附件不可能仅靠键名脱敏完全识别；`SECURITY.md` 已要求分享诊断前人工复核。OR-3 继续处理 Web Agent 的第三方条款和默认禁用边界，不由本工作包代替。

## 6. 回退

- `1eb3099` 可独立回退桌面受保护存储；已迁移密文在回退版本中不会被读取，回退前应由当前版本重新录入/导出到维护者认可的秘密提供器，禁止直接解密并写入日志。
- `16af81d` 可回退 Connector DPAPI 包装；回退版不能读取 Windows 受保护包装，因此应先用当前版本撤销并重新配对，不得手工复制明文私钥。
- 文档提交可独立回退，但不得恢复“所有秘密都已受保护”的绝对化承诺。
