import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentRuntimeDefinition } from "../src/shared/agent-runtimes";
import {
  prepareDesktopCodexPolicy,
  verifyDesktopCodexPolicy,
} from "../src/main/mobile-control/codex-policy-verifier";
import {
  createDesktopExecutionPolicyStore,
  refreshDesktopExecutionApprovals,
} from "../src/main/mobile-control/desktop-policy-authority";
import { DesktopConversationRepository } from "../src/main/mobile-control/desktop-conversations";
import { prepareAndManageMobileExecutionPolicies } from "../src/main/mobile-control/execution-management";

const state = vi.hoisted(() => ({
  root: "",
  profile: "owner",
  locked: false,
  nativeChanged: false,
  runtimes: [] as AgentRuntimeDefinition[],
  config: vi.fn(),
  probe: vi.fn(),
  reviewed: vi.fn(),
  project: "",
  workerChanged: false,
  writeFilesystem: vi.fn(),
  writeWorker: vi.fn(),
}));
vi.mock("../src/main/utils", () => {
  const mocked = {
  profileHome: () => state.root,
  getActiveProfileNameSync: () => state.profile,
};
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
vi.mock("../src/main/restore-write-lock", () => ({
  isAgentsOneRestoreWriteLocked: () => state.locked,
  assertAgentsOneWritesAllowed: () => {
    if (state.locked) throw Error("restore_write_locked");
  },
}));
vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: () => state.runtimes,
  startAgentRuntimeTask: vi.fn(),
  getAgentRuntimeRun: vi.fn(),
  requestAgentRuntimeTaskCancellation: vi.fn(),
}));
vi.mock("../src/main/runtime-conversation-store", () => ({
  beginRuntimeConversationTurn: vi.fn(),
  completeRuntimeConversationTurn: vi.fn(),
  getRuntimeConversation: vi.fn(),
}));
vi.mock("../src/main/mobile-control/desktop-conversations", () => ({
  DesktopConversationRepository: class {
    constructor(readonly profile: string) {}
    projects(): Array<{ id: string; name: string; path: string }> {
      return state.project
        ? [{ id: "project-one", name: "Project", path: state.project }]
        : [];
    }
  },
}));
vi.mock("../src/main/workspace-authority", () => ({
  resolveAuthorizedWorkspaceId: () =>
    process.platform === "win32" ? state.project.toLowerCase() : state.project,
}));
vi.mock("../src/main/mobile-control/codex-effective-config", () => ({
  readCodexMobileConfiguration: state.config,
}));
vi.mock("../src/main/mobile-control/codex-sandbox-probe", () => ({
  probeCodexReadOnlyFilesystem: state.probe,
}));
vi.mock("../src/main/mobile-control/codex-project-write-probe", () => ({
  probeCodexProjectWriteFilesystem: state.writeFilesystem,
}));
vi.mock("../src/main/mobile-control/codex-project-write-worker-proof", () => ({
  readCodexProjectWriteBinding: () => ({
    workerPath: "fixture-worker",
    workerSha256: "d".repeat(64),
    fingerprint: "e".repeat(64),
    nodeExecutable: "fixture-node",
    assertCurrent: () => {
      if (state.workerChanged) throw Error("unverified_policy");
    },
  }),
  probeCodexProjectWriteWorker: state.writeWorker,
}));
vi.mock("../src/main/mobile-control/codex-invocation-identity", () => ({
  captureCodexInspectionIdentity: () => ({
    nativePath: "synthetic-native.exe",
    fingerprint: "a".repeat(64),
  }),
  assertReviewedCodexInspectionNative: state.reviewed,
  assertCodexInspectionIdentity: () => {
    if (state.nativeChanged) throw Error("private-secret");
  },
}));
const selection = {
  runtimeId: "runtime-one",
  mode: "inspect" as const,
  unattendedApproved: false,
};
let originalHome: string | undefined;
let repository: DesktopConversationRepository;
function catalog(extra = "original"): void {
  writeFileSync(
    join(state.root, "auth", "models_cache.json"),
    JSON.stringify({
      models: [
        {
          slug: "gpt-6-sol",
          tool_mode: "code_mode_only",
          shell_type: "unified_exec",
          node_repl_disabled: false,
          multi_agent_version: "v2",
          description: extra,
        },
      ],
    }),
  );
}
beforeEach(() => {
  originalHome = process.env.CODEX_HOME;
  state.root = mkdtempSync(join(tmpdir(), "agents-one-policy-verifier-"));
  mkdirSync(join(state.root, "auth"));
  process.env.CODEX_HOME = join(state.root, "auth");
  state.profile = "owner";
  state.locked = false;
  state.nativeChanged = false;
  state.project = "";
  state.workerChanged = false;
  state.writeFilesystem
    .mockReset()
    .mockResolvedValue({ projectWriteFilesystemVerified: true });
  state.writeWorker
    .mockReset()
    .mockResolvedValue({ verified: true, workerSha256: "d".repeat(64) });
  state.runtimes = [
    {
      id: selection.runtimeId,
      name: "Original",
      kind: "codex",
      location: "local",
      enabled: true,
      managed: "user",
      config: { executablePath: "synthetic.exe", transport: "cli" },
    },
  ];
  state.config.mockReset().mockResolvedValue({
    model: "gpt-6-sol",
    providerId: "openai",
    args: [],
    configurationHash: "c".repeat(64),
  });
  state.probe.mockReset().mockResolvedValue({
    readonlyFilesystemVerified: true,
    completeExecutionPolicyVerified: false,
    verifiedAt: Date.now(),
  });
  state.reviewed.mockReset();
  catalog();
  repository = new DesktopConversationRepository("owner");
});
afterEach(() => {
  if (originalHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalHome;
  vi.useRealTimers();
  if (
    dirname(resolve(state.root)) !== resolve(tmpdir()) ||
    !basename(state.root).startsWith("agents-one-policy-verifier-")
  )
    throw Error("unsafe_fixture_cleanup");
  rmSync(state.root, { recursive: true, force: true });
});
describe("Main combined Codex inspection verifier", () => {
  it("requires full worker and filesystem evidence, persists worker identity and invalidates replaced code", async () => {
    state.project = join(state.root, "project");
    mkdirSync(state.project);
    const input = {
        ...selection,
        mode: "project_write" as const,
        projectId: "project-one",
      },
      runtime = state.runtimes[0];
    const store = createDesktopExecutionPolicyStore("owner", repository);
    expect(() => store.approve(input, "0", "write-policy")).toThrow(
      "unverified_policy",
    );
    await prepareDesktopCodexPolicy("owner", repository, input, runtime);
    expect(
      verifyDesktopCodexPolicy("owner", repository, input, runtime),
    ).toMatchObject({
      mode: "project_write",
      verified: true,
      codexProjectWriteWorkerHash: "d".repeat(64),
      unattendedSupported: false,
    });
    expect(state.probe).toHaveBeenCalledOnce();
    expect(state.writeFilesystem).toHaveBeenCalledOnce();
    expect(state.writeWorker).toHaveBeenCalledOnce();
    store.approve(input, "0", "write-policy");
    expect(
      createDesktopExecutionPolicyStore("owner", repository).authorize(
        "write-policy",
      ),
    ).toMatchObject({
      codexProjectWriteWorkerHash: "d".repeat(64),
      enforced: true,
    });
    const before = readFileSync(store.file, "utf8");
    state.workerChanged = true;
    expect(() => store.authorize("write-policy")).toThrow("unverified_policy");
    expect(store.list()[0].enforced).toBe(false);
    expect(readFileSync(store.file, "utf8")).toBe(before);
  });

  it("refuses write authority without a project or with missing OS/worker proof", async () => {
    const runtime = state.runtimes[0],
      input = { ...selection, mode: "project_write" as const };
    await expect(
      prepareDesktopCodexPolicy("owner", repository, input, runtime),
    ).rejects.toThrow("unverified_policy");
    state.project = state.root;
    await expect(
      prepareDesktopCodexPolicy(
        "owner",
        repository,
        { ...input, projectId: "project-one" },
        runtime,
      ),
    ).rejects.toThrow("unverified_policy");
    expect(state.config).not.toHaveBeenCalled();
    state.project = join(state.root, "project");
    mkdirSync(state.project);
    const fixed = { ...input, projectId: "project-one" };
    state.writeFilesystem.mockResolvedValueOnce({
      projectWriteFilesystemVerified: false,
    });
    await expect(
      prepareDesktopCodexPolicy("owner", repository, fixed, runtime),
    ).rejects.toThrow("unverified_policy");
    state.writeWorker.mockResolvedValueOnce({
      verified: false,
      workerSha256: "d".repeat(64),
    });
    await expect(
      prepareDesktopCodexPolicy("owner", repository, fixed, runtime),
    ).rejects.toThrow("unverified_policy");
    state.writeWorker.mockResolvedValueOnce({
      verified: true,
      workerSha256: "f".repeat(64),
    });
    await expect(
      prepareDesktopCodexPolicy("owner", repository, fixed, runtime),
    ).rejects.toThrow("unverified_policy");
    expect(
      verifyDesktopCodexPolicy("owner", repository, fixed, runtime),
    ).toBeUndefined();
    expect(
      existsSync(join(state.root, "desktop", "mobile-execution-policies.json")),
    ).toBe(false);
  });
  it("requires independently prepared scheduled write proof, explicit consent and unchanged worker bytes", async () => {
    state.project = join(state.root, "project");
    mkdirSync(state.project);
    const runtime = state.runtimes[0];
    const ordinary = {
      ...selection,
      mode: "project_write" as const,
      projectId: "project-one",
    };
    const scheduled = { ...ordinary, unattendedApproved: true };
    await prepareDesktopCodexPolicy("owner", repository, ordinary, runtime);
    const store = createDesktopExecutionPolicyStore("owner", repository);
    expect(() => store.approve(scheduled, "0", "scheduled-write")).toThrow(
      "unverified_policy",
    );
    expect(
      verifyDesktopCodexPolicy("owner", repository, scheduled, runtime),
    ).toBeUndefined();
    await prepareDesktopCodexPolicy("owner", repository, scheduled, runtime);
    const proof = verifyDesktopCodexPolicy(
      "owner",
      repository,
      scheduled,
      runtime,
    )!;
    expect(proof).toMatchObject({
      verified: true,
      unattendedSupported: true,
      codexProjectWriteWorkerHash: "d".repeat(64),
      enforcementId: "codex-01593-main-controlled-write-schedule-v1",
    });
    expect(proof.enforcementFingerprint).not.toBe(
      verifyDesktopCodexPolicy("owner", repository, ordinary, runtime)!
        .enforcementFingerprint,
    );
    store.approve(scheduled, "0", "scheduled-write");
    expect(store.authorize("scheduled-write")).toMatchObject({
      enforced: true,
      unattendedApproved: true,
      codexProjectWriteWorkerHash: "d".repeat(64),
    });
    state.workerChanged = true;
    expect(() => store.authorize("scheduled-write")).toThrow(
      "unverified_policy",
    );
  });
  it("requires independently prepared unattended evidence and explicit saved Owner consent", async () => {
    const runtime = state.runtimes[0];
    await prepareDesktopCodexPolicy("owner", repository, selection, runtime);
    const unattended = { ...selection, unattendedApproved: true };
    const store = createDesktopExecutionPolicyStore("owner", repository);
    expect(
      verifyDesktopCodexPolicy("owner", repository, unattended, runtime),
    ).toBeUndefined();
    expect(() => store.approve(unattended, "0", "schedule-policy")).toThrow(
      "unverified_policy",
    );
    await prepareDesktopCodexPolicy("owner", repository, unattended, runtime);
    const ordinaryProof = verifyDesktopCodexPolicy(
      "owner",
      repository,
      selection,
      runtime,
    )!;
    const scheduledProof = verifyDesktopCodexPolicy(
      "owner",
      repository,
      unattended,
      runtime,
    )!;
    expect(scheduledProof.unattendedSupported).toBe(true);
    expect(scheduledProof.enforcementFingerprint).not.toBe(
      ordinaryProof.enforcementFingerprint,
    );
    expect(ordinaryProof.unattendedSupported).toBe(false);
    expect(store.list()).toEqual([]);
    store.approve(unattended, "0", "schedule-policy");
    expect(store.authorize("schedule-policy")).toMatchObject({
      enforced: true,
      unattendedApproved: true,
    });
  });
  it("keeps checked proof during asynchronous renewal and renews before expiration without changing Owner intent", async () => {
    await prepareDesktopCodexPolicy(
      "owner",
      repository,
      selection,
      state.runtimes[0],
    );
    const store = createDesktopExecutionPolicyStore("owner", repository);
    store.approve(selection, "0", "policy-one");
    const file = store.file,
      bytes = readFileSync(file, "utf8");
    let complete!: (value: unknown) => void;
    state.config.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const renewal = prepareDesktopCodexPolicy(
      "owner",
      repository,
      selection,
      state.runtimes[0],
      true,
    );
    expect(store.authorize("policy-one").enforced).toBe(true);
    complete({
      model: "gpt-6-sol",
      providerId: "openai",
      args: [],
      configurationHash: "c".repeat(64),
    });
    await renewal;
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 240001);
    const before = verifyDesktopCodexPolicy(
      "owner",
      repository,
      selection,
      state.runtimes[0],
    )!.expiresAt;
    await refreshDesktopExecutionApprovals("owner", repository, 60000);
    expect(
      verifyDesktopCodexPolicy(
        "owner",
        repository,
        selection,
        state.runtimes[0],
      )!.expiresAt,
    ).toBeGreaterThan(before);
    expect(store.authorize("policy-one").enforced).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(bytes);
  });
  it("requires prepared live Main evidence and binds it into the actual production approval factory", async () => {
    const runtime = state.runtimes[0];
    const store = createDesktopExecutionPolicyStore("owner", repository);
    expect(
      verifyDesktopCodexPolicy("owner", repository, selection, runtime),
    ).toBeUndefined();
    await prepareDesktopCodexPolicy("owner", repository, selection, runtime);
    const proof = verifyDesktopCodexPolicy(
      "owner",
      repository,
      selection,
      runtime,
    );
    expect(proof).toMatchObject({
      verified: true,
      unattendedSupported: false,
      codexConfigurationHash: "c".repeat(64),
    });
    expect(state.config.mock.calls[0][1]).toBe(
      join(state.root, "desktop", "runtime-chat", "codex"),
    );
    store.approve(selection, "0", "policy-one");
    expect(store.authorize("policy-one").enforced).toBe(true);
    expect(
      createDesktopExecutionPolicyStore("owner", repository).authorize(
        "policy-one",
      ).enforced,
    ).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 300001);
    expect(store.list()[0].enforced).toBe(false);
    expect(() => store.authorize("policy-one")).toThrow("unverified_policy");
  });
  it("rejects unsupported modes, changed native, model and incomplete filesystem evidence", async () => {
    const runtime = state.runtimes[0];
    for (const input of [
      {
        ...selection,
        mode: "project_write" as const,
        projectId: "project-one",
      },
    ])
      await expect(
        prepareDesktopCodexPolicy("owner", repository, input, runtime),
      ).rejects.toThrow("unverified_policy");
    expect(state.config).not.toHaveBeenCalled();
    state.reviewed.mockImplementationOnce(() => {
      throw Error("private-secret");
    });
    await expect(
      prepareDesktopCodexPolicy("owner", repository, selection, runtime),
    ).rejects.toThrow("unverified_policy");
    state.config.mockResolvedValueOnce({
      model: "unknown-model",
      configurationHash: "c".repeat(64),
    });
    await expect(
      prepareDesktopCodexPolicy("owner", repository, selection, runtime),
    ).rejects.toThrow("unverified_policy");
    state.probe.mockResolvedValueOnce({
      readonlyFilesystemVerified: false,
      completeExecutionPolicyVerified: false,
    });
    await expect(
      prepareDesktopCodexPolicy("owner", repository, selection, runtime),
    ).rejects.toThrow("unverified_policy");
    expect(
      verifyDesktopCodexPolicy("owner", repository, selection, runtime),
    ).toBeUndefined();
    expect(
      existsSync(join(state.root, "desktop", "mobile-execution-policies.json")),
    ).toBe(false);
  });
  it("withdraws cached proof for native, metadata, profile or project identity changes", async () => {
    state.project = join(state.root, "project");
    mkdirSync(state.project);
    const input = { ...selection, projectId: "project-one" };
    const runtime = state.runtimes[0];
    await prepareDesktopCodexPolicy("owner", repository, input, runtime);
    expect(
      verifyDesktopCodexPolicy("owner", repository, input, runtime)?.verified,
    ).toBe(true);
    state.nativeChanged = true;
    expect(
      verifyDesktopCodexPolicy("owner", repository, input, runtime),
    ).toBeUndefined();
    state.nativeChanged = false;
    catalog("changed");
    expect(
      verifyDesktopCodexPolicy("owner", repository, input, runtime),
    ).toBeUndefined();
    catalog();
    state.profile = "other";
    expect(
      verifyDesktopCodexPolicy("owner", repository, input, runtime),
    ).toBeUndefined();
    state.profile = "owner";
    state.project = join(state.root, "other-project");
    mkdirSync(state.project);
    expect(
      verifyDesktopCodexPolicy("owner", repository, input, runtime),
    ).toBeUndefined();
  });
  it("requires a matching local review before approval and refuses changed configuration after review", async () => {
    await expect(
      prepareAndManageMobileExecutionPolicies("owner", {
        action: "approve",
        selection,
        expectedRevision: "0",
      }),
    ).rejects.toThrow("unverified_policy");
    const review = await prepareAndManageMobileExecutionPolicies("owner", {
      action: "review",
      selection,
    });
    expect(review.review?.verified).toBe(true);
    state.config.mockResolvedValueOnce({
      model: "gpt-6-sol",
      configurationHash: "d".repeat(64),
    });
    await expect(
      prepareAndManageMobileExecutionPolicies("owner", {
        action: "approve",
        selection,
        expectedRevision: "0",
      }),
    ).rejects.toThrow("unverified_policy");
    expect(
      existsSync(join(state.root, "desktop", "mobile-execution-policies.json")),
    ).toBe(false);
    await prepareAndManageMobileExecutionPolicies("owner", {
      action: "review",
      selection,
    });
    const result = await prepareAndManageMobileExecutionPolicies("owner", {
      action: "approve",
      selection: {
        unattendedApproved: false,
        mode: "inspect",
        runtimeId: selection.runtimeId,
      },
      expectedRevision: "0",
    });
    expect(result.status.policies).toHaveLength(1);
    expect(result.status.policies[0].verified).toBe(true);
    const policy = result.status.policies[0];
    await prepareAndManageMobileExecutionPolicies("owner", {
      action: "revoke",
      id: policy.id,
      expectedRevision: "1",
    });
    expect(
      createDesktopExecutionPolicyStore("owner", repository).list(),
    ).toEqual([]);
  });
  it("rejects invalid commands before native preparation and rechecks the frame after asynchronous preparation", async () => {
    await expect(
      prepareAndManageMobileExecutionPolicies("owner", {
        action: "review",
        selection,
        evidence: {},
      } as never),
    ).rejects.toThrow("invalid_input");
    expect(state.config).not.toHaveBeenCalled();
    const guard = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => {
        throw Error("scope_denied");
      });
    await expect(
      prepareAndManageMobileExecutionPolicies(
        "owner",
        { action: "review", selection },
        guard,
      ),
    ).rejects.toThrow("mobile_execution_unavailable");
    expect(
      existsSync(join(state.root, "desktop", "mobile-execution-policies.json")),
    ).toBe(false);
  });
  it("refreshes saved intent without rewriting it and leaves changed proof restricted", async () => {
    await prepareAndManageMobileExecutionPolicies("owner", {
      action: "review",
      selection,
    });
    await prepareAndManageMobileExecutionPolicies("owner", {
      action: "approve",
      selection,
      expectedRevision: "0",
    });
    const file = join(state.root, "desktop", "mobile-execution-policies.json");
    const bytes = readFileSync(file, "utf8");
    catalog("changed");
    await refreshDesktopExecutionApprovals("owner", repository);
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect(
      createDesktopExecutionPolicyStore("owner", repository).list()[0].enforced,
    ).toBe(false);
  });
});
