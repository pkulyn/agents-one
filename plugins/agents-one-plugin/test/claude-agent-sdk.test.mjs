import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createClaudeAgentSdkAdapter } from "../src/adapters/claude-agent-sdk.mjs";

const session = "claude-native-session";
function fixture(hooksApplied = true, beforeClose) {
  const workspace = mkdtempSync(join(tmpdir(), "agents-one-sdk-host-"));
  mkdirSync(join(workspace, "project"));
  const root = join(workspace, "project");
  const outside = join(workspace, "outside.txt");
  writeFileSync(outside, "untouched");
  const captured = [];
  const events = [];
  const artifacts = [];
  const adapter = createClaudeAgentSdkAdapter({
    workspaceRoot: root,
    query({ prompt, options }) {
      captured.push(options);
      const init = {
        type: "system",
        subtype: "init",
        session_id: session,
        model: "fixture-model",
        cwd: root,
      };
      const iterator = (async function* () {
        const message = await prompt.next();
        if (message.done) return;
        const text = message.value.message.content;
        yield init;
        const pre = options.hooks.PreToolUse[0].hooks[0];
        const post = options.hooks.PostToolUse[0].hooks[0];
        const ask = (tool_name, tool_input, id) =>
          pre({ session_id: session, tool_name, tool_input }, id);
        const deniedRead = await ask("Read", { file_path: outside }, "outside");
        assert.equal(deniedRead.hookSpecificOutput.permissionDecision, "deny");
        const shell = await ask("Bash", { command: "echo fixture" }, "shell");
        assert.equal(shell.hookSpecificOutput.permissionDecision, "deny");
        if (text === "pending") {
          await new Promise((resolve) => {
            if (options.abortController.signal.aborted) resolve();
            else
              options.abortController.signal.addEventListener(
                "abort",
                resolve,
                { once: true },
              );
          });
          return;
        }
        const file = join(root, "result.txt");
        const write = await ask("Write", { file_path: file }, "write-1");
        if (text === "write") {
          assert.deepEqual(write, {});
          writeFileSync(file, "project fixture");
          await post({ session_id: session, tool_name: "Write" }, "write-1");
          yield {
            type: "stream_event",
            session_id: session,
            event: {
              type: "content_block_delta",
              delta: { type: "thinking_delta", thinking: "准备写入" },
            },
          };
          yield {
            type: "assistant",
            session_id: session,
            message: {
              content: [{ type: "tool_use", id: "write-1", name: "Write" }],
            },
          };
          yield {
            type: "user",
            session_id: session,
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "write-1",
                  content: "written ok",
                  is_error: false,
                },
              ],
            },
          };
        } else {
          assert.equal(write.hookSpecificOutput.permissionDecision, "deny");
        }
        yield {
          type: "stream_event",
          session_id: session,
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "预览" },
          },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: session,
          result: text,
          usage: { input_tokens: 11, output_tokens: 7 },
        };
      })();
      iterator.initializationResult = async () => ({
        hooks_applied: hooksApplied,
      });
      iterator.close = async () => {
        await beforeClose?.();
        return iterator.return();
      };
      return iterator;
    },
  });
  return {
    adapter,
    captured,
    events,
    artifacts,
    outside,
    start(prompt, mode = "analysis", previous) {
      return adapter.startRun(
        {
          input: { text: prompt },
          sessionId: previous,
          execution: { permissionMode: mode },
        },
        {
          emit: (event) => events.push(event),
          publishArtifact: (item) => artifacts.push(item),
        },
      );
    },
  };
}

async function waitFor(adapter, id, check) {
  for (let n = 0; n < 100; n++) {
    const state = await adapter.getRun(id);
    if (check(state)) return state;
    await delay(10);
  }
  assert.fail("Claude run did not reach the expected state");
}

test("Claude keeps native session identity and read-only tool authority", async () => {
  const { adapter, captured, events, artifacts, start } = fixture();
  const initial = await start("read");
  const first = await waitFor(
    adapter,
    initial.vendorRunId,
    (state) => state.status !== "running",
  );
  assert.equal(first.status, "succeeded", first.error);
  assert.equal(first.sessionId, session);
  assert.equal(first.output, "read");
  assert.deepEqual(captured[0].tools, ["Read", "Glob", "Grep"]);
  assert.deepEqual(captured[0].settingSources, []);
  assert.deepEqual(
    events.map((x) => x.type),
    ["assistant.delta", "assistant.completed"],
  );
  assert.equal(artifacts.length, 0);
  const continuation = await start("resume", "analysis", first.sessionId);
  const result = await waitFor(
    adapter,
    continuation.vendorRunId,
    (state) => state.status !== "running",
  );
  assert.equal(result.status, "succeeded", result.error);
  assert.equal(captured[1].resume, session);
});

test("Claude publishes confirmed workspace writes and can cancel an SDK run", async () => {
  const { adapter, artifacts, events, start, outside } = fixture();
  const pending = await start("write", "safe_write");
  const completed = await waitFor(
    adapter,
    pending.vendorRunId,
    (state) => state.status !== "running",
  );
  assert.equal(completed.status, "succeeded", completed.error);
  assert.equal(readFileSync(outside, "utf8"), "untouched");
  assert.deepEqual(
    artifacts.map((item) => [item.name, item.bytes.toString()]),
    [["result.txt", "project fixture"]],
  );
  // The remote trace must present Claude reasoning, tool execution and usage
  // exactly like the OpenCode pilot does, so every runtime feels the same.
  assert.deepEqual(
    events.map((x) => x.type),
    [
      "reasoning.summary",
      "tool.started",
      "tool.completed",
      "assistant.delta",
      "assistant.completed",
    ],
  );
  const toolCompleted = events.find((x) => x.type === "tool.completed");
  assert.equal(toolCompleted.data.tool.callId, "write-1");
  assert.equal(toolCompleted.data.tool.name, "Write");
  assert.equal(toolCompleted.data.tool.outputSummary, "written ok");
  const message = events.find((x) => x.type === "assistant.completed");
  assert.deepEqual(message.data.usage, {
    inputTokens: 11,
    outputTokens: 7,
    totalTokens: 18,
  });

  const waiting = await start("pending");
  await waitFor(
    adapter,
    waiting.vendorRunId,
    (state) => state.sessionId === session,
  );
  assert.equal(await adapter.cancelRun(waiting.vendorRunId), true);
  assert.equal(
    (
      await waitFor(
        adapter,
        waiting.vendorRunId,
        (run) => run.status !== "running",
      )
    ).status,
    "cancelled",
  );
});

// @lat: [[remote-cli-host#Remote CLI Host#Claude Agent SDK protocol pilot#Cancellation acknowledgement does not wait for SDK cleanup]]
test("Claude acknowledges cancellation while SDK query cleanup is still pending", async () => {
  let releaseCleanup;
  let markCleanupStarted;
  const cleanupStarted = new Promise((resolve) => {
    markCleanupStarted = resolve;
  });
  const cleanup = new Promise((resolve) => {
    releaseCleanup = resolve;
  });
  const { adapter, start } = fixture(true, async () => {
    markCleanupStarted();
    await cleanup;
  });
  const waiting = await start("pending");
  await waitFor(
    adapter,
    waiting.vendorRunId,
    (run) => run.sessionId === session,
  );
  const cancel = adapter.cancelRun(waiting.vendorRunId);
  try {
    await cleanupStarted;
    const accepted = await Promise.race([
      cancel.then((value) => ({ settled: true, value })),
      delay(100).then(() => ({ settled: false })),
    ]);
    assert.deepEqual(accepted, { settled: true, value: true });
  } finally {
    releaseCleanup();
  }
  const final = await waitFor(
    adapter,
    waiting.vendorRunId,
    (run) => run.status !== "running",
  );
  assert.equal(final.status, "cancelled");
});

test("Claude verifies hook registration during probe and stops before sending a prompt without it", async () => {
  assert.equal((await fixture().adapter.probe()).healthy, true);
  const { adapter, start, artifacts, events } = fixture(false);
  assert.equal((await adapter.probe()).healthy, false);
  const started = await start("write", "safe_write");
  const state = await waitFor(
    adapter,
    started.vendorRunId,
    (run) => run.status !== "running",
  );
  assert.match(state.error, /did not confirm Host tool-policy registration/);
  assert.equal(artifacts.length, 0);
  assert.equal(events.length, 0);
});
