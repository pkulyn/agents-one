import { readDesktopConfig, writeDesktopConfig } from "../config";
import type { WebAgentPolicyStatus } from "../../shared/web-agent";

const POLICY_KEY = "experimentalWebAgents";

function localExperimentalAccessAllowed(): boolean {
  return process.env.AGENTS_ONE_ENABLE_EXPERIMENTAL_WEB_AGENTS === "1";
}

function emergencyDisableActive(): boolean {
  return process.env.AGENTS_ONE_DISABLE_WEB_AGENTS === "1";
}

// @lat: [[web-agent-runtime#Release policy]]
export function getWebAgentPolicyStatus(): WebAgentPolicyStatus {
  const killSwitchActive = emergencyDisableActive();
  const localAccessAllowed = localExperimentalAccessAllowed();
  const available = localAccessAllowed && !killSwitchActive;
  const config = readDesktopConfig();
  const policy = config[POLICY_KEY];
  const optedIn =
    policy &&
    typeof policy === "object" &&
    (policy as Record<string, unknown>).enabled === true &&
    typeof (policy as Record<string, unknown>).acknowledgedAt === "number";
  return {
    available,
    enabled: available && Boolean(optedIn),
    killSwitchActive,
    ...(!localAccessAllowed
      ? {
          reasonCode: "public-build-disabled" as const,
          reason:
            "公开构建默认关闭网页 Provider；当前没有第三方书面自动化许可。",
        }
      : killSwitchActive
        ? {
            reasonCode: "emergency-disabled" as const,
            reason: "网页 Provider 已由本机紧急开关停用。",
          }
        : {}),
  };
}

export function setWebAgentPolicyEnabled(
  enabled: boolean,
  acknowledged = false,
): WebAgentPolicyStatus {
  if (
    enabled &&
    (!localExperimentalAccessAllowed() || emergencyDisableActive())
  ) {
    throw new Error("当前构建不允许启用实验性网页 Provider。");
  }
  if (enabled && !acknowledged) {
    throw new Error("启用前必须确认第三方数据流、账号与封禁风险。");
  }
  const config = readDesktopConfig();
  config[POLICY_KEY] = enabled
    ? { enabled: true, acknowledgedAt: Date.now() }
    : { enabled: false };
  writeDesktopConfig(config);
  return getWebAgentPolicyStatus();
}

export function webAgentExecutionAllowed(): boolean {
  return getWebAgentPolicyStatus().enabled;
}

export function webAgentDisabledMessage(): string {
  return (
    getWebAgentPolicyStatus().reason ||
    "实验性网页 Provider 总开关未启用。请先阅读风险说明并明确开启。"
  );
}
