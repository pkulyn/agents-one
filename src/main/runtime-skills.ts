import { existsSync, lstatSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { parse } from "yaml";
import type { RuntimeSkillDescriptor } from "../shared/runtime-skills";

const MAX_SKILL_FILE_BYTES = 64 * 1024;

function skillMetadata(source: string): Record<string, unknown> {
  const front = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!front) return {};
  try {
    const value: unknown = parse(front[1]);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Discovery is intentionally read-only. It does not import a skill module,
 * execute scripts, or copy user skill content into application storage.
 */
export function discoverRuntimeSkills(
  root: string,
  source: RuntimeSkillDescriptor["source"],
): RuntimeSkillDescriptor[] {
  const absoluteRoot = resolve(root);
  if (!existsSync(absoluteRoot)) return [];
  return readdirSync(absoluteRoot, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const location = join(absoluteRoot, entry.name, "SKILL.md");
    let oneIssue: RuntimeSkillDescriptor["oneIssue"];
    let body = "";
    try {
      const stat = lstatSync(location);
      if (!stat.isFile() || stat.isSymbolicLink()) oneIssue = "unsafe_file";
      else if (stat.size > MAX_SKILL_FILE_BYTES) oneIssue = "too_large";
      else if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(entry.name))
        oneIssue = "invalid_name";
      else body = readFileSync(location, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      oneIssue = "unreadable";
    }
    const metadata = skillMetadata(body);
    const name =
      typeof metadata.name === "string" && metadata.name.trim()
        ? metadata.name.trim()
        : entry.name;
    const description =
      typeof metadata.description === "string"
        ? metadata.description.trim()
        : undefined;
    return [
      {
        id: source + ":" + entry.name,
        name,
        ...(description ? { description } : {}),
        source,
        location,
        enabled: true,
        trust:
          source === "user"
            ? "local-user"
            : source === "runtime"
              ? "runtime-managed"
              : "project-unreviewed",
        executionBoundary:
          source === "runtime" ? "runtime-subprocess" : "documentation-only",
        ...(oneIssue ? { oneIssue } : {}),
      },
    ];
  });
}
