import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { executeOneShell } from "./shell-tool";

it("runs a host command only when called and terminates it on cancellation", async () => {
  const root = mkdtempSync(join(tmpdir(), "one-shell-"));
  try {
    console.info("One shell test: starting short command");
    const output = JSON.parse(
      await executeOneShell(
        {
          command:
            process.platform === "win32"
              ? "Write-Output 'one-ok'"
              : "printf one-ok",
        },
        root,
        new AbortController().signal,
      ),
    );
    expect(output.exitCode).toBe(0);
    expect(output.output).toContain("one-ok");
    console.info("One shell test: short command completed");
    const abort = new AbortController();
    const pending = executeOneShell(
      {
        command:
          process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30",
      },
      root,
      abort.signal,
    );
    const cancellationStarted = Date.now();
    setTimeout(() => abort.abort(), 300);
    console.info("One shell test: waiting for cancellation");
    await expect(pending).rejects.toThrow("cancelled");
    console.info("One shell test: cancellation confirmed");
    expect(Date.now() - cancellationStarted).toBeLessThan(12000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
