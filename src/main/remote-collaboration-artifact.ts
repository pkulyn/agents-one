import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

const maximumBytes = 25 * 1024 * 1024;
const digest = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

/** Stage an already-authorized download under an isolated, task-owned directory. */
export function stageRemoteCollaborationArtifact(options: {
  workspace: string;
  runId: string;
  artifactId: string;
  name: string;
  bytes: Buffer;
  sha256: string;
}): { relativePath: string; sha256: string; size: number } {
  const { workspace, runId, artifactId, name, bytes, sha256 } = options;
  if (
    !runId ||
    !artifactId ||
    !Buffer.isBuffer(bytes) ||
    bytes.length > maximumBytes
  )
    throw new Error("Invalid remote collaboration artifact.");
  if (!/^[a-f0-9]{64}$/i.test(sha256) || digest(bytes) !== sha256.toLowerCase())
    throw new Error("Remote artifact SHA-256 mismatch.");
  if (
    !name ||
    name.length > 180 ||
    name === "." ||
    name === ".." ||
    basename(name) !== name ||
    /[\\/<>:"|?*]/.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
  )
    throw new Error("Invalid remote artifact filename.");

  const root = resolve(workspace);
  if (!isAbsolute(workspace) || !lstatSync(root).isDirectory())
    throw new Error("Invalid collaboration workspace.");
  const realRoot = realpathSync.native(root);
  const segments = [".remote-deliveries", digest(runId), digest(artifactId)];
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (!info) mkdirSync(current);
    const actual = lstatSync(current);
    if (!actual.isDirectory() || actual.isSymbolicLink())
      throw new Error("Invalid collaboration artifact directory.");
    const expected = join(realRoot, ...segments.slice(0, index + 1));
    const real = realpathSync.native(current);
    if (
      (process.platform === "win32" ? real.toLowerCase() : real) !==
      (process.platform === "win32" ? expected.toLowerCase() : expected)
    )
      throw new Error("Collaboration artifact directory alias.");
  }
  const target = join(current, name);
  try {
    writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    const info = lstatSync(target, { throwIfNoEntry: false });
    if (
      !info?.isFile() ||
      info.isSymbolicLink() ||
      info.size !== bytes.length ||
      digest(readFileSync(target)) !== sha256.toLowerCase()
    )
      throw error;
  }
  return {
    relativePath: [...segments, name].join("/"),
    sha256: sha256.toLowerCase(),
    size: bytes.length,
  };
}
