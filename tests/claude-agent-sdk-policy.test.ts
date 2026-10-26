import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  checks: 0,
  refused: false,
  allowed: true,
  initFails: false,
  eof: false,
  queries: [] as Array<{
    options: Record<string, unknown>;
    close: ReturnType<typeof vi.fn>;
    push: (x: unknown) => void;
  }>,
  environment: "one",
  modelSelections: [] as Array<string | undefined>,
  modelFails: false,
  holdTurn: false,
  compactCount: 0,
  prompts: [] as string[],
}));
vi.mock("../src/main/claude-code-runtime", () => ({
  claudeCodeInvocation: (s: string) => ({ command: s, prefix: [] }),
  configuredExecutable: () => "owned-cli",
}));
vi.mock("../src/main/utils", () => ({
  agentsOneProfileHome: () => "C:/owned-profile",
}));
vi.mock("../src/main/claude-config-policy", () => ({
  assertClaudeNonExecutingUserConfig: () => {
    state.checks++;
    if (state.refused) throw Error("owned config refused");
    return { ANTHROPIC_API_KEY: state.environment };
  },
}));
vi.mock("../src/main/claude-capabilities", () => ({
  verifyClaudeStrictCapabilities: async () => ({
    invocation: { command: "owned-cli", prefix: [] },
    assertUnchanged: () => {
      if (!state.allowed) throw Error("cancelled");
    },
  }),
}));
vi.mock("../src/main/claude-query-context", () => ({
  prepareClaudeQueryEnvironment: async (env: Record<string, string>) => env,
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({
    prompt,
    options,
  }: {
    prompt: AsyncIterable<unknown>;
    options: Record<string, unknown>;
  }) => {
    const items: unknown[] = [];
    let wake: ((v: IteratorResult<unknown>) => void) | undefined;
    let ended = false;
    const push = (value: unknown): void => {
      if (wake) {
        const fn = wake;
        wake = undefined;
        fn({ value, done: false });
      } else items.push(value);
    };
    const close = vi.fn(() => {
      ended = true;
      wake?.({ value: undefined, done: true });
      wake = undefined;
    });
    const active = {
      close,
      initializationResult: async () => {
        if (state.initFails) throw Error("owned init failed");
        return {};
      },
      supportedModels: async () => [{ value: "owned-model" }],
      supportedCommands: async () => [],
      setModel: vi.fn(async (model?: string) => {
        state.modelSelections.push(model);
        if (state.modelFails) throw Error("owned model failure");
      }),
      interrupt: vi.fn(async () => {
        close();
      }),
      async *[Symbol.asyncIterator](): AsyncGenerator<unknown, void, unknown> {
        while (!ended) {
          if (items.length) yield items.shift();
          else {
            const next = await new Promise<IteratorResult<unknown>>(
              (r) => (wake = r),
            );
            if (next.done) return;
            yield next.value;
          }
        }
      },
    };
    state.queries.push({ options, close, push });
    void (async () => {
      for await (const _message of prompt) {
        const serialized = JSON.stringify(_message);
        state.prompts.push(serialized);
        if (state.holdTurn) continue;
        if (serialized.includes("/compact")) {
          state.compactCount++;
          push({
            type: "system",
            subtype: "compact_boundary",
            session_id: "owned-session",
            compact_metadata: {
              trigger: "manual",
              pre_tokens: state.compactCount,
              post_tokens: 1,
            },
          });
        }
        if (state.eof) {
          close();
          break;
        }
        push({
          type: "assistant",
          session_id: "owned-session",
          message: { content: [{ type: "text", text: "owned answer" }] },
        });
        push({
          type: "result",
          subtype: "success",
          session_id: "owned-session",
          result: "owned answer",
        });
      }
    })();
    return active;
  },
}));
import {
  closeClaudeAgentSdkSessions,
  listClaudeAgentSdkModels,
  startClaudeAgentSdkProcess,
  executeClaudeAgentSdkCommand,
  setClaudeAgentSdkModel,
  compactClaudeAgentSdkSession,
} from "../src/main/claude-agent-sdk";
const config = {
  workspace: "C:/owned-workspace",
  profile: "owned-profile",
  runtimeId: "owned-runtime",
  executablePath: "owned-cli",
};
beforeEach(() => {
  state.checks = 0;
  state.refused = false;
  state.allowed = true;
  state.initFails = false;
  state.eof = false;
  state.environment = "one";
  state.modelSelections = [];
  state.modelFails = false;
  state.holdTurn = false;
  state.compactCount = 0;
  state.prompts = [];
  state.queries = [];
});
afterEach(async () => {
  await closeClaudeAgentSdkSessions();
  for (const q of state.queries) q.close();
  vi.unstubAllEnvs();
});
it.each(["turn", "metadata"])(
  "checks non-executing startup before SDK %s query",
  async (kind) => {
    state.refused = true;
    await expect(
      kind === "turn"
        ? startClaudeAgentSdkProcess(config, { prompt: "owned" }, () => {})
        : listClaudeAgentSdkModels(config),
    ).rejects.toThrow("owned config refused");
    expect(state.queries).toHaveLength(0);
  },
);
it("passes strict native policy and projected credentials to the actual query constructor", async () => {
  await listClaudeAgentSdkModels(config);
  const options = state.queries[0].options;
  expect(options).toMatchObject({
    cwd: resolve(config.workspace),
    permissionMode: "plan",
    tools: ["Read", "Glob", "Grep"],
    strictMcpConfig: true,
    settingSources: [],
    extraArgs: {
      restricted: null,
      "safe-mode": null,
      "permission-prompts": "none",
      "mcp-config": JSON.stringify({ mcpServers: {} }),
    },
    env: { ANTHROPIC_API_KEY: "one", USE_BUILTIN_RIPGREP: "1" },
  });
  expect(options.spawnClaudeCodeProcess).toBeTypeOf("function");
});
it("revalidates configuration on persistent reuse without changing the native session", async () => {
  const first = await startClaudeAgentSdkProcess(
    config,
    { prompt: "first" },
    () => {},
  );
  await first.completion;
  const next = await startClaudeAgentSdkProcess(
    config,
    { prompt: "next", sessionId: "owned-session" },
    () => {},
  );
  await next.completion;
  expect(state.queries).toHaveLength(1);
  expect(state.checks).toBe(2);
  state.refused = true;
  await expect(
    startClaudeAgentSdkProcess(
      config,
      { prompt: "blocked", sessionId: "owned-session" },
      () => {},
    ),
  ).rejects.toThrow("owned config refused");
});
it("does not reuse another project or profile Query with the same provider session id", async () => {
  const first = await startClaudeAgentSdkProcess(
    config,
    { prompt: "first" },
    () => {},
  );
  await first.completion;
  const next = await startClaudeAgentSdkProcess(
    { ...config, profile: "another-profile", workspace: "C:/another-project" },
    { prompt: "next", sessionId: "owned-session" },
    () => {},
  );
  await next.completion;
  expect(state.queries).toHaveLength(2);
});
it("refreshes an idle Query when trusted credentials change", async () => {
  const first = await startClaudeAgentSdkProcess(
    config,
    { prompt: "first" },
    () => {},
  );
  await first.completion;
  state.environment = "two";
  const next = await startClaudeAgentSdkProcess(
    config,
    { prompt: "next", sessionId: "owned-session" },
    () => {},
  );
  await next.completion;
  expect(state.queries).toHaveLength(2);
  expect(state.queries[0].close).toHaveBeenCalledOnce();
});
it("closes an initialization failure before returning the error", async () => {
  state.initFails = true;
  await expect(
    startClaudeAgentSdkProcess(config, { prompt: "owned" }, () => {}),
  ).rejects.toThrow("owned init failed");
  expect(state.queries[0].close).toHaveBeenCalledOnce();
});
it("settles a turn when its stream ends before a result", async () => {
  state.eof = true;
  const started = await startClaudeAgentSdkProcess(
    config,
    { prompt: "owned" },
    () => {},
  );
  await expect(started.completion).resolves.toMatchObject({
    error: expect.stringContaining("closed"),
  });
});
it("honors cancellation before query creation", async () => {
  await expect(
    startClaudeAgentSdkProcess(
      config,
      { prompt: "owned" },
      () => {},
      () => false,
    ),
  ).rejects.toThrow("cancelled");
  expect(state.queries).toHaveLength(0);
});

it("requires current full authority for arbitrary native commands before query construction", async () => {
  await expect(
    executeClaudeAgentSdkCommand(config, "owned-session", "owned-command"),
  ).rejects.toThrow("权限不足");
  expect(state.queries).toHaveLength(0);
});
it("rechecks current authority at the actual SDK spawn boundary", async () => {
  let valid = true;
  await listClaudeAgentSdkModels({
    ...config,
    assertCurrent: () => {
      if (!valid) throw Error("owned authority changed");
    },
  });
  valid = false;
  const launch = state.queries[0].options.spawnClaudeCodeProcess as (
    x: unknown,
  ) => unknown;
  expect(() =>
    launch({
      command: "owned-cli",
      args: [],
      cwd: resolve(config.workspace),
      env: {},
    }),
  ).toThrow("owned authority changed");
});
it("recovers with a fresh Query after an earlier stream ended", async () => {
  state.eof = true;
  const first = await startClaudeAgentSdkProcess(
    config,
    { prompt: "first", sessionId: "owned-session" },
    () => {},
  );
  expect((await first.completion).error).toContain("closed");
  state.eof = false;
  const next = await startClaudeAgentSdkProcess(
    config,
    { prompt: "next", sessionId: "owned-session" },
    () => {},
  );
  expect((await next.completion).output).toBe("owned answer");
  expect(state.queries).toHaveLength(2);
});

it("applies a current task model change within the same live Query", async () => {
  const first = await startClaudeAgentSdkProcess(
    config,
    { prompt: "first", model: "owned-one" },
    () => {},
  );
  await first.completion;
  expect(state.queries[0].options.model).toBe("owned-one");
  const next = await startClaudeAgentSdkProcess(
    config,
    { prompt: "next", sessionId: "owned-session", model: "owned-two" },
    () => {},
  );
  await next.completion;
  expect(state.queries).toHaveLength(1);
  expect(state.modelSelections).toEqual(["owned-two"]);
});
it("closes a failed live control and can resume its original provider session", async () => {
  const first = await startClaudeAgentSdkProcess(
    config,
    { prompt: "first" },
    () => {},
  );
  await first.completion;
  state.modelFails = true;
  await expect(
    setClaudeAgentSdkModel(config, "owned-session", "owned-bad"),
  ).rejects.toThrow("owned model failure");
  expect(state.queries[0].close).toHaveBeenCalledOnce();
  state.modelFails = false;
  const next = await startClaudeAgentSdkProcess(
    config,
    { prompt: "next", sessionId: "owned-session" },
    () => {},
  );
  expect((await next.completion).output).toBe("owned answer");
  expect(state.queries).toHaveLength(2);
});

it("does not enqueue a second concurrent turn on an already running Query", async () => {
  state.holdTurn = true;
  const first = await startClaudeAgentSdkProcess(
    config,
    { prompt: "first", sessionId: "owned-session" },
    () => {},
  );
  await vi.waitFor(() => expect(state.prompts).toHaveLength(1));
  const next = await startClaudeAgentSdkProcess(
    config,
    { prompt: "second", sessionId: "owned-session" },
    () => {},
  );
  expect((await next.completion).error).toContain("already running");
  expect(state.prompts).toHaveLength(1);
  expect(state.queries).toHaveLength(1);
  await first.cancel();
  await first.completion;
});
it("waits for the new compact boundary and result on each compact operation", async () => {
  const first = await startClaudeAgentSdkProcess(
    config,
    { prompt: "first" },
    () => {},
  );
  await first.completion;
  const a = await compactClaudeAgentSdkSession(config, "owned-session", "one");
  const b = await compactClaudeAgentSdkSession(config, "owned-session", "two");
  expect(a.tokensBefore).toBe(1);
  expect(b.tokensBefore).toBe(2);
  expect(state.queries).toHaveLength(1);
});
