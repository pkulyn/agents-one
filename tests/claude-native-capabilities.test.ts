import { mkdtempSync, rmSync, writeFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyClaudeStrictCapabilities } from "../src/main/claude-capabilities";
const roots: string[] = [];
function file(sized = false): string {
  const root = mkdtempSync(join(tmpdir(), "claude-native-identity-"));
  roots.push(root);
  const path = join(root, "owned.exe");
  writeFileSync(path, "owned fixture");
  if (sized) truncateSync(path, 247736480);
  return path;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      !resolve(root).startsWith(resolve(tmpdir()) + sep) ||
      !basename(root).startsWith("claude-native-identity-")
    )
      throw Error("Unsafe fixture");
    rmSync(root, { recursive: true, force: true });
  }
});
it("rejects unknown executable contents without invoking them", async () => {
  await expect(
    verifyClaudeStrictCapabilities({ command: file(), prefix: [] }),
  ).rejects.toThrow("本轮任务未发送");
});
it("checks the digest rather than accepting a same-size executable", async () => {
  await expect(
    verifyClaudeStrictCapabilities({ command: file(true), prefix: [] }),
  ).rejects.toThrow("本轮任务未发送");
});
it("rejects wrappers and conceals native paths", async () => {
  await expect(
    verifyClaudeStrictCapabilities({
      command: "private-owned-install",
      prefix: ["private-entry"],
    }),
  ).rejects.toThrow("本轮任务未发送");
  await expect(
    verifyClaudeStrictCapabilities({
      command: "private-owned-install",
      prefix: [],
    }),
  ).rejects.not.toThrow("private-owned-install");
});
it("honors cancellation before accessing an executable", async () => {
  await expect(
    verifyClaudeStrictCapabilities(
      { command: "missing-owned", prefix: [] },
      () => false,
    ),
  ).rejects.toThrow("cancelled");
});
it("honors cancellation during an actual file stream", async () => {
  let checks = 0;
  await expect(
    verifyClaudeStrictCapabilities(
      { command: file(true), prefix: [] },
      () => ++checks < 2,
    ),
  ).rejects.toThrow("cancelled");
  expect(checks).toBe(2);
});
