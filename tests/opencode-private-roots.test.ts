import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ root: "" }));
vi.mock("../src/main/agents-one-data-root", () => ({
  agentsOneDataRoot: () => join(state.root, "desktop", "data"),
}));
vi.mock("../src/main/utils", () => ({
  agentsOneProfileHome: () =>
    join(state.root, "desktop", "data", "profiles", "default"),
  profileHome: () => join(state.root, "hermes"),
}));
vi.mock("../src/main/runtime-inputs", () => ({
  prepareRuntimeInputs: vi.fn(() => ({ promptContext: "", files: [] })),
}));
vi.mock("../src/main/runtime-adapters/local-process", () => ({
  startLocalProcess: vi.fn(() => {
    throw new Error("dispatch sentinel");
  }),
}));
import { prepareRuntimeInputs } from "../src/main/runtime-inputs";
import { startLocalProcess } from "../src/main/runtime-adapters/local-process";
import { startOpenCodeProcess } from "../src/main/runtime-adapters/builtin/opencode-acp";
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "opencode-private-workspace-"));
  mkdirSync(join(state.root, "desktop", "data", "profiles", "default"), {
    recursive: true,
  });
  mkdirSync(join(state.root, "project"));
  mkdirSync(join(state.root, "hermes", "project"), { recursive: true });
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(state.root, "claude"));
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(state.root, { recursive: true, force: true });
});
// @lat: [[runtime-chat#OpenCode private workspace exclusion]]
it.each(["analysis", "safe_write"] as const)(
  "rejects %s private projects before input staging or dispatch",
  async (mode) => {
    for (const part of [
      "",
      "desktop",
      "desktop/data",
      "desktop/data/profiles/default",
      "hermes/project",
    ]) {
      await expect(
        startOpenCodeProcess(
          { executablePath: process.execPath },
          {
            mode,
            workspace: join(state.root, part),
            prompt: "Synthetic private workspace",
          },
          () => {},
          () => {},
        ),
      ).rejects.toThrow("私有数据");
    }
    expect(prepareRuntimeInputs).not.toHaveBeenCalled();
    expect(startLocalProcess).not.toHaveBeenCalled();
  },
);
it("rejects a junction into private data before staging or dispatch", async () => {
  const alias = join(state.root, "alias");
  symlinkSync(
    join(state.root, "desktop"),
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(
    startOpenCodeProcess(
      { executablePath: process.execPath },
      {
        mode: "safe_write",
        workspace: alias,
        prompt: "Synthetic alias",
      },
      () => {},
      () => {},
    ),
  ).rejects.toThrow();
  expect(prepareRuntimeInputs).not.toHaveBeenCalled();
  expect(startLocalProcess).not.toHaveBeenCalled();
});
it.each([
  { mode: "analysis", workspace: "project" },
  { mode: "safe_write", workspace: "project" },
  { mode: "analysis", workspace: undefined },
  { mode: "safe_write", workspace: undefined },
  { mode: "full_access", workspace: "desktop/data" },
] as const)(
  "preserves $mode startup for $workspace",
  async ({ mode, workspace }) => {
    await expect(
      startOpenCodeProcess(
        { executablePath: process.execPath },
        {
          mode,
          workspace:
            workspace === undefined ? undefined : join(state.root, workspace),
          fullAccessConfirmed: mode === "full_access",
          prompt: "Synthetic ordinary task",
        },
        () => {},
        () => {},
      ),
    ).rejects.toThrow("dispatch sentinel");
    expect(prepareRuntimeInputs).toHaveBeenCalledOnce();
    expect(startLocalProcess).toHaveBeenCalledOnce();
  },
);
