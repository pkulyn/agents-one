import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, relative, isAbsolute, sep } from "node:path";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_ENTRIES = 200;
const PRIVATE_NAMES = new Set([
  ".git",
  ".codex",
  ".agents",
  ".ssh",
  ".aws",
  ".azure",
  ".config",
  "node_modules",
  "desktop.json",
  "auth.json",
  "credentials.json",
  "mobile-owner-ledger.json",
  "mobile-execution-policies.json",
]);
const DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function denied(): never {
  throw new Error("Project inspection is unavailable for this path.");
}
function same(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;
}
export function projectPathSegments(
  value: unknown,
  directory: boolean,
): string[] {
  if (typeof value !== "string" || value.length > 1024) denied();
  if (directory && value === "") return [];
  if (
    !value ||
    /[\\:]/.test(value) ||
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    denied();
  const parts = value.split("/");
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (
      !part ||
      part === "." ||
      part === ".." ||
      /[ .]$/.test(part) ||
      DEVICE.test(part) ||
      PRIVATE_NAMES.has(lower) ||
      lower.startsWith(".agents-one-write-") ||
      lower === ".env" ||
      lower.startsWith(".env.") ||
      lower.endsWith(".pem") ||
      lower.endsWith(".key") ||
      /[<>"|?*]/.test(part)
    )
      denied();
  }
  return parts;
}

/** Main fixes the project capability root; every invocation rechecks current authorization. */
export function createProjectInspection(
  root: string,
  authorize: () => void,
): {
  readText(path: unknown): { path: string; text: string; sha256: string };
  list(path: unknown): {
    path: string;
    entries: { name: string; kind: "file" | "directory" }[];
  };
} {
  let canonical: string, rootIdentity: Stats;
  try {
    canonical = realpathSync(root);
    rootIdentity = lstatSync(canonical);
  } catch {
    return denied();
  }
  if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink()) denied();
  function checkRoot(): void {
    authorize();
    const current = lstatSync(canonical);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      !same(rootIdentity, current) ||
      realpathSync(root) !== canonical
    )
      denied();
  }
  function locate(parts: string[]): string {
    checkRoot();
    let target = canonical;
    for (const part of parts) {
      target = join(target, part);
      if (lstatSync(target).isSymbolicLink()) denied();
    }
    const actual = realpathSync(target);
    const relation = relative(canonical, actual);
    if (
      isAbsolute(relation) ||
      relation === ".." ||
      relation.startsWith(`..${sep}`)
    )
      denied();
    if (actual !== resolve(target)) denied();
    return target;
  }
  // Public tool errors never echo OS diagnostics containing local paths.
  function run<T>(action: () => T): T {
    try {
      return action();
    } catch {
      return denied();
    }
  }
  return {
    readText(input) {
      return run(() => {
        const parts = projectPathSegments(input, false),
          target = locate(parts);
        let fd: number | undefined;
        try {
          const before = lstatSync(target);
          if (
            !before.isFile() ||
            before.nlink !== 1 ||
            before.size > MAX_FILE_BYTES
          )
            denied();
          fd = openSync(target, "r");
          const opened = fstatSync(fd);
          // Re-resolve after opening to detect replacement/junction races.
          locate(parts);
          const current = lstatSync(target);
          if (
            !same(before, opened) ||
            !same(current, opened) ||
            opened.nlink !== 1
          )
            denied();
          const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
          let count = 0;
          while (count < bytes.length) {
            const n = readSync(fd, bytes, count, bytes.length - count, null);
            if (!n) break;
            count += n;
          }
          if (count > MAX_FILE_BYTES) denied();
          const after = fstatSync(fd);
          if (
            after.size !== opened.size ||
            after.mtimeMs !== opened.mtimeMs ||
            after.nlink !== 1
          )
            denied();
          locate(parts);
          if (!same(lstatSync(target), after)) denied();
          const body = bytes.subarray(0, count);
          const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
          if (text.includes("\0")) denied();
          checkRoot();
          return {
            path: parts.join("/"),
            text,
            sha256: createHash("sha256").update(body).digest("hex"),
          };
        } finally {
          if (fd !== undefined) closeSync(fd);
        }
      });
    },
    list(input) {
      return run(() => {
        const parts = projectPathSegments(input, true),
          target = locate(parts);
        if (!lstatSync(target).isDirectory()) denied();
        const entries: { name: string; kind: "file" | "directory" }[] = [];
        const directory = opendirSync(target);
        try {
          let count = 0;
          for (
            let entry = directory.readSync();
            entry;
            entry = directory.readSync()
          ) {
            if (++count > MAX_ENTRIES) denied();
            if (entry.isSymbolicLink()) continue;
            try {
              projectPathSegments(entry.name, false);
            } catch {
              continue;
            }
            const item = locate([...parts, entry.name]),
              stat = lstatSync(item);
            if (stat.isFile() && stat.nlink === 1)
              entries.push({ name: entry.name, kind: "file" });
            else if (stat.isDirectory())
              entries.push({ name: entry.name, kind: "directory" });
          }
        } finally {
          directory.closeSync();
        }
        locate(parts);
        entries.sort((a, b) => a.name.localeCompare(b.name));
        checkRoot();
        return { path: parts.join("/"), entries };
      });
    },
  };
}
