import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRemoteGatewayPlugin } from "../src/remote-gateway-plugin.mjs";

test("first and later Gateway turns bind one conversation to one provider session across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gateway-conversation-"));
  const statePath = join(directory, "gateway.json");
  const calls = [];
  const adapter = {
    async startRun(input) {
      calls.push(input);
      return {
        status: "succeeded",
        sessionId: input.sessionId || "provider-session-1",
      };
    },
  };
  const makePlugin = () =>
    createRemoteGatewayPlugin({
      agent: { id: "fixture", kind: "custom" },
      token: "test-token",
      statePath,
      adapter,
    });
  let plugin = makePlugin();
  const headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
  };
  const post = async (body) => {
    const response = await fetch(
      `http://127.0.0.1:${plugin.server.address().port}/runs`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );
    assert.equal(response.status, 202);
    return response.json();
  };
  try {
    await plugin.listen(0);
    const body = {
      runtimeId: "hermes",
      mode: "conversation",
      idempotencyKey: "first-turn",
      input: { text: "remember marker" },
    };
    const first = await post(body);
    assert.ok(first.conversationId);
    assert.equal(calls[0].conversationId, first.conversationId);
    assert.equal(calls[0].sessionId, undefined);
    const duplicate = await post(body);
    assert.equal(duplicate.id, first.id);
    assert.equal(calls.length, 1);
    await plugin.close();
    plugin = makePlugin();
    await plugin.listen(0);
    const second = await post({
      runtimeId: "hermes",
      mode: "conversation",
      conversationId: first.conversationId,
      input: { text: "what marker?" },
    });
    assert.equal(second.conversationId, first.conversationId);
    assert.equal(calls[1].conversationId, first.conversationId);
    assert.equal(calls[1].sessionId, "provider-session-1");
    await post({
      runtimeId: "other-runtime",
      mode: "conversation",
      conversationId: first.conversationId,
      input: { text: "independent" },
    });
    assert.equal(calls[2].sessionId, undefined);
    const legacy = await post({
      runtimeId: "hermes",
      mode: "conversation",
      conversationId: "provider-session-1",
      input: { text: "legacy follow up" },
    });
    assert.equal(legacy.conversationId, first.conversationId);
    assert.equal(calls[3].sessionId, "provider-session-1");
  } finally {
    await plugin.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
