import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { projectPathSegments } from "./project-inspection";

const MAX_BYTES = 256 * 1024;
function readBounded(fd: number): Buffer {
  const buffer = Buffer.alloc(MAX_BYTES + 1);
  let count = 0;
  while (count < buffer.length) {
    const size = readSync(fd, buffer, count, buffer.length - count, null);
    if (!size) break;
    count += size;
  }
  if (count > MAX_BYTES) fail();
  return buffer.subarray(0, count);
}
const hash = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
const same = (a: Stats, b: Stats): boolean =>
  a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;
function fail(code = "project_write_unavailable"): never {
  throw Object.assign(Error(code), { code });
}
export interface ProjectTextWriteIntent {
  path: string;
  previousText: string | null;
  previousSha256: string | null;
  sha256: string;
  bytes: number;
}

/** A bounded filesystem primitive, to be executed inside the reviewed project sandbox. */
export function createProjectTextWriter(
  root: string,
  authorize: () => void,
  beforeCommit: (intent: Readonly<ProjectTextWriteIntent>) => void,
): {
  write(
    path: unknown,
    text: unknown,
    expectedSha256: unknown,
  ): Omit<ProjectTextWriteIntent, "previousText">;
} {
  const canonical = realpathSync(root),
    identity = lstatSync(canonical);
  if (
    !identity.isDirectory() ||
    identity.isSymbolicLink() ||
    lstatSync(root).isSymbolicLink()
  )
    fail();
  function guard(): void {
    const result: unknown = authorize();
    if (result instanceof Promise) void result.catch(() => undefined);
    if (result !== undefined) fail();
    const actual = lstatSync(canonical);
    if (
      !same(identity, actual) ||
      actual.isSymbolicLink() ||
      lstatSync(root).isSymbolicLink() ||
      !actual.isDirectory() ||
      realpathSync(root) !== canonical
    )
      fail();
  }
  return {
    write(input, text, expectedSha256) {
      // @lat: [[mobile-data#Mobile data#Controlled project text write primitive]]
      guard();
      const parts = projectPathSegments(input, false);
      if (
        typeof text !== "string" ||
        text.includes("\0") ||
        (expectedSha256 !== null &&
          (typeof expectedSha256 !== "string" ||
            !/^[a-f0-9]{64}$/.test(expectedSha256)))
      )
        fail("invalid_input");
      const bytes = Buffer.from(text, "utf8");
      if (
        bytes.length > MAX_BYTES ||
        new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== text
      )
        fail("invalid_input");
      let parent = canonical;
      const parents: Array<{ path: string; identity: Stats }> = [];
      for (const part of parts.slice(0, -1)) {
        parent = join(parent, part);
        const stat = lstatSync(parent);
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          realpathSync(parent) !== parent
        )
          fail();
        parents.push({ path: parent, identity: stat });
      }
      const target = join(parent, parts.at(-1)!);
      function currentParents(): void {
        guard();
        for (const value of parents) {
          const stat = lstatSync(value.path);
          if (
            !same(value.identity, stat) ||
            stat.isSymbolicLink() ||
            !stat.isDirectory() ||
            realpathSync(value.path) !== value.path
          )
            fail();
        }
      }
      function currentFile(): { stat: Stats; body: Buffer } | null {
        currentParents();
        const stat = lstatSync(target, { throwIfNoEntry: false });
        if (!stat) return null;
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          stat.size > MAX_BYTES
        )
          fail();
        const fd = openSync(target, "r");
        try {
          const opened = fstatSync(fd);
          if (
            !same(stat, opened) ||
            opened.nlink !== 1 ||
            opened.size > MAX_BYTES
          )
            fail();
          const body = readBounded(fd);
          const after = fstatSync(fd);
          currentParents();
          const linked = lstatSync(target);
          if (
            !same(opened, after) ||
            !same(after, linked) ||
            linked.isSymbolicLink() ||
            linked.nlink !== 1 ||
            after.nlink !== 1 ||
            body.length !== after.size ||
            after.size !== opened.size ||
            after.mtimeMs !== opened.mtimeMs
          )
            fail();
          new TextDecoder("utf-8", { fatal: true }).decode(body);
          if (body.includes(0)) fail();
          return { stat: after, body };
        } finally {
          closeSync(fd);
        }
      }
      const previous = currentFile();
      if ((previous ? hash(previous.body) : null) !== expectedSha256)
        fail("revision_conflict");
      const intent: ProjectTextWriteIntent = {
        path: parts.join("/"),
        previousText: previous
          ? new TextDecoder("utf-8", { fatal: true }).decode(previous.body)
          : null,
        previousSha256: expectedSha256 as string | null,
        sha256: hash(bytes),
        bytes: bytes.length,
      };
      const temporary = join(
        dirname(target),
        `.agents-one-write-${randomUUID()}.tmp`,
      );
      let fd: number | undefined, owned: Stats | undefined;
      try {
        currentParents();
        fd = openSync(
          temporary,
          "wx",
          previous ? previous.stat.mode & 0o777 : 0o600,
        );
        owned = fstatSync(fd);
        let offset = 0;
        while (offset < bytes.length)
          offset += writeSync(fd, bytes, offset, bytes.length - offset);
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        const result: unknown = beforeCommit(Object.freeze({ ...intent }));
        if (result instanceof Promise) void result.catch(() => undefined);
        if (result !== undefined) fail();
        const actual = currentFile();
        if (
          (actual ? hash(actual.body) : null) !== expectedSha256 ||
          Boolean(actual) !== Boolean(previous) ||
          (actual && previous && !same(actual.stat, previous.stat))
        )
          fail("revision_conflict");
        currentParents();
        const staged = lstatSync(temporary);
        if (
          !same(staged, owned) ||
          !staged.isFile() ||
          staged.isSymbolicLink() ||
          staged.nlink !== 1 ||
          staged.size !== bytes.length
        )
          fail();
        fd = openSync(temporary, "r");
        if (
          !same(fstatSync(fd), owned) ||
          hash(readBounded(fd)) !== intent.sha256
        )
          fail();
        closeSync(fd);
        fd = undefined;
        currentParents();
        const finalStage = lstatSync(temporary);
        if (
          !same(finalStage, owned) ||
          !finalStage.isFile() ||
          finalStage.isSymbolicLink() ||
          finalStage.nlink !== 1 ||
          finalStage.size !== bytes.length
        )
          fail();
        renameSync(temporary, target);
        const { previousText: _previousText, ...receipt } = intent;
        return receipt;
      } finally {
        if (fd !== undefined) closeSync(fd);
        if (owned) {
          try {
            currentParents();
            const remaining = lstatSync(temporary, { throwIfNoEntry: false });
            if (
              remaining?.isFile() &&
              !remaining.isSymbolicLink() &&
              remaining.nlink === 1 &&
              same(remaining, owned)
            )
              unlinkSync(temporary);
          } catch {
            /* Preserve staging data when ownership or authority is uncertain. */
          }
        }
      }
    },
  };
}
