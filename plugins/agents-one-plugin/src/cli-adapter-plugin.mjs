import { spawn } from "node:child_process";
import { EventJournal, sanitizeEventText } from "./event-stream.mjs";

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/**
 * Starts a local CLI without a shell and normalizes its JSONL/Hook output.
 * The caller owns vendor-specific arguments and event mapping, so no native
 * CLI feature is removed or reinterpreted by the plugin.
 */
export function createCliAdapter({
  command,
  args = [],
  cwd,
  env,
  mapEvent,
  maxDiagnostics = 200,
}) {
  if (!command) throw new Error("command is required.");
  if (typeof mapEvent !== "function") throw new Error("mapEvent is required.");
  return {
    async run({ input, runId, signal }) {
      const journal = new EventJournal({ runId });
      const child = spawn(command, args, {
        cwd,
        env: { PATH: process.env.PATH || "", ...env },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const rawLog = [];
      let finalText = "";
      const pending = { stdout: "", stderr: "" };
      const consume = (chunk, source) => {
        pending[source] += chunk.toString("utf8");
        const lines = pending[source].split(/\r?\n/);
        pending[source] = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          rawLog.push({ source, line: sanitizeEventText(line, 4000) || "" });
          if (rawLog.length > maxDiagnostics) rawLog.shift();
          const mapped = mapEvent(parseJsonLine(line), { source, line });
          for (const event of Array.isArray(mapped)
            ? mapped
            : mapped
              ? [mapped]
              : []) {
            const persisted = journal.append(event);
            if (persisted?.type === "assistant.completed")
              finalText = persisted.data?.text || finalText;
          }
        }
      };
      child.stdout.on("data", (chunk) => consume(chunk, "stdout"));
      child.stderr.on("data", (chunk) => consume(chunk, "stderr"));
      const abort = () => child.kill("SIGTERM");
      signal?.addEventListener("abort", abort, { once: true });
      child.stdin.end(`${input}\n`);
      const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      signal?.removeEventListener("abort", abort);
      for (const source of ["stdout", "stderr"]) {
        if (pending[source].trim()) {
          const line = pending[source];
          rawLog.push({ source, line: sanitizeEventText(line, 4000) || "" });
          const mapped = mapEvent(parseJsonLine(line), { source, line });
          for (const event of Array.isArray(mapped)
            ? mapped
            : mapped
              ? [mapped]
              : []) {
            const persisted = journal.append(event);
            if (persisted?.type === "assistant.completed")
              finalText = persisted.data?.text || finalText;
          }
        }
      }
      if (exitCode !== 0) {
        journal.append({
          type: "run.failed",
          data: { summary: `CLI 退出，代码 ${exitCode}。` },
        });
      } else {
        journal.append({
          type: "run.completed",
          data: { summary: "本地 CLI 已完成运行。" },
        });
      }
      return {
        exitCode,
        output: finalText,
        events: journal.snapshot(),
        rawLog,
      };
    },
  };
}
