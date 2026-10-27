import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const DESKTOP_BUILD_INPUTS = [
  "src",
  "scripts",
  "contracts",
  "resources",
  "build",
  "package.json",
  "package-lock.json",
  "electron.vite.config.ts",
  "electron-builder.yml",
  "tsconfig.json",
  "tsconfig.node.json",
  "tsconfig.web.json",
];

/** A release receipt is derived from committed, clean build inputs, not caller metadata. */
export function createDesktopSourceReceipt(source) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: source,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const dirty = git(
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...DESKTOP_BUILD_INPUTS,
  );
  if (dirty) throw Error("desktop_source_build_inputs_dirty");
  const ignored = git(
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--",
    ...DESKTOP_BUILD_INPUTS,
  );
  if (ignored) throw Error("desktop_source_ignored_build_inputs");
  const sourceCommit = git("rev-parse", "HEAD");
  const inputTree = git(
    "ls-tree",
    "-r",
    "--full-tree",
    sourceCommit,
    "--",
    ...DESKTOP_BUILD_INPUTS,
  );
  if (!inputTree.includes("src/")) throw Error("desktop_source_inputs_missing");
  return {
    schema: 1,
    sourceCommit,
    sourceTree: git("rev-parse", "HEAD^{tree}"),
    buildInputTreeSha256: createHash("sha256").update(inputTree).digest("hex"),
    inputPathsVersion: 1,
    createdAt: new Date().toISOString(),
  };
}
