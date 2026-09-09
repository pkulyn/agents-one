import { spawn, type ChildProcess } from "node:child_process";
import { redactSensitiveText } from "../../shared/redaction";
import { terminateProcessTree } from "../process-control";
import { parseRuntimeJsonLine } from "./event-normalizer";

const DEFAULT_MAX_OUTPUT = 512 * 1024;
const DEFAULT_MAX_DIAGNOSTICS = 200;
const SENSITIVE_JSON_KEY =
  /(?:^|_)(?:token|access_token|refresh_token|id_token|auth_token|bearer_token|secret|password|cookie|authorization|api_key|credential)(?:$|_)/i;

function isSensitiveJsonKey(key: string): boolean {
  // Token counters are provider metadata, not credentials. The previous
  // substring check treated inputTokens/outputTokens/totalTokens as secrets
  // and silently erased usage data before an adapter could normalize it.
  const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2");
  if (
    /(?:^|_)(?:input|output|total|cached_read|context_used|context_window)_tokens?$/.test(
      normalized,
    )
  ) {
    return false;
  }
  return SENSITIVE_JSON_KEY.test(normalized);
}

export interface LocalProcessLine {
  source: "stdout" | "stderr";
  line: string;
  json?: unknown;
}

export interface LocalProcessOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxOutputChars?: number;
  maxDiagnostics?: number;
  onLine?: (line: LocalProcessLine) => void;
}

export interface LocalProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  diagnostics: LocalProcessLine[];
}

export interface LocalProcessHandle {
  readonly child: ChildProcess;
  readonly completion: Promise<LocalProcessResult>;
  sendLine(line: string): void;
  cancel(): Promise<void>;
}

function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") {
    return redactSensitiveText(value).slice(0, 8_000);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactJson(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          isSensitiveJsonKey(key) ? "[redacted]" : redactJson(item, depth + 1),
        ]),
    );
  }
  return value;
}

function appendCapped(current: string, next: string, limit: number): string {
  const merged = `${current}${redactSensitiveText(next)}`;
  return merged.length <= limit ? merged : merged.slice(-limit);
}

/** Spawn a local adapter process with argument-based, shell-free execution. */
export function startLocalProcess(
  options: LocalProcessOptions,
): LocalProcessHandle {
  const command = options.command.trim();
  if (!command) throw new Error("Local adapter command is required.");
  const maxOutput = options.maxOutputChars || DEFAULT_MAX_OUTPUT;
  const maxDiagnostics = options.maxDiagnostics || DEFAULT_MAX_DIAGNOSTICS;
  const child = spawn(command, [...(options.args || [])], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  const diagnostics: LocalProcessLine[] = [];
  const pending: Record<"stdout" | "stderr", string> = {
    stdout: "",
    stderr: "",
  };

  const consume = (source: "stdout" | "stderr", chunk: Buffer): void => {
    const key = source;
    pending[key] += chunk.toString("utf8");
    const lines = pending[key].split(/\r?\n/);
    pending[key] = lines.pop() || "";
    for (const rawLine of lines) emitLine(source, rawLine);
  };
  const emitLine = (source: "stdout" | "stderr", rawLine: string): void => {
    if (!rawLine.trim()) return;
    const json = parseRuntimeJsonLine(rawLine);
    const line: LocalProcessLine = {
      source,
      line: redactSensitiveText(rawLine).slice(0, maxOutput),
      ...(json !== undefined ? { json: redactJson(json) } : {}),
    };
    diagnostics.push(line);
    while (diagnostics.length > maxDiagnostics) diagnostics.shift();
    if (source === "stdout")
      stdout = appendCapped(stdout, `${rawLine}\n`, maxOutput);
    else stderr = appendCapped(stderr, `${rawLine}\n`, maxOutput);
    options.onLine?.(line);
  };

  child.stdout?.on("data", (chunk: Buffer) => consume("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => consume("stderr", chunk));
  const completion = new Promise<LocalProcessResult>((resolve) => {
    const finish = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (settled) return;
      settled = true;
      if (pending.stdout) emitLine("stdout", pending.stdout);
      if (pending.stderr) emitLine("stderr", pending.stderr);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        diagnostics: [...diagnostics],
      });
    };
    child.once("error", (error) => {
      stderr = appendCapped(stderr, error.message, maxOutput);
      finish(null, null);
    });
    child.once("close", (exitCode, signal) => finish(exitCode, signal));
  });

  return {
    child,
    completion,
    sendLine(line: string): void {
      if (!child.stdin || child.stdin.destroyed) {
        throw new Error("Local adapter process stdin is unavailable.");
      }
      child.stdin.write(`${line}\n`);
    },
    async cancel(): Promise<void> {
      await terminateProcessTree(child);
      await completion;
    },
  };
}
