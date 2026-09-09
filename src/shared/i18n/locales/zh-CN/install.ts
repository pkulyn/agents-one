export default {
  preparing: "准备中...",
  startingInstall: "开始安装",
  installationComplete: "安装完成",
  installationFailed: "安装失败",
  installingHermes: "正在安装 Hermes Agent Runtime",
  installationFailedHint: "安装失败，请重试或改用终端安装。",
  retryInstallation: "重新安装",
  copied: "已复制！",
  copyLogs: "复制日志",
  stepLabel: "步骤 {{step}}/{{total}}：{{title}}",
  waitingToStart: "等待开始...",
  continueToSetup: "继续前往设置",
  confirmTitle: "安装前确认",
  confirmLocationLabel: "Hermes Agent Runtime 将安装到：",
  confirmFresh: "此处未找到现有安装 — 将进行全新安装。",
  confirmUpdate: "此处已有 Hermes Agent Runtime 安装 — 将更新到最新版本。",
  confirmReplace:
    "此处存在一个文件夹，但不是有效的 Hermes Agent Runtime 安装 — 安装将删除并替换它。",
  confirmNotInherited:
    "如果你在其他位置或通过命令行安装过 Hermes Agent Runtime，那些安装不会被沿用。",
  confirmInstallBtn: "安装 Hermes Agent Runtime",
  useExistingBtn: "使用现有安装",
  useExistingHint:
    "选择包含现有 Hermes Agent Runtime 安装的文件夹（即包含 hermes-agent 文件夹的那个）。",
  useExistingInvalid: "在该文件夹中未找到可用的 Hermes Agent Runtime 安装。",
  useExistingDone: "已设置现有安装 — 退出并重新打开 Agents One 以应用。",
  useExistingQuitBtn: "退出 Agents One",
} as const;
