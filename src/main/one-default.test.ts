import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  writes: 0,
}));
vi.mock("./config", () => ({
  readDesktopConfig: () => structuredClone(state.config),
  writeDesktopConfig: (config: Record<string, unknown>) => {
    state.config = structuredClone(config);
    state.writes++;
  },
}));
import { initializeDefaultOne } from "./one-default";

beforeEach(() => {
  state.config = {};
  state.writes = 0;
});
describe("One first-run initialization", () => {
  // @lat: [[main-process#One first-run defaults]]
  it("creates a ready-to-configure One once, with the approved avatar and no model credentials", () => {
    initializeDefaultOne();
    const one = (
      state.config.oneAgentRuntimes as Array<{
        id: string;
        avatar: string;
        config: Record<string, unknown>;
      }>
    )[0];
    expect(one.id).toBe("one");
    expect(state.config.agentRuntimeAppearances).toMatchObject({
      one: { avatar: one.avatar },
    });
    expect(one.avatar).toBe(
      `data:image/png;base64,${readFileSync(join(__dirname, "../../resources/one-avatar.png")).toString("base64")}`,
    );
    expect(one.config).toMatchObject({
      endpoint: "",
      model: "",
      agentTransport: "local-sdk",
    });
    expect(JSON.stringify(one.config)).not.toMatch(
      /apiKey|bearerToken|api.example|your-model/,
    );
    const original = structuredClone(state.config);
    initializeDefaultOne();
    expect(state.config).toEqual(original);
    expect(state.writes).toBe(1);
  });
  it("preserves disabled and customized One definitions and unknown settings during upgrade", () => {
    const existing = {
      id: "custom",
      kind: "one",
      enabled: false,
      avatar: "custom-avatar",
      config: { futureKey: 17 },
    };
    state.config = { agentRuntimes: [existing], futureSetting: { keep: true } };
    initializeDefaultOne();
    expect(state.config.agentRuntimes).toEqual([existing]);
    expect(state.config).not.toHaveProperty("oneAgentRuntimes");
    expect(state.config.futureSetting).toEqual({ keep: true });
  });
  it.each([[], { futureFormat: true }])(
    "preserves existing dedicated One data including deliberate empty data: %j",
    (value) => {
      state.config = { oneAgentRuntimes: value };
      initializeDefaultOne();
      expect(state.config.oneAgentRuntimes).toEqual(value);
    },
  );
  it("does not revive One after deletion, and never clobbers an occupied runtime id", () => {
    state.config = { agentRuntimes: [{ id: "one", kind: "codex" }] };
    initializeDefaultOne();
    expect((state.config.oneAgentRuntimes as Array<{ id: string }>)[0].id).toBe(
      "one-2",
    );
    state.config.oneAgentRuntimes = [];
    initializeDefaultOne();
    expect(state.config.oneAgentRuntimes).toEqual([]);
  });
  it("preserves unrelated appearance entries and an explicit saved appearance", () => {
    state.config = {
      agentRuntimeAppearances: {
        one: { avatar: null, name: "My One" },
        codex: { color: "#123456" },
      },
    };
    initializeDefaultOne();
    expect(state.config.agentRuntimeAppearances).toMatchObject({
      one: { avatar: null, name: "My One" },
      codex: { color: "#123456" },
    });
  });
});
