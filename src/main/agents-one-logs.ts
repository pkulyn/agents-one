/** Product-owned diagnostics. These files deliberately live outside the
 * optional Hermes Agent Runtime runtime home. Task prompts, model output, credentials and
 * raw provider payloads are never written here. */
import { app } from "electron";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import { redactSensitiveText } from "../shared/redaction";

export const AGENTS_ONE_LOG_FILES = [
  "application.log",
  "tasks.log",
  "errors.log",
] as const;
export type AgentsOneLogFile = (typeof AGENTS_ONE_LOG_FILES)[number];

const MAX_LOG_BYTES = 1024 * 1024;
const DEFAULT_LOG_FILE: AgentsOneLogFile = "application.log";

function logDirectory(): string {
  const override = process.env.AGENTS_ONE_LOG_DIR?.trim();
  if (override) return override;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "agents-one", "logs");
  }
  try {
    return join(app.getPath("userData"), "logs");
  } catch {
    return join(homedir(), ".agents-one", "logs");
  }
}

/** Directory for all Agents One-owned diagnostic files. */
export function agentsOneLogsDirectory(): string {
  return logDirectory();
}

function safeText(value: unknown): string {
  let text: string;
  if (value instanceof Error) text = value.message;
  else if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  return redactSensitiveText(text)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 2_000);
}

function write(
  file: AgentsOneLogFile,
  level: string,
  event: string,
  detail?: unknown,
): void {
  try {
    const dir = logDirectory();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, file);
    if (existsSync(path) && statSync(path).size >= MAX_LOG_BYTES)
      writeFileSync(path, "", "utf-8");
    const suffix = detail === undefined ? "" : ` ${safeText(detail)}`;
    appendFileSync(
      path,
      `${new Date().toISOString()} [${level}] ${event}${suffix}\n`,
      "utf-8",
    );
  } catch {
    // Diagnostics must never prevent the requested application action.
  }
}

export function logApplicationDiagnostic(
  event: string,
  detail?: unknown,
): void {
  write("application.log", "info", event, detail);
}

export function logTaskDiagnostic(event: string, detail?: unknown): void {
  write("tasks.log", "info", event, detail);
}

export function logErrorDiagnostic(event: string, detail?: unknown): void {
  write("errors.log", "error", event, detail);
}

/** Read a bounded tail from a product-owned log file. */
export function readAgentsOneLogs(
  logFile: string = DEFAULT_LOG_FILE,
  lines = 300,
): { content: string; path: string } {
  const file = AGENTS_ONE_LOG_FILES.includes(logFile as AgentsOneLogFile)
    ? (logFile as AgentsOneLogFile)
    : DEFAULT_LOG_FILE;
  const path = join(logDirectory(), file);
  if (!existsSync(path)) return { content: "", path };
  try {
    const count = Math.min(Math.max(Math.floor(lines) || 300, 1), 1_000);
    return {
      content: readFileSync(path, "utf-8").split("\n").slice(-count).join("\n"),
      path,
    };
  } catch {
    return { content: "", path };
  }
}
