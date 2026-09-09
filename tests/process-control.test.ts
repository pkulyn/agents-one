import { once } from "events";
import { spawn } from "child_process";
import { describe, expect, it } from "vitest";
import { terminateProcessTree } from "../src/main/process-control";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

describe("local Runtime process-tree control", () => {
  it.skipIf(process.platform !== "win32")(
    "terminates a real Windows parent process and its descendant",
    async () => {
      const childProgram = "setInterval(() => {}, 1000);";
      const parentProgram = [
        "const { spawn } = require('child_process');",
        `const child = spawn(process.execPath, ['-e', ${JSON.stringify(childProgram)}], { stdio: 'ignore' });`,
        "process.stdout.write(String(child.pid));",
        "setInterval(() => {}, 1000);",
      ].join("");
      const parent = spawn(process.execPath, ["-e", parentProgram], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      let descendantPid: number | undefined;
      try {
        const [chunk] = (await once(parent.stdout!, "data")) as [Buffer];
        descendantPid = Number(chunk.toString("utf8"));
        expect(descendantPid).toBeGreaterThan(0);
        expect(isAlive(parent.pid!)).toBe(true);
        expect(isAlive(descendantPid)).toBe(true);

        const closed = once(parent, "close");
        await terminateProcessTree(parent);
        await closed;

        expect(await waitFor(() => !isAlive(parent.pid!))).toBe(true);
        expect(await waitFor(() => !isAlive(descendantPid!))).toBe(true);
      } finally {
        if (parent.pid && isAlive(parent.pid)) parent.kill();
        if (descendantPid && isAlive(descendantPid)) {
          try {
            process.kill(descendantPid);
          } catch {
            // The assertion above reports a more useful failure.
          }
        }
      }
    },
    10_000,
  );
});
