import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const skillName = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const maximumSkillBytes = 64 * 1024;
const maximumTotalBytes = 512 * 1024;

export interface OneSkillLoadResult {
  instructions: string[];
  skipped: string[];
}

/**
 * Load only explicitly selected, local user skill documents; never run scripts.
 * Missing, unsafe, or oversized selections are skipped so a stale skill ID
 * cannot block an otherwise valid One conversation.
 */
export function loadOneSkills(
  root: string,
  selectedIds: string[],
  agentsRoot?: string,
  oneRoot?: string,
): OneSkillLoadResult {
  if (
    selectedIds.length > 128 ||
    new Set(selectedIds).size !== selectedIds.length
  )
    throw new Error("One skill selection is invalid");
  const instructions: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const id of selectedIds) {
    const isOne = id.startsWith("one:");
    const isCodex = id.startsWith("user:");
    const isAgents = id.startsWith("agents-user:");
    if (!isOne && !isCodex && !isAgents) {
      skipped.push(id);
      continue;
    }
    const selectedRoot = isOne ? oneRoot : isCodex ? root : agentsRoot;
    const name = id.slice(isOne ? 4 : isCodex ? 5 : 12);
    if (
      !selectedRoot ||
      !skillName.test(name) ||
      name === "." ||
      name === ".."
    ) {
      skipped.push(id);
      continue;
    }
    const directory = join(selectedRoot, name);
    const path = join(directory, "SKILL.md");
    try {
      const dirStat = lstatSync(directory);
      const fileStat = lstatSync(path);
      if (
        !dirStat.isDirectory() ||
        dirStat.isSymbolicLink() ||
        !fileStat.isFile() ||
        fileStat.isSymbolicLink() ||
        fileStat.size > maximumSkillBytes ||
        total + fileStat.size > maximumTotalBytes
      ) {
        skipped.push(id);
        continue;
      }
      total += fileStat.size;
      instructions.push(
        "[Selected skill: " + name + "]\n" + readFileSync(path, "utf8"),
      );
    } catch {
      skipped.push(id);
    }
  }
  return { instructions, skipped };
}
