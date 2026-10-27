import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { createRequire } from "node:module";
import {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
} from "node:path";
import { codexInvocation } from "../codex-runtime";

// The reviewed npm entrypoint. This does not authorize an execution policy.
const WRAPPER_ENTRY_SHA256 =
  "61b0194f3bb6534439c8d26a3ed57d0805f84b884588b761795323eeb92fcf70";
// codex-cli 0.159.3 Windows x64: actual continuation, cancellation and tool probes.
// Updating this value requires new native boundary evidence; version text is insufficient.
const REVIEWED_NATIVE_SHA256 =
  "57e1bdab42c0559a74558ca17e85d5c7893caa5f1e582f67e9ddd6d97fa705a7";
interface FileIdentity {
  path: string;
  sha256: string;
}
export interface CodexInspectionIdentity {
  nativePath: string;
  fingerprint: string;
  files: FileIdentity[];
  environmentFingerprint: string;
}
/** Byte allowlist only: this is not a production execution capability certificate. */
export function assertReviewedCodexInspectionNative(
  identity: CodexInspectionIdentity,
): void {
  const native = identity.files.filter(
    (file) => file.path === identity.nativePath,
  );
  if (native.length !== 1 || native[0].sha256 !== REVIEWED_NATIVE_SHA256)
    fail();
}
function fail(): never {
  throw new Error(
    "Mobile Codex executable identity is unsupported or changed.",
  );
}
function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function fileIdentity(file: string, limit: number): FileIdentity {
  const path = realpathSync(file),
    handle = openSync(path, "r");
  try {
    const stat = fstatSync(handle);
    if (!stat.isFile() || stat.size < 2 || stat.size > limit) fail();
    const hash = createHash("sha256"),
      buffer = Buffer.allocUnsafe(65536);
    let total = 0,
      read: number;
    while ((read = readSync(handle, buffer, 0, buffer.length, null)) > 0) {
      total += read;
      if (total > limit) fail();
      hash.update(buffer.subarray(0, read));
    }
    if (total !== stat.size || fstatSync(handle).size !== stat.size) fail();
    return { path, sha256: hash.digest("hex") };
  } finally {
    closeSync(handle);
  }
}
function executablePath(value: string, environment: NodeJS.ProcessEnv): string {
  if (isAbsolute(value)) return value;
  if (!/^codex(?:\.exe|\.cmd)?$/i.test(value)) fail();
  const search =
    Object.entries(environment).find(
      ([key]) => key.toLowerCase() === "path",
    )?.[1] ?? "";
  const names = extname(value) ? [value] : ["codex.exe", "codex.cmd"];
  for (const directory of search.split(delimiter)) {
    const path = directory.replace(/^"|"$/g, "");
    if (!isAbsolute(path)) continue;
    for (const name of names) {
      const candidate = join(path, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return fail();
}

/** Resolve and hash the actual native runner; no shell, wrapper execution or approval. */
export function captureCodexInspectionIdentity(
  configuredExecutable: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): CodexInspectionIdentity {
  try {
    if (process.platform !== "win32" || process.arch !== "x64") fail();
    const original = executablePath(
      configuredExecutable.trim() || "codex",
      environment,
    );
    const invocation = codexInvocation(original);
    const files: FileIdentity[] = [];
    let native = original;
    if (invocation.prefix.length) {
      files.push(fileIdentity(original, 1024 * 1024));
      if (
        invocation.prefix.length !== 1 ||
        basename(invocation.prefix[0]) !== "codex.js"
      )
        fail();
      const entry = fileIdentity(invocation.prefix[0], 1024 * 1024);
      if (entry.sha256 !== WRAPPER_ENTRY_SHA256) fail();
      files.push(entry);
      let packageJson: string | undefined;
      try {
        packageJson = createRequire(entry.path).resolve(
          "@openai/codex-win32-x64/package.json",
        );
      } catch {
        /* Standard vendor fallback. */
      }
      if (packageJson) {
        const packageIdentity = fileIdentity(packageJson, 1024 * 1024);
        files.push(packageIdentity);
        native = join(
          dirname(packageIdentity.path),
          "vendor",
          "x86_64-pc-windows-msvc",
          "bin",
          "codex.exe",
        );
      } else
        native = join(
          dirname(entry.path),
          "..",
          "vendor",
          "x86_64-pc-windows-msvc",
          "bin",
          "codex.exe",
        );
    }
    if (extname(native).toLowerCase() !== ".exe") fail();
    const nativeIdentity = fileIdentity(native, 512 * 1024 * 1024);
    files.push(nativeIdentity);
    const environmentFingerprint = digest(
      JSON.stringify(
        Object.entries(environment).sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
    return {
      nativePath: nativeIdentity.path,
      files,
      environmentFingerprint,
      fingerprint: digest(
        JSON.stringify([
          original,
          realpathSync(cwd),
          files,
          environmentFingerprint,
        ]),
      ),
    };
  } catch {
    return fail();
  }
}

/** Compare bytes again; even a replacement at the same path invalidates this evidence. */
export function assertCodexInspectionIdentity(
  expected: CodexInspectionIdentity,
  configuredExecutable: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): void {
  const actual = captureCodexInspectionIdentity(
    configuredExecutable,
    cwd,
    environment,
  );
  if (actual.fingerprint !== expected.fingerprint) fail();
}
