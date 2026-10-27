import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MobileExecutionManagement } from "../src/main/mobile-control/execution-management";
import {
  MobileExecutionPolicyStore,
  type OwnerPolicyEvidence,
} from "../src/main/mobile-control/execution-policy-store";
import { desktopRuntimePolicyFingerprint } from "../src/main/mobile-control/desktop-execution";
import type { AgentRuntimeDefinition } from "../src/shared/agent-runtimes";
import type { MobileExecutionManagementCommand } from "../src/shared/mobile-execution-management";

vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: vi.fn(),
  startAgentRuntimeTask: vi.fn(),
  getAgentRuntimeRun: vi.fn(),
  requestAgentRuntimeTaskCancellation: vi.fn(),
}));
let root: string,
  file: string,
  now: number,
  runtime: AgentRuntimeDefinition,
  proof: OwnerPolicyEvidence,
  manager: MobileExecutionManagement,
  active: boolean,
  locked: boolean;
const selection = {
  runtimeId: "original-runtime",
  mode: "inspect" as const,
  unattendedApproved: false,
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mobile-policy-management-"));
  file = join(root, "policies.json");
  now = 1000;
  active = true;
  locked = false;
  runtime = {
    id: selection.runtimeId,
    name: "Original runtime",
    kind: "codex",
    location: "local",
    enabled: true,
    managed: "user",
    config: { executablePath: "private-command", token: "secret-never-return" },
  };
  proof = {
    enforcementId: "native-inspect",
    enforcementFingerprint: "a".repeat(64),
    runtimeConfigurationHash: desktopRuntimePolicyFingerprint(runtime),
    mode: "inspect",
    verified: true,
    unattendedSupported: false,
    expiresAt: now + 10000,
  };
  const guard = (write: boolean): void => {
    if (!active) throw Error("profile_inactive");
    if (write && locked) throw Error("restore_write_locked");
  };
  const store = new MobileExecutionPolicyStore(
    file,
    {
      runtime: () => runtime,
      project: () => undefined,
      verify: () => proof,
      assertWritesAllowed: () => guard(true),
    },
    () => now,
  );
  manager = new MobileExecutionManagement({
    store,
    guard,
    runtimes: () => [{ ...runtime, available: true }],
    projects: () => [
      {
        id: "project-one",
        name: "Original project",
        path: "D:/secret-project",
      },
    ],
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it("reviews current proof without writes and projects only public selection fields with the same policy revision", () => {
  const result = manager.execute({ action: "review", selection });
  expect(result.review).toMatchObject({
    selection,
    verified: true,
    unattendedSupported: false,
    expiresAt: 11000,
  });
  expect(existsSync(file)).toBe(false);
  expect(result.status).toEqual({
    revision: "0",
    runtimes: [{ id: runtime.id, name: runtime.name, available: true }],
    projects: [{ id: "project-one", name: "Original project" }],
    policies: [],
  });
  const approved = manager.execute({
    action: "approve",
    selection,
    expectedRevision: "0",
  });
  expect(approved.status.revision).toBe("1");
  expect(approved.status.policies[0]).toMatchObject({
    ...selection,
    verified: true,
  });
  expect(JSON.stringify(approved)).not.toMatch(
    /secret|private-command|runtimeConfigurationHash|enforcementFingerprint|D:\//,
  );
});
it("rechecks evidence for approval after a review and refuses unsupported unattended execution or expired proof", () => {
  expect(
    manager.execute({ action: "review", selection }).review?.verified,
  ).toBe(true);
  proof.verified = false;
  expect(() =>
    manager.execute({ action: "approve", selection, expectedRevision: "0" }),
  ).toThrow("unverified_policy");
  expect(manager.execute({ action: "review", selection }).review).toMatchObject(
    { verified: false, restrictionReason: "unverified_policy" },
  );
  proof.verified = true;
  expect(
    manager.execute({
      action: "review",
      selection: { ...selection, unattendedApproved: true },
    }).review?.verified,
  ).toBe(false);
  now = proof.expiresAt;
  expect(() =>
    manager.execute({ action: "approve", selection, expectedRevision: "0" }),
  ).toThrow("unverified_policy");
  expect(existsSync(file)).toBe(false);
});
it("preserves bytes on a stale revision, restore lock or profile change and revokes without requiring current proof", () => {
  const approved = manager.execute({
    action: "approve",
    selection,
    expectedRevision: "0",
  });
  const id = approved.status.policies[0].id,
    bytes = readFileSync(file, "utf8");
  expect(() =>
    manager.execute({ action: "revoke", id, expectedRevision: "0" }),
  ).toThrow("revision_conflict");
  locked = true;
  expect(() =>
    manager.execute({ action: "revoke", id, expectedRevision: "1" }),
  ).toThrow("restore_write_locked");
  locked = false;
  active = false;
  expect(() =>
    manager.execute({ action: "approve", selection, expectedRevision: "1" }),
  ).toThrow("profile_inactive");
  expect(readFileSync(file, "utf8")).toBe(bytes);
  active = true;
  proof.verified = false;
  expect(
    manager.execute({ action: "status" }).status.policies[0].verified,
  ).toBe(false);
  expect(
    manager.execute({ action: "revoke", id, expectedRevision: "1" }).status,
  ).toMatchObject({ revision: "2", policies: [] });
});
it("rejects paths, unknown actions and fields, fake evidence, malformed revisions and inherited requests before writes", () => {
  const invalid: unknown[] = [
    null,
    [],
    { action: "exec" },
    { action: "status", proof },
    { action: "review", selection: { ...selection, verified: true } },
    { action: "review", selection: { ...selection, runtimeId: "D:/runtime" } },
    { action: "review", selection: { ...selection, projectId: "../project" } },
    { action: "approve", selection, expectedRevision: "01" },
    { action: "revoke", id: "../policy", expectedRevision: "0" },
    Object.create({ action: "status" }),
    { action: "review", selection: { ...selection, mode: "project_write" } },
  ];
  for (const command of invalid)
    expect(() =>
      manager.execute(command as MobileExecutionManagementCommand),
    ).toThrow("invalid_input");
  expect(existsSync(file)).toBe(false);
});
