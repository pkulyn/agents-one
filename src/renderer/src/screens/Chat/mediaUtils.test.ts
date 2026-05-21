import { describe, it, expect } from "vitest";
import {
  parseMediaTokens,
  hasMediaTokens,
  describeImageSrc,
} from "./mediaUtils";

describe("parseMediaTokens (issue #299)", () => {
  it("returns a single text segment when there is nothing to extract", () => {
    expect(parseMediaTokens("just a normal reply")).toEqual([
      { type: "text", value: "just a normal reply" },
    ]);
  });

  // ── Explicit MEDIA: tokens ─────────────────────────────
  it("extracts an explicit MEDIA: token (Windows path)", () => {
    const segs = parseMediaTokens(
      "Here it is:\n\nMEDIA:C:\\Users\\pmos6\\cat.png",
    );
    expect(segs[0]).toEqual({ type: "text", value: "Here it is:\n\n" });
    expect(segs[1]).toMatchObject({
      type: "media",
      source: "media-token",
      token: { src: "C:\\Users\\pmos6\\cat.png", isImage: true, isUrl: false },
    });
  });

  it("extracts a MEDIA: https token as a URL", () => {
    const segs = parseMediaTokens("MEDIA:https://x.test/p.jpg");
    expect(segs[0]).toMatchObject({
      type: "media",
      source: "media-token",
      token: { isUrl: true, isImage: true },
    });
  });

  it("strips trailing punctuation from a bare MEDIA: token", () => {
    const segs = parseMediaTokens("see MEDIA:/tmp/out.png.");
    const media = segs.find((s) => s.type === "media");
    expect((media as { token: { src: string } }).token.src).toBe(
      "/tmp/out.png",
    );
  });

  // ── Whole-line bare paths ──────────────────────────────
  it("detects a whole-line bare absolute path (Windows, non-image)", () => {
    const segs = parseMediaTokens(
      "Criei o PDF aqui:\n\nC:\\Users\\pmos6\\proverbios.pdf\n\nInclui 10.",
    );
    expect(segs.find((s) => s.type === "media")).toMatchObject({
      type: "media",
      source: "bare-path",
      raw: "C:\\Users\\pmos6\\proverbios.pdf",
      token: { src: "C:\\Users\\pmos6\\proverbios.pdf", isImage: false },
    });
  });

  it("detects a whole-line POSIX path", () => {
    const segs = parseMediaTokens("Done:\n/home/me/out.png");
    expect(segs.find((s) => s.type === "media")).toMatchObject({
      source: "bare-path",
      token: { src: "/home/me/out.png", isImage: true },
    });
  });

  it("tolerates spaces inside a whole-line path", () => {
    const segs = parseMediaTokens("C:\\My Folder\\a file.pdf");
    expect(segs[0]).toMatchObject({
      type: "media",
      source: "bare-path",
      token: { src: "C:\\My Folder\\a file.pdf", name: "a file.pdf" },
    });
  });

  // ── False-positive guards ──────────────────────────────
  it("does NOT detect a path mentioned mid-sentence", () => {
    const segs = parseMediaTokens("I saved it to C:\\Users\\me\\x.pdf today.");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT detect a path inside a fenced code block", () => {
    const segs = parseMediaTokens(
      "Example:\n```\nC:\\Users\\me\\x.png\n```\ndone",
    );
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT treat a bare URL line as a path", () => {
    const segs = parseMediaTokens("https://example.com/pic.png");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT detect a relative path line", () => {
    const segs = parseMediaTokens("output/cat.png");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  // ── Misc ───────────────────────────────────────────────
  it("does not double-count a MEDIA: token as a bare path", () => {
    const media = parseMediaTokens("MEDIA:/tmp/a.png").filter(
      (s) => s.type === "media",
    );
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ source: "media-token" });
  });

  it("keeps text after a token", () => {
    const segs = parseMediaTokens("MEDIA:/tmp/a.png\n\nEnjoy!");
    expect(segs[segs.length - 1]).toEqual({
      type: "text",
      value: "\n\nEnjoy!",
    });
  });

  it("hasMediaTokens detects explicit tokens only", () => {
    expect(hasMediaTokens("MEDIA:/tmp/a.png")).toBe(true);
    expect(hasMediaTokens("no media")).toBe(false);
  });

  it("describeImageSrc classifies a plain src", () => {
    expect(describeImageSrc("https://x.test/p.png")).toMatchObject({
      isUrl: true,
      isImage: true,
      name: "p.png",
    });
  });
});
