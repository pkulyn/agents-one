import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseIdentity } from "./write-windows-release-identity.mjs";

// @lat: [[repository-presentation#Immutable Windows release identity]]
test("a release requires matching packaged source and both binary types", () => {
  const sourceCommit = "a".repeat(40),
    sourceTree = "b".repeat(40);
  const input = {
    sourceCommit,
    sourceTree,
    receipt: { sourceCommit, sourceTree },
    version: "0.2.0",
    assets: [
      { file: "agents-one-0.2.0-setup.exe" },
      { file: "agents-one-0.2.0-portable.exe" },
    ],
  };
  assert.equal(releaseIdentity(input).automaticUpdates, false);
  assert.throws(
    () => releaseIdentity({ ...input, sourceCommit: "c".repeat(40) }),
    /packaged receipt/,
  );
  assert.throws(
    () => releaseIdentity({ ...input, assets: input.assets.slice(0, 1) }),
    /together/,
  );
});
