import { spawn } from "node:child_process";
import type { OneWorkerTool } from "./protocol";

const maxOutputBytes = 256 * 1024;
const maxCommandChars = 32 * 1024;
export const oneShellTool: OneWorkerTool = {
  name: "host_shell",
  label: "Run host command",
  description:
    "Run a command with the user's full host permissions. Use only for the user's task.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "PowerShell command on Windows, shell command elsewhere.",
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
};

/** Caller must grant full host access before exposing this tool. */
export async function executeOneShell(
  parameters: unknown,
  cwd: string,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw new Error("Task was cancelled");
  if (
    !parameters ||
    typeof parameters !== "object" ||
    Array.isArray(parameters)
  )
    throw new Error("Command is invalid");
  const command = (parameters as Record<string, unknown>).command;
  if (
    typeof command !== "string" ||
    !command.trim() ||
    command.length > maxCommandChars ||
    command.includes("\0")
  )
    throw new Error("Command is invalid");
  const windows = process.platform === "win32";
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
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const executable = windows ? "powershell.exe" : "/bin/sh";
  const args = windows
    ? [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " + command,
      ]
    : ["-lc", command];
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      detached: !windows,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let outputBytes = 0;
    let truncated = false;
    let stopping = false;
    let termination: Promise<void> | undefined;
    const append = (chunk: Buffer): void => {
      const remaining = maxOutputBytes - outputBytes;
      if (remaining > 0) {
        const slice = chunk.subarray(0, remaining);
        output += slice.toString("utf8");
        outputBytes += slice.length;
      }
      if (chunk.length > remaining) truncated = true;
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      termination = new Promise<void>((done) => {
        if (!child.pid || child.exitCode !== null) {
          done();
          return;
        }
        if (windows) {
          const killer = spawn(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore", env },
          );
          killer.once("error", () => {
            child.kill();
            done();
          });
          killer.once("exit", () => done());
        } else {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
          done();
        }
      });
    };
    signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, 120_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      void (termination || Promise.resolve()).then(() => {
        if (signal.aborted) return reject(new Error("Task was cancelled"));
        if (stopping) return reject(new Error("Command timed out"));
        resolve(JSON.stringify({ exitCode: code, output, truncated }));
      });
    });
  });
}
