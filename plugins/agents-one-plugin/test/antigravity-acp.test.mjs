import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createAntigravityAcpAdapter } from "../src/adapters/antigravity-acp.mjs";

const nativeSession = "agy-fixture-session";
const server = String.raw`
const { createInterface } = require("node:readline");
const args = process.argv.slice(1);
if (args.includes("--version")) { process.stdout.write("antigravity-fixture 1.5.18\n"); process.exit(0); }
if (!args.includes("acp")) process.exit(3);
if (!process.env.SSH_CONNECTION) process.exit(5);
const send = (v) => process.stdout.write(JSON.stringify(v) + "\n");
const respond = (id, result) => send({ jsonrpc: "2.0", id, result });
let pendingPromptId;
createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") {
    respond(m.id, { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } }, agentInfo: { name: "Antigravity ACP Server", version: "fixture" } });
    return;
  }
  if (m.method === "session/new" || m.method === "session/resume") {
    if (args.includes("--auth-fail")) {
      send({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message: "sign in required" } });
      return;
    }
    respond(m.id, { sessionId: "agy-fixture-session" });
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "agy-fixture-session", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "思考完成" } } } });
    return;
  }
  if (m.method === "session/cancel") {
    if (pendingPromptId !== undefined) {
      respond(pendingPromptId, { stopReason: "aborted" });
      pendingPromptId = undefined;
    }
    return;
  }
  if (m.method === "session/prompt") {
    if (m.params.sessionId !== "agy-fixture-session") process.exit(6);
    pendingPromptId = m.id;
    if (args.includes("--hang")) return;
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "agy-fixture-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "你好" } } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "agy-fixture-session", update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "ls", kind: "read", rawInput: { path: "." } } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "agy-fixture-session", update: { sessionUpdate: "tool_call_update", toolCallId: "t1", title: "ls", status: "completed", kind: "read", content: [{ type: "text", text: "ok" }] } } });
    respond(m.id, { stopReason: "end_turn", usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } });
    return;
  }
});
`;

function fixture(extraArgs = []) {
  const base = mkdtempSync(join(tmpdir(), "agents-one-antigravity-acp-"));
  const workspaceRoot = join(base, "workspace");
  const geminiHome = join(base, "gemini-home");
  mkdirSync(workspaceRoot);
  mkdirSync(geminiHome);
  const adapter = createAntigravityAcpAdapter({
    executablePath: process.execPath,
    executableArgs: [
      "-e",
      server,
      "--",
      ...extraArgs,
      "--gemini-home",
      geminiHome,
    ],
    workspaceRoot,
    geminiHome,
  });
  const events = [];
  return {
    workspaceRoot,
    geminiHome,
    adapter,
    events,
    start(text, mode = "analysis", sessionId) {
      return adapter.startRun(
        { input: { text }, sessionId, execution: { permissionMode: mode } },
        { emit: (event) => events.push(event) },
      );
    },
  };
}

async function waitFor(adapter, id, check) {
  for (let n = 0; n < 200; n++) {
    const state = await adapter.getRun(id);
    if (check(state)) return state;
    await delay(10);
  }
  assert.fail("Antigravity run did not reach the expected state");
}

test("Antigravity probe verifies the native CLI", async () => {
  const { adapter } = fixture();
  const probe = await adapter.probe();
  assert.equal(probe.healthy, true);
  assert.equal(probe.manifest.adapterId, "antigravity-acp");
  assert.equal(probe.runtimeVersion, "fixture");
});

test("Antigravity streams reasoning, tools and usage across resumed sessions", async () => {
  const { adapter, events, start } = fixture();
  const initial = await start("first");
  const first = await waitFor(
    adapter,
    initial.vendorRunId,
    (state) => state.status !== "running",
  );
  assert.equal(first.status, "succeeded", first.error);
  assert.equal(first.sessionId, nativeSession);
  assert.equal(first.output, "你好");
  assert.deepEqual(first.usage, {
    inputTokens: 11,
    outputTokens: 7,
    totalTokens: 18,
  });
  assert.deepEqual(
    events.map((x) => x.type),
    [
      "reasoning.summary",
      "assistant.delta",
      "tool.started",
      "tool.completed",
      "assistant.completed",
    ],
  );
  const toolCompleted = events.find((x) => x.type === "tool.completed");
  assert.equal(toolCompleted.data.tool.callId, "t1");
  assert.equal(toolCompleted.data.tool.name, "ls");
  assert.equal(toolCompleted.data.tool.outputSummary, "ok");

  const resumed = await start("second", "analysis", first.sessionId);
  const second = await waitFor(
    adapter,
    resumed.vendorRunId,
    (state) => state.status !== "running",
  );
  assert.equal(second.status, "succeeded", second.error);
  assert.equal(second.sessionId, nativeSession);
});

test("Antigravity surfaces sign-in required errors from the ACP server", async () => {
  const { adapter, start } = fixture(["--auth-fail"]);
  const denied = await start("first");
  const outcome = await waitFor(
    adapter,
    denied.vendorRunId,
    (state) => state.status !== "running",
  );
  assert.equal(outcome.status, "failed");
  assert.match(outcome.error, /sign in required/);
});

test("Antigravity cancels a pending turn through session/cancel", async () => {
  const { adapter, start } = fixture(["--hang"]);
  const pending = await start("pending");
  await waitFor(adapter, pending.vendorRunId, (state) =>
    Boolean(state.sessionId),
  );
  assert.equal(await adapter.cancelRun(pending.vendorRunId), true);
  assert.equal(
    (
      await waitFor(
        adapter,
        pending.vendorRunId,
        (state) => state.status !== "running",
      )
    ).status,
    "cancelled",
  );
});
