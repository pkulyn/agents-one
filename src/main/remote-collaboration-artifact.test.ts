import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageRemoteCollaborationArtifact } from "./remote-collaboration-artifact";

const roots: string[] = [];
function root(): string {
  const p = mkdtempSync(join(tmpdir(), "one-remote-stage-"));
  roots.push(p);
  return p;
}
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const bytes = Buffer.from("verified remote content");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const input = (
  workspace: string,
): Parameters<typeof stageRemoteCollaborationArtifact>[0] => ({
  workspace,
  runId: "run-1",
  artifactId: "remote-1",
  name: "result.txt",
  bytes,
  sha256,
});

describe("remote collaboration artifact staging", () => {
  it("stores verified bytes under a task-owned run directory and is idempotent", () => {
    const workspace = root();
    const one = stageRemoteCollaborationArtifact(input(workspace));
    expect(readFileSync(join(workspace, one.relativePath))).toEqual(bytes);
    expect(stageRemoteCollaborationArtifact(input(workspace))).toEqual(one);
    expect(one.sha256).toBe(sha256);
  });
  it("rejects unverified contents and unsafe names", () => {
    const workspace = root();
    expect(() =>
      stageRemoteCollaborationArtifact({
        ...input(workspace),
        sha256: "0".repeat(64),
      }),
    ).toThrow(/SHA-256/);
    for (const name of ["../escape", "a/b", "a\\b", "CON.txt", "result."])
      expect(() =>
        stageRemoteCollaborationArtifact({ ...input(workspace), name }),
      ).toThrow(/filename/);
  });
  it("refuses to replace existing content", () => {
    const workspace = root();
    const result = stageRemoteCollaborationArtifact(input(workspace));
    writeFileSync(join(workspace, result.relativePath), "different");
    expect(() => stageRemoteCollaborationArtifact(input(workspace))).toThrow();
    expect(readFileSync(join(workspace, result.relativePath), "utf8")).toBe(
      "different",
    );
  });
  it("rejects a directory junction that escapes the workspace", () => {
    const workspace = root(),
      outside = root();
    mkdirSync(join(outside, "elsewhere"));
    symlinkSync(
      join(outside, "elsewhere"),
      join(workspace, ".remote-deliveries"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => stageRemoteCollaborationArtifact(input(workspace))).toThrow(
      /directory/,
    );
  });
});
