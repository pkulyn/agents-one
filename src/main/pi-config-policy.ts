import {
  constants,
  openSync,
  fstatSync,
  readSync,
  closeSync,
  lstatSync,
  statSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
const MAX_CONFIG_BYTES = 8 * 1024 * 1024;
const unavailable =
  "[Agents One 权限不足] Pi 模型或认证配置包含命令取值，或无法安全核验，本轮任务未发送。只读/自动模式请使用普通 Key、环境变量或 OAuth，命令型配置需要完全访问。 / Pi model or credential configuration may execute commands or could not be verified; the task was not sent. Restricted modes require literal, environment or OAuth credentials; command-backed configuration requires full access.";
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readConfig(file: string, models: boolean): RecordValue {
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
        // A dangling link is an existing, unverifiable configuration, not an absent file.
        try {
          lstatSync(file);
        } catch (missing) {
          if ((missing as NodeJS.ErrnoException).code === "ENOENT") return {};
        }
      }
      throw Error(unavailable);
    }
    fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_CONFIG_BYTES))
      throw Error(unavailable);
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_CONFIG_BYTES) throw Error(unavailable);
    const after = fstatSync(fd, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(length) !== after.size
    )
      throw Error(unavailable);
    let content = bytes
      .subarray(0, length)
      .toString("utf8")
      .replace(/^\uFEFF/, "");
    if (models) {
      // Pi1.4: preserve string literals, remove line comments then trailing commas.
      content = content
        .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (value) =>
          value[0] === '"' ? value : "",
        )
        .replace(
          /"(?:\\.|[^"\\])*"|,(\s*[}\]])/g,
          (value, tail) => tail ?? (value[0] === '"' ? value : ""),
        );
    }
    const parsed: unknown = !models && length === 0 ? {} : JSON.parse(content);
    if (!record(parsed)) throw Error(unavailable);
    return parsed;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function value(config: unknown): void {
  if (
    config !== undefined &&
    (typeof config !== "string" || config.startsWith("!"))
  )
    throw Error(unavailable);
}
function headers(config: unknown): void {
  if (config === undefined) return;
  if (!record(config)) throw Error(unavailable);
  for (const entry of Object.values(config)) value(entry);
}
function modelsPolicy(config: RecordValue): void {
  if (config.providers === undefined) return;
  if (!record(config.providers)) throw Error(unavailable);
  for (const provider of Object.values(config.providers)) {
    if (!record(provider)) throw Error(unavailable);
    value(provider.apiKey);
    headers(provider.headers);
    if (provider.models !== undefined) {
      if (!Array.isArray(provider.models)) throw Error(unavailable);
      for (const model of provider.models) {
        if (!record(model)) throw Error(unavailable);
        headers(model.headers);
      }
    }
    if (provider.modelOverrides !== undefined) {
      if (!record(provider.modelOverrides)) throw Error(unavailable);
      for (const model of Object.values(provider.modelOverrides)) {
        if (!record(model)) throw Error(unavailable);
        headers(model.headers);
      }
    }
  }
}
function authPolicy(config: RecordValue): void {
  for (const credential of Object.values(config)) {
    if (!record(credential)) throw Error(unavailable);
    if (credential.type === "api_key") value(credential.key);
    else if (credential.type !== "oauth") throw Error(unavailable);
  }
}

// @lat: [[runtime-chat#Pi non-executing native credentials]]
export function assertPiNonExecutingConfig(directory: string): void {
  try {
    if (!isAbsolute(directory)) throw Error(unavailable);
    modelsPolicy(readConfig(join(directory, "models.json"), true));
    authPolicy(readConfig(join(directory, "auth.json"), false));
  } catch {
    throw Error(unavailable);
  }
}
