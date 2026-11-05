import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
import { executeOneShell } from "./shell-tool";

describe.runIf(process.platform === "win32")(
  "One Windows process cleanup",
  () => {
    it("falls back and reports unconfirmed cleanup when taskkill fails", async () => {
      const child = Object.assign(new EventEmitter(), {
        pid: 1234,
        exitCode: null,
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn(() => {
          queueMicrotask(() => child.emit("close", 1));
          return true;
        }),
      });
      const killer = Object.assign(new EventEmitter(), { kill: vi.fn() });
      spawnMock
        .mockReset()
        .mockReturnValueOnce(child)
        .mockReturnValueOnce(killer);
      const abort = new AbortController();
      const pending = executeOneShell(
        { command: "Start-Sleep -Seconds 30" },
        process.cwd(),
        abort.signal,
      );
      abort.abort();
      killer.emit("exit", 1);
      await expect(pending).rejects.toThrow("cleanup could not be confirmed");
      expect(child.kill).toHaveBeenCalledOnce();
    });
  },
);
