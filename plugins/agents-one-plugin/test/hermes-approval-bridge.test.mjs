import test from "node:test";
import assert from "node:assert/strict";
import { createHermesApprovalForwarder } from "../src/hermes-approval-bridge.mjs";

// @lat: [[runtime-chat#Hermes native approval forwarding]]
test("Hermes forwards once/deny against the exact native Run and request", async () => {
  for (const allowed of [false, true]) {
    const replies = [];
    const bridge = createHermesApprovalForwarder({
      respond: async (r) => replies.push(r),
      stop: async () => assert.fail("unexpected cancellation"),
    });
    bridge.bind(
      "sdk",
      { vendorRunId: "native", runtimeId: "hers" },
      async () => allowed,
    );
    assert.equal(
      await bridge.forward("sdk", {
        approvalRequestId: "request",
        command: "rm document.md",
      }),
      true,
    );
    assert.deepEqual(replies, [
      {
        vendorRunId: "native",
        runtimeId: "hers",
        approvalRequestId: "request",
        allowed,
      },
    ]);
    assert.equal(
      await bridge.forward("sdk", {
        approvalRequestId: "request",
        command: "rm document.md",
      }),
      false,
    );
    assert.equal(replies.length, 1);
    assert.equal(
      await bridge.forward("another", {
        approvalRequestId: "request",
        command: "rm document.md",
      }),
      false,
    );
  }
});

test("cancelled Hermes Runs cannot inherit a late approval", async () => {
  let resolve;
  const replies = [];
  const bridge = createHermesApprovalForwarder({
    respond: async (r) => replies.push(r),
    stop: async () => undefined,
  });
  bridge.bind(
    "sdk",
    { vendorRunId: "native", runtimeId: "hers" },
    () => new Promise((r) => (resolve = r)),
  );
  const pending = bridge.forward("sdk", {
    approvalRequestId: "request",
    command: "rm document.md",
  });
  bridge.revoke("sdk");
  resolve(true);
  assert.equal(await pending, false);
  assert.deepEqual(replies, []);
});

test("ambiguous native approvals stop the Run before either can be accepted", async () => {
  let resolve;
  const replies = [],
    stopped = [];
  const bridge = createHermesApprovalForwarder({
    respond: async (r) => replies.push(r),
    stop: async (r) => stopped.push(r),
  });
  bridge.bind(
    "sdk",
    { vendorRunId: "native", runtimeId: "hers" },
    () => new Promise((r) => (resolve = r)),
  );
  const pending = bridge.forward("sdk", {
    approvalRequestId: "first",
    command: "rm first.md",
  });
  assert.equal(
    await bridge.forward("sdk", {
      approvalRequestId: "second",
      command: "rm second.md",
    }),
    false,
  );
  resolve(true);
  await pending;
  assert.deepEqual(replies, []);
  assert.deepEqual(stopped, [{ vendorRunId: "native", runtimeId: "hers" }]);
});

test("invalid input and changed replay intent fail closed", async () => {
  for (const input of [
    { command: "rm file" },
    { approvalRequestId: "valid", command: "" },
  ]) {
    let stopped = false;
    const bridge = createHermesApprovalForwarder({
      respond: async () => assert.fail("unexpected approval"),
      stop: async () => (stopped = true),
    });
    bridge.bind(
      "sdk",
      { vendorRunId: "native", runtimeId: "hers" },
      async () => true,
    );
    assert.equal(await bridge.forward("sdk", input), false);
    assert.equal(stopped, true);
  }
});
