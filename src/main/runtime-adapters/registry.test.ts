import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listRuntimeAdapterManifests } from "./registry";

const ENV_KEYS = [
  "AGENTS_ONE_REMOTE_OPENCODE_V1",
  "AGENTS_ONE_REMOTE_CODEX_APP_SERVER_V1",
  "AGENTS_ONE_REMOTE_CLAUDE_AGENT_SDK_V1",
  "AGENTS_ONE_REMOTE_PI_RPC_V1",
  "AGENTS_ONE_REMOTE_ANTIGRAVITY_ACP_V1",
];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function manifests(): string[] {
  return listRuntimeAdapterManifests().map((manifest) => manifest.adapterId);
}

describe("remote runtime rollout gates", () => {
  it("exposes every remote CLI pilot by default", () => {
    expect(manifests()).toContain("codex-app-server");
    expect(manifests()).toContain("claude-agent-sdk");
    expect(manifests()).toContain("pi-rpc");
    expect(manifests()).toContain("antigravity-acp");
    const opencode = listRuntimeAdapterManifests().find(
      (manifest) => manifest.adapterId === "opencode",
    );
    expect(opencode?.locations).toEqual(["local", "remote"]);
    expect(opencode?.transports).toEqual(["local-cli", "gateway-v1"]);
  });

  it("drops remote OpenCode when its environment gate is off", () => {
    process.env.AGENTS_ONE_REMOTE_OPENCODE_V1 = "0";
    const opencode = listRuntimeAdapterManifests().find(
      (manifest) => manifest.adapterId === "opencode",
    );
    expect(opencode?.locations).toEqual(["local"]);
  });

  it("hides a pilot explicitly disabled by the environment", () => {
    process.env.AGENTS_ONE_REMOTE_CODEX_APP_SERVER_V1 = "0";
    process.env.AGENTS_ONE_REMOTE_ANTIGRAVITY_ACP_V1 = "off";
    expect(manifests()).not.toContain("codex-app-server");
    expect(manifests()).not.toContain("antigravity-acp");
  });

  it("treats an explicit environment 1 as enabled", () => {
    process.env.AGENTS_ONE_REMOTE_PI_RPC_V1 = "1";
    expect(manifests()).toContain("pi-rpc");
  });
});
