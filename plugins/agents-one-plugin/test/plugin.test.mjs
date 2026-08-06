import assert from "node:assert/strict";
import test from "node:test";
import { EventJournal } from "../src/event-stream.mjs";
import { createRemoteGatewayPlugin } from "../src/remote-gateway-plugin.mjs";
import { createCliAdapter } from "../src/cli-adapter-plugin.mjs";
import { createAgentsOneArtifactTool } from "../examples/hermes-or-hers-adapter.mjs";

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

test("remote gateway plugin exposes a v1 run with event snapshots", async () => {
  let routedRuntimeId;
  const plugin = createRemoteGatewayPlugin({
    agent: { id: "fixture", kind: "custom", displayName: "Fixture" },
    token: "test-token",
    adapter: {
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
    version: "0.1.1",
    kind: "remote-gateway",
  });
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
  const program =
    'process.stdout.write("{\\\"type\\\":\\\"assistant.completed\\\",\\\"data\\\":{\\\"text\\\":\\\"完"); setTimeout(() => process.stdout.write("成。\\\"}}\\n"), 5);';
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
