import { describe, it, expect } from "vitest";
import {
  parseMediaTokens,
  hasMediaTokens,
  describeImageSrc,
} from "./mediaUtils";

describe("parseMediaTokens (issue #299)", () => {
  it("returns a single text segment when there is no MEDIA token", () => {
    expect(parseMediaTokens("just a normal reply")).toEqual([
      { type: "text", value: "just a normal reply" },
    ]);
  });

  it("extracts a Windows-path MEDIA token", () => {
    const segs = parseMediaTokens(
      "Here it is:\n\nMEDIA:C:\\Users\\pmos6\\generated_cat_beach.png",
    );
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ type: "text", value: "Here it is:\n\n" });
    expect(segs[1]).toEqual({
      type: "media",
      token: {
        src: "C:\\Users\\pmos6\\generated_cat_beach.png",
        isUrl: false,
        isImage: true,
        name: "generated_cat_beach.png",
      },
    });
  });

  it("extracts a POSIX-path MEDIA token", () => {
    const segs = parseMediaTokens("MEDIA:/tmp/red_circle.svg");
    expect(segs[0]).toMatchObject({
      type: "media",
      token: { src: "/tmp/red_circle.svg", isImage: true, isUrl: false },
    });
  });

  it("extracts an https MEDIA token and marks it a URL", () => {
    const segs = parseMediaTokens("MEDIA:https://example.com/pic.jpg");
    expect(segs[0]).toMatchObject({
      type: "media",
      token: { src: "https://example.com/pic.jpg", isUrl: true, isImage: true },
    });
  });

  it("handles a quoted path containing spaces", () => {
    const segs = parseMediaTokens('MEDIA:"C:\\My Pics\\a b.png"');
    expect(segs[0]).toMatchObject({
      type: "media",
      token: { src: "C:\\My Pics\\a b.png", isImage: true },
    });
  });

  it("strips trailing sentence punctuation from a bare token", () => {
    const segs = parseMediaTokens("see MEDIA:/tmp/out.png.");
    expect((segs[1] as { token: { src: string } }).token.src).toBe(
      "/tmp/out.png",
    );
  });

  it("flags a non-image media file", () => {
    const segs = parseMediaTokens("MEDIA:/tmp/clip.mp4");
    expect((segs[0] as { token: { isImage: boolean } }).token.isImage).toBe(
      false,
    );
  });

  it("keeps text after a token", () => {
    const segs = parseMediaTokens("MEDIA:/tmp/a.png\n\nEnjoy!");
    expect(segs[segs.length - 1]).toEqual({
      type: "text",
      value: "\n\nEnjoy!",
    });
  });

  it("hasMediaTokens detects presence", () => {
    expect(hasMediaTokens("MEDIA:/tmp/a.png")).toBe(true);
    expect(hasMediaTokens("no media here")).toBe(false);
  });

  it("describeImageSrc classifies a plain image src", () => {
    expect(describeImageSrc("https://x.test/p.png")).toMatchObject({
      isUrl: true,
      isImage: true,
      name: "p.png",
    });
  });
});
