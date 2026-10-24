import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createProjectTextWriter } from "../src/main/mobile-control/project-text-write";
import { createProjectInspection } from "../src/main/mobile-control/project-inspection";
const roots: string[] = [];
const digest = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
function fixture(): { base: string; root: string; outside: string } {
  const base = mkdtempSync(join(tmpdir(), "agents-one-project-write-"));
  roots.push(base);
  const root = join(base, "project"),
    outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  return { base, root, outside };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith("agents-one-project-write-")
    )
      throw Error("unsafe_cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

it("creates and replaces actual UTF8 bytes after recording original text and hashes without exposing original text in receipts", () => {
  const { root } = fixture(),
    audit = vi.fn();
  mkdirSync(join(root, "src"));
  const writer = createProjectTextWriter(root, () => undefined, audit);
  const created = writer.write("src/file.txt", "中文 first", null);
  expect(readFileSync(join(root, "src/file.txt"), "utf8")).toBe("中文 first");
  expect(created).toEqual({
    path: "src/file.txt",
    previousSha256: null,
    sha256: digest("中文 first"),
    bytes: Buffer.byteLength("中文 first"),
  });
  const updated = writer.write("src/file.txt", "第二版", created.sha256);
  expect(updated.previousSha256).toBe(created.sha256);
  expect(audit.mock.calls[1][0]).toMatchObject({
    previousText: "中文 first",
    previousSha256: created.sha256,
    sha256: digest("第二版"),
  });
  expect(readFileSync(join(root, "src/file.txt"), "utf8")).toBe("第二版");
  expect(readdirSync(join(root, "src"))).toEqual(["file.txt"]);
});

it("refuses stale hashes, creation over existing data and changes after the audit checkpoint", () => {
  const { root } = fixture();
  writeFileSync(join(root, "file.txt"), "original");
  const audit = vi.fn(),
    writer = createProjectTextWriter(root, () => undefined, audit);
  for (const expected of [null, digest("stale")])
    expect(() => writer.write("file.txt", "replacement", expected)).toThrow(
      "revision_conflict",
    );
  expect(audit).not.toHaveBeenCalled();
  const concurrent = createProjectTextWriter(
    root,
    () => undefined,
    () => {
      writeFileSync(join(root, "file.txt"), "desktop-edit");
    },
  );
  expect(() =>
    concurrent.write("file.txt", "replacement", digest("original")),
  ).toThrow("revision_conflict");
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("desktop-edit");
  expect(readdirSync(root)).toEqual(["file.txt"]);
});

it("refuses revoked or asynchronous authority and failed audit before changing target bytes", () => {
  const { root } = fixture();
  writeFileSync(join(root, "file.txt"), "original");
  let revoked = false;
  const writer = createProjectTextWriter(
    root,
    () => {
      if (revoked) throw Error("revoked");
    },
    () => {
      revoked = true;
    },
  );
  expect(() =>
    writer.write("file.txt", "replacement", digest("original")),
  ).toThrow("revoked");
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("original");
  const failed = createProjectTextWriter(
    root,
    () => undefined,
    () => {
      throw Error("audit_failed");
    },
  );
  expect(() => failed.write("new.txt", "replacement", null)).toThrow(
    "audit_failed",
  );
  const asynchronous = createProjectTextWriter(
    root,
    (() => Promise.resolve()) as unknown as () => void,
    () => undefined,
  );
  expect(() => asynchronous.write("new.txt", "replacement", null)).toThrow(
    "project_write_unavailable",
  );
});

it("rejects escapes, secret paths, internal staging names, hard links and junctions while preserving outside data", () => {
  const { root, outside } = fixture();
  writeFileSync(join(outside, "secret.txt"), "outside");
  linkSync(join(outside, "secret.txt"), join(root, "hard.txt"));
  symlinkSync(outside, join(root, "linked"), "junction");
  const writer = createProjectTextWriter(
    root,
    () => undefined,
    () => undefined,
  );
  for (const path of [
    "../outside/secret.txt",
    "C:/outside",
    "a\\b",
    "file:stream",
    "nul.txt",
    ".git/config",
    ".codex/config.toml",
    ".env",
    ".env.local",
    "auth.json",
    "private.key",
    ".agents-one-write-other.tmp",
    "hard.txt",
    "linked/secret.txt",
  ])
    expect(() => writer.write(path, "replacement", null)).toThrow();
  expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("outside");
  expect(
    createProjectInspection(root, () => undefined).list("").entries,
  ).toEqual([]);
});

it("refuses root replacement and a parent redirected after staging without writing outside", () => {
  const { base, root, outside } = fixture();
  const writer = createProjectTextWriter(
    root,
    () => undefined,
    () => undefined,
  );
  renameSync(root, join(base, "old"));
  mkdirSync(root);
  expect(() => writer.write("new.txt", "replacement", null)).toThrow();
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/file.txt"), "original");
  const redirected = createProjectTextWriter(
    root,
    () => undefined,
    () => {
      renameSync(join(root, "src"), join(root, "saved-src"));
      symlinkSync(outside, join(root, "src"), "junction");
    },
  );
  expect(() =>
    redirected.write("src/file.txt", "replacement", digest("original")),
  ).toThrow();
  expect(readdirSync(outside)).toEqual([]);
  expect(readFileSync(join(root, "saved-src/file.txt"), "utf8")).toBe(
    "original",
  );
});

it("refuses oversized, binary and invalid text and preserves unknown replaced staging bytes", () => {
  const { root } = fixture(),
    writer = createProjectTextWriter(
      root,
      () => undefined,
      () => undefined,
    );
  for (const text of ["a\0b", "\ud800", "x".repeat(256 * 1024 + 1), null])
    expect(() => writer.write("new.txt", text, null)).toThrow();
  for (const body of [
    Buffer.from([0xff]),
    Buffer.from("a\0b"),
    Buffer.alloc(256 * 1024 + 1),
  ]) {
    writeFileSync(join(root, "file.txt"), body);
    expect(() =>
      writer.write("file.txt", "replacement", digest("original")),
    ).toThrow();
    expect(readFileSync(join(root, "file.txt"))).toEqual(body);
  }
  const tampered = createProjectTextWriter(
    root,
    () => undefined,
    () => {
      const stage = readdirSync(root).find((n) =>
        n.startsWith(".agents-one-write-"),
      )!;
      renameSync(join(root, stage), join(root, "saved-stage"));
      writeFileSync(join(root, stage), "unknown-replacement");
    },
  );
  expect(() => tampered.write("new.txt", "replacement", null)).toThrow();
  const unknown = readdirSync(root).find((n) =>
    n.startsWith(".agents-one-write-"),
  )!;
  expect(readFileSync(join(root, unknown), "utf8")).toBe("unknown-replacement");
});
