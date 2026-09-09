import { existsSync } from "fs";
import { delimiter, join } from "path";
import { BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS } from "../shared/runtime-adapters";

/**
 * Local CLI executable detection (opensource plan 1.5).
 *
 * When adding a local CLI runtime, the desktop
 * auto-lists the executables it finds on PATH so the user can register an
 * agent by path instead of typing a command name that may not resolve.
 */

/** Canonical on-PATH command name per local CLI kind. */
export const LOCAL_CLI_COMMANDS: Record<string, string> = {
  ...Object.fromEntries(
    BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS.filter(
      (manifest) =>
        manifest.locations.includes("local") && manifest.localCliCommand,
    ).map((manifest) => [manifest.kinds[0], manifest.localCliCommand!]),
  ),
};

const WINDOWS_EXTENSIONS = [".cmd", ".exe", ".bat", ""];

/** On-PATH executable search order for the given command name. */
export function findExecutableOnPath(command: string): string | null {
  const pathVar = process.env.PATH || process.env.Path || "";
  const directories = pathVar
    .split(delimiter)
    .map((directory) => directory.trim())
    .filter(Boolean);

  const extensions = process.platform === "win32" ? WINDOWS_EXTENSIONS : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Detect every local CLI executable currently available on PATH. */
export function detectLocalCliPaths(): Record<string, string | null> {
  const detected: Record<string, string | null> = {};
  for (const [kind, command] of Object.entries(LOCAL_CLI_COMMANDS)) {
    detected[kind] = findExecutableOnPath(command);
  }
  return detected;
}
