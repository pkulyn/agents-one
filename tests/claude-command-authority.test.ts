import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  profile: "p",
  allowed: true,
  rows: [] as Array<{
    id: string;
    runtimeId: string;
    runtimeKind: string;
    runtimeSessionId: string;
    accessMode: string;
    workspace?: string;
    workspaceId?: string;
    archived?: boolean;
  }>,
}));
vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => state.profile,
}));
vi.mock("../src/main/runtime-conversation-store", () => ({
  listRuntimeConversations: () => state.rows,
  getRuntimeConversation: (id: string) => state.rows.find((r) => r.id === id),
}));
vi.mock("../src/main/workspace-authority", () => ({
  isAuthorizedWorkspaceRoot: () => state.allowed,
  resolveAuthorizedWorkspaceId: () =>
    state.allowed ? "owned-project" : undefined,
}));
import { claudeControlScope } from "../src/main/claude-command-authority";
beforeEach(() => {
  state.profile = "p";
  state.allowed = true;
  state.rows = [
    {
      id: "c",
      runtimeId: "r",
      runtimeKind: "claude-code",
      runtimeSessionId: "s",
      accessMode: "analysis",
      workspace: "owned-project",
    },
  ];
});
it("gives metadata an explicit profile without a default registered project", () => {
  const scope = claudeControlScope("r");
  expect(scope).toMatchObject({ profile: "p", runtimeId: "r" });
  expect(scope.workspace).toBeUndefined();
  expect(scope.nativeContext).toBeUndefined();
  state.profile = "other";
  expect(scope.assertCurrent).toThrow("权限不足");
});
it("binds a known read-only control to its authorized project without native resource permission", () => {
  const scope = claudeControlScope("r", "s");
  expect(scope.workspace).toBe("owned-project");
  expect(scope.nativeContext).toBeUndefined();
  scope.assertCurrent!();
  state.rows[0].accessMode = "full_access";
  expect(scope.assertCurrent).toThrow("权限不足");
});
it("requires unchanged current full access for native resource startup", () => {
  state.rows[0].accessMode = "full_access";
  const scope = claudeControlScope("r", "s");
  expect(scope.nativeContext?.cwd).toBe("owned-project");
  scope.nativeContext!.assertCurrent();
  state.allowed = false;
  expect(scope.nativeContext!.assertCurrent).toThrow("权限不足");
});
it.each(["unknown", "archived", "duplicate", "project", "runtime"])(
  "rejects %s conversation authority",
  (kind) => {
    if (kind === "unknown") state.rows = [];
    if (kind === "archived") state.rows[0].archived = true;
    if (kind === "duplicate")
      state.rows.push({ ...state.rows[0], id: "second" });
    if (kind === "project") state.allowed = false;
    if (kind === "runtime") state.rows[0].runtimeId = "other";
    expect(() => claudeControlScope("r", "s")).toThrow("权限不足");
  },
);
