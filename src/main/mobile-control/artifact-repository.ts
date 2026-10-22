import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentRuntimeRun } from "../../shared/agent-runtimes";
import { assertMobileSchema } from "../../shared/mobile-control";
import type { Json } from "./conversation-projection";

export interface ArtifactOriginalRun {
  runId: string;
  runtimeId: string;
  conversationId: string;
}
export interface MobileArtifactSource {
  knownRuns(): ArtifactOriginalRun[] | Promise<ArtifactOriginalRun[]>;
  getRun(id: string): Promise<AgentRuntimeRun | null>;
  resolvePath(
    runId: string,
    artifactId: string,
  ): { path: string; label: string } | null;
  guard(): void;
}
interface RecordEntry extends ArtifactOriginalRun {
  version: 1;
  ownerId: string;
  spaceId: string;
  dataEpoch: string;
  nativeArtifactId: string;
  metadata: Json;
}
function fail(code = "requires_owner_action", status = 409): never {
  throw Object.assign(Error(code), { code, status });
}
const key = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pathKey = (value: string): string =>
  process.platform === "win32" ? value.toLowerCase() : value;
function ordinaryPath(file: string, directory = false): void {
  if (
    !isAbsolute(file) ||
    pathKey(realpathSync(file)) !== pathKey(resolve(file))
  )
    fail();
  // realpath equality also rejects directory junctions and symlink parents.
  const stat = lstatSync(file);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
  )
    fail();
}
function displayName(value: string): string {
  const name = value
    .split(/[\\/]/)
    .pop()
    ?.replace(/\p{Cc}/gu, "_")
    .slice(0, 160)
    .trim();
  return name && name !== "." && name !== ".." ? name : "result";
}
async function openOrdinary(
  file: string,
): Promise<Awaited<ReturnType<typeof open>>> {
  ordinaryPath(file);
  const reader = await open(file, "r");
  try {
    ordinaryPath(file);
    const stat = await reader.stat(),
      located = lstatSync(file);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.dev !== located.dev ||
      stat.ino !== located.ino
    )
      fail();
    return reader;
  } catch (error) {
    await reader.close();
    throw error;
  }
}

/** Main-owned immutable delivery copies. Original messages and Runtime output are never file capabilities. */
export class MobileArtifactRepository {
  private readonly root: string;
  private readonly entries = new Map<string, RecordEntry>();
  private work: Promise<void> = Promise.resolve();
  constructor(
    home: string,
    private readonly ownerId: string,
    private readonly spaceId: string,
    private readonly dataEpoch: string,
    private readonly source: MobileArtifactSource,
  ) {
    source.guard();
    ordinaryPath(home, true);
    this.root = join(home, "artifacts", key([ownerId, spaceId, dataEpoch]));
    for (const directory of [join(home, "artifacts"), this.root]) {
      mkdirSync(directory, { recursive: true });
      ordinaryPath(directory, true);
    }
    for (const name of readdirSync(this.root)) {
      if (!/^artifact-[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = join(this.root, name);
      ordinaryPath(file);
      let record: RecordEntry;
      try {
        record = JSON.parse(readFileSync(file, "utf8")) as RecordEntry;
      } catch {
        fail();
      }
      this.validateRecord(record!);
      if (name !== `${record!.metadata.id}.json`) fail();
      this.entries.set(String(record!.metadata.id), record!);
    }
  }
  private validateRecord(record: RecordEntry): void {
    if (
      record?.version !== 1 ||
      record.ownerId !== this.ownerId ||
      record.spaceId !== this.spaceId ||
      record.dataEpoch !== this.dataEpoch ||
      typeof record.conversationId !== "string" ||
      typeof record.runtimeId !== "string" ||
      typeof record.nativeArtifactId !== "string"
    )
      fail();
    assertMobileSchema("Artifact", record.metadata);
    if (
      record.metadata.runId !== record.runId ||
      record.metadata.id !== this.id(record.runId, record.nativeArtifactId)
    )
      fail();
  }
  private id(runId: string, nativeId: string): string {
    return `artifact-${key([this.ownerId, this.spaceId, this.dataEpoch, runId, nativeId])}`;
  }
  private guard(signal?: AbortSignal): void {
    this.source.guard();
    ordinaryPath(this.root, true);
    if (signal?.aborted) fail("revoked", 403);
  }
  private async known(record: ArtifactOriginalRun): Promise<boolean> {
    return (await this.source
      .knownRuns())
      .some(
        (row) =>
          row.runId === record.runId &&
          row.runtimeId === record.runtimeId &&
          row.conversationId === record.conversationId,
      );
  }
  private async available(id: string, signal?: AbortSignal): Promise<RecordEntry> {
    this.guard(signal);
    const record = this.entries.get(id);
    if (!record || !(await this.known(record))) fail("resource_not_found", 404);
    this.validateRecord(record);
    return record;
  }
  private publicMetadata(record: RecordEntry): Json {
    const { id, runId, name, mime, sizeBytes, sha256, expiresAt } =
      record.metadata;
    return {
      id,
      runId,
      name,
      mime,
      sizeBytes,
      sha256,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      allowedActions: ["read", "download"],
    };
  }
  async list(runId: string): Promise<Json[]> {
    this.guard();
    const knownRuns = await this.source.knownRuns();
    return [...this.entries.values()]
      .filter(
        (row) =>
          row.runId === runId &&
          knownRuns.some(
            (known) =>
              known.runId === row.runId &&
              known.runtimeId === row.runtimeId &&
              known.conversationId === row.conversationId,
          ),
      )
      .map((row) => this.publicMetadata(row));
  }
  async metadata(id: string): Promise<Json> {
    return this.publicMetadata(await this.available(id));
  }
  async sync(): Promise<void> {
    for (const original of await this.source.knownRuns()) {
      this.guard();
      const run = await this.source.getRun(original.runId);
      if (run) {
        if (run.id !== original.runId || run.runtimeId !== original.runtimeId)
          fail();
        await this.capture(run, original.conversationId);
      }
    }
  }
  /** Called with the real terminal Main Run before its final checkpoint is committed. */
  async capture(run: AgentRuntimeRun, conversationId: string): Promise<Json[]> {
    const operation = this.work.then(async () => {
      this.guard();
      if (
        !(await this.known({ runId: run.id, runtimeId: run.runtimeId, conversationId }))
      )
        fail("resource_not_found", 404);
      if (run.status === "running") return;
      const artifacts = run.artifacts ?? [];
      const ids = artifacts.map((item) => item.id);
      if (
        artifacts.length > 100 ||
        ids.some((id) => !id) ||
        new Set(ids).size !== ids.length
      )
        return;
      for (const artifact of artifacts) {
        this.guard();
        if (
          !["file", "diff", "final"].includes(artifact.kind) ||
          artifact.unavailableReason
        )
          continue;
        const nativeId = artifact.id!;
        const id = this.id(run.id, nativeId);
        if (this.entries.has(id)) continue;
        const capability = this.source.resolvePath(run.id, nativeId);
        const inline =
          !artifact.path && typeof artifact.content === "string"
            ? Buffer.from(artifact.content, "utf8")
            : undefined;
        if (!capability && !inline) continue;
        const temporary = join(this.root, `pending-${randomUUID()}.tmp`);
        let sourceFile: Awaited<ReturnType<typeof open>> | undefined;
        let destination: Awaited<ReturnType<typeof open>> | undefined;
        try {
          if (capability) {
            sourceFile = await openOrdinary(capability.path);
          }
          destination = await open(temporary, "wx", 0o600);
          const hash = createHash("sha256");
          let size = 0;
          const before = sourceFile ? await sourceFile.stat() : undefined;
          const buffer = Buffer.alloc(65536);
          let position = 0;
          while (true) {
            this.guard();
            const bytes = sourceFile
              ? (await sourceFile.read(buffer, 0, buffer.length, position))
                  .bytesRead
              : Math.min(buffer.length, inline!.length - position);
            if (!bytes) break;
            const chunk = sourceFile
              ? buffer.subarray(0, bytes)
              : inline!.subarray(position, position + bytes);
            hash.update(chunk);
            size += bytes;
            position += bytes;
            let written = 0;
            while (written < bytes) {
              const result = await destination.write(
                chunk,
                written,
                bytes - written,
              );
              if (!result.bytesWritten) fail();
              written += result.bytesWritten;
            }
          }
          const after = sourceFile ? await sourceFile.stat() : undefined;
          if (capability && after) {
            ordinaryPath(capability.path);
            const located = lstatSync(capability.path);
            if (after.dev !== located.dev || after.ino !== located.ino) fail();
          }
          if (
            before &&
            after &&
            (before.size !== size ||
              before.size !== after.size ||
              before.mtimeMs !== after.mtimeMs ||
              before.ctimeMs !== after.ctimeMs)
          )
            fail();
          const sha256 = hash.digest("hex");
          if (
            (artifact.sha256 && artifact.sha256 !== sha256) ||
            (artifact.size !== undefined && artifact.size !== size)
          )
            fail();
          const mime =
            artifact.mime &&
            /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(artifact.mime)
              ? artifact.mime
              : inline
                ? "text/plain"
                : "application/octet-stream";
          const metadata: Json = {
            id,
            runId: run.id,
            name: displayName(artifact.label),
            mime,
            sizeBytes: size,
            sha256,
            allowedActions: ["read", "download"],
          };
          assertMobileSchema("Artifact", metadata);
          const record: RecordEntry = {
            version: 1,
            ownerId: this.ownerId,
            spaceId: this.spaceId,
            dataEpoch: this.dataEpoch,
            runId: run.id,
            runtimeId: run.runtimeId,
            conversationId,
            nativeArtifactId: nativeId,
            metadata,
          };
          this.guard();
          if (!(await this.known(record))) fail("resource_not_found", 404);
          await destination.sync();
          await destination.close();
          destination = undefined;
          await rename(temporary, join(this.root, `${id}.bin`));
          const manifestTemporary = join(
            this.root,
            `pending-${randomUUID()}.tmp`,
          );
          try {
            const manifest = await open(manifestTemporary, "wx", 0o600);
            try {
              await manifest.writeFile(JSON.stringify(record));
              await manifest.sync();
            } finally {
              await manifest.close();
            }
            this.guard();
            if (!(await this.known(record))) fail("resource_not_found", 404);
            await rename(manifestTemporary, join(this.root, `${id}.json`));
          } finally {
            await unlink(manifestTemporary).catch(() => {});
          }
          this.entries.set(id, record);
        } catch (error) {
          // A missing/unreadable source is not a failed Runtime task and never grants a download.
          if (
            !["ENOENT", "EACCES", "EPERM", "requires_owner_action"].includes(
              String((error as { code?: string }).code),
            )
          )
            throw error;
        } finally {
          await sourceFile?.close();
          await destination?.close();
          await unlink(temporary).catch(() => {});
        }
      }
    });
    this.work = operation.catch(() => {});
    await operation;
    return this.list(run.id);
  }
  async download(
    id: string,
    signal: AbortSignal,
  ): Promise<{ metadata: Json; chunks: AsyncIterable<Uint8Array> }> {
    const record = await this.available(id, signal),
      file = join(this.root, `${id}.bin`);
    const verify = await openOrdinary(file);
    try {
      const hash = createHash("sha256"),
        buffer = Buffer.alloc(65536);
      let size = 0;
      while (true) {
        await this.available(id, signal);
        const { bytesRead } = await verify.read(buffer, 0, buffer.length, size);
        if (!bytesRead) break;
        hash.update(buffer.subarray(0, bytesRead));
        size += bytesRead;
      }
      if (
        size !== record.metadata.sizeBytes ||
        hash.digest("hex") !== record.metadata.sha256
      )
        fail();
    } finally {
      await verify.close();
    }
    return {
      metadata: this.publicMetadata(record),
      chunks: this.chunks(id, file, record, signal),
    };
  }
  private async *chunks(
    id: string,
    file: string,
    record: RecordEntry,
    signal: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    await this.available(id, signal);
    const reader = await openOrdinary(file);
    try {
      const hash = createHash("sha256");
      let size = 0;
      while (true) {
        await this.available(id, signal);
        const buffer = Buffer.alloc(65536),
          { bytesRead } = await reader.read(buffer, 0, buffer.length, size);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > Number(record.metadata.sizeBytes)) fail();
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        await this.available(id, signal);
        yield chunk;
      }
      if (
        size !== record.metadata.sizeBytes ||
        hash.digest("hex") !== record.metadata.sha256
      )
        fail();
    } finally {
      await reader.close();
    }
  }
}
