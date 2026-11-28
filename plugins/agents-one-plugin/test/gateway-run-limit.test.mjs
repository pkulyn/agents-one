import assert from "node:assert/strict";
import test from "node:test";
import { createRemoteCliHost } from "../src/remote-cli-host.mjs";

function stubAdapter() {
  const state = { settled: false, started: 0 };
  return {
    state,
    manifest: {
      adapterId: "stub-stream",
      vendorId: "stub",
      version: "0.1.0",
      displayName: "Stub",
      protocol: "stub",
    },
    capabilities: {
      eventStream: { toolEvents: true, modelMetadata: true },
      tasks: { start: true, get: true, cancel: true },
      permissions: { interactive: false, modes: ["analysis"] },
      sessions: { create: true },
      artifacts: { publish: false, download: false },
    },
    async probe() {
      return {
        healthy: true,
        capabilities: this.capabilities,
        manifest: this.manifest,
      };
    },
    async startRun() {
      state.started += 1;
      return { vendorRunId: `stub_${state.started}`, status: "running" };
    },
    async getRun() {
      return state.settled
        ? { status: "succeeded", output: "done", sessionId: "stub-session" }
        : { status: "running" };
    },
  };
}

test("admission reconciles an unpolled finished run before refusing a slot", async () => {
  const adapter = stubAdapter();
  const host = createRemoteCliHost({
    token: "host-token",
    runtimes: [
      {
        runtimeId: "stub-rt",
        displayName: "Stub",
        kind: "opencode",
        adapter,
        limits: { maxConcurrentRuns: 1 },
      },
    ],
    trustedAdapterIds: ["stub-stream"],
    requireAdapterManifest: true,
  });
  await host.listen(0);
  const port = host.server.address().port;
  const headers = {
    authorization: "Bearer host-token",
    "content-type": "application/json",
  };
  const submit = (key) =>
    fetch(`http://127.0.0.1:${port}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        runtimeId: "stub-rt",
        mode: "conversation",
        conversationId: `conversation-${key}`,
        input: { text: "hi" },
        idempotencyKey: key,
        execution: {
          permission: "read",
          permissionMode: "analysis",
          timeoutSeconds: 60,
        },
      }),
    });
  try {
    const first = await submit("first");
    assert.equal(first.status, 202);
    const firstBody = await first.json();

    // The adapter run finishes while nobody ever queries the stale record;
    // the Host would otherwise keep holding the single Runtime slot forever.
    adapter.state.settled = true;

    const blocked = await submit("second");
    const blockedBody = await blocked.json();
    assert.equal(
      blocked.status,
      202,
      JSON.stringify(blockedBody).slice(0, 200),
    );
    assert.notEqual(blockedBody.id, firstBody.id);
  } finally {
    await host.close();
  }
});
