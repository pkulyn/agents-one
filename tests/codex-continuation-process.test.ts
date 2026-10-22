import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { ChildProcess } from "node:child_process";
import { startCodexProcess } from "../src/main/codex-runtime";
import { codexMobileInspectionArgs } from "../src/main/mobile-control/codex-inspect-boundary";

const state = vi.hoisted(() => ({
  root: "",
  spawn: vi.fn(),
  configuration: vi.fn(),
  identity: vi.fn(),
  assertIdentity: vi.fn(),
  reviewedNative: vi.fn(),
  context: vi.fn(),
  currentContext: vi.fn(),
  disposeContext: vi.fn(),
}));
vi.mock("../src/main/mobile-control/codex-mobile-context", () => ({
  prepareCodexMobileContext: state.context,
}));
vi.mock("../src/main/mobile-control/codex-invocation-identity", () => ({
  captureCodexInspectionIdentity: state.identity,
  assertCodexInspectionIdentity: state.assertIdentity,
  assertReviewedCodexInspectionNative: state.reviewedNative,
}));
vi.mock("../src/main/mobile-control/codex-effective-config", () => ({
  readCodexMobileConfiguration: state.configuration,
}));
vi.mock("child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: state.spawn,
}));
vi.mock("../src/main/utils", () => {
  const mocked = {
    profileHome: () => state.root,
    getActiveProfileNameSync: () => "default",
  };
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-codex-continuation-"));
  state.spawn.mockReset();
  state.configuration.mockReset();
  state.identity.mockReset();
  state.assertIdentity.mockReset();
  state.reviewedNative.mockReset();
  state.context.mockReset();
  state.currentContext.mockReset();
  state.disposeContext.mockReset();
  state.disposeContext.mockResolvedValue(undefined);
  state.context.mockResolvedValue({
    args: codexMobileInspectionArgs(),
    environment: { MAIN_ENV: "owned" },
    assertCurrent: state.currentContext,
    dispose: state.disposeContext,
  });
  state.identity.mockReturnValue({
    nativePath: "synthetic-codex",
    fingerprint: "a".repeat(64),
    files: [],
    environmentFingerprint: "b".repeat(64),
  });
  state.configuration.mockResolvedValue({
    model: "original-model",
    providerId: "openai",
    args: ["-c", 'model_provider="openai"'],
    configurationHash: "a".repeat(64),
  });
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
function processFor(chunks: string[], stderr = "", code = 0): void {
  state.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      for (const chunk of chunks) child.stdout.emit("data", Buffer.from(chunk));
      if (stderr) child.stderr.emit("data", Buffer.from(stderr));
      child.emit("close", code);
    });
    return child as unknown as ChildProcess;
  });
}

describe("Codex continuation at the process boundary", () => {
  // @lat: [[mobile-data#Mobile data#Codex mobile write model stays read only]]
  it("binds a fixed Main runner while the model process remains read-only", async () => {
    const workspace = join(state.root, "project"),
      home = join(state.root, "home");
    mkdirSync(workspace);
    mkdirSync(home);
    state.root = home;
    const projectGuard = vi.fn(),
      configurationGuard = vi.fn(),
      writes = vi.fn();
    processFor([
      '{"type":"thread.started","thread_id":"actual-write-thread"}\n',
    ]);
    const started = await startCodexProcess(
      { executablePath: "synthetic-codex" },
      { prompt: "Write through Main", mode: "safe_write", workspace },
      () => undefined,
      {
        projectInspectionGuard: projectGuard,
        configurationGuard,
        projectWrite: {
          runId: "run-11111111-1111-4111-8111-111111111111",
          workerPath: join(home, "worker.cjs"),
          assertWritesAllowed: writes,
        },
      },
    );
    await started.completion;
    expect(state.context.mock.calls[0][0].projectWriter.projectRoot()).toBe(
      workspace,
    );
    const args = state.spawn.mock.calls[0][1] as string[];
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(args).not.toContain("workspace-write");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(configurationGuard).toHaveBeenCalledTimes(2);
    expect(writes).toHaveBeenCalledOnce();
    expect(state.disposeContext).toHaveBeenCalledOnce();
    // Restore cleanup ownership to the fixture root, not just the newly created profile.
    state.root = dirname(home);
  });

  // @lat: [[mobile-data#Mobile data#Codex mobile write requires Main guards before spawn]]
  it("rejects incomplete or contradictory write authority before configuration, context or spawn", async () => {
    const projectWrite = {
      runId: "run-11111111-1111-4111-8111-111111111111",
      workerPath: "worker.cjs",
      assertWritesAllowed: () => undefined,
    };
    for (const options of [
      { projectWrite },
      {
        projectWrite,
        mobileInspection: true as const,
        projectInspectionGuard: () => undefined,
        configurationGuard: () => undefined,
      },
    ])
      await expect(
        startCodexProcess(
          {},
          { prompt: "Write", mode: "safe_write", workspace: state.root },
          () => undefined,
          options,
        ),
      ).rejects.toThrow("fixed Run and Main authority");
    expect(state.configuration).not.toHaveBeenCalled();
    expect(state.context).not.toHaveBeenCalled();
    expect(state.spawn).not.toHaveBeenCalled();
  });
  // @lat: [[mobile-data#Mobile data#Codex fresh configuration admission]]
  it("validates fresh configuration before tool context and rechecks approval immediately before native spawn", async () => {
    const guard = vi.fn((hash: string) => {
      if (hash !== "a".repeat(64)) throw Error("private-secret");
    });
    processFor([
      '{"type":"thread.started","thread_id":"original-thread-id"}\n',
    ]);
    const started = await startCodexProcess(
      { executablePath: "synthetic-codex" },
      { prompt: "Inspect", mode: "analysis" },
      () => undefined,
      { mobileInspection: true, configurationGuard: guard },
    );
    await started.completion;
    expect(guard).toHaveBeenCalledTimes(2);
    state.spawn.mockClear();
    state.context.mockClear();
    state.configuration.mockResolvedValueOnce({
      model: "changed-model",
      configurationHash: "b".repeat(64),
      args: [],
    });
    await expect(
      startCodexProcess(
        { executablePath: "synthetic-codex" },
        { prompt: "Inspect", mode: "analysis" },
        () => undefined,
        { mobileInspection: true, configurationGuard: guard },
      ),
    ).rejects.toThrow("approved configuration");
    expect(state.context).not.toHaveBeenCalled();
    expect(state.spawn).not.toHaveBeenCalled();
    state.disposeContext.mockClear();
    const revoked = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw Error("private-secret");
      });
    await expect(
      startCodexProcess(
        { executablePath: "synthetic-codex" },
        { prompt: "Inspect", mode: "analysis" },
        () => undefined,
        { mobileInspection: true, configurationGuard: revoked },
      ),
    ).rejects.toThrow("approved configuration");
    expect(state.disposeContext).toHaveBeenCalledOnce();
    expect(state.spawn).not.toHaveBeenCalled();
  });
  // @lat: [[mobile-data#Mobile data#Codex configuration authority strict callback]]
  it("rejects async configuration authority and authority without mobile inspection before dispatch", async () => {
    const guard = vi.fn(async () => {
      throw Error("private-secret");
    });
    await expect(
      startCodexProcess(
        { executablePath: "synthetic-codex" },
        { prompt: "Inspect", mode: "analysis" },
        () => undefined,
        { mobileInspection: true, configurationGuard: guard },
      ),
    ).rejects.toThrow("approved configuration");
    expect(state.context).not.toHaveBeenCalled();
    expect(state.spawn).not.toHaveBeenCalled();
    await expect(
      startCodexProcess(
        { executablePath: "synthetic-codex" },
        { prompt: "Inspect" },
        () => undefined,
        { configurationGuard: () => undefined },
      ),
    ).rejects.toThrow("requires mobile inspection");
  });
  // @lat: [[mobile-data#Mobile data#Codex Runtime owns tool context lifecycle]]
  it("passes Main project authority to the context and closes it before completion", async () => {
    const guard = vi.fn();
    processFor([
      '{"type":"thread.started","thread_id":"original-thread-id"}\n',
    ]);
    const started = await startCodexProcess(
      { executablePath: "synthetic-codex" },
      { prompt: "Read project", mode: "analysis", workspace: state.root },
      () => undefined,
      { mobileInspection: true, projectInspectionGuard: guard },
    );
    await started.completion;
    expect(state.context).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: state.root,
        projectGuard: guard,
        model: "original-model",
      }),
    );
    expect(state.spawn.mock.calls[0][2].env).toEqual({ MAIN_ENV: "owned" });
    expect(state.currentContext).toHaveBeenCalledOnce();
    expect(state.disposeContext).toHaveBeenCalledOnce();
  });
  // @lat: [[mobile-data#Mobile data#Codex failed context blocks native spawn]]
  it("does not dispatch after context preparation or last context validation fails", async () => {
    state.context.mockRejectedValueOnce(Error("context unavailable"));
    await expect(
      startCodexProcess(
        { executablePath: "synthetic-codex" },
        { prompt: "Read", mode: "analysis" },
        () => undefined,
        { mobileInspection: true },
      ),
    ).rejects.toThrow("context unavailable");
    expect(state.spawn).not.toHaveBeenCalled();
    state.currentContext.mockImplementation(() => {
      throw Error("context changed");
    });
    await expect(
      startCodexProcess(
        { executablePath: "synthetic-codex" },
        { prompt: "Read", mode: "analysis" },
        () => undefined,
        { mobileInspection: true },
      ),
    ).rejects.toThrow("context changed");
    expect(state.spawn).not.toHaveBeenCalled();
    expect(state.disposeContext).toHaveBeenCalledOnce();
  });
  // @lat: [[mobile-data#Mobile data#Reviewed Codex native version gate#Unknown native refused before configuration RPC]]
  it("refuses unreviewed native bytes before reading configuration or starting a model process", async () => {
    state.reviewedNative.mockImplementation(() => {
      throw Error(
        "Mobile Codex executable identity is unsupported or changed.",
      );
    });
    await expect(
      startCodexProcess(
        { executablePath: "synthetic-codex" },
        { prompt: "Continue", mode: "analysis" },
        () => undefined,
        { mobileInspection: true },
      ),
    ).rejects.toThrow("identity");
    expect(state.configuration).not.toHaveBeenCalled();
    expect(state.spawn).not.toHaveBeenCalled();
  });
  // @lat: [[mobile-data#Mobile data#Codex mobile inspection process arguments]]
  it("applies Main-owned inspection gates to the same original continuation without enabling shell or extensions", async () => {
    processFor([
      '{"type":"thread.started","thread_id":"original-thread-id"}\n',
    ]);
    const started = await startCodexProcess(
      { executablePath: "synthetic-codex", model: "original-model" },
      { prompt: "Continue", sessionId: "original-thread-id", mode: "analysis" },
      () => undefined,
      { mobileInspection: true },
    );
    expect((await started.completion).sessionId).toBe("original-thread-id");
    const args = state.spawn.mock.calls[0][1] as string[];
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    for (const feature of [
      "hooks",
      "apps",
      "plugins",
      "shell_tool",
      "unified_exec",
      "multi_agent",
      "image_generation",
      "view_image",
      "browser_use",
    ])
      expect(
        args.slice(args.indexOf(feature) - 1, args.indexOf(feature) + 1),
      ).toEqual(["--disable", feature]);
    expect(args).toContain('web_search="disabled"');
    expect(args).toContain("read-only");
    expect(args).toContain("original-model");
    expect(args).toContain('model_provider="openai"');
    expect(state.assertIdentity).toHaveBeenCalledTimes(2);
    expect(args).not.toContain("--last");
    expect(args.slice(-5)).toEqual([
      "resume",
      "--json",
      "--",
      "original-thread-id",
      "Continue",
    ]);
  });

  // @lat: [[mobile-data#Mobile data#Codex dispatch identity change refusal]]
  it("uses the identified native executable and refuses identity changes after configuration or immediately before dispatch", async () => {
    state.identity.mockReturnValue({
      nativePath: "identified-codex.exe",
      fingerprint: "a".repeat(64),
      files: [],
      environmentFingerprint: "b".repeat(64),
    });
    processFor([
      '{"type":"thread.started","thread_id":"original-thread-id"}\n',
    ]);
    const started = await startCodexProcess(
      { executablePath: "synthetic-codex" },
      { prompt: "Continue", mode: "analysis" },
      () => undefined,
      { mobileInspection: true },
    );
    await started.completion;
    expect(state.configuration).toHaveBeenCalledWith(
      { executablePath: "identified-codex.exe" },
      expect.any(String),
      expect.any(Object),
    );
    expect(state.spawn.mock.calls[0][0]).toBe("identified-codex.exe");
    for (const pass of [1, 2]) {
      state.spawn.mockClear();
      state.assertIdentity.mockReset();
      for (let index = 1; index < pass; index++)
        state.assertIdentity.mockImplementationOnce(() => undefined);
      state.assertIdentity.mockImplementationOnce(() => {
        throw Error(
          "Mobile Codex executable identity is unsupported or changed.",
        );
      });
      await expect(
        startCodexProcess(
          { executablePath: "synthetic-codex" },
          { prompt: "Continue", mode: "analysis" },
          () => undefined,
          { mobileInspection: true },
        ),
      ).rejects.toThrow("identity");
      expect(state.spawn).not.toHaveBeenCalled();
    }
  });

  it("preserves the effective implicit model and refuses unsupported configuration before staging inputs or dispatch", async () => {
    processFor([
      '{"type":"thread.started","thread_id":"original-thread-id"}\n',
    ]);
    const started = await startCodexProcess(
      { executablePath: "synthetic-codex" },
      { prompt: "Continue", sessionId: "original-thread-id", mode: "analysis" },
      () => undefined,
      { mobileInspection: true },
    );
    await started.completion;
    expect(state.configuration).toHaveBeenCalledWith(
      { executablePath: "synthetic-codex" },
      expect.any(String),
      expect.any(Object),
    );
    expect(state.spawn.mock.calls[0][1]).toContain("original-model");
    const staged = readdirSync(state.root);
    state.spawn.mockClear();
    state.configuration.mockRejectedValue(
      new Error("Unsupported mobile configuration"),
    );
    await expect(
      startCodexProcess(
        { executablePath: "synthetic-codex" },
        { prompt: "Continue", mode: "analysis" },
        () => undefined,
        { mobileInspection: true },
      ),
    ).rejects.toThrow("Unsupported mobile configuration");
    expect(state.spawn).not.toHaveBeenCalled();
    expect(readdirSync(state.root)).toEqual(staged);
  });

  // @lat: [[mobile-data#Mobile data#Codex mobile inspection mode rejection]]
  it("rejects writing modes before spawning or creating an input staging directory", async () => {
    for (const mode of ["safe_write", "full_access", "implementation"] as const)
      await expect(
        startCodexProcess(
          { executablePath: "synthetic-codex" },
          { prompt: "Write", mode },
          () => undefined,
          { mobileInspection: true },
        ),
      ).rejects.toThrow("analysis mode");
    expect(state.spawn).not.toHaveBeenCalled();
    expect(readdirSync(state.root)).toEqual([]);
  });
  // @lat: [[mobile-data#Mobile data#Codex long output session identity]]
  it("retains a chunked original thread id after the output tail window has discarded thread.started", async () => {
    processFor([
      '{"type":"thread.started","thread_',
      'id":"original-thread-id"}\n',
      "x".repeat(600_000),
    ]);
    const process = await startCodexProcess(
      { executablePath: "synthetic-codex" },
      { prompt: "Continue", sessionId: "original-thread-id", mode: "analysis" },
      () => undefined,
    );
    const result = await process.completion;
    expect(result.error).toBeUndefined();
    expect(result.sessionId).toBe("original-thread-id");
    expect(result.output).not.toContain("thread.started");
    expect(result.output.length).toBeLessThanOrEqual(512 * 1024);
    expect(state.configuration).not.toHaveBeenCalled();
    expect(state.identity).not.toHaveBeenCalled();
    expect(state.spawn.mock.calls[0][1].slice(-5)).toEqual([
      "resume",
      "--json",
      "--",
      "original-thread-id",
      "Continue",
    ]);
    expect(state.spawn.mock.calls[0][2]).toMatchObject({
      shell: false,
      windowsHide: true,
    });
  });

  // @lat: [[mobile-data#Mobile data#Codex mismatched continuation identity]]
  it("fails when the provider reports a different resumed thread and does not retry as a new conversation", async () => {
    processFor(['{"type":"thread.started","thread_id":"different-thread"}\n']);
    const process = await startCodexProcess(
      { executablePath: "synthetic-codex" },
      { prompt: "Continue", sessionId: "original-thread-id", mode: "analysis" },
      () => undefined,
    );
    const result = await process.completion;
    expect(result.error).toMatch(/different.*session/i);
    expect(result.sessionId).toBeUndefined();
    expect(state.spawn).toHaveBeenCalledTimes(1);
  });

  // @lat: [[mobile-data#Mobile data#Codex session evidence source]]
  it("does not accept a session id from stderr and preserves an explicit continuation after an ID-free successful event stream", async () => {
    processFor(
      ['{"type":"turn.completed","usage":{}}\n'],
      '{"thread_id":"untrusted-stderr"}\n',
    );
    const process = await startCodexProcess(
      { executablePath: "synthetic-codex" },
      { prompt: "Continue", sessionId: "original-thread-id", mode: "analysis" },
      () => undefined,
    );
    expect(await process.completion).toMatchObject({
      sessionId: "original-thread-id",
    });
  });
});
