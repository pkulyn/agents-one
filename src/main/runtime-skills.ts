import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import type { RuntimeSkillDescriptor } from "../shared/runtime-skills";

const MAX_SKILL_FILE_BYTES = 64 * 1024;

function frontMatterValue(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`^${key}:\\s*['"]?([^\\n'"]+)`, "m"));
  return match?.[1]?.trim() || undefined;
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
    if (!existsSync(location) || !statSync(location).isFile()) return [];
    const body = readFileSync(location, "utf8").slice(0, MAX_SKILL_FILE_BYTES);
    const name = frontMatterValue(body, "name") || entry.name;
    const description = frontMatterValue(body, "description");
    return [
      {
        id: `${source}:${entry.name}`,
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
      },
    ];
  });
}
