import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
const MAX_BYTES = 8 * 1024 * 1024;
const unavailable =
  "[Agents One 权限不足] Claude 用户或项目配置包含命令型认证，或无法可靠核验，本轮任务未发送。只读/自动模式请使用普通 Key、环境变量或 OAuth；命令型配置需要明确选择完全访问。 / Claude user or project credential configuration may execute commands or could not be verified; the task was not sent. Restricted tasks require non-command credentials; command-backed configuration requires explicit full access.";
const commandKeys = new Set([
  "apiKeyHelper",
  "awsAuthRefresh",
  "awsCredentialExport",
  "gcpAuthRefresh",
  "otelHeadersHelper",
  "proxyAuthHelper",
  "policyHelper",
  "policyHelpers",
]);
function environmentValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const values = Object.entries(env)
    .filter(([key]) => key.toUpperCase() === name)
    .map(([, value]) => value)
    .filter((value): value is string => value !== undefined);
  if (new Set(values).size > 1) throw Error(unavailable);
  return values[0];
}
function configuration(file: string): unknown {
  let fd: number | undefined;
  try {
    try {
      const entry = lstatSync(file);
      if (
        !(entry.isFile() || (entry.isSymbolicLink() && statSync(file).isFile()))
      )
        throw Error(unavailable);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        try {
          lstatSync(file);
        } catch (missing) {
          if ((missing as NodeJS.ErrnoException).code === "ENOENT") return {};
        }
      }
      throw Error(unavailable);
    }
    const canonical = realpathSync(file);
    fd = openSync(canonical, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_BYTES))
      throw Error(unavailable);
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd, { bigint: true }),
      current = statSync(file, { bigint: true });
    if (
      length > MAX_BYTES ||
      BigInt(length) !== after.size ||
      realpathSync(file) !== canonical ||
      [after, current].some(
        (stat) =>
          stat.dev !== before.dev ||
          stat.ino !== before.ino ||
          stat.size !== before.size ||
          stat.mtimeNs !== before.mtimeNs ||
          stat.ctimeNs !== before.ctimeNs,
      )
    )
      throw Error(unavailable);
    const text = bytes
      .subarray(0, length)
      .toString("utf8")
      .replace(/^\uFEFF/, "");
    const value: unknown = text.trim() ? JSON.parse(text) : {};
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw Error(unavailable);
    return value;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function assertNoCommands(value: unknown): void {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++visited > 100_000 || item.depth > 128) throw Error(unavailable);
    if (item.value === null || typeof item.value !== "object") continue;
    for (const [key, entry] of Object.entries(item.value)) {
      if (
        commandKeys.has(key) &&
        entry !== undefined &&
        entry !== null &&
        entry !== ""
      )
        throw Error(unavailable);
      pending.push({ value: entry, depth: item.depth + 1 });
    }
  }
}
// @lat: [[runtime-chat#Claude non-executing user configuration]]
export function assertClaudeNonExecutingUserConfig(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    if (!isAbsolute(cwd)) throw Error(unavailable);
    const home =
      environmentValue(
        env,
        process.platform === "win32" ? "USERPROFILE" : "HOME",
      ) || homedir();
    const custom = environmentValue(env, "CLAUDE_CONFIG_DIR");
    if (!isAbsolute(home) || (custom && !isAbsolute(custom)))
      throw Error(unavailable);
    const files = new Set([
      join(custom || home, ".claude.json"),
      join(custom || join(home, ".claude"), "settings.json"),
    ]);
    const roots = new Set([resolve(cwd)]);
    try {
      roots.add(realpathSync(cwd));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const root of roots) {
      let dir = root;
      for (let depth = 0; ; depth++) {
        if (depth > 128) throw Error(unavailable);
        files.add(join(dir, ".claude", "settings.json"));
        files.add(join(dir, ".claude", "settings.local.json"));
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    for (const file of files) assertNoCommands(configuration(file));
  } catch {
    throw Error(unavailable);
  }
}
