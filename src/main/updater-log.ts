/** Logger adapter for electron-updater. Update diagnostics join the same
 * product-owned application/error files as the rest of Agents One. */
import {
  logApplicationDiagnostic,
  logErrorDiagnostic,
} from "./agents-one-logs";

function write(level: string, message?: unknown): void {
  const text = typeof message === "string" ? message : JSON.stringify(message);
  const tag = `[updater] ${text}`;
  if (level === "error") console.error(tag);
  else if (level === "warn") console.warn(tag);
  else console.log(tag);

  if (level === "error") logErrorDiagnostic("updater", text);
  else logApplicationDiagnostic(`updater.${level}`, text);
}

export const updaterLogger = {
  info: (message?: unknown): void => write("info", message),
  warn: (message?: unknown): void => write("warn", message),
  error: (message?: unknown): void => write("error", message),
  debug: (message?: unknown): void => write("debug", message),
};
