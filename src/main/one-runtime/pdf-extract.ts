import { fork } from "node:child_process";

/** Parse untrusted PDF bytes in a bounded process without model credentials. */
export function extractOnePdf(
  workerPath: string,
  bytes: Buffer,
  signal: AbortSignal,
): Promise<{ pages: number; text: string }> {
  if (signal.aborted) return Promise.reject(new Error("Task was cancelled"));
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    const child = fork(workerPath, [], {
      execPath: process.execPath,
      execArgv: ["--max-old-space-size=256"],
      env,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let result: { pages: number; text: string } | undefined;
    let failure = "PDF parser exited unexpectedly";
    let settled = false;
    const stop = (reason: string): void => {
      failure = reason;
      result = undefined;
      child.kill();
    };
    const abort = (): void => stop("Task was cancelled");
    const timer = setTimeout(() => stop("PDF extraction timed out"), 20000);
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", () => {
      if (child.pid) stop("PDF parser process error");
      else {
        failure = "Could not start PDF parser";
        finish();
      }
    });
    child.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") {
        stop("Invalid PDF parser response");
        return;
      }
      const value = message as Record<string, unknown>;
      if (
        value.ok === true &&
        Number.isSafeInteger(value.pages) &&
        typeof value.text === "string" &&
        Buffer.byteLength(value.text, "utf8") <= 256 * 1024
      )
        result = { pages: value.pages as number, text: value.text };
      else
        failure =
          typeof value.error === "string"
            ? value.error.slice(0, 300)
            : "PDF extraction failed";
      if (child.connected) child.disconnect();
    });
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new Error("Task was cancelled"));
      else if (result) resolve(result);
      else reject(new Error(failure));
    };
    child.on("exit", finish);
    if (signal.aborted) abort();
    else
      child.send({ data: bytes.toString("base64") }, (error) => {
        if (error) stop("Could not send PDF to parser");
      });
  });
}
