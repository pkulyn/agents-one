import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  permissionCases,
  permissionProgram,
} from "./fixtures/acp-permission.mjs";
import { createOpenCodeAcpAdapter } from "../src/adapters/opencode-acp.mjs";

for (const input of permissionCases)
  test("remote ACP keeps task-scoped authority: " + input.name, async () => {
    const workspace = mkdtempSync(join(tmpdir(), "remote-acp-authority-"));
    const events = [];
    const adapter = createOpenCodeAcpAdapter({
      executablePath: process.execPath,
      acpArgs: ["-e", permissionProgram(input)],
      workspaceRoot: workspace,
    });
    let started;
    try {
      started = await adapter.startRun(
        { mode: "safe_write", input: { text: "Fixture tool" } },
        { emit: (event) => events.push(event) },
      );
      const deadline = Date.now() + 5000;
      let result;
      do {
        result = await adapter.getRun(started.vendorRunId);
        if (result.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      assert.notEqual(result.status, "running");
      const response = JSON.parse(
        readFileSync(join(workspace, "response.json"), "utf8"),
      );
      assert.equal(response.id, input.id);
      assert.deepEqual(
        response.result.outcome,
        input.allowed
          ? { outcome: "selected", optionId: "once" }
          : { outcome: "cancelled" },
      );
      assert.equal(existsSync(join(workspace, "executed.txt")), input.allowed);
      assert.equal(existsSync(join(workspace, "remembered.txt")), false);
      assert.equal(result.status, input.allowed ? "succeeded" : "failed");
      if (!input.allowed) {
        assert.match(result.error, /权限不足/);
        assert.ok(
          events.some((event) => event.data?.code === "permission_denied"),
        );
      }
    } finally {
      if (started) await adapter.cancelRun(started.vendorRunId);
      rmSync(workspace, { recursive: true, force: true });
    }
  });
