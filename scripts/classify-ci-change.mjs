import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Unknown, executable and workflow inputs always require the full check.
export function classifyChanges(files) {
  const docsOnly =
    files.length > 0 &&
    files.every(
      (file) =>
        /^(?:README(?:\.zh-CN)?\.md|CONTRIBUTING(?:\.zh-CN)?\.md|KNOWN_ISSUES\.md|LICENSE|THIRD_PARTY_NOTICES\.md)$/.test(
          file,
        ) ||
        /^(?:docs|lat\.md)\/[^\r\n]+\.md$/.test(file) ||
        /^docs\/assets\/[^\r\n]+\.(?:png|webp|jpg|jpeg|gif|svg)$/.test(file),
    );
  return { docsOnly, files };
}

export function changedFiles(base, head, cwd = process.cwd()) {
  if (![base, head].every((sha) => /^[a-f0-9]{40}$/i.test(sha)))
    throw Error("CI comparison requires full commit SHAs");
  return execFileSync(
    "git",
    ["diff", "--no-renames", "--name-only", "-z", base, head],
    { cwd },
  )
    .toString()
    .split("\0")
    .filter(Boolean);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  let result;
  try {
    result = classifyChanges(
      changedFiles(process.env.CI_BASE_SHA, process.env.CI_HEAD_SHA),
    );
  } catch {
    result = {
      docsOnly: false,
      files: [],
      reason: "comparison-unavailable-full-check",
    };
  }
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `docs_only=${result.docsOnly}\n`,
    );
  console.log(JSON.stringify(result, null, 2));
}
