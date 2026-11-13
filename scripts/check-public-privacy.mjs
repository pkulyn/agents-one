import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const mediaPattern = /\.(?:png|jpe?g|webp|gif|ico|icns|mp4|pdf|zip|docx)$/i;
const demoUser =
  /^(?:a|b|demo|test\w*|user\d*|example|alice|bob|me|hermes|runner|public|default|<[^>]+>|\$.*|%.*|\{.*)$/i;

export function inspectText(text) {
  const reasons = new Set();
  // Inspect literal home directories; variables and documented demo accounts are safe.
  for (const match of text.matchAll(
    /(?:[A-Za-z]:[\\/]+Users[\\/]+|\/(?:Users|home)\/)([^\\/\s"'\x60]+)/g,
  )) {
    if (!demoUser.test(match[1]) && !match[1].startsWith("."))
      reasons.add("personal-home-directory");
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text))
    reasons.add("private-key");
  if (
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/.test(text)
  )
    reasons.add("github-credential");
  if (/https?:\/\/[^\s/:@]+:[^\s/@]+@/i.test(text)) reasons.add("url-password");
  for (const match of text.matchAll(
    /(?:https?|wss?):\/\/(\d{1,3}(?:\.\d{1,3}){3})(?=[:/\s"'\x60]|$)/g,
  )) {
    const [a, b, c, d] = match[1].split(".").map(Number);
    if ([a, b, c, d].some((n) => n > 255)) continue;
    if (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      match[1] === "0.0.0.0" ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    )
      continue;
    reasons.add("public-ip-endpoint");
  }
  return [...reasons];
}

export function inspectMetadata(bytes) {
  const reasons = new Set();
  const text = bytes.toString("latin1");
  if (
    /<(?:dc:creator|photoshop:AuthorsPosition)|(?:exif:GPS|tiff:Artist|xmp:CreatorTool)\b/i.test(
      text,
    )
  )
    reasons.add("identifying-media-metadata");
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    for (let offset = 8; offset + 12 <= bytes.length; ) {
      const size = bytes.readUInt32BE(offset),
        kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (offset + size + 12 > bytes.length) {
        reasons.add("malformed-png");
        break;
      }
      if (["tEXt", "zTXt", "iTXt", "eXIf"].includes(kind))
        reasons.add("unreviewed-png-metadata");
      // Never decompress arbitrary text chunks in CI; exporting without metadata is preferred.
      offset += size + 12;
    }
  }
  if (
    text.includes("EXIF") ||
    bytes.includes(Buffer.from([69, 120, 105, 102, 0, 0]))
  )
    reasons.add("unreviewed-exif");
  return [...reasons];
}

export function inspectFiles(files, media, read, fixtures = []) {
  const allowed = new Set(
    fixtures.map(
      ({ path, rule, lineSha256 }) => path + ":" + rule + ":" + lineSha256,
    ),
  );
  const findings = [];
  const present = new Set(files);
  for (const path of files) {
    const bytes = read(path);
    if (mediaPattern.test(path)) {
      const approved = media[path];
      if (
        !approved ||
        approved.sha256 !== createHash("sha256").update(bytes).digest("hex")
      )
        findings.push({ path, rule: "media-review-required" });
      for (const rule of inspectMetadata(bytes)) findings.push({ path, rule });
    } else if (!bytes.includes(0)) {
      for (const [index, line] of bytes
        .toString("utf8")
        .split(/\r?\n/)
        .entries()) {
        for (const rule of inspectText(line)) {
          const lineSha256 = createHash("sha256").update(line).digest("hex");
          if (!allowed.has(path + ":" + rule + ":" + lineSha256))
            findings.push({ path, rule, line: index + 1, lineSha256 });
        }
      }
    }
  }
  for (const path of Object.keys(media))
    if (!present.has(path)) findings.push({ path, rule: "stale-media-review" });
  return findings;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const media = JSON.parse(
    readFileSync(resolve(root, ".github/public-media.json"), "utf8"),
  );
  const fixtures = JSON.parse(
    readFileSync(resolve(root, ".github/privacy-fixtures.json"), "utf8"),
  );
  const findings = inspectFiles(
    files,
    media,
    (path) => readFileSync(resolve(root, path)),
    fixtures,
  );
  for (const { path, rule } of findings) console.error(path + ": " + rule);
  if (findings.length) process.exitCode = 1;
  else
    console.log(
      "Public privacy checks passed (literal paths, selected credential formats, IP endpoints and reviewed media hashes/metadata). Pixel content and archives require separate review.",
    );
}
