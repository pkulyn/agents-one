import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { extname, join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  dialog: {
    showSaveDialog: vi.fn(),
  },
}));

import {
  cleanupTempMediaFiles,
  materializeDataUrlToTemp,
  materializeBytesToTemp,
  mediaFileExists,
  normalizeMediaPath,
  readMediaAsDataUrl,
} from "../src/main/media";

describe("materializeDataUrlToTemp", () => {
  afterEach(() => {
    cleanupTempMediaFiles();
  });

  it("writes a data URL to a temporary image file that can be opened", () => {
    const path = materializeDataUrlToTemp(
      "data:image/png;base64,SGVybWVz",
      "prompt-image",
    );

    expect(path).toBeTruthy();
    expect(extname(path || "")).toBe(".png");
    expect(existsSync(path || "")).toBe(true);
    expect(readFileSync(path || "", "utf-8")).toBe("Hermes");

    if (path) rmSync(path, { force: true });
  });

  it("reuses the same temporary file for the same image data", () => {
    const first = materializeDataUrlToTemp(
      "data:image/png;base64,SGVybWVz",
      "prompt-image",
    );
    const second = materializeDataUrlToTemp(
      "data:image/png;base64,SGVybWVz",
      "prompt-image",
    );

    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("cleans up temporary media files", () => {
    const path = materializeDataUrlToTemp(
      "data:image/png;base64,SGVybWVz",
      "prompt-image",
    );

    expect(path).toBeTruthy();
    expect(existsSync(path || "")).toBe(true);

    cleanupTempMediaFiles();

    expect(existsSync(path || "")).toBe(false);
  });

  it("normalizes connector-escaped Windows paths before reading local media", () => {
    const source = join(tmpdir(), `agents-one-media-${Date.now()}.png`);
    writeFileSync(source, Buffer.from("PNG test"));
    const escaped = source.replace(/\\/g, "\\\\");

    expect(normalizeMediaPath(`"${escaped}"`)).toBe(source);
    expect(mediaFileExists(escaped)).toBe(true);
    expect(readMediaAsDataUrl(escaped)).toBe(
      `data:image/png;base64,${Buffer.from("PNG test").toString("base64")}`,
    );

    rmSync(source, { force: true });
  });
});

describe("materializeBytesToTemp", () => {
  afterEach(() => {
    cleanupTempMediaFiles();
  });

  it("stages authenticated remote bytes using the MIME-derived extension", () => {
    const path = materializeBytesToTemp(
      Buffer.from("remote chart"),
      "test-chart",
      "image/png",
    );

    expect(path).toBeTruthy();
    expect(extname(path || "")).toBe(".png");
    expect(readFileSync(path || "", "utf-8")).toBe("remote chart");
    if (path) rmSync(path, { force: true });
  });
});
