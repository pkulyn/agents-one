import type { ConnectionConfig } from "./config";

type StartResult = { success: boolean; error?: string };

export interface OfficeStartDependencies {
  getConnectionConfig: () => ConnectionConfig;
  isGatewayRunning: (profile?: string) => boolean;
  startGateway: (profile?: string) => boolean;
  startClaw3dAll: () => StartResult;
  stopClaw3dAll: () => void;
  waitForClaw3dReady: () => Promise<boolean>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startOfficeStack(
  profile: string | undefined,
  deps: OfficeStartDependencies,
): Promise<StartResult> {
  try {
    const conn = deps.getConnectionConfig();

    if (conn.mode === "local" && !deps.isGatewayRunning(profile)) {
      deps.startGateway(profile);
    }

    const result = deps.startClaw3dAll();
    if (!result.success) return result;

    if (conn.mode === "local" && !(await deps.waitForClaw3dReady())) {
      deps.stopClaw3dAll();
      return {
        success: false,
        error:
          "Office started but did not become ready in time. Check Office logs and try again.",
      };
    }

    return result;
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
