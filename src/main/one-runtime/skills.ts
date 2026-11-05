import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const skillName = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const maximumSkillBytes = 64 * 1024;
const maximumTotalBytes = 128 * 1024;

/** Load only explicitly selected, local user skill documents; never run scripts. */
export function loadOneSkills(
  root: string,
  selectedIds: string[],
  agentsRoot?: string,
): string[] {
  if (
    selectedIds.length > 32 ||
    new Set(selectedIds).size !== selectedIds.length
  )
    throw new Error("One skill selection is invalid");
  let total = 0;
  return selectedIds.map((id) => {
    const isCodex = id.startsWith("user:");
    const isAgents = id.startsWith("agents-user:");
    if (!isCodex && !isAgents)
      throw new Error("Only selected user skills can be used by One");
    const selectedRoot = isCodex ? root : agentsRoot;
    if (!selectedRoot)
      throw new Error("Selected One skill source is unavailable");
    const name = id.slice(isCodex ? 5 : 12);
    if (!skillName.test(name) || name === "." || name === "..")
      throw new Error("One skill name is invalid");
    const directory = join(selectedRoot, name);
    const path = join(directory, "SKILL.md");
    const dirStat = lstatSync(directory);
    const fileStat = lstatSync(path);
    if (
      !dirStat.isDirectory() ||
      dirStat.isSymbolicLink() ||
      !fileStat.isFile() ||
      fileStat.isSymbolicLink() ||
      fileStat.size > maximumSkillBytes
    )
      throw new Error("Selected One skill is unavailable or unsafe: " + name);
    total += fileStat.size;
    if (total > maximumTotalBytes)
      throw new Error("Selected One skills exceed the size limit");
    return "[Selected skill: " + name + "]\n" + readFileSync(path, "utf8");
  });
}
