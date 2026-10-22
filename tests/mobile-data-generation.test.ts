import { beforeEach, afterEach, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  rmdirSync,
  linkSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import {
  MOBILE_DATA_GENERATION_PATH,
  readMobileDataGeneration,
  mobileOwnerLedgerPath,
} from "../src/main/mobile-control/data-generation";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agents-one-mobile-generation-"));
});
afterEach(() => {
  const rel = relative(realpathSync(tmpdir()), realpathSync(root));
  if (
    isAbsolute(rel) ||
    rel.startsWith("..") ||
    !rel.startsWith("agents-one-mobile-generation-")
  )
    throw Error("unsafe cleanup");
  rmSync(root, { recursive: true, force: true });
});
// @lat: [[mobile-data#Mobile data#Legacy ledger namespace preservation]]
it("keeps the old ledger namespace before restore and reads stable local generation without changing it", () => {
  const legacy = createHash("sha256")
    .update(JSON.stringify(["owner-1", "space-1"]))
    .digest("hex");
  expect(readMobileDataGeneration(root)).toBe("legacy");
  expect(mobileOwnerLedgerPath(root, "owner-1", "space-1", "legacy")).toBe(
    join(root, "desktop", "mobile-control", `owner-${legacy}.json`),
  );
  mkdirSync(join(root, "desktop", "mobile-control"), { recursive: true });
  const generation = randomUUID(),
    file = join(root, MOBILE_DATA_GENERATION_PATH);
  writeFileSync(file, JSON.stringify({ version: 1, generation }));
  expect(readMobileDataGeneration(root)).toBe(generation);
  expect(readMobileDataGeneration(root)).toBe(generation);
  expect(
    mobileOwnerLedgerPath(root, "owner-1", "space-1", generation),
  ).not.toContain(legacy);
});
// @lat: [[mobile-data#Mobile data#Generation marker rejects corruption and file redirection]]
it("rejects corrupt oversized hard-linked and redirected generation markers instead of treating them as legacy", () => {
  const folder = join(root, "desktop", "mobile-control");
  mkdirSync(folder, { recursive: true });
  const file = join(root, MOBILE_DATA_GENERATION_PATH);
  for (const data of [
    "{",
    JSON.stringify({ version: 2, generation: randomUUID() }),
    JSON.stringify({ version: 1, generation: "legacy" }),
    "x".repeat(4097),
  ]) {
    writeFileSync(file, data);
    expect(() => readMobileDataGeneration(root)).toThrow("owner_unavailable");
  }
  writeFileSync(file, JSON.stringify({ version: 1, generation: randomUUID() }));
  linkSync(file, join(root, "copy.json"));
  expect(() => readMobileDataGeneration(root)).toThrow("owner_unavailable");
  rmSync(file);
  rmSync(join(root, "copy.json"));
  rmdirSync(folder);
  const other = join(root, "other");
  mkdirSync(other);
  symlinkSync(other, folder, "junction");
  expect(() => readMobileDataGeneration(root)).toThrow("owner_unavailable");
  rmdirSync(folder);
});
