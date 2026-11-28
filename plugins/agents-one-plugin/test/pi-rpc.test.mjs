import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createPiRpcAdapter } from "../src/adapters/pi-rpc.mjs";
import { resolvePiToolPath } from "../src/adapters/pi-workspace-policy.mjs";

const nativeSession = "pi-native-fixture-id";
const server = String.raw`
const { createInterface } = require("node:readline");
const { writeFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(1);
const value = name => args[args.indexOf(name) + 1];
const send = frame => process.stdout.write(JSON.stringify(frame) + "\n");
const response = (req, data) => send({ id: req.id, type: "response", command: req.type, success: true, data });
const sessionId = "pi-native-fixture-id";
const resume = args.includes("--session");
if (!args.includes("--no-extensions") || !value("--extension").includes("pi-workspace-policy")) throw Error("missing policy");
if (resume && !existsSync(value("--session"))) throw Error("missing native session file");
createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", line => {
  const request = JSON.parse(line);
  if (typeof request.id !== "string") throw Error("Pi request id must be string");
  switch (request.type) {
    case "get_commands":
      response(request, { commands: args.includes("missing-policy") ? [] : [
        { name: "agents-one-host-policy", source: "extension" },
      ] });
      break;
    case "get_state":
      response(request, { sessionId, model: { id: "fixture-model", provider: "fixture" } });
      break;
    case "prompt": {
      response(request, {});
      const output = request.message === "pending" ? "waiting" : resume ? "续聊" : "你好";
      send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: output } });
      if (request.message === "pending") break;
      if (request.message === "write") {
        if (value("--tools").includes("bash") || !value("--tools").includes("write")) throw Error("incorrect write authority");
        const args = { path: "output.txt" };
        send({ type: "tool_execution_start", toolCallId: "writer", toolName: "write", args });
        writeFileSync(args.path, "fixture artifact");
        send({ type: "tool_execution_end", toolCallId: "writer", toolName: "write", isError: false });
      }
      writeFileSync(join(value("--session-dir"), "fixture_" + sessionId + ".jsonl"), "{}");
      send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "思考完成" } });
      send({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop", usage: { input: 5, output: 3, totalTokens: 8 } }] });
      break;
    }
    case "abort":
      response(request, {});
      break;
  }
});
`;

function fixture(missingPolicy = false) {
  const base = mkdtempSync(join(tmpdir(), "agents-one-pi-host-"));
  const workspaceRoot = join(base, "workspace");
  mkdirSync(workspaceRoot);
  const adapter = createPiRpcAdapter({
    executablePath: process.execPath,
    executableArgs: [
      "-e",
      server,
      "--",
      ...(missingPolicy ? ["missing-policy"] : []),
    ],
    workspaceRoot,
    sessionDirectory: join(base, "sessions"),
  });
  const events = [];
  const artifacts = [];
  return {
    workspaceRoot,
    adapter,
    events,
    artifacts,
    start(text, mode = "analysis", sessionId) {
      return adapter.startRun(
        { input: { text }, sessionId, execution: { permissionMode: mode } },
        {
          emit: (event) => events.push(event),
          publishArtifact: (artifact) => artifacts.push(artifact),
        },
      );
    },
  };
}

async function waitFor({ adapter }, id, predicate) {
  for (let n = 0; n < 200; n++) {
    const result = await adapter.getRun(id);
    if (predicate(result)) return result;
    await delay(10);
  }
  assert.fail("Pi did not reach the expected run state");
}

test("Pi RPC discovers its policy and continues the same workspace session", async () => {
  const f = fixture();
  assert.equal((await f.adapter.probe()).healthy, true);
  const started = await f.start("read");
  const first = await waitFor(
    f,
    started.vendorRunId,
    (x) => x.status !== "running",
  );
  assert.equal(first.status, "succeeded", first.error);
  assert.equal(first.sessionId, nativeSession);
  assert.equal(first.output, "你好");
  assert.equal(first.model.provider, "fixture");
  const resumed = await f.start("continue", "analysis", first.sessionId);
  const second = await waitFor(
    f,
    resumed.vendorRunId,
    (x) => x.status !== "running",
  );
  assert.equal(second.status, "succeeded", second.error);
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.output, "续聊");
  assert.equal(
    resolvePiToolPath(f.workspaceRoot, ["write"], "write", {
      path: "../other",
    }),
    undefined,
  );
  assert.equal(
    resolvePiToolPath(f.workspaceRoot, ["read"], "write", { path: "within" }),
    undefined,
  );
});

test("Pi gates prompting on its policy, publishes confirmed writes and cancels an active turn", async () => {
  const missing = fixture(true);
  const denied = await missing.start("write", "safe_write");
  const stopped = await waitFor(
    missing,
    denied.vendorRunId,
    (x) => x.status !== "running",
  );
  assert.match(stopped.error, /did not load the Host workspace policy/);
  assert.equal(missing.events.length, 0);

  const f = fixture();
  const started = await f.start("write", "safe_write");
  const ok = await waitFor(
    f,
    started.vendorRunId,
    (x) => x.status !== "running",
  );
  assert.equal(ok.status, "succeeded", ok.error);
  assert.deepEqual(
    f.artifacts.map((artifact) => [artifact.name, artifact.bytes.toString()]),
    [["output.txt", "fixture artifact"]],
  );
  // Pi must present reasoning, tool execution and usage exactly like the
  // OpenCode pilot does, so the desktop trace stays consistent per runtime.
  assert.deepEqual(
    f.events.map((x) => x.type),
    [
      "assistant.delta",
      "tool.started",
      "tool.completed",
      "reasoning.summary",
      "assistant.completed",
    ],
  );
  const toolStarted = f.events.find((x) => x.type === "tool.started");
  assert.equal(toolStarted.data.tool.inputSummary, '{"path":"output.txt"}');
  const reasoning = f.events.find((x) => x.type === "reasoning.summary");
  assert.equal(reasoning.data.reasoningSummary, "思考完成");
  const message = f.events.find((x) => x.type === "assistant.completed");
  assert.deepEqual(message.data.usage, {
    inputTokens: 5,
    outputTokens: 3,
    totalTokens: 8,
  });
  const pending = await f.start("pending");
  await waitFor(f, pending.vendorRunId, (x) => x.output === "waiting");
  assert.equal(await f.adapter.cancelRun(pending.vendorRunId), true);
  assert.equal(
    (await f.adapter.getRun(pending.vendorRunId)).status,
    "cancelled",
  );
});
