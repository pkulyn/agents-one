import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { executeOneShell } from "./shell-tool";

it("runs a host command only when called and terminates it on cancellation", async () => {
  const root = mkdtempSync(join(tmpdir(), "one-shell-"));
  try {
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

    await expect(pending).rejects.toThrow("cancelled");

    expect(Date.now() - cancellationStarted).toBeLessThan(12000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

it.runIf(process.platform === "win32")(
  "preserves the PowerShell module path without inheriting unrelated secrets",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "one-shell-env-"));
    const previousModulePath = process.env.PSModulePath;
    const previousSecret = process.env.ONE_SHELL_TEST_SECRET;
    try {
      process.env.PSModulePath = `${previousModulePath || ""};one-shell-module-marker`;
      process.env.ONE_SHELL_TEST_SECRET = "not-for-shell";
      const result = JSON.parse(
        await executeOneShell(
          {
            command:
              "if ($env:PSModulePath -like '*one-shell-module-marker*') { Write-Output 'module-ok' }; if ($null -eq $env:ONE_SHELL_TEST_SECRET) { Write-Output 'secret-absent' }",
          },
          root,
          new AbortController().signal,
        ),
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("module-ok");
      expect(result.output).toContain("secret-absent");
    } finally {
      if (previousModulePath === undefined) delete process.env.PSModulePath;
      else process.env.PSModulePath = previousModulePath;
      if (previousSecret === undefined)
        delete process.env.ONE_SHELL_TEST_SECRET;
      else process.env.ONE_SHELL_TEST_SECRET = previousSecret;
      rmSync(root, { recursive: true, force: true });
    }
  },
  30000,
);
