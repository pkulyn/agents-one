import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { classifyChanges, changedFiles } from "./classify-ci-change.mjs";

// @lat: [[repository-presentation#CI change routing]]
test("documentation routing fails closed for mixed and executable changes", () => {
  assert.equal(
    classifyChanges([
      "README.md",
      "README.zh-CN.md",
      "docs/AGENTS_ONE_PLUGIN_SDK.md",
    ]).docsOnly,
    true,
  );
  for (const file of [
    "src/main/index.ts",
    ".github/workflows/ci.yml",
    "package-lock.json",
    "docs/tool.mjs",
    "docs/assets/script.js",
    "AGENTS.md",
  ]) {
    assert.equal(classifyChanges(["README.md", file]).docsOnly, false, file);
  }
  assert.equal(classifyChanges([]).docsOnly, false);
});

test("real Git comparisons include deletions and both sides of renames", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-one-ci-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init");
  git("config", "user.name", "CI Test");
  git("config", "user.email", "ci@example.invalid");
  fs.writeFileSync(path.join(dir, "worker.js"), "runtime input");
  git("add", ".");
  git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  fs.renameSync(path.join(dir, "worker.js"), path.join(dir, "README.md"));
  git("add", "-A");
  git("commit", "-m", "rename");
  assert.equal(
    classifyChanges(changedFiles(base, git("rev-parse", "HEAD"), dir)).docsOnly,
    false,
  );
  assert.throws(() => changedFiles("main", "HEAD", dir), /full commit/);
});
