import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { projectRuntimeAvatar } from "../src/main/mobile-control/runtime-avatar";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8XKD4n4GBgYGJAQoAJzoChzU5gKEAAAAASUVORK5CYII=";
describe("configured runtime image projection", () => {
  // @lat: [[mobile-data#Mobile data#Runtime avatar original content identity]]
  it("preserves original image bytes and binds the immutable reference to MIME and content", () => {
    const bytes = Buffer.from(png, "base64");
    const projected = projectRuntimeAvatar(`data:image/png;base64,${png}`)!;
    expect(projected).toEqual({
      id: `ava-${createHash("sha256").update("image/png\0").update(bytes).digest("hex")}`,
      mime: "image/png",
      base64: png,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(
      projectRuntimeAvatar(
        `data:image/png;base64,${Buffer.concat([bytes, Buffer.from([0])]).toString("base64")}`,
      )?.id,
    ).not.toBe(projected.id);
  });
  // @lat: [[mobile-data#Mobile data#Runtime avatar bounded source admission]]
  it("rejects URLs, paths, SVG, wrong signatures, noncanonical bytes and oversized configured data", () => {
    for (const input of [
      undefined,
      {},
      "https://private/avatar.png",
      "D:/private/avatar.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      `data:image/jpeg;base64,${png}`,
      `data:image/png;base64,${png.slice(0, -1)}`,
      "data:image/png;base64,c2VjcmV0",
      `data:image/png;base64,${"A".repeat(700000)}`,
    ])
      expect(projectRuntimeAvatar(input)).toBeNull();
    const large = Buffer.alloc(524979);
    Buffer.from(png, "base64").copy(large);
    expect(
      projectRuntimeAvatar(`data:image/png;base64,${large.toString("base64")}`)
        ?.sizeBytes,
    ).toBe(large.length);
    // Header admission is not a claim of successful decoding; Android must decode with bounds.
    expect(
      projectRuntimeAvatar(
        `data:image/png;base64,${Buffer.alloc(525000).toString("base64")}`,
      ),
    ).toBeNull();
  });
});
