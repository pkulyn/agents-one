import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  writeSync,
  unlinkSync,
  type Stats,
} from "node:fs";
import { join, relative, isAbsolute, sep } from "node:path";
import { terminateProcessTree } from "../process-control";
import {
  captureCodexInspectionIdentity,
  assertReviewedCodexInspectionNative,
  assertCodexInspectionIdentity,
} from "./codex-invocation-identity";
import {
  createProjectInspection,
  projectPathSegments,
} from "./project-inspection";
import type { ProjectTextWriteIntent } from "./project-text-write";
import type { AgentRuntimeArtifact } from "../../shared/agent-runtimes";

type Receipt = Omit<ProjectTextWriteIntent, "previousText">;
interface RecordEntry {
  version: 1;
  namespace: string;
  inputHash: string;
  phase:
    | "accepted"
    | "prepared"
    | "committing"
    | "applied"
    | "failed"
    | "uncertain";
  intent?: ProjectTextWriteIntent;
  receipt?: Receipt;
}
export interface ProjectWriteCommand {
  key: string;
  path: string;
  text: string;
  expectedSha256: string | null;
  signal: AbortSignal;
}
export interface RetainedWriteReview {
  id: string;
  path: string;
  state: "matches_requested" | "matches_previous" | "changed" | "unavailable";
  sha256?: string;
  reviewToken: string;
}
export interface ClosedWriteEvidence {
  root: string;
  rootIdentity: { dev: number; ino: number; birthtimeMs: number };
  directoryIdentity: { dev: number; ino: number; birthtimeMs: number };
  coordinationIdentity: { dev: number; ino: number; birthtimeMs: number };
  namespace: string;
  journalName: string;
  journalSha256: string;
  lockName: string;
  lockSha256: string;
  lockIdentity: { dev: number; ino: number; birthtimeMs: number };
  path: string;
  sha256: string;
  previousSha256: string | null;
  bytes: number;
}
interface OwnedLease {
  owned(): boolean;
  release(): boolean;
  evidence(): Pick<
    ClosedWriteEvidence,
    "lockName" | "lockSha256" | "lockIdentity"
  >;
}
const hash = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
const same = (a: Stats, b: Stats): boolean =>
  a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;
const statIdentity = (
  stat: Stats,
): { dev: number; ino: number; birthtimeMs: number } => ({
  dev: stat.dev,
  ino: stat.ino,
  birthtimeMs: stat.birthtimeMs,
});
function fail(code = "reconciliation_required"): never {
  throw Object.assign(Error(code), { code });
}
function readOrdinary(file: string, limit: number): Buffer {
  const stat = lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > limit
  )
    fail();
  const fd = openSync(file, "r");
  try {
    const opened = fstatSync(fd);
    if (!same(stat, opened) || opened.nlink !== 1 || opened.size > limit)
      fail();
    const bytes = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < bytes.length) {
      const n = readSync(fd, bytes, count, bytes.length - count, null);
      if (!n) break;
      count += n;
    }
    if (count > limit) fail();
    const after = fstatSync(fd),
      current = lstatSync(file);
    if (
      !same(opened, after) ||
      !same(after, current) ||
      current.isSymbolicLink() ||
      current.nlink !== 1 ||
      after.nlink !== 1 ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      count !== after.size
    )
      fail();
    return bytes.subarray(0, count);
  } finally {
    closeSync(fd);
  }
}

/** Main-owned audit/authorization handshake. Pending attempts are never automatically dispatched again. */
export class ProjectWriteRunner {
  private readonly directory: string;
  private readonly root: string;
  private readonly namespace: string;
  private readonly rootIdentity: Stats;
  private readonly directoryIdentity: Stats;
  private readonly coordination: string;
  private readonly coordinationIdentity: Stats;
  private serial: Promise<void> = Promise.resolve();
  private readonly snapshots = new Map<string, AgentRuntimeArtifact>();
  private snapshotLimitReached = false;
  private readonly retained = new Map<
    string,
    {
      file: string;
      journalHash: string;
      command: ProjectWriteCommand;
      lease: OwnedLease;
    }
  >();
  constructor(
    private readonly options: {
      root: string;
      directory: string;
      namespace: string;
      executablePath: string;
      workerPath: string;
      expectedWorkerSha256?: string;
      authorize(): void;
      assertWritesAllowed(): void;
      authorizeRecovery?(): void;
      onRetained?(
        id: string,
        path: string,
        evidence?: ClosedWriteEvidence,
      ): void;
      nodeExecutable?: string;
      timeoutMs?: number;
      coordinationDirectory?: string;
    },
  ) {
    this.root = realpathSync(options.root);
    this.rootIdentity = lstatSync(this.root);
    if (
      lstatSync(options.root).isSymbolicLink() ||
      !lstatSync(this.root).isDirectory()
    )
      fail("unverified_policy");
    mkdirSync(options.directory, { recursive: true });
    this.directory = realpathSync(options.directory);
    this.directoryIdentity = lstatSync(this.directory);
    if (lstatSync(options.directory).isSymbolicLink())
      fail("unverified_policy");
    this.namespace = hash(JSON.stringify([options.namespace, this.root]));
    const coordination = options.coordinationDirectory ?? this.directory;
    mkdirSync(coordination, { recursive: true });
    this.coordination = realpathSync(coordination);
    this.coordinationIdentity = lstatSync(this.coordination);
    if (lstatSync(coordination).isSymbolicLink()) fail("unverified_policy");
    const lockRelation = relative(this.root, this.coordination);
    if (
      !lockRelation ||
      (!isAbsolute(lockRelation) &&
        lockRelation !== ".." &&
        !lockRelation.startsWith(`..${sep}`))
    )
      fail("unverified_policy");
    const relation = relative(this.root, this.directory);
    if (
      !relation ||
      (!isAbsolute(relation) &&
        relation !== ".." &&
        !relation.startsWith(`..${sep}`))
    )
      fail("unverified_policy");
  }
  write(command: ProjectWriteCommand): Promise<Receipt> {
    const fixed = Object.freeze({ ...command });
    const promise = this.serial.then(() => this.apply(fixed));
    this.serial = promise.then(
      () => undefined,
      () => undefined,
    );
    return promise;
  }
  projectRoot(): string {
    return this.root;
  }
  /** Main-only; available solely after this runner observed the worker's actual close. */
  reviewRetainedWrites(): Promise<RetainedWriteReview[]> {
    return this.serial.then(() =>
      [...this.retained.keys()].map((id) => this.review(id)),
    );
  }
  releaseRetainedWrite(
    id: string,
    reviewToken: string,
    acknowledged: boolean,
    assertCaller?: () => void,
  ): Promise<void> {
    const operation = this.serial.then(() => {
      assertCaller?.();
      if (acknowledged !== true) fail("confirmation_required");
      const review = this.review(id);
      if (review.reviewToken !== reviewToken) fail("revision_conflict");
      const retained = this.retained.get(id)!;
      const record = JSON.parse(
        readOrdinary(retained.file, 2 * 1024 * 1024).toString("utf8"),
      );
      record.ownerReleaseAuthorized = {
        reviewedAt: new Date().toISOString(),
        state: review.state,
        ...(review.sha256 ? { observedSha256: review.sha256 } : {}),
      };
      this.recoveryGuard();
      if (
        !retained.lease.owned() ||
        hash(readOrdinary(retained.file, 2 * 1024 * 1024)) !==
          retained.journalHash
      )
        fail();
      this.save(retained.file, record);
      retained.journalHash = hash(readOrdinary(retained.file, 2 * 1024 * 1024));
      this.recoveryGuard();
      assertCaller?.();
      if (!retained.lease.release()) fail();
      this.retained.delete(id);
    });
    this.serial = operation.catch(() => undefined);
    return operation;
  }
  private recoveryGuard(): void {
    if (!this.options.authorizeRecovery) fail("unverified_policy");
    const value: unknown = this.options.authorizeRecovery();
    if (value instanceof Promise) void value.catch(() => undefined);
    if (
      value !== undefined ||
      realpathSync(this.options.root) !== this.root ||
      lstatSync(this.options.root).isSymbolicLink() ||
      !same(lstatSync(this.root), this.rootIdentity) ||
      realpathSync(this.options.directory) !== this.directory ||
      lstatSync(this.options.directory).isSymbolicLink() ||
      !same(lstatSync(this.directory), this.directoryIdentity)
    )
      fail();
    this.options.assertWritesAllowed();
  }
  private review(id: string): RetainedWriteReview {
    this.recoveryGuard();
    const retained = this.retained.get(id);
    if (!retained || !retained.lease.owned()) fail();
    const journalHash = hash(readOrdinary(retained.file, 2 * 1024 * 1024));
    if (journalHash !== retained.journalHash) fail();
    let sha256: string | undefined;
    try {
      sha256 = createProjectInspection(this.root, () =>
        this.recoveryGuard(),
      ).readText(retained.command.path).sha256;
    } catch {
      // An unreadable or missing file is an observation, never evidence that the write did not happen.
    }
    this.recoveryGuard();
    if (
      !retained.lease.owned() ||
      hash(readOrdinary(retained.file, 2 * 1024 * 1024)) !== journalHash
    )
      fail();
    const state: RetainedWriteReview["state"] = !sha256
      ? "unavailable"
      : sha256 === hash(retained.command.text)
        ? "matches_requested"
        : sha256 === retained.command.expectedSha256
          ? "matches_previous"
          : "changed";
    return {
      id,
      path: retained.command.path,
      state,
      ...(sha256 ? { sha256 } : {}),
      reviewToken: hash(
        JSON.stringify([id, journalHash, state, sha256 ?? null]),
      ),
    };
  }
  /** Confirmed written bytes, never the later contents of a mutable project path. */
  artifacts(): AgentRuntimeArtifact[] {
    return structuredClone([
      ...this.snapshots.values(),
      ...(this.snapshotLimitReached
        ? [
            {
              id: `write-limit-${this.namespace}`,
              kind: "file" as const,
              label: "Additional written files",
              unavailableReason:
                "This Run exceeded the written file snapshot limit. Review additional changes on the desktop.",
            },
          ]
        : []),
    ]);
  }
  private capture(command: ProjectWriteCommand, receipt: Receipt): void {
    const id = `write-${hash(JSON.stringify([this.namespace, receipt.path, receipt.sha256]))}`;
    if (this.snapshots.has(id)) return;
    if (this.snapshots.size >= 99) {
      this.snapshotLimitReached = true;
      return;
    }
    this.snapshots.set(id, {
      id,
      kind: "file",
      label: receipt.path,
      mime: "text/plain",
      size: receipt.bytes,
      sha256: receipt.sha256,
      content: command.text,
    });
  }
  private lease(): OwnedLease {
    const location =
      this.options.coordinationDirectory ?? this.options.directory;
    if (
      realpathSync(location) !== this.coordination ||
      lstatSync(location).isSymbolicLink() ||
      !same(lstatSync(this.coordination), this.coordinationIdentity)
    )
      fail("unverified_policy");
    const path = join(
      this.coordination,
      `project-${hash(process.platform === "win32" ? this.root.toLowerCase() : this.root)}.lock`,
    );
    let fd: number;
    try {
      fd = openSync(path, "wx", 0o600);
    } catch {
      return fail("project_write_busy");
    }
    const identity = fstatSync(fd),
      bytes = Buffer.from(
        JSON.stringify({ version: 1, token: randomUUID(), pid: process.pid }),
      );
    try {
      let offset = 0;
      while (offset < bytes.length)
        offset += writeSync(fd, bytes, offset, bytes.length - offset);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const owned = (): boolean => {
      try {
        if (
          realpathSync(location) !== this.coordination ||
          lstatSync(location).isSymbolicLink() ||
          !same(lstatSync(this.coordination), this.coordinationIdentity)
        )
          return false;
        const actual = lstatSync(path, { throwIfNoEntry: false });
        return Boolean(
          actual?.isFile() &&
          !actual.isSymbolicLink() &&
          actual.nlink === 1 &&
          same(actual, identity) &&
          hash(readOrdinary(path, 4096)) === hash(bytes),
        );
      } catch {
        /* Preserve unknown lock ownership or replacement bytes. */
        return false;
      }
    };
    return {
      owned,
      evidence: () => {
        if (!owned()) fail();
        return {
          lockName: path.slice(path.lastIndexOf(sep) + 1),
          lockSha256: hash(bytes),
          lockIdentity: statIdentity(lstatSync(path)),
        };
      },
      release: () => {
        try {
          if (!owned()) return false;
          unlinkSync(path);
          return true;
        } catch {
          return false;
        }
      },
    };
  }
  private guard(command: ProjectWriteCommand): void {
    if (command.signal.aborted) fail("revoked");
    const value: unknown = this.options.authorize();
    if (command.signal.aborted) fail("revoked");
    if (value instanceof Promise) void value.catch(() => undefined);
    if (
      value !== undefined ||
      !same(lstatSync(this.root), this.rootIdentity) ||
      realpathSync(this.options.root) !== this.root ||
      lstatSync(this.options.root).isSymbolicLink()
    )
      fail("unverified_policy");
  }
  private save(file: string, record: RecordEntry): void {
    this.options.assertWritesAllowed();
    if (
      realpathSync(this.options.directory) !== this.directory ||
      !same(lstatSync(this.directory), this.directoryIdentity) ||
      lstatSync(this.options.directory).isSymbolicLink()
    )
      fail();
    const temporary = `${file}.tmp-${randomUUID()}`,
      fd = openSync(temporary, "wx", 0o600);
    try {
      const body = Buffer.from(JSON.stringify(record));
      let offset = 0;
      while (offset < body.length)
        offset += writeSync(fd, body, offset, body.length - offset);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.options.assertWritesAllowed();
    renameSync(temporary, file);
  }
  private claim(file: string, record: RecordEntry): void {
    this.options.assertWritesAllowed();
    if (
      realpathSync(this.options.directory) !== this.directory ||
      !same(lstatSync(this.directory), this.directoryIdentity) ||
      lstatSync(this.options.directory).isSymbolicLink()
    )
      fail();
    const fd = openSync(file, "wx", 0o600);
    try {
      const body = Buffer.from(JSON.stringify(record));
      let offset = 0;
      while (offset < body.length)
        offset += writeSync(fd, body, offset, body.length - offset);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  private async apply(command: ProjectWriteCommand): Promise<Receipt> {
    this.guard(command);
    if (
      typeof command.key !== "string" ||
      !command.key ||
      command.key.length > 160 ||
      typeof command.text !== "string" ||
      command.text.includes("\0") ||
      Buffer.byteLength(command.text) > 256 * 1024 ||
      Buffer.from(command.text).toString("utf8") !== command.text ||
      (command.expectedSha256 !== null &&
        !/^[a-f0-9]{64}$/.test(command.expectedSha256))
    )
      fail("invalid_input");
    projectPathSegments(command.path, false);
    const timeout = this.options.timeoutMs ?? 10000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000)
      fail("invalid_input");
    const inputHash = hash(
      JSON.stringify([command.path, command.text, command.expectedSha256]),
    );
    const file = join(
      this.directory,
      `${hash(JSON.stringify([this.namespace, command.key]))}.json`,
    );
    if (lstatSync(file, { throwIfNoEntry: false })) {
      let old: RecordEntry;
      try {
        old = JSON.parse(readOrdinary(file, 2 * 1024 * 1024).toString("utf8"));
      } catch {
        return fail();
      }
      if (
        old.version !== 1 ||
        old.namespace !== this.namespace ||
        old.inputHash !== inputHash
      )
        fail("idempotency_conflict");
      if (
        old.phase === "applied" &&
        old.receipt &&
        Object.keys(old.receipt).sort().join(",") ===
          "bytes,path,previousSha256,sha256" &&
        old.receipt.path === command.path &&
        old.receipt.sha256 === hash(command.text) &&
        old.receipt.bytes === Buffer.byteLength(command.text) &&
        old.receipt.previousSha256 === command.expectedSha256
      ) {
        this.capture(command, old.receipt);
        return structuredClone(old.receipt);
      }
      return fail();
    }
    const record: RecordEntry = {
      version: 1,
      namespace: this.namespace,
      inputHash,
      phase: "accepted",
    };
    const lease = this.lease();
    let workerClosed = false;
    let permitted = false,
      claimed = false;
    try {
      this.claim(file, record);
      claimed = true;
      const environment = { ...process.env };
      const identity = captureCodexInspectionIdentity(
        this.options.executablePath,
        this.root,
        environment,
      );
      assertReviewedCodexInspectionNative(identity);
      const worker = readOrdinary(this.options.workerPath, 1024 * 1024);
      if (
        this.options.expectedWorkerSha256 !== undefined &&
        (!/^[a-f0-9]{64}$/.test(this.options.expectedWorkerSha256) ||
          hash(worker) !== this.options.expectedWorkerSha256)
      )
        fail("unverified_policy");
      const workerFile = join(this.directory, `worker-${randomUUID()}.cjs`),
        workerFd = openSync(workerFile, "wx", 0o600);
      try {
        let offset = 0;
        while (offset < worker.length)
          offset += writeSync(workerFd, worker, offset, worker.length - offset);
        fsyncSync(workerFd);
      } finally {
        closeSync(workerFd);
      }
      this.guard(command);
      assertCodexInspectionIdentity(
        identity,
        this.options.executablePath,
        this.root,
        environment,
      );
      const child = spawn(
        identity.nativePath,
        [
          "sandbox",
          "--permission-profile",
          ":workspace",
          "-C",
          this.root,
          "--",
          this.options.nodeExecutable ?? process.execPath,
          workerFile,
        ],
        {
          cwd: this.root,
          env: {
            ...environment,
            ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          },
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let buffer = "",
        bytes = 0,
        applied: Receipt | undefined,
        failed = false,
        stopping = false;
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const stop = (): void => {
        if (stopping) return;
        stopping = true;
        void terminateProcessTree(child).catch(() => child.kill());
      };
      const timer = setTimeout(stop, timeout),
        refresh = setInterval(() => {
          try {
            this.guard(command);
          } catch {
            stop();
          }
        }, 100);
      command.signal.addEventListener("abort", stop, { once: true });
      child.stdin?.on("error", stop);
      child.stderr?.resume();
      child.stdout?.on("data", (chunk: Buffer) => {
        if (stopping) return;
        try {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) fail();
          buffer += decoder.decode(chunk, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const frame = JSON.parse(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            if (!frame || typeof frame !== "object" || Array.isArray(frame))
              fail();
            if (
              frame.kind === "prepared" &&
              Object.keys(frame).sort().join(",") === "intent,kind" &&
              !permitted &&
              record.phase === "accepted"
            ) {
              const intent = frame.intent as ProjectTextWriteIntent;
              if (
                !intent ||
                Object.keys(intent).sort().join(",") !==
                  "bytes,path,previousSha256,previousText,sha256" ||
                intent.path !== command.path ||
                intent.sha256 !== hash(command.text) ||
                intent.bytes !== Buffer.byteLength(command.text) ||
                intent.previousSha256 !== command.expectedSha256 ||
                (intent.previousText !== null &&
                  (typeof intent.previousText !== "string" ||
                    Buffer.byteLength(intent.previousText) > 256 * 1024 ||
                    intent.previousText.includes("\0") ||
                    hash(intent.previousText) !== intent.previousSha256)) ||
                (intent.previousText === null && intent.previousSha256 !== null)
              )
                fail();
              this.guard(command);
              record.intent = intent;
              record.phase = "prepared";
              this.save(file, record);
              this.guard(command);
              record.phase = "committing";
              this.save(file, record);
              this.guard(command);
              permitted = true;
              child.stdin?.write('{"commit":true}\n');
            } else if (
              frame.kind === "applied" &&
              Object.keys(frame).sort().join(",") === "kind,receipt" &&
              permitted &&
              !applied &&
              !failed
            ) {
              const expected = {
                path: command.path,
                previousSha256: command.expectedSha256,
                sha256: hash(command.text),
                bytes: Buffer.byteLength(command.text),
              };
              if (
                !frame.receipt ||
                Object.keys(frame.receipt).sort().join(",") !==
                  "bytes,path,previousSha256,sha256" ||
                Object.entries(expected).some(
                  ([key, value]) => frame.receipt[key] !== value,
                )
              )
                fail();
              applied = expected;
            } else if (
              frame.kind === "failed" &&
              Object.keys(frame).join(",") === "kind" &&
              !applied &&
              !failed
            ) {
              failed = true;
            } else fail();
          }
        } catch {
          stop();
        }
      });
      const code = await new Promise<number | null>((resolve) => {
        child.once("error", stop);
        child.once("close", (code) => {
          workerClosed = true;
          resolve(code);
        });
        child.stdin?.write(
          JSON.stringify({
            root: this.root,
            path: command.path,
            text: command.text,
            expectedSha256: command.expectedSha256,
          }) + "\n",
        );
      });
      clearTimeout(timer);
      clearInterval(refresh);
      command.signal.removeEventListener("abort", stop);
      buffer += decoder.decode();
      if (stopping || code !== 0 || !applied || buffer.trim()) fail();
      record.phase = "applied";
      record.receipt = applied;
      this.save(file, record);
      this.capture(command, applied);
      return applied;
    } catch {
      if (!claimed) return fail();
      record.phase = permitted ? "uncertain" : "failed";
      try {
        this.save(file, record);
      } catch {
        /* Retain the preceding durable phase when persistence is unavailable. */
      }
      return fail();
    } finally {
      if (claimed && permitted && workerClosed && record.phase !== "applied") {
        try {
          const journalHash = hash(readOrdinary(file, 2 * 1024 * 1024));
          this.retained.set(hash(file), { file, journalHash, command, lease });
          let evidence: ClosedWriteEvidence | undefined;
          if (lease.owned())
            evidence = {
              root: this.root,
              rootIdentity: statIdentity(this.rootIdentity),
              directoryIdentity: statIdentity(this.directoryIdentity),
              coordinationIdentity: statIdentity(this.coordinationIdentity),
              namespace: this.namespace,
              journalName: file.slice(file.lastIndexOf(sep) + 1),
              journalSha256: journalHash,
              ...lease.evidence(),
              path: command.path,
              sha256: hash(command.text),
              previousSha256: command.expectedSha256,
              bytes: Buffer.byteLength(command.text),
            };
          this.options.onRetained?.(hash(file), command.path, evidence);
        } catch {
          // Keep the uncertain lock; unverifiable audit bytes cannot create a recovery capability.
        }
      }
      if (
        !claimed ||
        record.phase === "applied" ||
        (!permitted && record.phase === "failed")
      )
        lease.release();
    }
  }
}
