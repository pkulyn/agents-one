import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeDefinition } from "../src/shared/agent-runtimes";
import {
  createDesktopExecutionBackend,
  createDesktopMobileCatalog,
  desktopRuntimePolicyFingerprint,
} from "../src/main/mobile-control/desktop-execution";
import type { DesktopConversationRepository } from "../src/main/mobile-control/desktop-conversations";

const mock = vi.hoisted(() => ({
  profile: "owner",
  runtimes: [] as AgentRuntimeDefinition[],
  start: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => mock.profile,
}));
vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: () => mock.runtimes,
  startAgentRuntimeTask: mock.start,
  getAgentRuntimeRun: mock.get,
  requestAgentRuntimeTaskCancellation: mock.cancel,
}));
vi.mock("../src/main/runtime-conversation-store", () => ({
  beginRuntimeConversationTurn: vi.fn(),
  completeRuntimeConversationTurn: vi.fn(),
  getRuntimeConversation: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.profile = "owner";
  mock.runtimes = [
    {
      id: "runtime-1",
      name: "Original name",
      kind: "codex",
      location: "local",
      enabled: true,
      managed: "user",
      config: { command: "codex", transport: "cli" },
    },
  ];
});
describe("Desktop execution Main bridge", () => {
  // @lat: [[mobile-data#Mobile data#Owner controlled write dispatch retains approval binding]]
  it("passes controlled write authority and revokes it after mode, workspace or configuration changes", async () => {
    const policy = {
      id: "write-policy",
      runtimeId: "runtime-1",
      projectId: "project-1",
      mode: "project_write" as "project_write" | "inspect",
      codexProjectWriteWorkerHash: "d".repeat(64),
      enforced: true,
      codexConfigurationHash: "c".repeat(64),
      runtimeConfigurationHash: desktopRuntimePolicyFingerprint(
        mock.runtimes[0],
      ),
      workspaceRef: "original-workspace",
    };
    const backend = createDesktopExecutionBackend("owner", {
      authorize: () => policy,
    });
    const approved = backend.authorize(
      policy.id,
      policy.runtimeId,
      policy.projectId,
    );
    const options = approved.dispatchOptions!;
    expect(options.codexMobileProjectWrite).toBe(true);
    options.codexMobileProjectGuard!();
    options.codexMobileConfigurationGuard!("c".repeat(64));
    await backend.start(
      policy.runtimeId,
      { prompt: "Write", ...approved.task },
      options,
    );
    expect(mock.start.mock.calls[0][2]).toMatchObject({
      codexMobileProjectWrite: true,
    });
    expect(mock.start.mock.calls[0][2].codexMobileInspection).toBeUndefined();
    policy.mode = "inspect";
    expect(() => options.codexMobileProjectGuard!()).toThrow(
      "unverified_policy",
    );
    expect(() =>
      options.codexMobileConfigurationGuard!("c".repeat(64)),
    ).toThrow("unverified_policy");
    policy.mode = "project_write";
    policy.workspaceRef = "changed-workspace";
    expect(() => options.codexMobileProjectGuard!()).toThrow(
      "unverified_policy",
    );
    expect(() =>
      options.codexMobileConfigurationGuard!("c".repeat(64)),
    ).toThrow("unverified_policy");
    policy.workspaceRef = "original-workspace";
    policy.codexConfigurationHash = "d".repeat(64);
    expect(() =>
      options.codexMobileConfigurationGuard!("d".repeat(64)),
    ).toThrow("unverified_policy");
    policy.codexConfigurationHash = "";
    expect(() =>
      backend.authorize(policy.id, policy.runtimeId, policy.projectId),
    ).toThrow("unverified_policy");
  });
  // @lat: [[mobile-data#Mobile data#Owner Codex configuration guard revocation]]
  it("passes the Main config guard without a project and keeps the approved value after provider mutation", async () => {
    const policy = {
      id: "policy-config",
      runtimeId: "runtime-1",
      mode: "inspect" as const,
      enforced: true,
      codexConfigurationHash: "c".repeat(64),
      runtimeConfigurationHash: desktopRuntimePolicyFingerprint(
        mock.runtimes[0],
      ),
    };
    const backend = createDesktopExecutionBackend("owner", {
      authorize: () => policy,
    });
    const approved = backend.authorize(policy.id, policy.runtimeId, undefined);
    const guard = approved.dispatchOptions?.codexMobileConfigurationGuard;
    expect(guard).toBeTypeOf("function");
    guard!("c".repeat(64));
    expect(() => guard!("d".repeat(64))).toThrow("unverified_policy");
    await backend.start(
      policy.runtimeId,
      { prompt: "Inspect", ...approved.task },
      approved.dispatchOptions!,
    );
    expect(mock.start.mock.calls[0][2]).toMatchObject({
      codexMobileInspection: true,
      codexMobileConfigurationGuard: guard,
    });
    policy.codexConfigurationHash = "d".repeat(64);
    expect(() => guard!("d".repeat(64))).toThrow("unverified_policy");
    policy.codexConfigurationHash = "c".repeat(64);
    policy.enforced = false;
    expect(() => guard!("c".repeat(64))).toThrow("unverified_policy");
    policy.enforced = true;
    mock.runtimes[0].enabled = false;
    expect(() => guard!("c".repeat(64))).toThrow("unverified_policy");
    mock.runtimes = [];
    expect(() => guard!("c".repeat(64))).toThrow("unverified_policy");
  });
  // @lat: [[mobile-data#Mobile data#Owner project tool guard binds current approval]]
  it("retains a Main-only guard that refuses policy revocation, runtime changes and profile switches", async () => {
    const policy = {
      id: "policy-project",
      runtimeId: "runtime-1",
      projectId: "project-1",
      mode: "inspect" as const,
      enforced: true,
      runtimeConfigurationHash: desktopRuntimePolicyFingerprint(
        mock.runtimes[0],
      ),
    };
    const backend = createDesktopExecutionBackend("owner", {
      authorize: () => policy,
    });
    const approved = backend.authorize(
      policy.id,
      policy.runtimeId,
      policy.projectId,
    );
    const guard = approved.dispatchOptions?.codexMobileProjectGuard;
    expect(guard).toBeTypeOf("function");
    guard!();
    mock.start.mockResolvedValue({ id: "run-project" });
    await backend.start(
      policy.runtimeId,
      { prompt: "Read project", ...approved.task },
      approved.dispatchOptions!,
    );
    expect(mock.start.mock.calls[0][2]).toMatchObject({
      codexMobileInspection: true,
      codexMobileProjectGuard: guard,
    });
    policy.enforced = false;
    expect(() => guard!()).toThrow("unverified_policy");
    policy.enforced = true;
    mock.runtimes[0].config.command = "changed";
    expect(() => guard!()).toThrow("unverified_policy");
    mock.profile = "changed";
    expect(() => guard!()).toThrow("profile_inactive");
  });
  // @lat: [[mobile-data#Mobile data#Catalog fixed Owner profile]]
  it("reads the original Runtime registry and repository only for its bound active Owner profile", () => {
    const policy = {
      id: "policy-inspect",
      runtimeId: "runtime-1",
      mode: "inspect" as const,
      enforced: true,
      runtimeConfigurationHash: desktopRuntimePolicyFingerprint(
        mock.runtimes[0],
      ),
    };
    const policies = { list: () => [policy], authorize: () => policy };
    const projects = vi.fn(() => [
      { id: "project-one", name: "Original", path: "D:/private" },
    ]);
    const repository = {
      profile: "owner",
      projects,
    } as unknown as DesktopConversationRepository;
    const catalog = createDesktopMobileCatalog(
      "owner",
      repository,
      policies,
      createDesktopExecutionBackend("owner", policies),
    );
    expect(catalog.snapshot().runtimes[0]).toMatchObject({
      id: "runtime-1",
      name: "Original name",
      allowedActions: ["read", "create", "advance"],
    });
    expect(catalog.snapshot().projects[0]).not.toHaveProperty("path");
    mock.runtimes[0].config.command = "changed-after-approval";
    expect(catalog.snapshot().policies[0]).toMatchObject({
      enforced: false,
      allowedActions: [],
    });
    mock.profile = "another";
    expect(() => catalog.snapshot()).toThrow("profile_inactive");
    expect(projects).toHaveBeenCalledTimes(3);
  });
  // @lat: [[mobile-data#Mobile data#Bound execution policy bridge]]
  it("requires an enforced policy bound to active Owner profile, original runtime configuration and project", async () => {
    const policy = {
      id: "policy-1",
      runtimeId: "runtime-1",
      projectId: "project-1",
      mode: "project_write" as const,
      codexProjectWriteWorkerHash: "d".repeat(64),
      enforced: true,
      codexConfigurationHash: "c".repeat(64),
      runtimeConfigurationHash: desktopRuntimePolicyFingerprint(
        mock.runtimes[0],
      ),
      workspaceRef: "owner-workspace-1",
    };
    const backend = createDesktopExecutionBackend("owner", {
      authorize: () => policy,
    });
    expect(
      backend.authorize("policy-1", "runtime-1", "project-1").task,
    ).toEqual({
      mode: "safe_write",
      workspaceId: "project-1",
      workspaceRef: "owner-workspace-1",
    });
    expect(() => backend.authorize("policy-1", "runtime-1", undefined)).toThrow(
      "unverified_policy",
    );
    mock.runtimes[0].name = "Desktop renamed";
    mock.runtimes[0].color = "#F37021";
    expect(() =>
      backend.authorize("policy-1", "runtime-1", "project-1"),
    ).not.toThrow();
    mock.runtimes[0].config.command = "different-codex";
    expect(() =>
      backend.authorize("policy-1", "runtime-1", "project-1"),
    ).toThrow("unverified_policy");
    mock.profile = "another-profile";
    expect(() =>
      backend.authorize("policy-1", "runtime-1", "project-1"),
    ).toThrow("profile_inactive");
    mock.profile = "owner";
    mock.runtimes[0].enabled = false;
    expect(() =>
      backend.authorize("policy-1", "runtime-1", "project-1"),
    ).toThrow("requires_owner_action");
    const options = { persistBeforeDispatch: vi.fn() };
    mock.start.mockResolvedValue({ id: "run-1" });
    await backend.start(
      "runtime-1",
      {
        prompt: "Synthetic task",
        profile: "phone-supplied-profile",
        mode: "analysis",
      },
      options,
    );
    expect(mock.start).toHaveBeenCalledWith(
      "runtime-1",
      { prompt: "Synthetic task", profile: "owner", mode: "analysis" },
      { ...options, codexMobileInspection: true },
    );
  });
  // @lat: [[mobile-data#Mobile data#Unverified execution refusal]]
  it("denies unproven capability and unsupported policy modes without supplying full-access confirmation", () => {
    const runtime = mock.runtimes[0];
    const policy = {
      id: "policy-1",
      runtimeId: runtime.id,
      mode: "inspect" as const,
      enforced: false,
      runtimeConfigurationHash: desktopRuntimePolicyFingerprint(runtime),
    };
    expect(() =>
      createDesktopExecutionBackend("owner", {
        authorize: () => policy,
      }).authorize("policy-1", runtime.id, undefined),
    ).toThrow("unverified_policy");
    policy.enforced = true;
    const approved = createDesktopExecutionBackend("owner", {
      authorize: () => policy,
    }).authorize("policy-1", runtime.id, undefined);
    expect(approved.task).toEqual({ mode: "analysis" });
    expect(approved.task).not.toHaveProperty("fullAccessConfirmed");
  });
});
