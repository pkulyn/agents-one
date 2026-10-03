import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import {
  Agent as HttpAgent,
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EventJournal, eventStreamCapability } from "../src/event-stream.mjs";
import {
  createRemoteGatewayPlugin,
  readJsonBody,
} from "../src/remote-gateway-plugin.mjs";
import { createCliAdapter } from "../src/cli-adapter-plugin.mjs";
import { createAgentsOneArtifactTool } from "../examples/hermes-or-hers-adapter.mjs";
import { createRemoteCliHost } from "../src/remote-cli-host.mjs";
import { createOpenCodeAcpAdapter } from "../src/adapters/opencode-acp.mjs";

async function createPoolingReverseProxy(upstreamPort) {
  const agent = new HttpAgent({ keepAlive: true, maxSockets: 1 });
  const sockets = new Set();
  const server = createHttpServer((request, response) => {
    const headers = { ...request.headers };
    delete headers.host;
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: upstreamPort,
        method: request.method,
        path: request.url,
        headers,
        agent,
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, {
          ...upstreamResponse.headers,
        });
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("socket", (socket) => sockets.add(socket));
    upstream.on("error", (cause) => {
      response.writeHead(502, { "content-type": "text/plain" });
      response.end(cause instanceof Error ? cause.message : String(cause));
    });
    request.pipe(upstream);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    socketCount: () => sockets.size,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((cause) => (cause ? reject(cause) : resolve())),
      );
      agent.destroy();
    },
  };
}

test("event journal redacts local paths and deduplicates stable provider IDs", () => {
  const journal = new EventJournal({ runId: "run_test" });
  journal.append({
    id: "evt_1",
    type: "tool.completed",
    data: {
      tool: {
        name: "read",
        kind: "workspace",
        outputSummary: "Read D:\\private\\secret.txt",
      },
    },
  });
  journal.append({
    id: "evt_1",
    type: "tool.completed",
    data: { summary: "duplicate" },
  });
  assert.equal(journal.snapshot().length, 1);
  assert.match(journal.snapshot()[0].data.tool.outputSummary, /已脱敏/);
});

test("event journal keeps provider sequence monotonic after a restart or stale frame", () => {
  const journal = new EventJournal({ runId: "run_sequence" });
  journal.append({ id: "evt_10", type: "run.started", sequence: 10 });
  journal.append({ id: "evt_2", type: "run.status", sequence: 2 });
  journal.append({
    id: "evt_auto",
    type: "assistant.completed",
    data: { text: "ok" },
  });
  assert.deepEqual(
    journal.snapshot().map((event) => event.sequence),
    [10, 11, 12],
  );
});

test("event journal preserves safe artifact MIME and size metadata", () => {
  const journal = new EventJournal({ runId: "run_artifact" });
  journal.append({
    id: "evt_artifact",
    type: "artifact.created",
    data: {
      artifact: {
        id: "artifact_fixture",
        label: "connector-smoke.txt",
        mime: "text/plain",
        size: 5,
        sha256: "a".repeat(64),
      },
    },
  });
  assert.deepEqual(journal.snapshot()[0].data.artifact, {
    id: "artifact_fixture",
    label: "connector-smoke.txt",
    mime: "text/plain",
    size: 5,
    sha256: "a".repeat(64),
  });
});

test("event journal preserves safe workspace evidence and tool duration", () => {
  const journal = new EventJournal({ runId: "run_workspace" });
  journal.append({
    id: "evt_workspace",
    type: "workspace.completed",
    data: {
      operation: "list",
      path: ".",
      tool: {
        callId: "call_workspace_1",
        name: "workspace_gateway",
        kind: "workspace",
        duration: 42,
      },
    },
  });
  assert.deepEqual(journal.snapshot()[0].data, {
    operation: "list",
    path: ".",
    tool: {
      callId: "call_workspace_1",
      name: "workspace_gateway",
      kind: "workspace",
      duration: 42,
    },
  });

  journal.append({
    id: "evt_unsafe_workspace",
    type: "workspace.requested",
    data: { operation: "read", path: "D:\\private\\secret.txt" },
  });
  assert.equal(journal.snapshot()[1].data.path, undefined);
});

test("event stream capabilities reflect stable adapter declarations", () => {
  assert.deepEqual(eventStreamCapability("poll"), {
    protocol: "agents-one-event-stream-v1",
    transport: "poll",
  });
  assert.deepEqual(
    eventStreamCapability("poll", {
      reasoningSummaries: true,
      toolEvents: true,
      modelMetadata: false,
      usageMetadata: true,
    }),
    {
      protocol: "agents-one-event-stream-v1",
      transport: "poll",
      reasoningSummaries: true,
      toolEvents: true,
      usageMetadata: true,
    },
  );
});

test("JSON request reader accepts string and Buffer chunks", async () => {
  const request = Readable.from([
    '{"input":',
    Buffer.from('{"text":"hello"}}', "utf8"),
  ]);
  assert.deepEqual(await readJsonBody(request), {
    input: { text: "hello" },
  });
});

test("remote gateway plugin exposes a v1 run with event snapshots", async () => {
  let routedRuntimeId;
  const plugin = createRemoteGatewayPlugin({
    agent: { id: "fixture", kind: "custom", displayName: "Fixture" },
    token: "test-token",
    adapter: {
      capabilities: {
        eventStream: {
          reasoningSummaries: true,
          toolEvents: true,
        },
      },
      async startRun(_input, { emit, runtimeId }) {
        routedRuntimeId = runtimeId;
        emit({
          id: "evt_reasoning",
          type: "reasoning.summary",
          data: { reasoningSummary: "正在分析任务。" },
        });
        emit({
          id: "evt_answer",
          type: "assistant.completed",
          data: { text: "完成。" },
        });
        return { vendorRunId: "vendor_1", status: "succeeded" };
      },
    },
  });
  await plugin.listen(0);
  const port = plugin.server.address().port;
  const headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
  };
  const created = await fetch(`http://127.0.0.1:${port}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      runtimeId: "hers-home2",
      mode: "conversation",
      input: { runtimeId: "hers-home2", text: "hello" },
    }),
  });
  const run = await created.json();
  assert.equal(created.status, 202);
  assert.equal(routedRuntimeId, "hers-home2");
  assert.equal(run.events.length, 4);
  assert.equal(run.events.at(-1).type, "run.completed");
  const capability = await fetch(`http://127.0.0.1:${port}/capabilities`, {
    headers: { authorization: "Bearer test-token" },
  });
  const capabilityBody = await capability.json();
  assert.equal(
    capabilityBody.capabilities.eventStream.protocol,
    "agents-one-event-stream-v1",
  );
  assert.deepEqual(capabilityBody.plugin, {
    id: "agents-one-plugin-sdk",
    version: "0.1.5",
    kind: "remote-gateway",
  });
  assert.deepEqual(capabilityBody.capabilities.eventStream, {
    protocol: "agents-one-event-stream-v1",
    transport: "poll",
    reasoningSummaries: true,
    toolEvents: true,
  });
  await plugin.close();
});

test("remote gateway accepts three runs after SSE through a pooling reverse proxy", async () => {
  let starts = 0;
  const plugin = createRemoteGatewayPlugin({
    agent: { id: "fixture", kind: "custom" },
    token: "test-token",
    adapter: {
      async startRun(_input, { emit }) {
        starts += 1;
        emit({
          id: `evt_answer_${starts}`,
          type: "assistant.completed",
          data: { text: `answer ${starts}` },
        });
        return { status: "succeeded", vendorRunId: `vendor_${starts}` };
      },
    },
  });
  await plugin.listen(0);
  const port = plugin.server.address().port;
  const proxy = await createPoolingReverseProxy(port);
  const runBody = (text) =>
    JSON.stringify({ mode: "conversation", input: { text } });
  try {
    for (const connection of [undefined, "close"]) {
      const headers = {
        authorization: "Bearer test-token",
        "content-type": "application/json",
        ...(connection ? { connection } : {}),
      };
      const seedResponse = await fetch(`${proxy.base}/runs`, {
        method: "POST",
        headers,
        body: runBody(`${connection || "default"}-seed`),
      });
      assert.equal(seedResponse.status, 202);
      let current = await seedResponse.json();

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const eventsResponse = await fetch(
          `${proxy.base}/runs/${current.id}/events`,
          { headers },
        );
        assert.equal(eventsResponse.status, 200);
        assert.match(
          eventsResponse.headers.get("content-type") || "",
          /^text\/event-stream\b/,
        );
        if (connection === "close") {
          assert.notEqual(
            eventsResponse.headers.get("connection"),
            "keep-alive",
          );
        }
        const events = await eventsResponse.text();
        assert.match(events, /event: assistant\.completed/);
        assert.match(events, /event: run\.completed/);

        const nextResponse = await fetch(`${proxy.base}/runs`, {
          method: "POST",
          headers,
          body: runBody(`${connection || "default"}-${attempt}`),
        });
        assert.equal(nextResponse.status, 202);
        current = await nextResponse.json();
      }
    }
    assert.equal(starts, 8);
    assert.ok(proxy.socketCount() < starts);
  } finally {
    await proxy.close();
    await plugin.close();
  }
});

test("remote gateway resumes SSE after numeric or stable Last-Event-ID cursors", async () => {
  const plugin = createRemoteGatewayPlugin({
    agent: { id: "fixture", kind: "custom" },
    token: "test-token",
    adapter: {
      async startRun(_input, { emit }) {
        emit({
          id: "evt_one",
          type: "tool.started",
          data: { tool: "one" },
        });
        emit({
          id: "evt_two",
          type: "tool.completed",
          data: { tool: "one" },
        });
        emit({
          id: "evt_three",
          type: "assistant.completed",
          data: { text: "done" },
        });
        return { status: "succeeded", vendorRunId: "vendor_resume" };
      },
    },
  });
  await plugin.listen(0);
  const base = `http://127.0.0.1:${plugin.server.address().port}`;
  const headers = { authorization: "Bearer test-token" };
  const createdResponse = await fetch(`${base}/runs`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ input: { text: "resume" } }),
  });
  const created = await createdResponse.json();

  const numeric = await fetch(`${base}/runs/${created.id}/events`, {
    headers: { ...headers, "last-event-id": "2" },
  });
  const numericBody = await numeric.text();
  assert.doesNotMatch(numericBody, /"sequence":1/);
  assert.doesNotMatch(numericBody, /"sequence":2/);
  assert.match(numericBody, /"sequence":3/);
  assert.match(numericBody, /"sequence":4/);

  const stable = await fetch(`${base}/runs/${created.id}/events`, {
    headers: { ...headers, "last-event-id": "evt_two" },
  });
  const stableBody = await stable.text();
  assert.doesNotMatch(stableBody, /"sequence":3/);
  assert.doesNotMatch(stableBody, /"sequence":2/);
  assert.match(stableBody, /"sequence":4/);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const resumed = await fetch(`${base}/runs/${created.id}/events`, {
      headers: {
        ...headers,
        "last-event-id": attempt % 2 === 0 ? "2" : "evt_two",
        ...(attempt % 2 === 0 ? {} : { connection: "close" }),
      },
    });
    assert.equal(resumed.status, 200, await resumed.text());
    assert.match(
      resumed.headers.get("content-type") || "",
      /^text\/event-stream\b/,
    );
  }
  await plugin.close();
});

test("remote gateway makes POST /runs idempotent and rejects conflicting reuse", async () => {
  let starts = 0;
  const plugin = createRemoteGatewayPlugin({
    agent: { id: "fixture", kind: "custom" },
    token: "test-token",
    adapter: {
      async startRun() {
        starts += 1;
        return { status: "running", vendorRunId: `vendor_${starts}` };
      },
    },
  });
  await plugin.listen(0);
  const port = plugin.server.address().port;
  const headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
    "idempotency-key": "desktop-run-1",
  };
  const body = JSON.stringify({ input: { text: "same" } });
  const first = await fetch(`http://127.0.0.1:${port}/runs`, {
    method: "POST",
    headers,
    body,
  });
  const firstRun = await first.json();
  const retry = await fetch(`http://127.0.0.1:${port}/runs`, {
    method: "POST",
    headers,
    body,
  });
  const retryRun = await retry.json();
  assert.equal(first.status, 202);
  assert.equal(retry.status, 202);
  assert.equal(retryRun.id, firstRun.id);
  assert.equal(starts, 1);

  const conflict = await fetch(`http://127.0.0.1:${port}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { text: "different" } }),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "idempotency_conflict");
  await plugin.close();
});

test("Remote CLI Host state reopens unfinished Runs as explicit reconciliation failures", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agents-one-host-state-"));
  const statePath = join(directory, "host-state.json");
  const first = createRemoteCliHost({
    token: "test-token",
    statePath,
    runtimes: [
      {
        runtimeId: "opencode-state",
        displayName: "OpenCode",
        adapter: {
          async startRun() {
            return { status: "running", vendorRunId: "vendor_state" };
          },
        },
      },
    ],
  });
  await first.listen(0);
  const firstPort = first.server.address().port;
  const headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
  };
  const created = await fetch(`http://127.0.0.1:${firstPort}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      runtimeId: "opencode-state",
      input: { text: "hello" },
    }),
  });
  const createdRun = await created.json();
  await first.close();

  const second = createRemoteCliHost({
    token: "test-token",
    statePath,
    runtimes: [
      {
        runtimeId: "opencode-state",
        displayName: "OpenCode",
        adapter: {
          async startRun() {
            return { status: "running" };
          },
        },
      },
    ],
  });
  await second.listen(0);
  const recovered = await fetch(
    `http://127.0.0.1:${second.server.address().port}/runs/${createdRun.id}`,
    { headers },
  );
  const recoveredRun = await recovered.json();
  assert.equal(recoveredRun.status, "failed");
  assert.match(
    recoveredRun.error.message,
    /host_restart_reconciliation_required/,
  );
  assert.equal(
    recoveredRun.events.at(-1).data.code,
    "host_restart_reconciliation_required",
  );
  await second.close();
});

test("Remote CLI Host reconciles a persisted Run through the Runtime adapter and keeps sequence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agents-one-host-reconcile-"));
  const statePath = join(directory, "host-state.json");
  const first = createRemoteCliHost({
    token: "test-token",
    statePath,
    runtimes: [
      {
        runtimeId: "opencode-reconcile",
        displayName: "OpenCode",
        adapter: {
          async startRun() {
            return { status: "running", vendorRunId: "vendor_reconcile" };
          },
        },
      },
    ],
  });
  await first.listen(0);
  const firstPort = first.server.address().port;
  const headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
  };
  const created = await fetch(`http://127.0.0.1:${firstPort}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      runtimeId: "opencode-reconcile",
      input: { text: "hello" },
    }),
  });
  const createdRun = await created.json();
  await first.close();

  const second = createRemoteCliHost({
    token: "test-token",
    statePath,
    runtimes: [
      {
        runtimeId: "opencode-reconcile",
        displayName: "OpenCode",
        adapter: {
          async startRun() {
            return { status: "running" };
          },
          async reconcileRun(vendorRunId, record) {
            assert.equal(vendorRunId, "vendor_reconcile");
            assert.equal(record.runtimeId, "opencode-reconcile");
            return {
              status: "succeeded",
              sessionId: "session-reconciled",
              output: "reconciled",
              events: [
                {
                  id: "provider-reconciled",
                  type: "assistant.completed",
                  data: { text: "reconciled" },
                },
              ],
            };
          },
        },
      },
    ],
  });
  await second.listen(0);
  const recovered = await fetch(
    `http://127.0.0.1:${second.server.address().port}/runs/${createdRun.id}`,
    { headers },
  );
  const recoveredRun = await recovered.json();
  assert.equal(recoveredRun.status, "succeeded");
  assert.equal(recoveredRun.sessionId, "session-reconciled");
  assert.equal(recoveredRun.output, "reconciled");
  assert.deepEqual(
    recoveredRun.events.map((event) => event.sequence),
    [1, 2, 3],
  );
  assert.equal(
    recoveredRun.events.some(
      (event) => event.data?.code === "host_restart_reconciliation_required",
    ),
    false,
  );
  await second.close();
});

test("remote gateway appends provider events before terminal status events", async () => {
  const plugin = createRemoteGatewayPlugin({
    agent: { id: "fixture", kind: "custom" },
    token: "test-token",
    adapter: {
      capabilities: { eventStream: { toolEvents: true } },
      async startRun() {
        return { vendorRunId: "vendor_refresh", status: "running" };
      },
      async getRun() {
        return {
          status: "succeeded",
          output: "完成。",
          events: [
            {
              id: "evt_tool_completed",
              type: "tool.completed",
              data: {
                tool: {
                  callId: "call_1",
                  name: "read",
                  kind: "workspace",
                },
              },
            },
            {
              id: "evt_assistant_completed",
              type: "assistant.completed",
              data: { text: "完成。" },
            },
          ],
        };
      },
    },
  });
  await plugin.listen(0);
  const port = plugin.server.address().port;
  const headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
  };
  const created = await fetch(`http://127.0.0.1:${port}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { text: "hello" } }),
  });
  const createdRun = await created.json();
  const refreshed = await fetch(
    `http://127.0.0.1:${port}/runs/${createdRun.id}`,
    { headers },
  );
  const run = await refreshed.json();
  assert.equal(run.status, "succeeded");
  assert.deepEqual(
    run.events.map((event) => event.type),
    ["run.started", "tool.completed", "assistant.completed", "run.completed"],
  );
  await plugin.close();
});

test("remote gateway appends failure evidence before run.failed", async () => {
  const plugin = createRemoteGatewayPlugin({
    agent: { id: "fixture", kind: "custom" },
    token: "test-token",
    adapter: {
      async startRun() {
        return { vendorRunId: "vendor_failed", status: "running" };
      },
      async getRun() {
        return {
          status: "failed",
          error: "read failed",
          events: [
            {
              id: "evt_tool_failed",
              type: "tool.failed",
              data: {
                summary: "读取失败。",
                tool: { callId: "call_1", name: "read", kind: "workspace" },
              },
            },
          ],
        };
      },
    },
  });
  await plugin.listen(0);
  const port = plugin.server.address().port;
  const headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
  };
  const created = await fetch(`http://127.0.0.1:${port}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { text: "hello" } }),
  });
  const createdRun = await created.json();
  const refreshed = await fetch(
    `http://127.0.0.1:${port}/runs/${createdRun.id}`,
    { headers },
  );
  const run = await refreshed.json();
  assert.equal(run.status, "failed");
  assert.deepEqual(
    run.events.map((event) => event.type),
    ["run.started", "tool.failed", "run.failed"],
  );
  await plugin.close();
});

test("remote gateway plugin exposes and accepts Artifact API uploads", async () => {
  let uploaded;
  const plugin = createRemoteGatewayPlugin({
    agent: { id: "fixture", kind: "custom" },
    token: "test-token",
    adapter: {
      async startRun() {
        return { status: "succeeded" };
      },
      async uploadArtifact(input) {
        uploaded = input;
        return {
          id: "artifact_fixture",
          name: input.name,
          mime: input.mime,
          size: input.size,
          sha256: input.sha256,
        };
      },
    },
  });
  await plugin.listen(0);
  const port = plugin.server.address().port;
  const headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
  };
  const capabilityResponse = await fetch(
    `http://127.0.0.1:${port}/capabilities`,
    {
      headers: { authorization: "Bearer test-token" },
    },
  );
  const capabilities = await capabilityResponse.json();
  assert.equal(capabilities.capabilities.artifacts.upload, true);
  assert.deepEqual(capabilities.capabilities.eventStream, {
    protocol: "agents-one-event-stream-v1",
    transport: "poll",
  });

  const uploadResponse = await fetch(`http://127.0.0.1:${port}/artifacts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "brief.txt",
      mime: "text/plain",
      sha256: "a".repeat(64),
      contentBase64: Buffer.from("hello").toString("base64"),
    }),
  });
  assert.equal(uploadResponse.status, 201);
  assert.equal((await uploadResponse.json()).id, "artifact_fixture");
  assert.equal(uploaded.bytes.toString("utf8"), "hello");
  await plugin.close();
});

test("remote gateway plugin downloads output artifacts through the Artifact API", async () => {
  const bytes = Buffer.from("chart bytes");
  const plugin = createRemoteGatewayPlugin({
    agent: { id: "fixture", kind: "custom" },
    token: "test-token",
    adapter: {
      async startRun() {
        return { status: "succeeded" };
      },
      async getArtifact(id) {
        assert.equal(id, "artifact_chart");
        return {
          id,
          name: "test-chart.png",
          mime: "image/png",
          size: bytes.length,
          sha256: "a".repeat(64),
          bytes,
        };
      },
    },
  });
  await plugin.listen(0);
  const port = plugin.server.address().port;
  const response = await fetch(
    `http://127.0.0.1:${port}/artifacts/artifact_chart`,
    {
      headers: { authorization: "Bearer test-token" },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: "artifact_chart",
    name: "test-chart.png",
    mime: "image/png",
    size: bytes.length,
    sha256: "a".repeat(64),
    contentBase64: bytes.toString("base64"),
  });
  await plugin.close();
});

test("remote adapters can publish output artifacts without a separate artifact store", async () => {
  const bytes = Buffer.from("published chart bytes");
  const plugin = createRemoteGatewayPlugin({
    agent: { id: "fixture", kind: "custom" },
    token: "test-token",
    adapter: {
      async startRun(_input, { publishArtifact }) {
        await publishArtifact({
          id: "artifact_published_chart",
          name: "published-chart.png",
          mime: "image/png",
          bytes,
        });
        return { status: "succeeded" };
      },
    },
  });
  await plugin.listen(0);
  const port = plugin.server.address().port;
  const headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
  };
  const created = await fetch(`http://127.0.0.1:${port}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { text: "make a chart" } }),
  });
  const run = await created.json();
  assert.equal(created.status, 202);
  assert.equal(run.artifacts[0].id, "artifact_published_chart");
  assert.equal(
    run.events.some((event) => event.type === "artifact.created"),
    true,
  );

  const downloaded = await fetch(
    `http://127.0.0.1:${port}/artifacts/artifact_published_chart`,
    { headers: { authorization: "Bearer test-token" } },
  );
  assert.equal(downloaded.status, 200);
  assert.equal(
    (await downloaded.json()).contentBase64,
    bytes.toString("base64"),
  );
  await plugin.close();
});

test("Remote Gateway persists published Artifact bytes across Host restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agents-one-host-artifacts-"));
  const statePath = join(directory, "host-state.json");
  const bytes = Buffer.from("durable artifact");
  const first = createRemoteGatewayPlugin({
    agent: { id: "fixture", kind: "custom" },
    token: "test-token",
    statePath,
    adapter: {
      async startRun(_input, { publishArtifact }) {
        await publishArtifact({
          id: "artifact_durable",
          name: "durable.txt",
          mime: "text/plain",
          bytes,
        });
        return { status: "succeeded" };
      },
    },
  });
  await first.listen(0);
  const firstPort = first.server.address().port;
  const headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
  };
  const created = await fetch(`http://127.0.0.1:${firstPort}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { text: "make artifact" } }),
  });
  assert.equal(created.status, 202);
  await first.close();

  const second = createRemoteGatewayPlugin({
    agent: { id: "fixture", kind: "custom" },
    token: "test-token",
    statePath,
    adapter: {
      async startRun() {
        return { status: "succeeded" };
      },
    },
  });
  await second.listen(0);
  const downloaded = await fetch(
    `http://127.0.0.1:${second.server.address().port}/artifacts/artifact_durable`,
    { headers: { authorization: "Bearer test-token" } },
  );
  assert.equal(downloaded.status, 200);
  assert.equal(
    (await downloaded.json()).contentBase64,
    bytes.toString("base64"),
  );
  await second.close();
});

test("Hermes connector artifact tool reads only through the connector callback", async () => {
  let readCount = 0;
  let published;
  const readOutput = async (path) => {
    readCount += 1;
    assert.equal(path, "charts/revenue.png");
    return Buffer.from("png bytes");
  };
  const publishArtifact = async (artifact) => {
    published = artifact;
    return { id: "artifact_tool", ...artifact };
  };
  const tool = createAgentsOneArtifactTool({ publishArtifact, readOutput });
  const result = await tool.execute({
    path: "charts/revenue.png",
    name: "revenue.png",
    mime: "image/png",
  });

  assert.equal(result.id, "artifact_tool");
  assert.equal(readCount, 1);
  assert.equal(published.mime, "image/png");
  assert.equal(published.bytes.toString("utf8"), "png bytes");
});

test("CLI adapter preserves JSONL records split across stream chunks", async () => {
  const program = String.raw`process.stdout.write('{"type":"assistant.completed","data":{"text":"完'); setTimeout(() => process.stdout.write('成。"}}\n'), 5);`;
  const adapter = createCliAdapter({
    command: process.execPath,
    args: ["-e", program],
    mapEvent: (event) => event,
  });
  const result = await adapter.run({ input: "hello", runId: "run_cli" });
  assert.equal(result.output, "完成。");
  assert.equal(
    result.events.filter((event) => event.type === "assistant.completed")
      .length,
    1,
  );
});

test("Remote CLI Host routes multiple Runtime IDs through one Gateway", async () => {
  const calls = [];
  const adapter = (name) => ({
    async startRun(input, { emit }) {
      calls.push([name, input.runtimeId]);
      emit({ type: "assistant.completed", data: { text: name } });
      return { status: "succeeded" };
    },
  });
  const host = createRemoteCliHost({
    token: "host-token",
    runtimes: [
      {
        runtimeId: "opencode-main",
        displayName: "OpenCode",
        kind: "opencode",
        adapter: adapter("open"),
      },
      {
        runtimeId: "pi-main",
        displayName: "Pi",
        kind: "pi",
        adapter: adapter("pi"),
      },
    ],
  });
  await host.listen(0);
  const port = host.server.address().port;
  const headers = {
    authorization: "Bearer host-token",
    "content-type": "application/json",
  };
  const create = async (runtimeId) =>
    fetch(`http://127.0.0.1:${port}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ runtimeId, input: { text: "hello" } }),
    });
  const first = await (await create("opencode-main")).json();
  const second = await (await create("pi-main")).json();
  assert.equal(first.runtimeId, "opencode-main");
  assert.equal(second.runtimeId, "pi-main");
  assert.deepEqual(calls, [
    ["open", "opencode-main"],
    ["pi", "pi-main"],
  ]);
  const capabilities = await (
    await fetch(`http://127.0.0.1:${port}/capabilities`, { headers })
  ).json();
  assert.deepEqual(
    capabilities.runtimes.map((item) => item.runtimeId),
    ["opencode-main", "pi-main"],
  );
  await host.close();
});

test("Remote CLI Host enforces Adapter trust and per-Runtime concurrency", async () => {
  const adapter = {
    manifest: { adapterId: "opencode-acp", version: "0.1.2" },
    async startRun() {
      return { status: "running", vendorRunId: "vendor_limit" };
    },
  };
  assert.throws(
    () =>
      createRemoteCliHost({
        token: "host-token",
        trustedAdapterIds: ["pi-rpc"],
        requireAdapterManifest: true,
        runtimes: [
          {
            runtimeId: "opencode-trust",
            displayName: "OpenCode",
            adapter,
          },
        ],
      }),
    /not trusted or registered/,
  );
  assert.throws(
    () =>
      createRemoteCliHost({
        token: "host-token",
        runtimes: [
          {
            runtimeId: "opencode-trust",
            displayName: "OpenCode",
            adapterId: "pi-rpc",
            adapter,
          },
        ],
      }),
    /does not match its manifest/,
  );

  const host = createRemoteCliHost({
    token: "host-token",
    trustedAdapterIds: ["opencode-acp"],
    requireAdapterManifest: true,
    runtimes: [
      {
        runtimeId: "opencode-limit",
        displayName: "OpenCode",
        limits: { maxConcurrentRuns: 1 },
        adapter,
      },
    ],
  });
  await host.listen(0);
  const port = host.server.address().port;
  const headers = {
    authorization: "Bearer host-token",
    "content-type": "application/json",
  };
  const body = JSON.stringify({
    runtimeId: "opencode-limit",
    input: { text: "hello" },
  });
  const first = await fetch(`http://127.0.0.1:${port}/runs`, {
    method: "POST",
    headers,
    body,
  });
  const second = await fetch(`http://127.0.0.1:${port}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      runtimeId: "opencode-limit",
      input: { text: "second" },
    }),
  });
  assert.equal(first.status, 202);
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.code, "run_limit_reached");
  await host.close();
});

test("Remote CLI Host routes Artifact requests by Runtime ID", async () => {
  const calls = [];
  const adapter = (name) => ({
    async startRun() {
      return { status: "succeeded" };
    },
    async uploadArtifact(input, context) {
      calls.push(["upload", name, context.runtimeId, input.name]);
      return {
        id: `artifact_${name}`,
        name: input.name,
        mime: input.mime,
        size: input.size,
        sha256: "a".repeat(64),
      };
    },
    async getArtifact(id, context) {
      calls.push(["download", name, context.runtimeId, id]);
      return {
        id,
        name: `${name}.txt`,
        mime: "text/plain",
        size: 1,
        sha256: "a".repeat(64),
        contentBase64: Buffer.from(name).toString("base64"),
      };
    },
  });
  const host = createRemoteCliHost({
    token: "host-token",
    runtimes: [
      {
        runtimeId: "opencode-main",
        displayName: "OpenCode",
        adapter: adapter("open"),
      },
      {
        runtimeId: "pi-main",
        displayName: "Pi",
        adapter: adapter("pi"),
      },
    ],
  });
  await host.listen(0);
  const port = host.server.address().port;
  const headers = {
    authorization: "Bearer host-token",
    "content-type": "application/json",
  };
  const upload = await fetch(`http://127.0.0.1:${port}/artifacts`, {
    method: "POST",
    headers: { ...headers, "x-agents-one-runtime-id": "pi-main" },
    body: JSON.stringify({
      name: "input.txt",
      mime: "text/plain",
      contentBase64: Buffer.from("hello").toString("base64"),
    }),
  });
  assert.equal(upload.status, 201);
  const download = await fetch(
    `http://127.0.0.1:${port}/artifacts/artifact_open`,
    {
      headers: {
        authorization: "Bearer host-token",
        "x-agents-one-runtime-id": "opencode-main",
      },
    },
  );
  assert.equal(download.status, 200);
  assert.deepEqual(calls, [
    ["upload", "pi", "pi-main", "input.txt"],
    ["download", "open", "opencode-main", "artifact_open"],
  ]);
  await host.close();
});

test("OpenCode ACP Remote Adapter keeps answer, thought, tool, model and artifacts separate", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "agents-one-remote-opencode-"));
  const program = [
    "const fs=require('node:fs');",
    "const rl=require('node:readline').createInterface({input:process.stdin});",
    "const send=(v)=>process.stdout.write(JSON.stringify(v)+'\\n');",
    "rl.on('line',(line)=>{const m=JSON.parse(line);",
    "if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentInfo:{name:'OpenCode',version:'remote-test'},agentCapabilities:{sessionCapabilities:{resume:true}},configOptions:[{id:'model',category:'model',currentValue:{provider:'deepseek',id:'deepseek-v4-flash'}}]}});",
    "else if(m.method==='session/new'||m.method==='session/resume')send({id:m.id,result:{sessionId:'remote-session'}});",
    "else if(m.method==='session/prompt'){fs.writeFileSync(process.cwd()+'/remote-output.txt','remote artifact');",
    "send({method:'session/update',params:{sessionId:'remote-session',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'内部摘要'}}}});",
    "send({method:'session/update',params:{sessionId:'remote-session',update:{sessionUpdate:'tool_call',toolCallId:'call-1',title:'read',kind:'read',rawInput:{path:'README.md'}}}});",
    "send({method:'session/update',params:{sessionId:'remote-session',update:{sessionUpdate:'tool_call_update',toolCallId:'call-1',title:'read',status:'completed',content:[{type:'text',text:'ok'}]}}});",
    "send({method:'session/update',params:{sessionId:'remote-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'远程答复'}}}});",
    "send({id:m.id,result:{stopReason:'end_turn',usage:{inputTokens:3,outputTokens:2}}});}});",
  ].join("");
  const adapter = createOpenCodeAcpAdapter({
    executablePath: process.execPath,
    acpArgs: ["-e", program],
    workspaceRoot: workspace,
  });
  const probe = await adapter.probe();
  assert.equal(probe.healthy, true);
  assert.equal(probe.protocolVersion, 1);
  assert.equal(probe.manifest.runtimeVersion, "remote-test");
  const host = createRemoteCliHost({
    token: "host-token",
    runtimes: [
      {
        runtimeId: "opencode-remote",
        displayName: "OpenCode Remote",
        kind: "opencode",
        adapter,
      },
    ],
  });
  await host.listen(0);
  const port = host.server.address().port;
  const headers = {
    authorization: "Bearer host-token",
    "content-type": "application/json",
  };
  const response = await fetch(`http://127.0.0.1:${port}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      runtimeId: "opencode-remote",
      mode: "safe_write",
      input: { text: "hello" },
    }),
  });
  const created = await response.json();
  let run = created;
  for (
    let attempt = 0;
    attempt < 30 && run.status === "running";
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    run = await (
      await fetch(`http://127.0.0.1:${port}/runs/${created.id}`, { headers })
    ).json();
  }
  assert.equal(run.status, "succeeded");
  assert.equal(run.output, "远程答复");
  assert.equal(run.sessionId, "remote-session");
  assert.deepEqual(run.model, {
    provider: "deepseek",
    id: "deepseek-v4-flash",
  });
  assert.deepEqual(run.usage, { inputTokens: 3, outputTokens: 2 });
  assert.equal(
    run.events.some(
      (event) =>
        event.type === "reasoning.summary" &&
        event.data.reasoningSummary === "内部摘要",
    ),
    true,
  );
  assert.equal(
    run.events.some(
      (event) =>
        event.type === "assistant.completed" && event.data.text === "远程答复",
    ),
    true,
  );
  assert.equal(
    run.events.some((event) => event.type === "tool.completed"),
    true,
  );
  assert.equal(
    run.artifacts.some((artifact) => artifact.name === "remote-output.txt"),
    true,
  );

  const continuedResponse = await fetch(`http://127.0.0.1:${port}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      runtimeId: "opencode-remote",
      conversationId: run.sessionId,
      mode: "conversation",
      input: { text: "continue" },
    }),
  });
  const continued = await continuedResponse.json();
  let continuedRun = continued;
  for (
    let attempt = 0;
    attempt < 30 && continuedRun.status === "running";
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    continuedRun = await (
      await fetch(`http://127.0.0.1:${port}/runs/${continued.id}`, { headers })
    ).json();
  }
  assert.equal(continuedRun.status, "succeeded");
  assert.equal(continuedRun.sessionId, "remote-session");
  await host.close();
});
