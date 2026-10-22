# Desktop launch root

日常开发版从维护中的 `D:\Projects\Agents-One` 启动，确保运行代码与当前工作区一致。

`scripts/launch-agents-one.ps1` 由自身目录确定项目根目录，直接以便携 Node 执行本地 `electron-vite` CLI，并继续使用现有用户数据位置。旧工作区 `D:\Agent Console\Agents-One` 的同名入口先为本机显式设置实验性网页 Provider 环境开关，再转发到这里；网页 Provider 仍需在设置页确认风险才能执行。入口不迁移或重写 Runtime 配置、登录分区与会话历史。

2026-10-05 本机桌面快捷方式直接调用新目录脚本，工作目录和图标亦指向新目录；显式传入 `-EnableExperimentalWebAgents` 保留旧本机入口的实验开关。快捷方式使用隐藏PowerShell窗口，应用界面正常显示。

## Hidden window recovery

后台主进程可能因关闭到托盘而没有MainWindowHandle，启动入口必须唤回现有窗口并保留正在运行的任务。

主进程存在时启动同一应用触发已有second-instance处理，再等待窗口恢复；不能按“无可见窗口”强制结束Electron/Vite。只有主进程不存在才清理本目录孤立辅助进程。便携Node在PATH不可用时回退到已配置便携路径，异常写入 `.agents-one/launcher/launcher.error.log`。真实快捷方式测试核对新目录、窗口标题与主进程PID复用。

启动成功还必须由 `scripts/check-launcher-renderer.mjs` 的 `ensureWorkspace` 确认工作区导航DOM和preload接口存在。仅窗口标题或句柄不证明页面渲染成功。助手只连接当前应用的回环调试端口，不读取任务正文；正常页面不刷新。根节点空白时忽略HTTP缓存刷新一次，防止开发模块缓存读取失败导致整页白屏，随后恢复缓存开关。

### Renderer readiness

已渲染的工作区直接通过检查，不能为了验证启动而刷新页面并丢弃用户草稿。

### Blank cache recovery

根节点空白时只执行一次忽略缓存的刷新，待导航和接口可用才报成功，并在结束时恢复缓存读取设置。

### Preserve rendered error state

非空页面未达到工作区时报告失败而不自动刷新，保留当前界面、输入和错误证据供排查。

主进程构建把 `ws` 的可选原生加速包 `bufferutil` 和 `utf-8-validate` 保留为外部依赖，让 `ws` 自己捕获缺失并使用 JavaScript 实现；否则 Vite 会在启动时把缺失依赖变成顶层错误。
