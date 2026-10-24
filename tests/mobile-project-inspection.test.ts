import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  linkSync,
  symlinkSync,
  renameSync,
} from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { createProjectInspection } from "../src/main/mobile-control/project-inspection";

const roots: string[] = [];
function fixture(): {
  base: string;
  root: string;
  outside: string;
  service: ReturnType<typeof createProjectInspection>;
} {
  const base = mkdtempSync(join(tmpdir(), "agents-one-project-inspection-"));
  roots.push(base);
  const root = join(base, "project"),
    outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  return {
    base,
    root,
    outside,
    service: createProjectInspection(root, () => undefined),
  };
}
afterEach(() => {
  for (const root of roots.splice(0))
    if (
      dirname(resolve(root)) === resolve(tmpdir()) &&
      basename(root).startsWith("agents-one-project-inspection-")
    )
      rmSync(root, { recursive: true, force: true });
});

describe("Main controlled project inspection", () => {
  it("reads only the fixed project's text with a hash of the actual bytes", () => {
    const { root, service } = fixture();
    mkdirSync(join(root, "src"));
    const text = "中文 project text\n";
    writeFileSync(join(root, "src", "readme.md"), text);
    expect(service.readText("src/readme.md")).toEqual({
      path: "src/readme.md",
      text,
      sha256: createHash("sha256").update(text).digest("hex"),
    });
  });

  it("rejects path traversal, Windows alternate forms, device names and private configuration", () => {
    const { root, service } = fixture();
    writeFileSync(join(root, ".env"), "private-secret");
    for (const input of [
      "../outside/file",
      "/file",
      "C:/file",
      "a\\file",
      "file:stream",
      "nul.txt",
      "com1",
      "file.",
      "file ",
      ".git/config",
      ".codex/config.toml",
      ".env",
      ".env.local",
      "private.key",
      "auth.json",
      "a//b",
      "./file",
      null,
      {},
    ]) {
      expect(() => service.readText(input)).toThrow(
        "Project inspection is unavailable for this path.",
      );
    }
    expect(() => service.readText("missing.txt")).toThrow(
      "Project inspection is unavailable for this path.",
    );
  });

  it("rejects hard links and directory junctions to outside data", () => {
    const { root, outside, service } = fixture();
    writeFileSync(join(outside, "secret.txt"), "private-secret");
    linkSync(join(outside, "secret.txt"), join(root, "hard.txt"));
    symlinkSync(outside, join(root, "linked"), "junction");
    expect(() => service.readText("hard.txt")).toThrow(
      "inspection is unavailable",
    );
    expect(() => service.readText("linked/secret.txt")).toThrow(
      "inspection is unavailable",
    );
    expect(service.list("").entries).toEqual([]);
  });

  it("withholds results after authority revocation or root replacement", () => {
    const { root, base } = fixture();
    writeFileSync(join(root, "file.txt"), "private-secret");
    let checks = 0;
    const revoked = createProjectInspection(root, () => {
      if (++checks > 1) throw Error("revoked");
    });
    expect(() => revoked.readText("file.txt")).toThrow(
      "inspection is unavailable",
    );
    const service = createProjectInspection(root, () => undefined);
    renameSync(root, join(base, "old"));
    mkdirSync(root);
    writeFileSync(join(root, "file.txt"), "replacement");
    expect(() => service.readText("file.txt")).toThrow(
      "inspection is unavailable",
    );
  });

  it("rejects oversized, binary and invalid UTF8 files instead of returning a truncated snapshot", () => {
    const { root, service } = fixture();
    for (const content of [
      Buffer.alloc(256 * 1024 + 1, 65),
      Buffer.from([0xff, 0xfe]),
      Buffer.from("a\0b"),
    ]) {
      writeFileSync(join(root, "file.txt"), content);
      expect(() => service.readText("file.txt")).toThrow(
        "inspection is unavailable",
      );
    }
    writeFileSync(join(root, "file.txt"), Buffer.alloc(256 * 1024, 65));
    expect(service.readText("file.txt").text.length).toBe(256 * 1024);
  });

  it("omits private names and rejects directories exceeding the bounded scan", () => {
    const { root, service } = fixture();
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, ".codex"));
    writeFileSync(join(root, ".env"), "private-secret");
    writeFileSync(join(root, "readme.md"), "project");
    expect(service.list("")).toEqual({
      path: "",
      entries: [
        { name: "readme.md", kind: "file" },
        { name: "src", kind: "directory" },
      ],
    });
    for (let i = 0; i < 201; i++)
      writeFileSync(join(root, "src", `${i}.txt`), "");
    expect(() => service.list("src")).toThrow("inspection is unavailable");
  });
});
