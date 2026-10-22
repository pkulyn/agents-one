import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, relative, isAbsolute, sep } from "node:path";
import { ProjectWriteRunner } from "./project-write-runner";

const hash = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
function digest(file: string, limit: number): string {
  const stat = lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > limit
  )
    throw Error("unverified_policy");
  const fd = openSync(file, "r");
  try {
    const opened = fstatSync(fd),
      h = createHash("sha256"),
      bytes = Buffer.alloc(1024 * 1024);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) throw Error();
    let count = 0,
      n: number;
    while ((n = readSync(fd, bytes, 0, bytes.length, null))) {
      count += n;
      if (count > limit) throw Error();
      h.update(bytes.subarray(0, n));
    }
    const after = fstatSync(fd),
      current = lstatSync(file);
    if (
      count !== opened.size ||
      current.isSymbolicLink() ||
      current.nlink !== 1 ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      current.birthtimeMs !== opened.birthtimeMs ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      current.mtimeMs !== opened.mtimeMs
    )
      throw Error();
    return h.digest("hex");
  } finally {
    closeSync(fd);
  }
}
export interface CodexProjectWriteBinding {
  workerPath: string;
  workerSha256: string;
  nodeExecutable: string;
  fingerprint: string;
  assertCurrent(): void;
}
const loadedMainHash = (() => {
  try {
    return digest(__filename, 32 * 1024 * 1024);
  } catch {
    return undefined;
  }
})();
/** Actual installed Main/worker/Node bytes, never a renderer or model assertion. */
export function readCodexProjectWriteBinding(): CodexProjectWriteBinding {
  const workerPath = join(__dirname, "project-text-write-worker.cjs"),
    nodeExecutable = process.execPath;
  const files: [string, number][] = [
    [workerPath, 1024 * 1024],
    [__filename, 32 * 1024 * 1024],
    [nodeExecutable, 512 * 1024 * 1024],
  ];
  const values = files.map(([file, limit]) => digest(file, limit));
  if (!loadedMainHash || values[1] !== loadedMainHash)
    throw Error("unverified_policy");
  return {
    workerPath,
    workerSha256: values[0],
    nodeExecutable,
    fingerprint: hash(JSON.stringify(values)),
    assertCurrent: () => {
      files.forEach(([file, limit], i) => {
        if (digest(file, limit) !== values[i]) throw Error("unverified_policy");
      });
    },
  };
}
/** Runs the exact built worker through Main's actual audit/commit protocol in an isolated project. */
export async function probeCodexProjectWriteWorker(input: {
  executablePath: string;
  privateDirectory: string;
  binding: CodexProjectWriteBinding;
}): Promise<{
  verified: boolean;
  workerSha256: string;
  error?: "probe_failed";
}> {
  let root: string | undefined;
  let verified = false;
  try {
    const base = realpathSync(input.privateDirectory);
    if (lstatSync(input.privateDirectory).isSymbolicLink()) throw Error();
    root = mkdtempSync(join(base, "codex-write-worker-"));
    const project = join(root, "project"),
      audit = join(root, "audit"),
      outside = join(root, "outside");
    mkdirSync(project);
    mkdirSync(outside);
    const original = `original-${randomUUID()}`,
      replacement = `written-${randomUUID()}`;
    writeFileSync(join(project, "existing.txt"), original);
    writeFileSync(join(outside, "file.txt"), original);
    symlinkSync(outside, join(project, "linked"), "junction");
    let audited = false,
      revoke = false;
    const records = (): Array<{
      phase: string;
      intent?: { previousText?: string | null };
    }> =>
      readdirSync(audit)
        .filter((n) => /^[a-f0-9]{64}\.json$/.test(n))
        .map((n) => JSON.parse(readFileSync(join(audit, n), "utf8")));
    const runner = new ProjectWriteRunner({
      root: project,
      directory: audit,
      namespace: "main-policy-probe",
      executablePath: input.executablePath,
      workerPath: input.binding.workerPath,
      expectedWorkerSha256: input.binding.workerSha256,
      nodeExecutable: input.binding.nodeExecutable,
      assertWritesAllowed: () => input.binding.assertCurrent(),
      authorize: () => {
        input.binding.assertCurrent();
        for (const record of records())
          if (record.phase === "committing") {
            if (
              record.intent?.previousText === original &&
              readFileSync(join(project, "existing.txt"), "utf8") === original
            )
              audited = true;
            if (revoke) throw Error("revoked");
          }
      },
    });
    const signal = new AbortController().signal;
    // @lat: [[mobile-data#Mobile data#Actual built worker approval proof]]
    const command = {
      key: "replace-proof",
      path: "existing.txt",
      text: replacement,
      expectedSha256: hash(original),
      signal,
    };
    const receipt = await runner.write(command);
    const replay = await runner.write(command);
    if (
      !audited ||
      readFileSync(join(project, "existing.txt"), "utf8") !== replacement ||
      receipt.sha256 !== hash(replacement) ||
      JSON.stringify(receipt) !== JSON.stringify(replay)
    )
      throw Error();
    const created = await runner.write({
      key: "create-proof",
      path: "created.txt",
      text: replacement,
      expectedSha256: null,
      signal,
    });
    if (
      created.previousSha256 !== null ||
      created.sha256 !== hash(replacement) ||
      readFileSync(join(project, "created.txt"), "utf8") !== replacement
    )
      throw Error();
    let escaped = false;
    for (const path of ["../outside/file.txt", "linked/file.txt"]) {
      try {
        await runner.write({
          key: `deny-${path}`,
          path,
          text: replacement,
          expectedSha256: hash(original),
          signal,
        });
        escaped = true;
      } catch {
        /* Expected rejection must leave the outside marker intact. */
      }
    }
    if (escaped || readFileSync(join(outside, "file.txt"), "utf8") !== original)
      throw Error();
    revoke = true;
    let accepted = false;
    try {
      await runner.write({
        key: "revoke-proof",
        path: "revoked.txt",
        text: replacement,
        expectedSha256: null,
        signal,
      });
      accepted = true;
    } catch {
      /* Main revocation must prevent the commit grant. */
    }
    if (
      accepted ||
      existsSync(join(project, "revoked.txt")) ||
      records().some((r) => !["applied", "failed"].includes(r.phase)) ||
      !records().some((r) => r.phase === "failed")
    )
      throw Error();
    input.binding.assertCurrent();
    verified = true;
  } catch {
    return {
      verified: false,
      workerSha256: input.binding.workerSha256,
      error: "probe_failed",
    };
  } finally {
    // Retain failed/uncertain audit evidence. Remove only our ordinary verified probe subtree.
    if (verified && root) {
      const base = realpathSync(input.privateDirectory),
        actual = realpathSync(root),
        relation = relative(base, actual);
      if (
        actual === root &&
        !lstatSync(root).isSymbolicLink() &&
        relation &&
        relation !== ".." &&
        !relation.startsWith(`..${sep}`) &&
        !isAbsolute(relation)
      )
        rmSync(root, { recursive: true, force: true });
    }
  }
  return { verified: true, workerSha256: input.binding.workerSha256 };
}
