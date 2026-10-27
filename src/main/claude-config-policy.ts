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
const credentialEnvironmentKeys = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);
const authRoutingKeys = new Set([
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_GATEWAY",
  "USE_LOCAL_OAUTH",
  "USE_STAGING_OAUTH",
  "CLAUDE_LOCAL_OAUTH_API_BASE",
  "CLAUDE_LOCAL_OAUTH_APPS_BASE",
  "CLAUDE_LOCAL_OAUTH_CONSOLE_BASE",
  "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
  "CLAUDE_CODE_HOST_AUTH_ENV_VAR",
  "CLAUDE_CODE_HOST_CREDS_FILE",
  "CLAUDE_CODE_GB_BASE_URL",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
]);
function hasUnreviewedRouting(env: Record<string, unknown>): boolean {
  return Object.entries(env).some(
    ([key, value]) =>
      authRoutingKeys.has(key.toUpperCase()) &&
      value !== undefined &&
      value !== null &&
      value !== "" &&
      value !== false &&
      value !== "false" &&
      value !== 0 &&
      value !== "0",
  );
}
function userCredentialEnvironment(
  config: unknown,
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = (config as Record<string, unknown>).env;
  if (env === undefined) return {};
  if (env === null || typeof env !== "object" || Array.isArray(env))
    throw Error(unavailable);
  const values = env as Record<string, unknown>;
  if (hasUnreviewedRouting(values)) throw Error(unavailable);
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(values)) {
    const canonical = name.toUpperCase();
    if (!credentialEnvironmentKeys.has(canonical)) continue;
    if (
      typeof value !== "string" ||
      (result[canonical] !== undefined && result[canonical] !== value)
    )
      throw Error(unavailable);
    result[canonical] = value;
  }
  if (Object.keys(result).length && hasUnreviewedRouting(source))
    throw Error(unavailable);
  return result;
}
// @lat: [[runtime-chat#Claude non-executing user configuration]]
export function assertClaudeNonExecutingUserConfig(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
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
    const userSettings = join(custom || join(home, ".claude"), "settings.json");
    const files = new Set([join(custom || home, ".claude.json"), userSettings]);
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
    let credentials: NodeJS.ProcessEnv = {};
    for (const file of files) {
      const config = configuration(file);
      assertNoCommands(config);
      if (file === userSettings)
        credentials = userCredentialEnvironment(config, env);
    }
    return credentials;
  } catch {
    throw Error(unavailable);
  }
}
