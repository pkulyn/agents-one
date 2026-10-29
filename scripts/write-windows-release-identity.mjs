import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export function releaseIdentity({
  sourceCommit,
  sourceTree,
  receipt,
  version,
  assets,
  appAsarSha256,
}) {
  if (
    !/^[a-f0-9]{40}$/.test(sourceCommit) ||
    !/^[a-f0-9]{40}$/.test(sourceTree) ||
    receipt.sourceCommit !== sourceCommit ||
    receipt.sourceTree !== sourceTree
  )
    throw Error("Release source identity does not match the packaged receipt");
  if (
    !assets.some((a) => a.file === `agents-one-${version}-setup.exe`) ||
    !assets.some((a) => a.file === `agents-one-${version}-portable.exe`)
  )
    throw Error("Installer and portable assets must be released together");
  return {
    schema: 1,
    sourceCommit,
    sourceTree,
    version,
    repository: "https://github.com/pkulyn/agents-one",
    platform: "windows-x64",
    signing: "unsigned",
    automaticUpdates: false,
    appAsarSha256,
    buildInputTreeSha256: receipt.buildInputTreeSha256,
    assets,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const root = process.cwd(),
    dist = path.resolve(root, process.argv[2] ?? "dist");
  const hash = (file) =>
    createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const asar = createRequire(path.join(root, "package.json"))("@electron/asar");
  const archive = path.join(dist, "win-unpacked/resources/app.asar");
  const key = asar
    .listPackage(archive)
    .find(
      (name) =>
        name.replaceAll("\\", "/").replace(/^\//, "") ===
        "out/main/desktop-source-receipt.json",
    );
  if (!key) throw Error("Packaged source receipt missing");
  const receipt = JSON.parse(
    asar.extractFile(archive, key.replace(/^[/\\]/, "")).toString(),
  );
  const version = JSON.parse(
    fs.readFileSync(path.join(root, "package.json")),
  ).version;
  const files = [
    `agents-one-${version}-setup.exe`,
    `agents-one-${version}-portable.exe`,
  ];
  const identity = releaseIdentity({
    sourceCommit: git("rev-parse", "HEAD"),
    sourceTree: git("rev-parse", "HEAD^{tree}"),
    receipt,
    version,
    appAsarSha256: hash(archive),
    assets: files.map((file) => ({
      file,
      bytes: fs.statSync(path.join(dist, file)).size,
      sha256: hash(path.join(dist, file)),
    })),
  });
  fs.writeFileSync(
    path.join(dist, "SOURCE_IDENTITY.json"),
    JSON.stringify(identity, null, 2) + "\n",
  );
}
