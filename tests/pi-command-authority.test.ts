import { beforeEach, expect, it, vi } from "vitest";
import type { RuntimeConversation } from "../src/shared/runtime-conversations";
const fixture = vi.hoisted(() => ({
  profile: "default",
  allowed: true,
  rows: [] as RuntimeConversation[],
}));
vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => fixture.profile,
}));
vi.mock("../src/main/runtime-conversation-store", () => ({
  getRuntimeConversation: (id: string, profile: string) =>
    profile === "default"
      ? (fixture.rows.find((row) => row.id === id) ?? null)
      : null,
  listRuntimeConversations: () => fixture.rows,
}));
vi.mock("../src/main/workspace-authority", () => ({
  isAuthorizedWorkspaceRoot: () => fixture.allowed,
  resolveAuthorizedWorkspaceId: () =>
    fixture.allowed ? "D:/fixture/project" : null,
}));
import { piNativeCommandContext } from "../src/main/pi-command-authority";
beforeEach(() => {
  fixture.profile = "default";
  fixture.allowed = true;
  fixture.rows = [
    {
      id: "conversation",
      runtimeId: "pi",
      runtimeSessionId: "native-session",
      accessMode: "full_access",
      workspace: "D:/fixture/project",
    } as RuntimeConversation,
  ];
});
it("binds exact Main-owned full conversation, session, runtime and authorized project", () => {
  const context = piNativeCommandContext(
    "pi",
    "native-session",
    "conversation",
  );
  expect(context?.cwd).toBe("D:/fixture/project");
  expect(context?.profile).toBe("default");
  expect(() => context?.assertCurrent()).not.toThrow();
});
it.each(["auto", "analysis"] as const)(
  "does not grant native authority to %s",
  (mode) => {
    fixture.rows[0].accessMode = mode;
    expect(piNativeCommandContext("pi", "native-session")).toBeUndefined();
  },
);
it("refuses missing, mismatched or ambiguous bindings", () => {
  expect(piNativeCommandContext("pi")).toBeUndefined();
  expect(
    piNativeCommandContext("other", "native-session", "conversation"),
  ).toBeUndefined();
  expect(piNativeCommandContext("pi", "other", "conversation")).toBeUndefined();
  expect(
    piNativeCommandContext("pi", "native-session", "missing"),
  ).toBeUndefined();
  fixture.rows.push({
    ...fixture.rows[0],
    id: "duplicate",
    accessMode: "analysis",
  });
  expect(piNativeCommandContext("pi", "native-session")).toBeUndefined();
});
it("requires a currently authorized project even for full access", () => {
  fixture.allowed = false;
  expect(piNativeCommandContext("pi", "native-session")).toBeUndefined();
});
it.each([
  "profile",
  "mode",
  "session",
  "workspace",
  "archive",
  "delete",
  "authorization",
])("revokes a captured authority after %s changes", (change) => {
  const context = piNativeCommandContext("pi", "native-session")!;
  if (change === "profile") fixture.profile = "other";
  if (change === "mode") fixture.rows[0].accessMode = "auto";
  if (change === "session") fixture.rows[0].runtimeSessionId = "other";
  if (change === "workspace") fixture.rows[0].workspace = "D:/fixture/other";
  if (change === "archive") fixture.rows[0].archived = true;
  if (change === "delete") fixture.rows.length = 0;
  if (change === "authorization") fixture.allowed = false;
  expect(() => context.assertCurrent()).toThrow("权限不足");
});

// @lat: [[runtime-chat#Pi control-channel startup authority]]
it("keeps unrelated message updates from revoking unchanged authority", () => {
  const context = piNativeCommandContext("pi", "native-session")!;
  fixture.rows[0].title = "new title";
  expect(() => context.assertCurrent()).not.toThrow();
});

it("resolves project context without granting native authority in analysis", async () => {
  fixture.rows[0].accessMode = "analysis";
  const { piControlScope } = await import("../src/main/pi-command-authority");
  expect(piControlScope("pi", "native-session")).toEqual({
    profile: "default",
    workspace: "D:/fixture/project",
  });
  expect(piNativeCommandContext("pi", "native-session")).toBeUndefined();
  fixture.allowed = false;
  expect(piControlScope("pi", "native-session")).toEqual({
    profile: "default",
  });
});
