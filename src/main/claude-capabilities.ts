import { createHash } from "node:crypto";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
export interface ClaudeCapabilityInvocation {
  command: string;
  prefix: string[];
}
export interface VerifiedClaudeInvocation {
  invocation: ClaudeCapabilityInvocation;
  assertUnchanged: () => void;
}
const reviewed = {
  size: 247736480n,
  sha256: "6d5be51f0edfe3429cd1a9885950db31c1e59eb9a2c9a30a47e64179d2ff98b4",
};
const unavailable =
  "[Agents One 权限不足] 无法确认 Claude CLI 的严格权限能力，本轮任务未发送。目前只读/自动模式支持已核验的 Windows Claude Code 2.1.287 原生执行文件；请检查安装，或明确选择完全访问。 / Claude strict capabilities could not be verified; the task was not sent. Restricted modes currently require the reviewed Windows Claude Code 2.1.287 native executable. Check the installation or explicitly choose full access.";
const cancelled = "Claude Code task was cancelled before process launch.";
function executableFile(command: string): string {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\"))
    return resolve(command);
  for (const directory of (process.env.PATH || process.env.Path || "")
    .split(delimiter)
    .filter(Boolean)) {
    for (const suffix of process.platform === "win32"
      ? ["", ".exe", ".com"]
      : [""]) {
      const file = join(directory, command + suffix);
      try {
        if (statSync(file).isFile()) return file;
      } catch {
        /* Continue the explicit PATH search. */
      }
    }
  }
  throw Error(unavailable);
}
function identity(file: string): string {
  const stat = statSync(file, { bigint: true });
  if (!stat.isFile() || stat.ino <= 0n) throw Error(unavailable);
  return JSON.stringify([
    realpathSync(file),
    String(stat.dev),
    String(stat.ino),
    String(stat.size),
    String(stat.mtimeNs),
    String(stat.ctimeNs),
  ]);
}
// @lat: [[runtime-chat#Claude strict native task dispatch]]
export async function verifyClaudeStrictCapabilities(
  requested: ClaudeCapabilityInvocation,
  canStart: () => boolean = () => true,
): Promise<VerifiedClaudeInvocation> {
  let stopped = false;
  const checkStart = (): void => {
    if (!canStart()) {
      stopped = true;
      throw Error(cancelled);
    }
  };
  checkStart();
  try {
    if (requested.prefix.length) throw Error(unavailable);
    const alias = executableFile(requested.command),
      command = realpathSync(alias);
    const before = identity(command),
      aliasBefore = identity(alias);
    if (statSync(command, { bigint: true }).size !== reviewed.size)
      throw Error(unavailable);
    const invocation = { command, prefix: [] as string[] };
    const assertUnchanged = (): void => {
      try {
        if (
          invocation.command !== command ||
          invocation.prefix.length ||
          identity(command) !== before ||
          identity(alias) !== aliasBefore
        )
          throw Error(unavailable);
      } catch {
        throw Error(unavailable);
      }
    };
    const file = await open(command, "r");
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 10_000);
    try {
      const stat = await file.stat({ bigint: true });
      if (!stat.isFile() || stat.size !== reviewed.size)
        throw Error(unavailable);
      const hash = createHash("sha256");
      const stream = createReadStream(command, {
        fd: file.fd,
        autoClose: false,
        highWaterMark: 512 * 1024,
        signal: abort.signal,
      });
      let bytes = 0n;
      for await (const chunk of stream) {
        checkStart();
        bytes += BigInt(chunk.length);
        if (bytes > reviewed.size) throw Error(unavailable);
        hash.update(chunk);
      }
      if (bytes !== reviewed.size || hash.digest("hex") !== reviewed.sha256)
        throw Error(unavailable);
      assertUnchanged();
    } finally {
      clearTimeout(timeout);
      await file.close();
    }
    checkStart();
    assertUnchanged();
    return { invocation, assertUnchanged };
  } catch {
    throw Error(stopped ? cancelled : unavailable);
  }
}
