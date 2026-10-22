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
      available: true,
      enabled: false,
      killSwitchActive: false,
    });
    expect(policy.webAgentExecutionAllowed()).toBe(false);
  });

  it("requires explicit acknowledgement without a developer environment variable", async () => {
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

  it("preserves unrelated config and policy fields across enable, reload and disable", async () => {
    const policy = await policyModule();
    const { readDesktopConfig, writeDesktopConfig } =
      await import("../src/main/config");
    const before = readDesktopConfig();
    writeDesktopConfig({
      ...before,
      futureSetting: { retained: true },
      experimentalWebAgents: { enabled: false, futurePolicy: "keep" },
    });
    expect(policy.webAgentExecutionAllowed()).toBe(false);
    policy.setWebAgentPolicyEnabled(true, true);
    expect(readDesktopConfig()).toMatchObject({
      futureSetting: { retained: true },
      experimentalWebAgents: {
        futurePolicy: "keep",
        enabled: true,
        acknowledgedAt: expect.any(Number),
      },
    });
    const reloaded = await policyModule();
    expect(reloaded.webAgentExecutionAllowed()).toBe(true);
    reloaded.setWebAgentPolicyEnabled(false);
    expect(reloaded.webAgentExecutionAllowed()).toBe(false);
    expect(readDesktopConfig()).toMatchObject({
      futureSetting: { retained: true },
      experimentalWebAgents: { futurePolicy: "keep", enabled: false },
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
      reasonCode: "emergency-disabled",
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
