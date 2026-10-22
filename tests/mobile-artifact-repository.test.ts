import { afterEach, beforeEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  linkSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { join, resolve, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  MobileArtifactRepository,
  type MobileArtifactSource,
  type ArtifactOriginalRun,
} from "../src/main/mobile-control/artifact-repository";
import type { AgentRuntimeRun } from "../src/shared/agent-runtimes";

let root: string, home: string, original: string, ownerActive: boolean;
let known: ArtifactOriginalRun[],
  run: AgentRuntimeRun,
  source: MobileArtifactSource,
  repository: MobileArtifactRepository;
const bytes = Buffer.from(
  Array.from({ length: 200003 }, (_, index) => index % 251),
);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agents-one-artifact-source-"));
  home = join(root, "control");
  mkdirSync(home);
  original = join(root, "original.bin");
  writeFileSync(original, bytes);
  ownerActive = true;
  known = [
    {
      runId: "native-run",
      runtimeId: "runtime-1",
      conversationId: "original-conversation",
    },
  ];
  run = {
    id: "native-run",
    runtimeId: "runtime-1",
    status: "succeeded",
    startedAt: 1,
    completedAt: 2,
    output: "Ordinary reply",
    events: [],
    artifacts: [
      {
        id: "native-file",
        kind: "file",
        label: "../../result.bin",
        path: original,
        mime: "application/octet-stream",
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  };
  source = {
    knownRuns: () => known,
    getRun: async () => run,
    resolvePath: (runId, id) =>
      runId === run.id && id === "native-file"
        ? { path: original, label: "result.bin" }
        : null,
    guard: () => {
      if (!ownerActive)
        throw Object.assign(Error("owner_unavailable"), {
          code: "owner_unavailable",
        });
    },
  };
  repository = new MobileArtifactRepository(
    home,
    "owner-1",
    "space-1",
    "epoch-1",
    source,
  );
});
afterEach(() => {
  const target = resolve(root),
    temporaryRoot = resolve(tmpdir());
  if (
    !target.startsWith(temporaryRoot + sep) ||
    !basename(target).startsWith("agents-one-artifact-source-")
  )
    throw Error("Unsafe test cleanup");
  rmSync(target, { recursive: true, force: true });
});
async function received(
  repo: MobileArtifactRepository,
  id: string,
  signal = new AbortController().signal,
): Promise<Buffer> {
  const delivery = await repo.download(id, signal),
    parts: Buffer[] = [];
  for await (const part of delivery.chunks) {
    expect(part.length).toBeLessThanOrEqual(65536);
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts);
}
function storeDirectory(): string {
  const parent = join(home, "artifacts");
  return join(parent, readdirSync(parent)[0]);
}

// @lat: [[mobile-data#Mobile data#Original artifact immutable delivery]]
it("captures the authorized original binary and reopens identical delivery bytes after a restart without native registry state", async () => {
  const [metadata] = await repository.capture(run, "original-conversation");
  expect(metadata).toMatchObject({
    runId: "native-run",
    name: "result.bin",
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    allowedActions: ["read", "download"],
  });
  expect(JSON.stringify(metadata)).not.toContain(root);
  expect(await received(repository, String(metadata.id))).toEqual(bytes);
  writeFileSync(original, "later original edits");
  source.getRun = async () => null;
  const restarted = new MobileArtifactRepository(
    home,
    "owner-1",
    "space-1",
    "epoch-1",
    source,
  );
  expect(await restarted.metadata(String(metadata.id))).toEqual(metadata);
  expect(await received(restarted, String(metadata.id))).toEqual(bytes);
  expect(readFileSync(original, "utf8")).toBe("later original edits");
});
// @lat: [[mobile-data#Mobile data#Original artifact capability admission]]
it("rejects unknown Run identity and never interprets a message path or ordinary reply as an artifact capability", async () => {
  await expect(
    repository.capture(
      { ...run, runtimeId: "other-runtime" },
      "original-conversation",
    ),
  ).rejects.toMatchObject({ code: "resource_not_found" });
  source.getRun = async () => ({ ...run, runtimeId: "foreign-runtime" });
  await expect(repository.sync()).rejects.toMatchObject({
    code: "requires_owner_action",
  });
  source.getRun = async () => run;
  source.resolvePath = () => null;
  expect(await repository.capture(run, "original-conversation")).toEqual([]);
  run.artifacts = [];
  expect(await repository.capture(run, "original-conversation")).toEqual([]);
  expect(readdirSync(storeDirectory())).toEqual([]);
  run.artifacts = [
    {
      kind: "final",
      id: "declared-final",
      label: "result.txt",
      content: "Explicit original artifact",
    },
  ];
  const [metadata] = await repository.capture(run, "original-conversation");
  expect(await received(repository, String(metadata.id))).toEqual(
    Buffer.from("Explicit original artifact"),
  );
});
// @lat: [[mobile-data#Mobile data#Original artifact identity revocation]]
it("blocks deleted original conversations, inactive Owners and changed epochs without deleting the original files", async () => {
  const [metadata] = await repository.capture(run, "original-conversation");
  known = [];
  expect(await repository.list(run.id)).toEqual([]);
  await expect(repository.metadata(String(metadata.id))).rejects.toThrow(
    "resource_not_found",
  );
  known = [
    {
      runId: "native-run",
      runtimeId: "runtime-1",
      conversationId: "original-conversation",
    },
  ];
  ownerActive = false;
  await expect(
    repository.download(String(metadata.id), new AbortController().signal),
  ).rejects.toMatchObject({ code: "owner_unavailable" });
  ownerActive = true;
  const otherEpoch = new MobileArtifactRepository(
    home,
    "owner-1",
    "space-1",
    "epoch-2",
    source,
  );
  expect(await otherEpoch.list(run.id)).toEqual([]);
  await expect(otherEpoch.metadata(String(metadata.id))).rejects.toThrow(
    "resource_not_found",
  );
  expect(readFileSync(original)).toEqual(bytes);
});
// @lat: [[mobile-data#Mobile data#Original artifact stream revocation]]
it("checks abort and original source authority between actual binary chunks", async () => {
  const [metadata] = await repository.capture(run, "original-conversation");
  const abort = new AbortController(),
    transfer = await repository.download(String(metadata.id), abort.signal);
  const iterator = transfer.chunks[Symbol.asyncIterator]();
  expect((await iterator.next()).value.length).toBe(65536);
  abort.abort();
  await expect(iterator.next()).rejects.toMatchObject({ code: "revoked" });
  const next = (
    await repository.download(String(metadata.id), new AbortController().signal)
  ).chunks[Symbol.asyncIterator]();
  await next.next();
  ownerActive = false;
  await expect(next.next()).rejects.toMatchObject({
    code: "owner_unavailable",
  });
});
// @lat: [[mobile-data#Mobile data#Original artifact source integrity]]
it("refuses source hard links, wrong source digest and corrupt delivery bytes before returning a download response", async () => {
  linkSync(original, join(root, "alias.bin"));
  expect(await repository.capture(run, "original-conversation")).toEqual([]);
  rmSync(join(root, "alias.bin"));
  run.artifacts![0].sha256 = "0".repeat(64);
  expect(await repository.capture(run, "original-conversation")).toEqual([]);
  expect(readdirSync(storeDirectory())).toEqual([]);
  run.artifacts![0].sha256 = createHash("sha256").update(bytes).digest("hex");
  const [metadata] = await repository.capture(run, "original-conversation");
  writeFileSync(
    join(storeDirectory(), `${metadata.id}.bin`),
    Buffer.alloc(bytes.length),
  );
  await expect(
    repository.download(String(metadata.id), new AbortController().signal),
  ).rejects.toMatchObject({ code: "requires_owner_action" });
});
// @lat: [[mobile-data#Mobile data#Original artifact linked directory rejection]]
it("rejects a source directory junction before reading bytes even when the Main resolver supplies its lexical path", async () => {
  const directory = join(root, "original-directory");
  mkdirSync(directory);
  writeFileSync(join(directory, "result.bin"), bytes);
  const alias = join(root, "source-alias");
  symlinkSync(
    directory,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  original = join(alias, "result.bin");
  expect(await repository.capture(run, "original-conversation")).toEqual([]);
  expect(readdirSync(storeDirectory())).toEqual([]);
  expect(readFileSync(join(directory, "result.bin"))).toEqual(bytes);
});
// @lat: [[mobile-data#Mobile data#Original artifact index isolation]]
it("projects only public metadata and rejects a damaged or foreign immutable index on reopen", async () => {
  const [metadata] = await repository.capture(run, "original-conversation"),
    file = join(storeDirectory(), `${metadata.id}.json`);
  const record = JSON.parse(readFileSync(file, "utf8"));
  record.metadata.localPath = original;
  record.metadata.secret = "private";
  writeFileSync(file, JSON.stringify(record));
  const restarted = new MobileArtifactRepository(
    home,
    "owner-1",
    "space-1",
    "epoch-1",
    source,
  );
  expect(await restarted.metadata(String(metadata.id))).toEqual(metadata);
  record.ownerId = "other-owner";
  writeFileSync(file, JSON.stringify(record));
  expect(
    () =>
      new MobileArtifactRepository(
        home,
        "owner-1",
        "space-1",
        "epoch-1",
        source,
      ),
  ).toThrow("requires_owner_action");
  expect(JSON.parse(readFileSync(file, "utf8")).ownerId).toBe("other-owner");
});
