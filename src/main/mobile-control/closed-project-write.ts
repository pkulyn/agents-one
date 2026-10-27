import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  writeSync,
  renameSync,
  unlinkSync,
  opendirSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { agentsOneProfileHome, getActiveProfileNameSync } from "../utils";
import { assertAgentsOneWritesAllowed } from "../restore-write-lock";
import { listProjectFolders } from "../project-folders";
import { resolveAuthorizedWorkspaceId } from "../workspace-authority";
import { readMobileDataGeneration } from "./data-generation";
import {
  createProjectInspection,
  projectPathSegments,
} from "./project-inspection";
import type {
  ClosedWriteEvidence,
  RetainedWriteReview,
} from "./project-write-runner";
import type { MobileWriteRecoveryItem } from "../../shared/mobile-write-recovery";

type Identity = { dev: number; ino: number; birthtimeMs: number };
interface Proof extends ClosedWriteEvidence {
  version: 1;
  profile: string;
  runId: string;
  projectId: string;
  localId: string;
  ownerPid: number;
  closedAt: string;
  generation: string;
  homeIdentity: Identity;
}
export interface WriteRecoveryCapability {
  reviewRetainedWrites(): Promise<RetainedWriteReview[]>;
  releaseRetainedWrite(
    id: string,
    token: string,
    acknowledged: boolean,
    assertCaller?: () => void,
  ): Promise<void>;
}
const hash = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");
function fail(code = "requires_owner_action"): never {
  throw Object.assign(Error(code), { code });
}
const equalPath = (a: string, b: string): boolean =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const matches = (stat: Stats, id: Identity): boolean =>
  stat.dev === id.dev &&
  stat.ino === id.ino &&
  stat.birthtimeMs === id.birthtimeMs;
function identityValid(value: Identity): boolean {
  return Boolean(
    value &&
    Object.keys(value).sort().join(",") === "birthtimeMs,dev,ino" &&
    [value.dev, value.ino, value.birthtimeMs].every(Number.isFinite),
  );
}
function directory(path: string, id?: Identity): void {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !equalPath(realpathSync(path), path) ||
    (id && !matches(stat, id))
  )
    fail();
}
function bytes(file: string, limit: number): Buffer {
  const before = lstatSync(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size > limit
  )
    fail();
  const fd = openSync(file, "r");
  try {
    const opened = fstatSync(fd);
    if (!matches(opened, before) || opened.nlink !== 1 || opened.size > limit)
      fail();
    const buffer = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, null);
      if (!read) break;
      count += read;
    }
    const after = fstatSync(fd),
      current = lstatSync(file);
    if (
      count > limit ||
      count !== after.size ||
      !matches(after, opened) ||
      !matches(current, after) ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      current.nlink !== 1 ||
      current.isSymbolicLink()
    )
      fail();
    return buffer.subarray(0, count);
  } finally {
    closeSync(fd);
  }
}
function dead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
function validate(proof: Proof): void {
  const fields =
    "bytes,closedAt,coordinationIdentity,directoryIdentity,generation,homeIdentity,journalName,journalSha256,localId,lockIdentity,lockName,lockSha256,namespace,ownerPid,path,previousSha256,profile,projectId,root,rootIdentity,runId,sha256,version";
  if (
    !proof ||
    Object.keys(proof).sort().join(",") !== fields ||
    proof.version !== 1 ||
    !/^run-[a-f0-9-]{36}$/.test(proof.runId) ||
    !Number.isSafeInteger(proof.ownerPid) ||
    proof.ownerPid <= 0 ||
    proof.ownerPid > 0x7fffffff ||
    !Number.isFinite(Date.parse(proof.closedAt)) ||
    Date.parse(proof.closedAt) > Date.now() + 1000 ||
    ![
      proof.localId,
      proof.journalSha256,
      proof.lockSha256,
      proof.namespace,
      proof.sha256,
    ].every((v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)) ||
    !/[a-f0-9]{64}\.json$/.test(proof.journalName) ||
    proof.journalName.length !== 69 ||
    !/^project-[a-f0-9]{64}\.lock$/.test(proof.lockName) ||
    (proof.previousSha256 !== null &&
      !/^[a-f0-9]{64}$/.test(proof.previousSha256)) ||
    !Number.isSafeInteger(proof.bytes) ||
    proof.bytes < 0 ||
    proof.bytes > 256 * 1024 ||
    ![
      proof.homeIdentity,
      proof.rootIdentity,
      proof.directoryIdentity,
      proof.coordinationIdentity,
      proof.lockIdentity,
    ].every(identityValid)
  )
    fail();
  projectPathSegments(proof.path, false);
}
/** Called solely by the runner's actual-close callback; private audit authority is not an IPC input. */
export function persistClosedProjectWrite(input: {
  profile: string;
  runId: string;
  projectId: string;
  localId: string;
  homeIdentity: Identity;
  generation: string;
  evidence: ClosedWriteEvidence;
}): void {
  const home = agentsOneProfileHome(input.profile),
    folder = join(home, "desktop/mobile-control/project-writes");
  const proof: Proof = {
    ...input.evidence,
    version: 1,
    profile: input.profile,
    runId: input.runId,
    projectId: input.projectId,
    localId: input.localId,
    homeIdentity: input.homeIdentity,
    generation: input.generation,
    ownerPid: process.pid,
    closedAt: new Date().toISOString(),
  };
  validate(proof);
  assertAgentsOneWritesAllowed();
  directory(home, proof.homeIdentity);
  directory(folder, proof.directoryIdentity);
  if (readMobileDataGeneration(home) !== proof.generation) fail();
  const file = join(folder, `closed-${proof.localId}.json`),
    body = Buffer.from(JSON.stringify(proof));
  if (body.length > 16384) fail();
  const fd = openSync(file, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < body.length)
      offset += writeSync(fd, body, offset, body.length - offset);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
class ClosedCapability implements WriteRecoveryCapability {
  private journalHash: string;
  constructor(
    private readonly proof: Proof,
    private readonly marker: string,
    private readonly markerHash: string,
  ) {
    this.journalHash = proof.journalSha256;
  }
  assertCurrent(): void {
    this.check();
  }
  private check(): {
    journal: string;
    lock: string;
    record: Record<string, unknown>;
  } {
    const p = this.proof,
      home = agentsOneProfileHome(p.profile),
      folder = join(home, "desktop/mobile-control/project-writes"),
      coordination = join(
        agentsOneProfileHome(),
        "desktop/mobile-control/project-write-locks",
      );
    assertAgentsOneWritesAllowed();
    if (getActiveProfileNameSync() !== p.profile || !dead(p.ownerPid)) fail();
    directory(home, p.homeIdentity);
    directory(join(home, "desktop"));
    directory(join(home, "desktop/mobile-control"));
    directory(folder, p.directoryIdentity);
    directory(agentsOneProfileHome());
    directory(join(agentsOneProfileHome(), "desktop"));
    directory(join(agentsOneProfileHome(), "desktop/mobile-control"));
    directory(coordination, p.coordinationIdentity);
    if (
      readMobileDataGeneration(home) !== p.generation ||
      hash(bytes(this.marker, 16384)) !== this.markerHash
    )
      fail();
    const registered = resolveAuthorizedWorkspaceId(p.projectId);
    if (!registered || !equalPath(realpathSync(registered), p.root)) fail();
    directory(p.root, p.rootIdentity);
    const lockName = `project-${hash(process.platform === "win32" ? p.root.toLowerCase() : p.root)}.lock`;
    if (lockName !== p.lockName) fail();
    const journal = join(folder, p.journalName),
      lock = join(coordination, lockName),
      lockBody = bytes(lock, 4096);
    if (
      p.localId !== hash(journal) ||
      p.namespace !==
        hash(
          JSON.stringify([
            JSON.stringify([realpathSync(home), p.runId]),
            p.root,
          ]),
        )
    )
      fail();
    if (
      !matches(lstatSync(lock), p.lockIdentity) ||
      hash(lockBody) !== p.lockSha256
    )
      fail();
    const owner = JSON.parse(lockBody.toString("utf8"));
    if (owner.pid !== p.ownerPid) fail();
    const journalBody = bytes(journal, 2 * 1024 * 1024);
    if (hash(journalBody) !== this.journalHash) fail();
    const record = JSON.parse(journalBody.toString("utf8")),
      intent = record.intent;
    if (
      record.version !== 1 ||
      record.namespace !== p.namespace ||
      !["uncertain", "committing"].includes(record.phase) ||
      !intent ||
      intent.path !== p.path ||
      intent.sha256 !== p.sha256 ||
      intent.previousSha256 !== p.previousSha256 ||
      intent.bytes !== p.bytes
    )
      fail();
    return { journal, lock, record };
  }
  private review(): RetainedWriteReview {
    this.check();
    let sha256: string | undefined;
    try {
      sha256 = createProjectInspection(this.proof.root, () => {
        this.check();
      }).readText(this.proof.path).sha256;
    } catch {
      /* Unreadable bytes never prove that the original write did not occur. */
    }
    this.check();
    const state: RetainedWriteReview["state"] = !sha256
      ? "unavailable"
      : sha256 === this.proof.sha256
        ? "matches_requested"
        : sha256 === this.proof.previousSha256
          ? "matches_previous"
          : "changed";
    return {
      id: this.proof.localId,
      path: this.proof.path,
      state,
      ...(sha256 ? { sha256 } : {}),
      reviewToken: hash(
        JSON.stringify([
          this.markerHash,
          this.journalHash,
          state,
          sha256 ?? null,
        ]),
      ),
    };
  }
  async reviewRetainedWrites(): Promise<RetainedWriteReview[]> {
    return [this.review()];
  }
  async releaseRetainedWrite(
    id: string,
    token: string,
    acknowledged: boolean,
    assertCaller?: () => void,
  ): Promise<void> {
    assertCaller?.();
    if (id !== this.proof.localId || acknowledged !== true)
      fail("confirmation_required");
    const review = this.review();
    if (review.reviewToken !== token) fail("revision_conflict");
    const { journal, record } = this.check();
    record.ownerReleaseAuthorized = {
      reviewedAt: new Date().toISOString(),
      state: review.state,
      ...(review.sha256 ? { observedSha256: review.sha256 } : {}),
      closedProof: this.markerHash,
    };
    assertCaller?.();
    this.check();
    const temporary = `${journal}.tmp-${randomUUID()}`,
      body = Buffer.from(JSON.stringify(record)),
      fd = openSync(temporary, "wx", 0o600);
    try {
      let offset = 0;
      while (offset < body.length)
        offset += writeSync(fd, body, offset, body.length - offset);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    assertCaller?.();
    this.check();
    renameSync(temporary, journal);
    this.journalHash = hash(body);
    assertCaller?.();
    const current = this.check();
    unlinkSync(current.lock);
  }
}
export function discoverClosedProjectWrites(
  profile: string,
  knownProjects: Set<string>,
): {
  entries: Array<{
    profile: string;
    runId: string;
    projectId: string;
    localId: string;
    path: string;
    runner: WriteRecoveryCapability;
    restarted: true;
  }>;
  blocked: MobileWriteRecoveryItem[];
} {
  const home = agentsOneProfileHome(profile),
    folder = join(home, "desktop/mobile-control/project-writes"),
    coordination = join(
      agentsOneProfileHome(),
      "desktop/mobile-control/project-write-locks",
    ),
    entries: ReturnType<typeof discoverClosedProjectWrites>["entries"] = [],
    blocked: MobileWriteRecoveryItem[] = [];
  if (getActiveProfileNameSync() !== profile) fail("profile_inactive");
  assertAgentsOneWritesAllowed();
  const found = new Set(knownProjects);
  if (lstatSync(folder, { throwIfNoEntry: false })) {
    directory(home);
    directory(join(home, "desktop"));
    directory(join(home, "desktop/mobile-control"));
    directory(folder);
    const reader = opendirSync(folder);
    try {
      let scanned = 0;
      for (
        let file = reader.readSync();
        file && ++scanned <= 4096;
        file = reader.readSync()
      ) {
        if (
          !/^closed-[a-f0-9]{64}\.json$/.test(file.name) ||
          file.isSymbolicLink()
        )
          continue;
        try {
          const marker = join(folder, file.name),
            body = bytes(marker, 16384),
            proof = JSON.parse(body.toString("utf8")) as Proof;
          validate(proof);
          if (
            proof.profile !== profile ||
            file.name !== `closed-${proof.localId}.json` ||
            found.has(proof.projectId) ||
            !dead(proof.ownerPid)
          )
            continue;
          const runner = new ClosedCapability(proof, marker, hash(body));
          // Validation includes the actual original lock and unchanged private audit, not only marker claims.
          runner.assertCurrent();
          entries.push({
            profile,
            runId: proof.runId,
            projectId: proof.projectId,
            localId: proof.localId,
            path: proof.path,
            runner,
            restarted: true,
          });
          found.add(proof.projectId);
        } catch {
          /* Invalid/missing closure proof stays blocked; never age out or delete a lock. */
        }
      }
    } finally {
      reader.closeSync();
    }
  }
  if (lstatSync(coordination, { throwIfNoEntry: false })) {
    directory(agentsOneProfileHome());
    directory(join(agentsOneProfileHome(), "desktop"));
    directory(join(agentsOneProfileHome(), "desktop/mobile-control"));
    directory(coordination);
    for (const project of listProjectFolders()) {
      if (!project.id || found.has(project.id)) continue;
      const root = resolveAuthorizedWorkspaceId(project.id);
      if (!root) continue;
      const lock = join(
        coordination,
        `project-${hash(process.platform === "win32" ? realpathSync(root).toLowerCase() : realpathSync(root))}.lock`,
      );
      if (lstatSync(lock, { throwIfNoEntry: false }))
        blocked.push({
          id: `blocked-${hash(lock)}`,
          runId: "",
          projectId: project.id,
          path: project.name,
          state: "blocked",
          restrictionReason: "requires_owner_action",
        });
    }
  }
  return { entries, blocked };
}
