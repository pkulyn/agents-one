# Windows 桌面与任务栏图标修复

用户截图显示已安装应用的窗口标题图标是彩虹圆环，桌面快捷方式和任务栏却为 Electron 默认图标。本次只修 Windows 打包可执行文件中的图标资源，沿用现有品牌图片和 AppUserModelID。

## 变更前边界

配置中的 `win.signAndEditExecutable: false` 同时跳过签名与 Electron 主 exe 的图标资源编辑；声明 `win.icon` 并不足以替换主 exe 内置图标。

- 影响数据：仅新打包目录中的主 exe PE 图标资源和打包 hook；安装程序及快捷方式读取主 exe 的图标。
- 消费者：Windows Explorer、桌面/开始菜单快捷方式、任务栏及 NSIS/portable 打包输出。标题栏继续使用 `resources/icon.png`。
- 方案：保留无需签名 helper 解包的配置，afterPack 复用已锁定 `resedit` 依赖，以 JavaScript 将既有多尺寸 `build/icon.ico` 写入输出 exe；保留其他 PE 资源，图标失败必须阻止打包，不吞错。
- 风险：hook 未接入、编辑错文件、图标尺寸丢失、打包缺少资源编辑器、旧快捷方式/任务栏缓存仍显示旧图标。
- 回退：单独回退 hook/配置/定向测试/lat 差异。既有安装 exe、用户快捷方式、图标缓存、Explorer、Runtime 注册/配置/历史均不改写；不需要管理员权限。
- 验证：先用真实 Electron exe 副本复现未改图标，修复后独立读取 PE 资源验证全部 ICO 帧；再本地一次 unpacked 打包验证 hook 集成。无需全量回归、重跑原生 CLI 或 GitHub Actions。

## 已完成的验证

最终 JavaScript 资源补丁通过真实 PE 资源校验及本地 unpacked 打包；旧设备的安装图标需要下一次安装或覆盖升级才能采用新 exe。

- 红测：真实 Electron exe 副本在不编辑时只有默认图标 4 帧，与目标 ICO 的 9 帧不一致。
- 绿测：3/3 定向用例通过，独立 PE 解析校验全部 9 个目标帧逐项 SHA-256 一致，并核对所有非图标资源哈希保持；其他平台不执行，输出目录外目标被拒绝。
- 初版 native rcedit 在实际打包时出现 `Unable to commit changes`，稍后同文件编辑成功，原因未完全确定。最终改用现有 lockfile 的 `resedit` 纯 JavaScript API，无新增依赖、资源编辑工具或管理员权限需求。
- 现有 electron-builder 也提供仅禁用签名的开关，但默认资源编辑还会调整版本等元数据。本次 hook 只变图标，保持已有未签名和 PE 元数据策略。
- 最终 `electron-builder --win --dir --x64 --publish never` 成功，hook 日志确认已写入图标；Windows Shell `ExtractAssociatedIcon` 从打包出的新主 exe 提取到彩虹圆环，已目检，不是 Electron 默认图标。
- Node 类型检查、定向 lint、格式和 lat 校验通过。本地尝试未消耗 GitHub Actions；没有把这一 unpacked 包称作已验收的 NSIS/portable 正式安装包。

## 旧安装和固定图标

已有快捷方式与固定任务栏项可能保留旧 exe 或缓存图标；源码修复不自动改写外部设备或 Windows 缓存。

下次生成并安装修复后的包时，桌面快捷方式读取新主 exe 的图标。若已有任务栏固定项仍显示旧图标，可在关闭应用后取消固定该项，再从新安装的快捷方式启动并重新固定。无需删除系统图标缓存或重启 Explorer。
