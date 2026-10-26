import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MobileExecutionPolicyStore,
  mobileProjectCapabilityHash,
  type OwnerPolicyAuthority,
  type OwnerPolicyEvidence,
} from "../src/main/mobile-control/execution-policy-store";
import { desktopRuntimePolicyFingerprint } from "../src/main/mobile-control/desktop-execution";
import type { AgentRuntimeDefinition } from "../src/shared/agent-runtimes";
import { createDesktopExecutionPolicyStore } from "../src/main/mobile-control/desktop-policy-authority";
import type { DesktopConversationRepository } from "../src/main/mobile-control/desktop-conversations";

const mock = vi.hoisted(() => ({
  profile: "owner",
  root: "",
  workspace: "",
  runtimes: [] as AgentRuntimeDefinition[],
  writes: vi.fn(),
}));

vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: () => mock.runtimes,
  startAgentRuntimeTask: vi.fn(),
  getAgentRuntimeRun: vi.fn(),
  requestAgentRuntimeTaskCancellation: vi.fn(),
}));
vi.mock("../src/main/utils", () => {
  const mocked = {
    getActiveProfileNameSync: () => mock.profile,
    profileHome: (profile: string) => join(mock.root, profile),
  };
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
vi.mock("../src/main/workspace-authority", () => ({
  resolveAuthorizedWorkspaceId: () => mock.workspace || null,
}));
vi.mock("../src/main/restore-write-lock", () => ({
  assertAgentsOneWritesAllowed: () => mock.writes(),
}));
vi.mock("../src/main/runtime-conversation-store", () => ({
  getRuntimeConversation: vi.fn(),
  beginRuntimeConversationTurn: vi.fn(),
  completeRuntimeConversationTurn: vi.fn(),
}));
let root: string,
  file: string,
  now: number,
  runtime: AgentRuntimeDefinition,
  projectPath: string,
  proof: OwnerPolicyEvidence,
  store: MobileExecutionPolicyStore,
  authority: OwnerPolicyAuthority;
const input = {
  runtimeId: "runtime-one",
  projectId: "project-one",
  mode: "inspect" as const,
  unattendedApproved: false,
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agents-one-mobile-policy-"));
  file = join(root, "policies.json");
  now = 1000000;
  projectPath = "D:/original/project";
  runtime = {
    id: "runtime-one",
    name: "Original",
    kind: "codex",
    location: "local",
    enabled: true,
    managed: "user",
    config: { executablePath: "codex" },
  };
  mock.root = root;
  mock.profile = "owner";
  mock.runtimes = [runtime];
  mock.workspace = "";
  mock.writes.mockReset();
  proof = {
    enforcementId: "executor-inspect",
    enforcementFingerprint: "a".repeat(64),
    runtimeConfigurationHash: desktopRuntimePolicyFingerprint(runtime),
    projectCapabilityHash: mobileProjectCapabilityHash({
      id: input.projectId,
      path: projectPath,
    }),
    mode: "inspect",
    verified: true,
    unattendedSupported: true,
    expiresAt: now + 60000,
  };
  authority = {
    runtime: (id) => (id === runtime.id ? runtime : undefined),
    project: (id) =>
      id === input.projectId
        ? {
            capabilityHash: mobileProjectCapabilityHash({
              id,
              path: projectPath,
            }),
          }
        : undefined,
    verify: vi.fn(() => proof),
    assertWritesAllowed: vi.fn(),
  };
  store = new MobileExecutionPolicyStore(file, authority, () => now);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
describe("Owner desktop execution approval store", () => {
  it("persists the trusted config binding and restricts approvals after changes or lost proof across reload", () => {
    proof.codexConfigurationHash = "c".repeat(64);
    store.approve(input, "0", "policy-one");
    expect(
      JSON.parse(readFileSync(file, "utf8")).approvals[0]
        .codexConfigurationHash,
    ).toBe(proof.codexConfigurationHash);
    store = new MobileExecutionPolicyStore(file, authority, () => now);
    expect(store.authorize("policy-one").codexConfigurationHash).toBe(
      "c".repeat(64),
    );
    proof.codexConfigurationHash = "d".repeat(64);
    expect(() => store.authorize("policy-one")).toThrow("unverified_policy");
    expect(store.list()[0]).not.toHaveProperty("codexConfigurationHash");
    proof.codexConfigurationHash = undefined;
    expect(() => store.authorize("policy-one")).toThrow("unverified_policy");
    proof.codexConfigurationHash = "invalid";
    expect(() => store.approve(input, "1")).toThrow("unverified_policy");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    saved.approvals[0].codexConfigurationHash = "invalid";
    writeFileSync(file, JSON.stringify(saved));
    expect(() => store.list()).toThrow("requires_owner_action");
  });
  it("binds approval to the active original profile and the actual authorized project realpath", () => {
    const repository = {
      profile: "owner",
      projects: () => [{ id: input.projectId, name: "Original", path: root }],
    } as unknown as DesktopConversationRepository;
    mock.workspace = process.platform === "win32" ? root.toLowerCase() : root;
    proof.projectCapabilityHash = mobileProjectCapabilityHash({
      id: input.projectId,
      path: mock.workspace,
    });
    proof.expiresAt = Date.now() + 60000;
    const production = createDesktopExecutionPolicyStore(
      "owner",
      repository,
      () => proof,
    );
    production.approve(input, "0", "policy-one");
    expect(production.file).toBe(
      join(root, "owner", "desktop", "mobile-execution-policies.json"),
    );
    expect(production.authorize("policy-one").enforced).toBe(true);
    mock.workspace = "D:/other/authorized-root";
    expect(() => production.authorize("policy-one")).toThrow(
      "resource_not_found",
    );
    mock.profile = "other-owner";
    expect(() => production.approve(input, "1")).toThrow("profile_inactive");
    expect(production.list()[0].enforced).toBe(false);
  });
  it("persists a desktop approval and rechecks proof after restart without trusting saved enforced values", () => {
    expect(store.currentRevision()).toBe("0");
    store.approve(input, "0", "policy-one");
    expect(store.authorize("policy-one")).toMatchObject({
      id: "policy-one",
      runtimeId: input.runtimeId,
      projectId: input.projectId,
      enforced: true,
      unattendedApproved: false,
    });
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.approvals[0]).not.toHaveProperty("enforced");
    saved.futureRoot = { retained: true };
    saved.approvals[0].futureApproval = { retained: true };
    saved.approvals[0].enforced = true;
    writeFileSync(file, JSON.stringify(saved));
    store = new MobileExecutionPolicyStore(file, authority, () => now);
    store.approve({ ...input, unattendedApproved: true }, "1", "policy-one");
    const updated = JSON.parse(readFileSync(file, "utf8"));
    expect(updated.futureRoot).toEqual(saved.futureRoot);
    expect(updated.approvals[0].futureApproval).toEqual(
      saved.approvals[0].futureApproval,
    );
    proof.verified = false;
    expect(store.list()[0]).toMatchObject({
      enforced: false,
      unattendedApproved: false,
    });
    expect(() => store.authorize("policy-one")).toThrow("unverified_policy");
  });
  it("invalidates approval for changed runtime, project capability and enforcement boundary while preserving appearance changes", () => {
    store.approve(input, "0", "policy-one");
    runtime.name = "Renamed";
    runtime.color = "#F37021";
    expect(store.authorize("policy-one").enforced).toBe(true);
    runtime.config.executablePath = "other-codex";
    expect(() => store.authorize("policy-one")).toThrow("unverified_policy");
    proof.runtimeConfigurationHash = desktopRuntimePolicyFingerprint(runtime);
    expect(() => store.authorize("policy-one")).toThrow("unverified_policy");
    runtime.config.executablePath = "codex";
    proof.runtimeConfigurationHash = desktopRuntimePolicyFingerprint(runtime);
    projectPath = "D:/replacement/project";
    proof.projectCapabilityHash = mobileProjectCapabilityHash({
      id: input.projectId,
      path: projectPath,
    });
    expect(() => store.authorize("policy-one")).toThrow("unverified_policy");
    projectPath = "D:/original/project";
    proof.projectCapabilityHash = mobileProjectCapabilityHash({
      id: input.projectId,
      path: projectPath,
    });
    proof.enforcementFingerprint = "b".repeat(64);
    expect(() => store.authorize("policy-one")).toThrow("unverified_policy");
    proof.enforcementFingerprint = "a".repeat(64);
    proof.expiresAt = now;
    expect(() => store.authorize("policy-one")).toThrow("unverified_policy");
    expect(store.list()[0].enforced).toBe(false);
  });
  it("refuses absent, malformed or non-matching proof and unattended requests without supported enforcement", () => {
    const original = { ...proof };
    for (const changes of [
      { verified: false },
      { expiresAt: NaN },
      { enforcementFingerprint: "fake" },
      { enforcementId: "invalid/path" },
      { mode: "project_write" as const },
      { projectCapabilityHash: undefined },
    ]) {
      Object.assign(proof, original, changes);
      expect(() => store.approve(input, "0")).toThrow("unverified_policy");
      expect(existsSync(file)).toBe(false);
    }
    Object.assign(proof, original, { unattendedSupported: false });
    expect(() =>
      store.approve({ ...input, unattendedApproved: true }, "0"),
    ).toThrow("unverified_policy");
    expect(() =>
      store.approve(
        { ...input, mode: "project_write", projectId: undefined },
        "0",
      ),
    ).toThrow("invalid_input");
    authority.verify = () => undefined;
    expect(() => store.approve(input, "0")).toThrow("unverified_policy");
  });
  it("enforces approval CAS and rechecks proof and restore-write lock before committing the temporary file", () => {
    store.approve(input, "0", "policy-one");
    const bytes = readFileSync(file, "utf8");
    expect(() => store.approve(input, "0", "policy-two")).toThrow(
      "revision_conflict",
    );
    authority.verify = vi
      .fn()
      .mockReturnValueOnce(proof)
      .mockReturnValueOnce({ ...proof, verified: false });
    expect(() => store.approve(input, "1", "policy-two")).toThrow(
      "unverified_policy",
    );
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect(readdirSync(root)).toEqual(["policies.json"]);
    authority.verify = () => proof;
    authority.assertWritesAllowed = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw Error("restore_write_locked");
      });
    expect(() => store.revoke("policy-one", "1")).toThrow(
      "restore_write_locked",
    );
    expect(readFileSync(file, "utf8")).toBe(bytes);
    authority.assertWritesAllowed = () => undefined;
    store.revoke("policy-one", "1");
    expect(store.list()).toEqual([]);
    expect(store.currentRevision()).toBe("2");
  });
  it("fails closed on corrupt approvals without rewriting their bytes", () => {
    for (const value of [
      "{bad",
      JSON.stringify({ schemaVersion: 2, revision: "1", approvals: [] }),
      JSON.stringify({
        schemaVersion: 1,
        revision: "1",
        approvals: [{ id: "policy-unknown" }],
      }),
    ]) {
      writeFileSync(file, value);
      expect(() => store.approve(input, "1")).toThrow("requires_owner_action");
      expect(() => store.list()).toThrow("requires_owner_action");
      expect(readFileSync(file, "utf8")).toBe(value);
    }
  });
});
