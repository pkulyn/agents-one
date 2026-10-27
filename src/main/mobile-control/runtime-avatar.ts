import { createHash } from "node:crypto";

export interface RuntimeAvatarContent {
  id: string;
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  sizeBytes: number;
  sha256: string;
  base64: string;
}

/** Reads only the configured image value; it never resolves a URL or local path. */
export function projectRuntimeAvatar(
  value: unknown,
): RuntimeAvatarContent | null {
  if (typeof value !== "string" || value.length > 700000) return null;
  const match =
    /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
      value,
    );
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const mime =
    `image/${kind === "jpg" ? "jpeg" : kind}` as RuntimeAvatarContent["mime"];
  const bytes = Buffer.from(match[2], "base64");
  if (
    !bytes.length ||
    bytes.length > 525000 ||
    bytes.toString("base64") !== match[2]
  )
    return null;
  const image =
    mime === "image/png"
      ? bytes.length >= 33 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === "image/jpeg"
        ? bytes.length >= 4 &&
          bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes[2] === 255
        : mime === "image/webp"
          ? bytes.length >= 12 &&
            bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
            bytes.subarray(8, 12).toString("ascii") === "WEBP" &&
            bytes.readUInt32LE(4) + 8 === bytes.length
          : bytes.length >= 13 &&
            ["GIF87a", "GIF89a"].includes(
              bytes.subarray(0, 6).toString("ascii"),
            );
  if (!image) return null;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = `ava-${createHash("sha256").update(mime).update("\0").update(bytes).digest("hex")}`;
  return { id, mime, sizeBytes: bytes.length, sha256, base64: match[2] };
}
