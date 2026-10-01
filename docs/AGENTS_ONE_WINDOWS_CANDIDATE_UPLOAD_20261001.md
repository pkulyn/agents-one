# Windows 候选产物重新上传（2026-10-01）

本记录保留月度配额检查、重新上传的阻塞原因以及依赖修复的边界，避免把上传成功等同于 RC1 发布验收通过。

## 原候选与阻塞

原候选为 `a2471471a00060d7626528b04e4a8bc5cf94315c`。9 月 23 日运行 `35813569237` 完成连续三轮门禁、Windows 打包、包体 smoke 和校验和生成，随后因 Artifact storage quota 超限无法上传。

10 月 1 日 UTC 新账期开始后，10 月 billing usage summary 暂无记录，仓库 artifact 列表为 0。用户授权重新上传。同一候选重新运行 `36842392731`，`publish_draft=false`；第一轮格式、类型、lint 和测试通过，但依赖审计报告 3 high / 2 moderate，后续打包和上传被跳过。该运行没有验证上传配额是否已解除。

## 变更安全评估

本次是恢复构建所需的依赖安全更新，在原候选的独立工作树进行，仅修改依赖声明、锁文件及验收文档。

- 影响数据与消费者：`package.json`、`package-lock.json`；npm clean install、Electron 桌面宿主、原生 SQLite ABI、打包工具链及依赖网络/路径解析库。
- 最小边界：保留应用源代码、Runtime 注册、IPC、配置写入、迁移、用户历史和外观；现有主工作区的未提交修改不纳入候选。
- 失败模式：Electron 更新可能改变 Chromium/Node/native ABI；传递依赖更新可能影响网络、路径匹配或打包。只使用现有兼容版本范围内的修复，审阅锁文件差异。
- 回退：原候选 SHA 保持可重现；新依赖和文档集中在独立分支，修复可独立回退。不会覆写原候选、创建 tag、公开仓库或发布 Release。
- 验证：依赖审计、lockfile/manifest 一致性、格式、类型、lint、主工程和子项目测试、生产构建，以及 GitHub Windows clean runner 上原有连续三轮 Gate、打包、包体 smoke、校验和和 artifact 上传。

## 当前状态

依赖修复限于锁文件内 15 个已存在的包条目：Electron `43.4.1 → 43.7.7`；brace-expansion `1.1.18 → 1.1.21`、`2.1.4 → 2.1.7`、`5.0.9 → 5.0.12`；undici `6.28.0 → 6.29.0`、`7.29.0 → 7.30.0`；fast-uri `3.1.7 → 3.1.8`；ip-address `10.5.0 → 10.7.2`。没有引入新依赖或修改应用源代码，均满足既有版本范围。锁文件审计现在为 0 vulnerabilities。

新候选 `7dfcb50d10e9098331a27d0e133012d028f703b5` 的 [Windows Gate 36844292900](https://github.com/pkulyn/agents-one/actions/runs/36844292900) 于北京时间 10 月 1 日 18:04 完成并成功。三轮格式、类型、lint、主工程与子项目测试、依赖审计和生产构建全部通过；每轮主工程为 215/215 文件通过，audit 均为 0 vulnerabilities。Windows x64 安装版和便携版打包、包体 smoke、校验和生成及 artifact 上传均通过；草稿 Release job 因 `publish_draft=false` 跳过。

- Artifact：`11153244191`，`agents-one-0.1.0-alpha.1-windows-x64-7dfcb50d10e9098331a27d0e133012d028f703b5`。
- [下载候选 ZIP](https://github.com/pkulyn/agents-one/actions/runs/36844292900/artifacts/11153244191)：393,005,490 bytes；GitHub 返回 `expired=false`。
- ZIP SHA-256：`86df19e232a8112cb241c005a79f58756dcf3acfceee341d579bb7667642314c`。
- 保留 14 天，API 到期时间为 `2026-10-15T10:03:00Z`（北京时间 10 月 15 日 18:03）。ZIP 包含安装版、便携版、blockmap、latest.yml、SHA256SUMS.txt 和 RELEASE_NOTES.md。
- GitHub run 的 `head_sha` 是工作流所在 main 的 `a247147…`；实际 checkout、门禁和 artifact 名称对应输入候选 `7dfcb50…`，不能用工作流的 head SHA 替代发布候选身份。

此次真实上传确认 Artifact storage quota 拦截已经解除。依赖修复保留在独立分支，尚未合并 main。RC1 总体结论继续 No-Go；此记录不更新 RC1 Checklist，也不代替独立 Windows 的 OR-702/OR-704 人工验收。
