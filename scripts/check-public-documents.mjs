import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const approved = new Set(
  JSON.parse(
    readFileSync(
      new URL("../.github/public-documents.json", import.meta.url),
      "utf8",
    ),
  ),
);

export function findUnapprovedDocuments(paths) {
  return paths.filter((path) => {
    if (/^(?:\.agents|\.claude)\//.test(path)) return true;
    return (
      (path.startsWith("docs/") || path.toLowerCase().endsWith(".md")) &&
      !approved.has(path)
    );
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: projectRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const unapproved = findUnapprovedDocuments(tracked);
  if (unapproved.length) {
    console.error(
      "Public documentation scope check failed. Keep internal records outside the repository; a new public document requires explicit maintainer approval.",
    );
    for (const path of unapproved) console.error(`- ${path}`);
    process.exitCode = 1;
  } else {
    console.log("Public documentation scope check passed.");
  }
}
