import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRemoteCliHost } from "../src/remote-cli-host.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { createCodexAppServerAdapter } from "../src/adapters/codex-app-server.mjs";

const appServer = String.raw`
const { createInterface } = require("node:readline");
const send = frame => process.stdout.write(JSON.stringify(frame) + "\n");
const result = (id, value) => send({ id, result: value });
const notify = (method, params) => send({ method, params });
const session = "fixture-codex-session";
const turn = "fixture-turn";
let resumed = false;
const assertSandboxPair = (params) => {
  const pair = params.sandbox + "/" + params.approvalPolicy;
  if (pair !== "read-only/never" && pair !== "workspace-write/on-request")
    throw Error("unexpected sandbox policy pair: " + pair);
  if (params.permissions || params.config || params.sandboxPolicy)
    throw Error("named permission profile should not be requested");
};
createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", line => {
  const { id, method, params } = JSON.parse(line);
  switch (method) {
    case "initialize":
      result(id, { userAgent: "codex/fixture" });
      break;
    case "thread/resume":
      if (params.threadId !== session) throw Error("session should be native");
      resumed = true;
      // Fall through to the shared sandbox assertions.
    case "thread/start":
      assertSandboxPair(params);
      result(id, { thread: { id: session, cwd: process.cwd() }, model: "fixture-model" });
      break;
    case "turn/start": {
      if (params.threadId !== session) throw Error("turn belongs to a different session");
      assertSandboxPair(params);
      if (params.input[0].text === "pending") {
        result(id, { turn: { id: turn } });
        notify("item/agentMessage/delta", { threadId: session, turnId: turn, delta: "native turn running" });
        break;
      }
      notify("item/agentMessage/delta", { threadId: "another-thread", turnId: turn, delta: "foreign" });
      const output = resumed ? "续聊成功" : "你好";
      const delta = Buffer.from(JSON.stringify({
        method: "item/agentMessage/delta",
        params: { threadId: session, turnId: turn, delta: output },
      }) + "\r\n");
      const cut = delta.indexOf(Buffer.from(output)) + 1;
      process.stdout.write(delta.subarray(0, cut));
      process.stdout.write(delta.subarray(cut));
      result(id, { turn: { id: turn } });
      notify("item/started", { threadId: session, turnId: turn, item: { type: "commandExecution", id: "tool-1" } });
      notify("item/completed", { threadId: session, turnId: turn, item: { type: "commandExecution", id: "tool-1", status: "completed" } });
      notify("turn/completed", { threadId: session, turn: { id: turn, status: "completed" } });
      break;
    }
    case "turn/interrupt":
      if (params.threadId !== session || params.turnId !== turn) throw Error("wrong interrupt scope");
      result(id, {});
      break;
  }
});
`;

function createFixture() {
  const workspaceRoot = mkdtempSync(
    join(tmpdir(), "agents-one-codex-app-server-"),
  );
  const adapter = createCodexAppServerAdapter({
    executablePath: process.execPath,
    appServerArgs: ["-e", appServer],
    workspaceRoot,
  });
  const events = [];
  const context = {
    emit(event) {
      events.push(event);
    },
  };
  const start = (text, options = {}) =>
    adapter.startRun({ input: { text }, ...options }, context);
  return { adapter, events, start };
}

async function waitFor(adapter, id, predicate) {
  const deadline = Date.now() + 5_000;
  let current;
  do {
    current = await adapter.getRun(id);
    if (predicate(current)) return current;
    await delay(10);
  } while (Date.now() < deadline);
  assert.fail(
    "Codex fixture did not reach expected state: " + JSON.stringify(current),
  );
}

test("Codex probes and resumes with the native sandbox policy pair", async () => {
  const { adapter, start } = createFixture();
  assert.equal((await adapter.probe()).healthy, true);
  const next = await start("first");
  const first = await waitFor(
    adapter,
    next.vendorRunId,
    (run) => run.status !== "running",
  );
  assert.equal(first.status, "succeeded");
  const started = await start("resume", { sessionId: first.sessionId });
  const resumed = await waitFor(
    adapter,
    started.vendorRunId,
    (run) => run.status !== "running",
  );
  assert.equal(resumed.status, "succeeded");
  assert.equal(resumed.sessionId, first.sessionId);
});

test("Codex Host initializes, keeps streaming scoped, and resumes the same native session", async () => {
  const { adapter, events, start } = createFixture();
  assert.equal((await adapter.probe()).healthy, true);

  const first = await start("first");
  const initial = await waitFor(
    adapter,
    first.vendorRunId,
    (run) => run.status !== "running",
  );
  assert.equal(initial.status, "succeeded", initial.error);
  assert.equal(initial.output, "你好");
  assert.equal(initial.sessionId, "fixture-codex-session");
  assert.equal(initial.model.id, "fixture-model");
  assert.deepEqual(
    events.map(({ type }) => type),
    [
      "assistant.delta",
      "tool.started",
      "tool.completed",
      "assistant.completed",
    ],
  );

  const second = await start("second", { sessionId: initial.sessionId });
  const resumed = await waitFor(
    adapter,
    second.vendorRunId,
    (run) => run.status !== "running",
  );
  assert.equal(resumed.status, "succeeded", resumed.error);
  assert.equal(resumed.output, "续聊成功");
  assert.equal(resumed.sessionId, initial.sessionId);
});

test("Codex protocol pilot rejects unsupported permissions and confirms cancellation", async () => {
  const { adapter, start } = createFixture();
  const denied = await start("write", {
    execution: { permissionMode: "safe_write" },
  });
  assert.match(
    (await adapter.getRun(denied.vendorRunId)).error,
    /only read-only/,
  );
  const wrongScope = await start("read", { workspace: ".." });
  assert.match(
    (await adapter.getRun(wrongScope.vendorRunId)).error,
    /outside the configured Host root/,
  );

  const running = await start("pending");
  const state = await waitFor(
    adapter,
    running.vendorRunId,
    (run) => run.output === "native turn running",
  );
  assert.equal(state.status, "running");
  assert.equal(await adapter.cancelRun(running.vendorRunId), true);
  assert.equal((await adapter.getRun(running.vendorRunId)).status, "cancelled");
});

test("Gateway exposes the selected Codex pilot capabilities", async (t) => {
  const { adapter } = createFixture();
  const host = createRemoteCliHost({
    token: "fixture-token",
    runtimes: [
      {
        runtimeId: "other-runtime",
        displayName: "Other",
        adapter: {
          async startRun() {
            return { status: "running" };
          },
        },
      },
      {
        runtimeId: "codex-pilot",
        displayName: "Codex",
        kind: "codex",
        adapter,
      },
    ],
  });
  await host.listen(0);
  t.after(() => host.close());
  const response = await fetch(
    "http://127.0.0.1:" + host.server.address().port + "/capabilities",
    {
      headers: {
        authorization: "Bearer fixture-token",
        "x-agents-one-runtime-id": "codex-pilot",
      },
    },
  );
  assert.equal(response.status, 200);
  const { capabilities } = await response.json();
  assert.deepEqual(capabilities.permissions.modes, ["analysis"]);
  assert.equal(capabilities.permissions.interactive, false);
  assert.equal(capabilities.permissions.deletionConfirmation, false);
  assert.equal(capabilities.artifacts.download, false);
  assert.equal(capabilities.artifacts.upload, false);
  assert.equal(capabilities.tasks.cancel, true);
  assert.equal(capabilities.eventStream.toolEvents, true);
});

const writeAppServer = String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const result = (id, value) => send({ id, result: value });
const threadId = "write-session";
const turnId = "write-turn";
const notify = (method, params) => send({ method, params: { threadId, turnId, ...params } });
let item;
let text;
readline.createInterface({ input: process.stdin }).on("line", line => {
  const frame = JSON.parse(line);
  if (frame.method === "initialize") result(frame.id, {});
  if (frame.method === "thread/start") {
    if (frame.params.sandbox !== "workspace-write" || frame.params.approvalPolicy !== "on-request")
      throw Error("missing workspace-write policy pair");
    result(frame.id, { thread: { id: threadId, cwd: process.cwd() } });
  }
  if (frame.method === "turn/start") {
    if (frame.params.sandbox !== "workspace-write" || frame.params.approvalPolicy !== "on-request")
      throw Error("turn sent without the workspace-write policy pair");
    text = frame.params.input[0].text;
    const path = text === "write" ? "output.txt" : text === "outside" ? "../outside.txt" : "sentinel.txt";
    item = { id: "patch", type: "fileChange", changes: [
      { path, kind: { type: text.startsWith("remove") ? "delete" : "add" } },
    ], status: "inProgress" };
    notify("item/started", { item });
    send({ id: "approval", method: "item/fileChange/requestApproval", params: {
      threadId, turnId, itemId: item.id,
    } });
    result(frame.id, { turn: { id: turnId } });
  }
  if (frame.id === "approval") {
    const accepted = frame.result.decision === "accept";
    if (accepted !== (text === "write" || text === "remove-allowed"))
      throw Error("unexpected approval decision");
    if (accepted && text === "write") fs.writeFileSync("output.txt", "authorized fixture");
    if (accepted && text === "remove-allowed") fs.unlinkSync("sentinel.txt");
    notify("item/completed", { item: { ...item, status: accepted ? "completed" : "declined" } });
    notify("turn/completed", { turn: { id: turnId, status: "completed" } });
  }
});
`;

test("Codex scoped writes use native one-time approval and return only confirmed output", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "agents-one-codex-patch-"));
  const check = join(workspaceRoot, "sentinel.txt");
  writeFileSync(check, "fixture");
  const adapter = createCodexAppServerAdapter({
    workspaceRoot,
    executablePath: process.execPath,
    appServerArgs: ["-e", writeAppServer],
    allowWorkspaceWrites: true,
  });
  assert.deepEqual(adapter.capabilities.permissions.modes, [
    "analysis",
    "safe_write",
  ]);
  const allowed = [];
  const artifacts = [];
  for (const operation of [
    "write",
    "outside",
    "remove-denied",
    "remove-allowed",
  ]) {
    const { vendorRunId } = await adapter.startRun(
      {
        input: { text: operation },
        execution: { permissionMode: "safe_write" },
      },
      {
        emit: () => undefined,
        authorizeTool(name, input) {
          allowed.push([operation, name, input.paths]);
          return operation === "write" || operation === "remove-allowed";
        },
        publishArtifact: (artifact) => artifacts.push(artifact),
      },
    );
    const result = await waitFor(
      adapter,
      vendorRunId,
      (run) => run.status !== "running",
    );
    assert.equal(result.status, "succeeded", result.error);
    assert.equal(existsSync(check), operation !== "remove-allowed");
  }
  assert.deepEqual(allowed, [
    ["write", "file_change", ["output.txt"]],
    ["remove-denied", "delete_file", ["sentinel.txt"]],
    ["remove-allowed", "delete_file", ["sentinel.txt"]],
  ]);
  assert.deepEqual(
    artifacts.map(({ name, bytes }) => [name, bytes.toString()]),
    [["output.txt", "authorized fixture"]],
  );
});
