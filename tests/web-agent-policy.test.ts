import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testHome: string;

async function policyModule(): Promise<
  typeof import("../src/main/web-agent/policy")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return import("../src/main/web-agent/policy");
}

// @lat: [[web-agent-runtime#Release policy]]
describe("Web Agent release policy", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "agents-one-web-policy-"));
    vi.stubEnv("AGENTS_ONE_ENABLE_EXPERIMENTAL_WEB_AGENTS", "");
    vi.stubEnv("AGENTS_ONE_DISABLE_WEB_AGENTS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("keeps public builds disabled by default", async () => {
    const policy = await policyModule();
    expect(policy.getWebAgentPolicyStatus()).toMatchObject({
      available: false,
      enabled: false,
      killSwitchActive: false,
    });
    expect(() => policy.setWebAgentPolicyEnabled(true, true)).toThrow(
      /不允许启用/,
    );
  });

  it("requires explicit acknowledgement before local experimental opt-in", async () => {
    vi.stubEnv("AGENTS_ONE_ENABLE_EXPERIMENTAL_WEB_AGENTS", "1");
    const policy = await policyModule();
    expect(policy.getWebAgentPolicyStatus()).toMatchObject({
      available: true,
      enabled: false,
    });
    expect(() => policy.setWebAgentPolicyEnabled(true, false)).toThrow(
      /必须确认/,
    );
    expect(policy.setWebAgentPolicyEnabled(true, true)).toMatchObject({
      available: true,
      enabled: true,
    });
  });

  it("lets the local emergency switch override a persisted opt-in", async () => {
    vi.stubEnv("AGENTS_ONE_ENABLE_EXPERIMENTAL_WEB_AGENTS", "1");
    const policy = await policyModule();
    policy.setWebAgentPolicyEnabled(true, true);
    vi.stubEnv("AGENTS_ONE_DISABLE_WEB_AGENTS", "1");
    expect(policy.getWebAgentPolicyStatus()).toMatchObject({
      available: false,
      enabled: false,
      killSwitchActive: true,
    });
    expect(() => policy.setWebAgentPolicyEnabled(true, true)).toThrow(
      /不允许启用/,
    );
  });

  it("supports one-step disable without another acknowledgement", async () => {
    vi.stubEnv("AGENTS_ONE_ENABLE_EXPERIMENTAL_WEB_AGENTS", "1");
    const policy = await policyModule();
    policy.setWebAgentPolicyEnabled(true, true);
    expect(policy.setWebAgentPolicyEnabled(false)).toMatchObject({
      available: true,
      enabled: false,
    });
  });
});
