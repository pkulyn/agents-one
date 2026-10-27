import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertCodexInspectionIdentity,
  captureCodexInspectionIdentity,
  assertReviewedCodexInspectionNative,
} from "../src/main/mobile-control/codex-invocation-identity";
let root: string, native: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mobile-codex-identity-"));
  native = join(root, "codex.exe");
  writeFileSync(native, "native-one");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
describe.skipIf(process.platform !== "win32" || process.arch !== "x64")(
  "Windows Codex native identity",
  () => {
    it("accepts only the reviewed native digest and rejects unknown, missing and ambiguous native identities", () => {
      const identity = captureCodexInspectionIdentity(native, root, {});
      expect(() => assertReviewedCodexInspectionNative(identity)).toThrow(
        "identity",
      );
      const reviewed = {
        ...identity,
        files: [
          {
            path: native,
            sha256:
              "57e1bdab42c0559a74558ca17e85d5c7893caa5f1e582f67e9ddd6d97fa705a7",
          },
        ],
      };
      expect(() => assertReviewedCodexInspectionNative(reviewed)).not.toThrow();
      expect(reviewed).not.toHaveProperty("verified");
      for (const files of [
        [],
        [...reviewed.files, ...reviewed.files],
        [{ ...reviewed.files[0], path: "other.exe" }],
      ])
        expect(() =>
          assertReviewedCodexInspectionNative({ ...reviewed, files }),
        ).toThrow("identity");
    });
    it("hashes the actual native bytes and current environment without exposing its values or granting approval", () => {
      const env = { Path: root, API_KEY: "private-secret" };
      const identity = captureCodexInspectionIdentity("codex", root, env);
      expect(identity.nativePath).toBe(native);
      expect(identity.files).toEqual([
        {
          path: native,
          sha256: createHash("sha256")
            .update(readFileSync(native))
            .digest("hex"),
        },
      ]);
      expect(identity.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(identity)).not.toContain("private-secret");
      expect(identity).not.toHaveProperty("verified");
      expect(() =>
        assertCodexInspectionIdentity(identity, "codex", root, env),
      ).not.toThrow();
      expect(() =>
        assertCodexInspectionIdentity(identity, "codex", root, {
          ...env,
          API_KEY: "changed",
        }),
      ).toThrow("identity");
    });
    it("rejects different bytes at the same path even when size and timestamp are retained", () => {
      const original = captureCodexInspectionIdentity(native, root, {}),
        stat = statSync(native);
      writeFileSync(native, "native-two");
      utimesSync(native, stat.atime, stat.mtime);
      expect(statSync(native).size).toBe(stat.size);
      expect(() =>
        assertCodexInspectionIdentity(original, native, root, {}),
      ).toThrow("identity");
    });
    it("rejects missing files, directories, relative paths and unreviewed npm entrypoints without invoking them", () => {
      const entry = join(root, "node_modules", "@openai", "codex", "bin");
      mkdirSync(entry, { recursive: true });
      writeFileSync(join(root, "node.exe"), "unused-node");
      writeFileSync(join(root, "codex.cmd"), "unused-shim");
      writeFileSync(join(entry, "codex.js"), "throw Error('do-not-execute');");
      for (const file of [
        join(root, "missing.exe"),
        root,
        "relative/runner.exe",
        join(root, "codex.cmd"),
      ])
        expect(() => captureCodexInspectionIdentity(file, root, {})).toThrow(
          "identity",
        );
      expect(readFileSync(join(entry, "codex.js"), "utf8")).toContain(
        "do-not-execute",
      );
    });
  },
);
