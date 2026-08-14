import { describe, expect, it } from "vitest";

import {
  startOfficeStack,
  type OfficeStartDependencies,
} from "../src/main/office-start";
import type { ConnectionConfig } from "../src/main/config";

function localConnection(): ConnectionConfig {
  return {
    mode: "local",
    remoteUrl: "",
    apiKey: "",
    remoteChatTransport: "auto",
  };
}

function makeDeps(
  connection: ConnectionConfig,
  overrides: Partial<OfficeStartDependencies> = {},
): { calls: string[]; deps: OfficeStartDependencies } {
  const calls: string[] = [];
  const deps: OfficeStartDependencies = {
    getConnectionConfig: () => connection,
    isGatewayRunning: () => false,
    startGateway: (profile) => {
      calls.push(`startGateway:${profile ?? ""}`);
      return true;
    },
    startClaw3dAll: () => {
      calls.push("startClaw3dAll");
      return { success: true };
    },
    stopClaw3dAll: () => {
      calls.push("stopClaw3dAll");
    },
    waitForClaw3dReady: async () => {
      calls.push("waitForClaw3dReady");
      return true;
    },
    ...overrides,
  };
  return { calls, deps };
}

describe("startOfficeStack", () => {
  it("starts the local gateway with the active profile before Claw3D", async () => {
    const { calls, deps } = makeDeps(localConnection());

    const result = await startOfficeStack("research", deps);

    expect(result).toEqual({ success: true });
    expect(calls).toEqual([
      "startGateway:research",
      "startClaw3dAll",
      "waitForClaw3dReady",
    ]);
  });

  it("does not restart a local gateway that is already running", async () => {
    const { calls, deps } = makeDeps(localConnection(), {
      isGatewayRunning: () => true,
    });

    const result = await startOfficeStack("research", deps);

    expect(result).toEqual({ success: true });
    expect(calls).toEqual(["startClaw3dAll", "waitForClaw3dReady"]);
  });

  it("returns an error when local Office does not become ready", async () => {
    const { calls, deps } = makeDeps(localConnection(), {
      waitForClaw3dReady: async () => {
        calls.push("waitForClaw3dReady");
        return false;
      },
    });

    const result = await startOfficeStack("research", deps);

    expect(result).toEqual({
      success: false,
      error:
        "Office started but did not become ready in time. Check Office logs and try again.",
    });
    expect(calls).toEqual([
      "startGateway:research",
      "startClaw3dAll",
      "waitForClaw3dReady",
      "stopClaw3dAll",
    ]);
  });
});
