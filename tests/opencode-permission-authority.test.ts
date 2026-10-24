import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  permissionCases,
  permissionProgram,
} from "../plugins/agents-one-plugin/test/fixtures/acp-permission.mjs";
import { startOpenCodeProcess } from "../src/main/runtime-adapters/builtin/opencode-acp";

it.each(permissionCases)(
  "local ACP keeps task-scoped authority: $name",
  async (input) => {
    const workspace = mkdtempSync(join(tmpdir(), "local-acp-authority-"));
    try {
      const events: { type: string; summary: string }[] = [];
      const started = await startOpenCodeProcess(
        {
          executablePath: process.execPath,
          acpArgs: ["-e", permissionProgram(input)],
        },
        {
          prompt: "Fixture tool",
          mode: "safe_write",
          workspace,
          timeoutMs: 5000,
        },
        () => {},
        (event) => events.push(event),
      );
      const result = await started.completion;
      const response = JSON.parse(
        readFileSync(join(workspace, "response.json"), "utf8"),
      );
      expect(response.id).toBe(input.id);
      expect(response.result.outcome).toEqual(
        input.allowed
          ? { outcome: "selected", optionId: "once" }
          : { outcome: "cancelled" },
      );
      expect(existsSync(join(workspace, "executed.txt"))).toBe(input.allowed);
      expect(existsSync(join(workspace, "remembered.txt"))).toBe(false);
      if (input.allowed) expect(result.error).toBeUndefined();
      else {
        expect(result.error).toContain("[Agents One 权限不足]");
        expect(events.some((event) => event.type === "error")).toBe(true);
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);
