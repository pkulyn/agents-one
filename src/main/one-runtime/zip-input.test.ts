import JSZip from "jszip";
import { expect, it } from "vitest";
import { readOneZip } from "./zip-input";

it("reads a skill ZIP without executing scripts, following links or exposing credential files", async () => {
  const zip = new JSZip();
  zip.file("skill/SKILL.md", "# Example\nRead this guide.");
  zip.file("skill/setup.js", "throw Error('must not execute')");
  zip.file("../escape.md", "outside");
  zip.file("skill/.env", "API_KEY=hidden");
  zip.file("link.md", "target", { unixPermissions: 0o120777 });
  zip.file("binary.bin", Buffer.from([0, 1, 2]));
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    platform: "UNIX",
  });
  const result = readOneZip(bytes, new AbortController().signal);
  expect(
    result.entries.find((item) => item.path === "skill/SKILL.md")?.text,
  ).toContain("Read this guide");
  expect(
    result.entries.find((item) => item.path === "skill/setup.js")?.text,
  ).toContain("must not execute");
  expect(
    result.entries.find((item) => item.path === "../escape.md")?.text,
  ).toBeUndefined();
  expect(
    result.entries.find((item) => item.path === "link.md")?.text,
  ).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("API_KEY=hidden");
  expect(
    result.entries.find((item) => item.path === "binary.bin")?.text,
  ).toBeUndefined();
});

it("bounds entries and expanded text, and validates CRC instead of passing corrupt text", async () => {
  const zip = new JSZip();
  zip.file("large.md", "a".repeat(1024 * 1024));
  zip.file("small.md", "readable");
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  const result = readOneZip(bytes, new AbortController().signal);
  expect(result.entries[0].text).toBeUndefined();
  expect(result.entries[1].text).toBe("readable");
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const secondCentral = bytes.indexOf(
    Buffer.from([0x50, 0x4b, 0x01, 0x02]),
    central + 4,
  );
  bytes.writeUInt32LE(0, secondCentral + 16);
  expect(
    readOneZip(bytes, new AbortController().signal).entries[1].text,
  ).toBeUndefined();
  const many = new JSZip();
  for (let i = 0; i < 129; i++) many.file(`${i}.md`, "x");
  expect(() =>
    readOneZip(Buffer.from("not a zip"), new AbortController().signal),
  ).toThrow();
  const tooMany = await many.generateAsync({ type: "nodebuffer" });
  expect(() => readOneZip(tooMany, new AbortController().signal)).toThrow(
    "128",
  );
  const abort = new AbortController();
  abort.abort();
  expect(() => readOneZip(bytes, abort.signal)).toThrow();
});

it("bounds inflation when headers lie about size, and skips encrypted content", async () => {
  const zip = new JSZip();
  zip.file("large.md", "a".repeat(1024 * 1024));
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(1, central + 24);
  expect(
    readOneZip(bytes, new AbortController().signal).entries[0].text,
  ).toBeUndefined();
  bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
  expect(
    readOneZip(bytes, new AbortController().signal).entries[0].status,
  ).toContain("加密");
});
