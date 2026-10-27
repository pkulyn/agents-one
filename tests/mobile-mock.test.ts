import { afterAll, beforeAll, expect, test } from "vitest";
import { createMobileMockServer } from "../services/agents-one-mobile-mock/server.mjs";
import { assertMobileSchema } from "../src/shared/mobile-control";

const server = createMobileMockServer();
let origin: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const base = "/agents-one/mobile/v1/owners/fixture-value/spaces/fixture-value";

test("simulator marks responses and never grants real credentials", async () => {
  const response = await fetch(origin + base + "/bootstrap");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-agents-one-simulator")).toBe(
    "contract-fixtures-only",
  );
  assertMobileSchema("Bootstrap", await response.json());
  const pair = await fetch(origin + "/agents-one/mobile/v1/pairing/claims", {
    method: "POST",
    body: "{}",
  });
  expect(pair.status).toBe(403);
  expect((await pair.json()).error.code).toBe("requires_owner_action");
});
test("simulator checks write contract and replays a rejected receipt without dispatch", async () => {
  const input = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Mutation-Id": "m1",
      "Idempotency-Key": "m1",
      "If-Match": '"1"',
    },
    body: JSON.stringify({
      text: "合成契约用例",
      executionPolicyId: "inspect",
    }),
  };
  const first = await fetch(origin + base + "/conversations/c1/turns", input);
  expect(first.status).toBe(202);
  const receipt = await first.json();
  assertMobileSchema("OperationReceipt", receipt);
  expect(receipt.status).toBe("rejected");
  const replay = await fetch(origin + base + "/conversations/c1/turns", input);
  expect(await replay.json()).toEqual(receipt);
  const conflict = await fetch(origin + base + "/conversations/c1/turns", {
    ...input,
    body: JSON.stringify({ text: "different", executionPolicyId: "inspect" }),
  });
  expect(conflict.status).toBe(409);
  const invalid = await fetch(origin + base + "/conversations/c1/turns", {
    ...input,
    body: JSON.stringify({
      text: "合成",
      executionPolicyId: "inspect",
      workspace: "D:/private",
    }),
  });
  expect(invalid.status).toBe(422);
});

test("expired simulator cursor returns 410 and can recover through a snapshot", async () => {
  const expired = await fetch(origin + base + "/events", {
    headers: { "Last-Event-ID": "expired" },
  });
  expect(expired.status).toBe(410);
  expect((await expired.json()).error.code).toBe("cursor_expired");
  const snapshot = await fetch(origin + base + "/snapshots");
  assertMobileSchema("Snapshot", await snapshot.json());
  const stream = await fetch(origin + base + "/events");
  expect(stream.headers.get("content-type")).toBe("text/event-stream");
  expect(await stream.text()).toContain("event: conversation.updated");
});
