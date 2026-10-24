import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manageMobileExecutionPolicies } from "../src/main/mobile-control/execution-management";
import {
  authorizeOriginalMobileSchedule,
  desktopMobileScheduleAuthority,
} from "../src/main/mobile-control/schedule-execution";
import { createDesktopExecutionPolicyStore } from "../src/main/mobile-control/desktop-policy-authority";
import { DesktopConversationRepository } from "../src/main/mobile-control/desktop-conversations";
import { MobileExecutionPolicyStore } from "../src/main/mobile-control/execution-policy-store";
import {
  createDesktopExecutionBackend,
  desktopRuntimePolicyFingerprint,
} from "../src/main/mobile-control/desktop-execution";
import type { TaskSchedule } from "../src/shared/task-schedules";
import { listAgentRuntimes } from "../src/main/agent-runtimes";
const state = vi.hoisted(() => ({ root: "", profile: "owner", locked: false }));
vi.mock("../src/main/utils", () => {
  const mocked = {
  getActiveProfileNameSync: () => state.profile,
  profileHome: (profile: string) => join(state.root, profile),
};
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: () => [
    {
      id: "runtime-one",
      name: "Original runtime",
      kind: "codex",
      location: "local",
      enabled: true,
      config: { token: "private-token" },
    },
  ],
  startAgentRuntimeTask: vi.fn(),
  getAgentRuntimeRun: vi.fn(),
  requestAgentRuntimeTaskCancellation: vi.fn(),
}));
vi.mock("../src/main/restore-write-lock", () => ({
  isAgentsOneRestoreWriteLocked: () => state.locked,
  assertAgentsOneWritesAllowed: () => {
    if (state.locked) throw Error("Actual writes paused");
  },
}));
afterEach(() => {
  if (state.root) rmSync(state.root, { recursive: true, force: true });
});

it("never authorizes a persisted mobile schedule or advertises executable schedules through the unverified production factory", () => {
  state.root = mkdtempSync(join(tmpdir(), "mobile-schedule-production-"));
  state.profile = "owner";
  state.locked = false;
  const repository = new DesktopConversationRepository("owner");
  const policies = createDesktopExecutionPolicyStore("owner", repository);
  const authority = desktopMobileScheduleAuthority(
    policies,
    createDesktopExecutionBackend("owner", policies),
  );
  expect(authority.available()).toBe(false);
  const directory = join(state.root, "owner", "desktop");
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "mobile-execution-policies.json");
  const bytes = JSON.stringify({
    schemaVersion: 1,
    revision: "1",
    approvals: [
      {
        id: "policy-one",
        runtimeId: "runtime-one",
        mode: "inspect",
        unattendedApproved: true,
        runtimeConfigurationHash: desktopRuntimePolicyFingerprint(
          listAgentRuntimes()[0],
        ),
        enforcementId: "native-inspect",
        enforcementFingerprint: "b".repeat(64),
        approvedAt: 1000,
      },
    ],
  });
  writeFileSync(file, bytes);
  const schedule = {
    mobileExecutionPolicyId: "policy-one",
    runtimeId: "runtime-one",
    mode: "analysis",
  } as TaskSchedule;
  expect(() => authorizeOriginalMobileSchedule(schedule, "owner")).toThrow(
    "unverified_policy",
  );
  expect(authority.available()).toBe(false);
  expect(readFileSync(file, "utf8")).toBe(bytes);
  writeFileSync(file, "corrupt approval store");
  expect(authority.available()).toBe(false);
  expect(() => authorizeOriginalMobileSchedule(schedule, "owner")).toThrow(
    "requires_owner_action",
  );
  expect(readFileSync(file, "utf8")).toBe("corrupt approval store");
});

it("requires unattended consent in addition to current proof and rejects runtime/project swaps through the actual backend", () => {
  state.root = mkdtempSync(join(tmpdir(), "mobile-schedule-authority-"));
  state.profile = "owner";
  state.locked = false;
  const runtime = listAgentRuntimes()[0];
  const policies = new MobileExecutionPolicyStore(
    join(state.root, "synthetic-proofs.json"),
    {
      runtime: (id) => (id === runtime.id ? runtime : undefined),
      project: () => undefined,
      assertWritesAllowed: () => {},
      verify: (selection) => ({
        verified: true,
        mode: selection.mode,
        unattendedSupported: true,
        enforcementId: "synthetic-only",
        enforcementFingerprint: "b".repeat(64),
        runtimeConfigurationHash: desktopRuntimePolicyFingerprint(runtime),
        expiresAt: Date.now() + 300000,
      }),
    },
  );
  const authority = desktopMobileScheduleAuthority(
    policies,
    createDesktopExecutionBackend("owner", policies),
  );
  policies.approve(
    { runtimeId: runtime.id, mode: "inspect", unattendedApproved: false },
    "0",
    "manual-only",
  );
  expect(authority.available()).toBe(false);
  expect(() =>
    authority.authorize({
      executionPolicyId: "manual-only",
      runtimeId: runtime.id,
    }),
  ).toThrow("unverified_policy");
  policies.approve(
    { runtimeId: runtime.id, mode: "inspect", unattendedApproved: true },
    "1",
    "unattended",
  );
  expect(authority.available()).toBe(true);
  expect(
    authority.authorize({
      executionPolicyId: "unattended",
      runtimeId: runtime.id,
    }),
  ).toBe("analysis");
  expect(() =>
    authority.authorize({
      executionPolicyId: "unattended",
      runtimeId: "other-runtime",
    }),
  ).toThrow("resource_not_found");
  expect(() =>
    authority.authorize({
      executionPolicyId: "unattended",
      runtimeId: runtime.id,
      projectId: "different-project",
    }),
  ).toThrow("unverified_policy");
  policies.revoke("unattended", "2");
  expect(authority.available()).toBe(false);
  expect(() =>
    authority.authorize({
      executionPolicyId: "unattended",
      runtimeId: runtime.id,
    }),
  ).toThrow("resource_not_found");
});
it("uses the actual fixed-profile factory, keeps unproven approvals restricted, and can revoke with CAS while preserving unknown stored fields", () => {
  state.root = mkdtempSync(
    join(tmpdir(), "mobile-policy-settings-production-"),
  );
  state.profile = "owner";
  state.locked = false;
  const directory = join(state.root, "owner", "desktop");
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "mobile-execution-policies.json");
  const original = JSON.stringify({
    schemaVersion: 1,
    revision: "4",
    futureRoot: { keep: true },
    approvals: [
      {
        id: "policy-one",
        runtimeId: "runtime-one",
        mode: "inspect",
        unattendedApproved: false,
        runtimeConfigurationHash: "a".repeat(64),
        enforcementId: "native-inspect",
        enforcementFingerprint: "b".repeat(64),
        approvedAt: 1000,
        futureApproval: "keep",
      },
    ],
  });
  writeFileSync(file, original);
  expect(
    manageMobileExecutionPolicies("owner", { action: "status" }).status,
  ).toMatchObject({
    revision: "4",
    policies: [{ id: "policy-one", verified: false }],
  });
  const selection = {
    runtimeId: "runtime-one",
    mode: "inspect" as const,
    unattendedApproved: false,
  };
  expect(
    manageMobileExecutionPolicies("owner", { action: "review", selection })
      .review,
  ).toMatchObject({ verified: false, restrictionReason: "unverified_policy" });
  expect(() =>
    manageMobileExecutionPolicies("owner", {
      action: "approve",
      selection,
      expectedRevision: "4",
    }),
  ).toThrow("unverified_policy");
  state.locked = true;
  expect(() =>
    manageMobileExecutionPolicies("owner", {
      action: "revoke",
      id: "policy-one",
      expectedRevision: "4",
    }),
  ).toThrow("restore_write_locked");
  state.locked = false;
  state.profile = "other";
  expect(() =>
    manageMobileExecutionPolicies("owner", {
      action: "revoke",
      id: "policy-one",
      expectedRevision: "4",
    }),
  ).toThrow("profile_inactive");
  expect(readFileSync(file, "utf8")).toBe(original);
  state.profile = "owner";
  const result = manageMobileExecutionPolicies("owner", {
    action: "revoke",
    id: "policy-one",
    expectedRevision: "4",
  });
  expect(result.status).toMatchObject({ revision: "5", policies: [] });
  expect(JSON.parse(readFileSync(file, "utf8")).futureRoot).toEqual({
    keep: true,
  });
  expect(JSON.stringify(result)).not.toContain("private-token");
});
