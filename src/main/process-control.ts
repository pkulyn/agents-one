import { execFile as execFileCallback, type ChildProcess } from "child_process";
import { promisify } from "util";

const execFile = promisify(execFileCallback);
const PROCESS_TREE_TERMINATION_TIMEOUT_MS = 5_000;

function tryKill(child: ChildProcess, signal?: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // The process may have closed between the state check and the signal.
  }
}

/**
 * Stop a local Runtime and all of its descendants. On Windows, npm/CLI
 * wrappers commonly leave the actual agent below the direct child process, so
 * killing only that direct child is insufficient. The caller still awaits the
 * child `close` event before it records a terminal Runtime state.
 */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (typeof child.pid !== "number" || child.pid <= 0) {
    tryKill(child, "SIGTERM");
    return;
  }
  if (process.platform !== "win32") {
    tryKill(child, "SIGTERM");
    return;
  }
  try {
    await execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      shell: false,
      timeout: PROCESS_TREE_TERMINATION_TIMEOUT_MS,
    });
  } catch {
    // The process may have exited between the close check and taskkill. A
    // direct signal remains the best bounded fallback for that race.
    tryKill(child);
  }
}
