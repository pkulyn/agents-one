import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function within(root, candidate) {
  const path = relative(root, candidate);
  return path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
}

export function resolveHostWorkspace(root, reference) {
  if (typeof root !== "string" || !isAbsolute(root))
    throw new Error("Host requires an absolute workspace root.");
  if (reference !== undefined && typeof reference !== "string")
    throw new Error("Host workspace reference is invalid.");
  try {
    const base = realpathSync(root);
    const candidate = realpathSync(resolve(base, reference || "."));
    if (within(base, candidate) && lstatSync(candidate).isDirectory())
      return candidate;
  } catch {
    // The public error omits the configured paths.
  }
  throw new Error(
    "Workspace is unavailable or outside the configured Host root.",
  );
}

/** Resolve an explicit file or future file through the nearest existing parent. */
export function resolveWorkspaceToolPath(root, path, allowMissing) {
  if (typeof path !== "string" || !path.trim()) return undefined;
  const target = resolve(root, path);
  if (!within(root, target)) return undefined;
  let candidate = target;
  try {
    while (within(root, candidate)) {
      const info = lstatSync(candidate, { throwIfNoEntry: false });
      if (info) {
        if (info.isSymbolicLink() || !within(root, realpathSync(candidate)))
          return undefined;
        if (candidate !== target && !info.isDirectory()) return undefined;
        return target;
      }
      if (!allowMissing || candidate === root) return undefined;
      candidate = dirname(candidate);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;

export function readWorkspaceArtifact(cwd, path) {
  if (!resolveWorkspaceToolPath(cwd, path, false)) return undefined;
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const state = fstatSync(fd);
    const current = lstatSync(path);
    if (
      !resolveWorkspaceToolPath(cwd, path, false) ||
      !state.isFile() ||
      !current.isFile() ||
      state.dev !== current.dev ||
      state.ino !== current.ino ||
      state.size === 0 ||
      state.size > MAX_ARTIFACT_BYTES
    )
      return undefined;
    const content = Buffer.alloc(state.size + 1);
    let used = 0;
    let count;
    do {
      count = readSync(fd, content, used, content.length - used, null);
      used += count;
    } while (count && used < content.length);
    return used === state.size ? content.subarray(0, used) : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
