import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventJournal } from "../src/event-stream.mjs";
import { createRemoteGatewayPlugin } from "../src/remote-gateway-plugin.mjs";

const poisonedId =
  "provider\r\nevent: run.completed\r\ndata: forged\r\n\r\nid: injected";
function safeId(id) {
  assert.ok(id.length <= 512);
  for (const character of id) {
    const code = character.charCodeAt(0);
    assert.ok(code > 31 && (code < 127 || code > 159));
  }
}
test("journal replaces unsafe IDs deterministically and preserves safe provider cursors", () => {
  const journal = new EventJournal();
  for (const id of [poisonedId, "null\0id", "tab\tid", "x".repeat(513)]) {
    const first = journal.append({
      id,
      type: "tool.started",
      data: { summary: "one" },
    });
    const duplicate = journal.append({
      id,
      type: "tool.started",
      data: { summary: "ignored" },
    });
    safeId(first.id);
    assert.notEqual(first.id, id);
    assert.equal(duplicate, first);
  }
  const original = "provider/session:one@cursor+1";
  assert.equal(
    journal.append({ id: original, type: "tool.completed" }).id,
    original,
  );
  assert.equal(
    journal.append({ eventId: original, type: "tool.completed" }).id,
    original,
  );
  const empty1 = journal.append({ type: "run.status" });
  const empty2 = journal.append({ type: "run.status" });
  assert.notEqual(empty1.id, empty2.id);
  assert.equal(
    journal.append({ id: "unsafe-type", type: "run.completed\nevent: forged" }),
    undefined,
  );
  assert.equal(journal.snapshot().length, 7);
});
function parseEvents(body) {
  return body
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split("\n");
      assert.equal(
        lines.length,
        3,
        "one ID, type and JSON data line per event",
      );
      assert.ok(lines[0].startsWith("id: "));
      assert.ok(lines[1].startsWith("event: "));
      assert.ok(lines[2].startsWith("data: "));
      const event = JSON.parse(lines[2].slice(6));
      safeId(event.id);
      assert.equal(lines[0], "id: " + event.id);
      assert.equal(lines[1], "event: " + event.type);
      return event;
    });
}

test("real SSE output cannot be split by provider IDs and safe cursors survive reload", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sdk-sse-metadata-"));
  const statePath = join(directory, "state.json");
  const options = {
    agent: { id: "fixture", kind: "custom" },
    token: "fixture-token",
    statePath,
    adapter: {
      async startRun(_input, { emit }) {
        emit({
          id: poisonedId,
          type: "tool.started",
          data: { summary: "line one\nline two" },
        });
        emit({
          id: "evt_safe",
          type: "assistant.completed",
          data: { text: "done" },
        });
        return { status: "succeeded", vendorRunId: "fixture-run" };
      },
    },
  };
  let plugin = createRemoteGatewayPlugin(options);
  const headers = { authorization: "Bearer fixture-token" };
  async function listen() {
    await plugin.listen(0);
    return "http://127.0.0.1:" + plugin.server.address().port;
  }
  try {
    let base = await listen();
    const response = await fetch(base + "/runs", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ input: { text: "fixture" } }),
    });
    assert.equal(response.status, 202);
    const created = await response.json();
    const eventsResponse = await fetch(
      base + "/runs/" + created.id + "/events",
      { headers },
    );
    assert.equal(eventsResponse.status, 200);
    const events = parseEvents(await eventsResponse.text());
    assert.equal(
      events.filter((event) => event.type === "run.completed").length,
      1,
    );
    const normalized = events.find((event) => event.type === "tool.started");
    const cursor = normalized.id;
    assert.equal(normalized.data.summary, "line one\nline two");
    const resumed = parseEvents(
      await (
        await fetch(base + "/runs/" + created.id + "/events", {
          headers: { ...headers, "last-event-id": cursor },
        })
      ).text(),
    );
    assert.ok(resumed.length > 0);
    assert.ok(resumed.every((event) => event.sequence > normalized.sequence));
    await plugin.close();
    // Simulate a journal produced by an older SDK before ID validation.
    const stored = JSON.parse(readFileSync(statePath, "utf8"));
    stored.runs[0].events.find((event) => event.type === "tool.started").id =
      poisonedId;
    writeFileSync(statePath, JSON.stringify(stored));
    plugin = createRemoteGatewayPlugin(options);
    base = await listen();
    const restored = parseEvents(
      await (
        await fetch(base + "/runs/" + created.id + "/events", { headers })
      ).text(),
    );
    assert.equal(
      restored.find((event) => event.type === "tool.started").id,
      cursor,
    );
    assert.equal(
      restored.find((event) => event.id === "evt_safe").type,
      "assistant.completed",
    );
    assert.deepEqual(
      restored.map((event) => event.sequence),
      events.map((event) => event.sequence),
    );
    const safeResume = parseEvents(
      await (
        await fetch(base + "/runs/" + created.id + "/events", {
          headers: { ...headers, "last-event-id": "evt_safe" },
        })
      ).text(),
    );
    assert.deepEqual(
      safeResume.map((event) => event.type),
      ["run.completed"],
    );
  } finally {
    if (plugin.server.listening) await plugin.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
