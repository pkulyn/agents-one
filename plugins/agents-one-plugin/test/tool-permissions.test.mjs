import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRemoteGatewayPlugin } from "../src/remote-gateway-plugin.mjs";

for (const allowed of [false, true]) {
  // @lat: [[runtime-chat#Remote deletion approval lifecycle]]
  test(
    "remote automatic creates documents and confirms deletion: " + allowed,
    { timeout: 10000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "agents-one-remote-permission-")),
        file = join(dir, "report.docx");
      let state = { status: "running", output: "" };
      const plugin = createRemoteGatewayPlugin({
        agent: { id: "fixture", kind: "fixture" },
        token: "test-token",
        adapter: {
          startRun(_input, context) {
            void (async () => {
              assert.equal(
                await context.authorizeTool("Terminal", {
                  command: "python generate_docx.py",
                }),
                true,
              );
              writeFileSync(file, "document");
              if (
                await context.authorizeTool("delete_document", { path: file })
              )
                unlinkSync(file);
              state = { status: "succeeded", output: "done" };
            })();
            return { vendorRunId: "fixture-run", status: "running" };
          },
          getRun() {
            return state;
          },
        },
      });
      await plugin.listen(0);
      const base = "http://127.0.0.1:" + plugin.server.address().port;
      const headers = {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      };
      try {
        const response = await fetch(base + "/runs", {
          method: "POST",
          headers,
          body: JSON.stringify({
            mode: "conversation",
            input: { text: "Make report" },
            execution: { permission: "write", permissionMode: "safe_write" },
          }),
        });
        const run = await response.json();
        let current;
        for (let i = 0; i < 100; i++) {
          current = await (
            await fetch(base + "/runs/" + run.id, { headers })
          ).json();
          if (current.permissionRequests?.length) break;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        assert.ok(existsSync(file));
        assert.equal(current.status, "running");
        assert.equal(current.permissionRequests.length, 1);
        const id = current.permissionRequests[0].id;
        assert.equal(
          (
            await fetch(base + "/runs/wrong-run/permissions/" + id, {
              method: "POST",
              headers,
              body: JSON.stringify({ allowed: true }),
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await fetch(base + "/runs/" + run.id + "/permissions/" + id, {
              method: "POST",
              headers,
              body: JSON.stringify({ allowed }),
            })
          ).status,
          200,
        );
        for (let i = 0; i < 100; i++) {
          current = await (
            await fetch(base + "/runs/" + run.id, { headers })
          ).json();
          if (current.status === "succeeded") break;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        assert.equal(current.status, "succeeded");
        assert.equal(existsSync(file), !allowed);
        assert.equal(
          (
            await fetch(base + "/runs/" + run.id + "/permissions/" + id, {
              method: "POST",
              headers,
              body: JSON.stringify({ allowed: true }),
            })
          ).status,
          409,
        );
      } finally {
        await plugin.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
}

test(
  "remote full access deletes without a second approval",
  { timeout: 10000 },
  async () => {
    let state = { status: "running", output: "" };
    const plugin = createRemoteGatewayPlugin({
      agent: { id: "fixture", kind: "fixture" },
      token: "test-token",
      adapter: {
        startRun(_input, context) {
          void context
            .authorizeTool("delete_document", { path: "report.docx" })
            .then((allowed) => {
              state = {
                status: allowed ? "succeeded" : "failed",
                output: "done",
              };
            });
          return { vendorRunId: "full-run", status: "running" };
        },
        getRun() {
          return state;
        },
      },
    });
    await plugin.listen(0);
    const base = "http://127.0.0.1:" + plugin.server.address().port,
      headers = {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      };
    try {
      const response = await fetch(base + "/runs", {
        method: "POST",
        headers,
        body: JSON.stringify({
          mode: "conversation",
          input: { text: "Delete the document" },
          execution: { permission: "write", permissionMode: "full_access" },
        }),
      });
      const run = await response.json();
      const current = await (
        await fetch(base + "/runs/" + run.id, { headers })
      ).json();
      assert.equal(current.status, "succeeded");
      assert.equal(current.permissionRequests, undefined);
    } finally {
      await plugin.close();
    }
  },
);

test(
  "remote cancellation revokes a pending deletion without executing it",
  { timeout: 10000 },
  async () => {
    let state = { status: "running", output: "" },
      deletionAllowed;
    const plugin = createRemoteGatewayPlugin({
      agent: { id: "fixture", kind: "fixture" },
      token: "test-token",
      adapter: {
        startRun(_input, context) {
          void context
            .authorizeTool("delete_document", { path: "report.docx" })
            .then((allowed) => {
              deletionAllowed = allowed;
            });
          return { vendorRunId: "cancel-run", status: "running" };
        },
        getRun() {
          return state;
        },
        cancelRun() {
          state = { status: "cancelled", output: "" };
          return state;
        },
      },
    });
    await plugin.listen(0);
    const base = "http://127.0.0.1:" + plugin.server.address().port,
      headers = {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      };
    try {
      const run = await (
        await fetch(base + "/runs", {
          method: "POST",
          headers,
          body: JSON.stringify({
            mode: "conversation",
            input: { text: "Delete" },
            execution: { permission: "write", permissionMode: "safe_write" },
          }),
        })
      ).json();
      assert.equal(run.permissionRequests.length, 1);
      const request = run.permissionRequests[0];
      assert.equal(
        (
          await fetch(base + "/runs/" + run.id + "/cancel", {
            method: "POST",
            headers,
          })
        ).status,
        202,
      );
      assert.equal(deletionAllowed, false);
      assert.equal(
        (
          await fetch(base + "/runs/" + run.id + "/permissions/" + request.id, {
            method: "POST",
            headers,
            body: JSON.stringify({ allowed: true }),
          })
        ).status,
        409,
      );
    } finally {
      await plugin.close();
    }
  },
);
