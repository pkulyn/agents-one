import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const outputRoot = join(process.cwd(), "out");

if (!existsSync(outputRoot)) {
  throw new Error("Build output is missing. Run `npm run build` first.");
}

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function summarize(name) {
  const directory = join(outputRoot, name);
  const files = filesUnder(directory).map((path) => ({
    path: relative(process.cwd(), path).replaceAll("\\", "/"),
    bytes: statSync(path).size,
  }));
  files.sort((left, right) => right.bytes - left.bytes);
  return {
    files: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    largest: files.slice(0, 10),
  };
}

console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      main: summarize("main"),
      preload: summarize("preload"),
      renderer: summarize("renderer"),
    },
    null,
    2,
  ),
);
