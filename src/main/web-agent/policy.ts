import { readDesktopConfig, writeDesktopConfig } from "../config";
import type { WebAgentPolicyStatus } from "../../shared/web-agent";

const POLICY_KEY = "experimentalWebAgents";

function emergencyDisableActive(): boolean {
  return process.env.AGENTS_ONE_DISABLE_WEB_AGENTS === "1";
}

// @lat: [[web-agent-runtime#Release policy]]
export function getWebAgentPolicyStatus(): WebAgentPolicyStatus {
  const killSwitchActive = emergencyDisableActive();
  const available = !killSwitchActive;
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
    ...(killSwitchActive
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
  if (enabled && emergencyDisableActive()) {
    throw new Error("当前构建不允许启用实验性网页 Provider。");
  }
  if (enabled && !acknowledged) {
    throw new Error("启用前必须确认第三方数据流、账号与封禁风险。");
  }
  const config = readDesktopConfig();
  const previous = config[POLICY_KEY];
  const preserved = previous && typeof previous === "object" ? previous : {};
  config[POLICY_KEY] = enabled
    ? { ...preserved, enabled: true, acknowledgedAt: Date.now() }
    : { ...preserved, enabled: false };
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
