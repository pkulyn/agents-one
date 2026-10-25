import { execFile } from "child_process";
import { mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

export interface PiCapabilityInvocation {
  command: string;
  prefix: string[];
}
export interface VerifiedPiInvocation {
  invocation: PiCapabilityInvocation;
  assertUnchanged: () => void;
}
export interface InspectedPiInvocation extends VerifiedPiInvocation {
  version: string;
}
const inspectionUnavailable =
  "Pi 版本探测失败，无法安全确认版本元数据；请检查执行器安装。 / Pi version metadata could not be safely verified; check the CLI installation.";
const exec = promisify(execFile);
const unavailable =
  "[Agents One 权限不足] 无法确认 Pi 执行器的严格权限能力，本轮任务未发送。只读和自动模式目前支持已验证的 Pi 1.4.0；请检查执行器安装，或明确选择完全访问。 / Pi strict capabilities could not be verified; the task was not sent. Read-only and automatic modes currently require verified Pi 1.4.0. Check the CLI installation or explicitly choose full access.";

function executableFile(command: string): string {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\"))
    return realpathSync(resolve(command));
  const directories = (process.env.PATH || process.env.Path || "")
    .split(delimiter)
    .filter(Boolean);
  for (const directory of directories) {
    for (const suffix of process.platform === "win32"
      ? ["", ".exe", ".com"]
      : [""]) {
      try {
        const file = realpathSync(join(directory, command + suffix));
        if (statSync(file).isFile()) return file;
      } catch {
        /* Continue only the explicit PATH search. */
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

/** This process needs no model credentials, user config, hooks or network. */
function probeEnvironment(directory: string): NodeJS.ProcessEnv {
  const keep = new Set([
    "systemroot",
    "windir",
    "comspec",
    "path",
    "pathext",
    "temp",
    "tmp",
  ]);
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        keep.has(key.toLowerCase()),
      ),
    ),
    HOME: directory,
    USERPROFILE: directory,
    APPDATA: join(directory, "appdata"),
    LOCALAPPDATA: join(directory, "local"),
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_CACHE_HOME: join(directory, "cache"),
    PI_CODING_AGENT_DIR: join(directory, "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(directory, "sessions"),
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  };
}

// @lat: [[runtime-chat#Pi isolated health metadata]]
export async function inspectPiVersion(
  requested: PiCapabilityInvocation,
): Promise<InspectedPiInvocation> {
  let directory: string | undefined;
  try {
    const invocation = {
      command: executableFile(requested.command),
      prefix: requested.prefix.map((file) => realpathSync(resolve(file))),
    };
    const files = [invocation.command, ...invocation.prefix];
    const before = files.map(identity);
    const assertUnchanged = (): void => {
      try {
        if (files.some((file, index) => identity(file) !== before[index]))
          throw Error(inspectionUnavailable);
      } catch {
        throw Error(inspectionUnavailable);
      }
    };
    directory = mkdtempSync(join(tmpdir(), "agents-one-pi-capability-"));
    const result = await exec(
      invocation.command,
      [
        ...invocation.prefix,
        "--version",
        "--offline",
        "--no-extensions",
        "--no-mcp",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-context-files",
      ],
      {
        cwd: directory,
        env: probeEnvironment(directory),
        shell: false,
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 4096,
        encoding: "utf8",
      },
    );
    const version = result.stdout.trim();
    // Discovery does not imply strict-policy compatibility. Keep diagnostics out.
    if (
      version.length > 128 ||
      !/^(?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:[.][0-9A-Za-z-]+)*)?(?:[+][0-9A-Za-z-]+(?:[.][0-9A-Za-z-]+)*)?$/.test(
        version,
      ) ||
      result.stderr.trim()
    )
      throw Error(inspectionUnavailable);
    assertUnchanged();
    return { invocation, assertUnchanged, version };
  } catch {
    throw Error(inspectionUnavailable);
  } finally {
    if (directory) {
      // This exact private mkdtemp result is never supplied by a task or CLI.
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        /* Probe cleanup cannot reveal native diagnostics or task content. */
      }
    }
  }
}

// @lat: [[runtime-chat#Pi strict CLI capability gate]]
export async function verifyPiStrictCapabilities(
  requested: PiCapabilityInvocation,
): Promise<VerifiedPiInvocation> {
  try {
    const inspected = await inspectPiVersion(requested);
    if (inspected.version !== "1.4.0") throw Error(unavailable);
    return {
      invocation: inspected.invocation,
      assertUnchanged: (): void => {
        try {
          inspected.assertUnchanged();
        } catch {
          throw Error(unavailable);
        }
      },
    };
  } catch {
    throw Error(unavailable);
  }
}
