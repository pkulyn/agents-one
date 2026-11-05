import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.runIf(process.platform === "win32")(
  "starts and closes a short PowerShell process in the shell tool environment",
  async () => {
    const cwd = mkdtempSync(join(tmpdir(), "one-shell-diagnostic-"));
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      "PATH",
      "Path",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "HOME",
      "LANG",
      "LC_ALL",
    ])
      if (process.env[key] !== undefined) env[key] = process.env[key];
    try {
      const observed = await new Promise<{
        spawned: boolean;
        exited: boolean;
        closed: boolean;
        output: string;
      }>((resolve) => {
        const child = spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output 'one-ok'",
          ],
          { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        );
        let spawned = false,
          exited = false,
          output = "";
        const timer = setTimeout(() => {
          child.kill();
          resolve({ spawned, exited, closed: false, output });
        }, 10000);
        child.once("spawn", () => {
          spawned = true;
        });
        child.once("exit", () => {
          exited = true;
        });
        child.stdout.on("data", (data) => {
          output += String(data);
        });
        child.once("error", () => {
          clearTimeout(timer);
          resolve({ spawned, exited, closed: false, output });
        });
        child.once("close", () => {
          clearTimeout(timer);
          resolve({ spawned, exited, closed: true, output });
        });
      });
      console.info("One shell diagnostic:", JSON.stringify(observed));
      expect(observed).toMatchObject({
        spawned: true,
        exited: true,
        closed: true,
      });
      expect(observed.output).toContain("one-ok");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
  20000,
);
