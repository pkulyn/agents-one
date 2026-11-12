import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import type { OneWorkerTool } from "./protocol";

const skillName = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const maximumSkillBytes = 64 * 1024;
const maximumTotalBytes = 512 * 1024;

export interface OneSkillLoadResult {
  instructions: string[];
  skipped: string[];
  revisionInstructions: string[];
  resources: Array<{ id: string; directory: string }>;
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
  const resources: OneSkillLoadResult["resources"] = [];
  const revisionInstructions: string[] = [];
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
      const content = readFileSync(path, "utf8");
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
      let metadata: Record<string, unknown> = {};
      try {
        metadata = front ? parse(front[1]) || {} : {};
      } catch {
        /* Use the heading fallback. */
      }
      const description =
        typeof metadata.description === "string"
          ? metadata.description
          : content
              .split(/\r?\n/)
              .find((line) => /^#\s/.test(line))
              ?.replace(/^#\s+/, "") || name;
      instructions.push(
        JSON.stringify({
          skill: id,
          name: typeof metadata.name === "string" ? metadata.name : name,
          description: description.slice(0, 1000),
        }),
      );
      revisionInstructions.push(content);
      resources.push({ id, directory: realpathSync(directory) });
    } catch {
      skipped.push(id);
    }
  }
  return { instructions, skipped, resources, revisionInstructions };
}

/** Read selected skill instructions/resources on demand without widening workspace access. */
export function createOneSkillReader(
  resources: OneSkillLoadResult["resources"],
): {
  tools: OneWorkerTool[];
  executeTool: (parameters: unknown, signal: AbortSignal) => Promise<string>;
} {
  return {
    tools: resources.length
      ? [
          {
            name: "skill_read",
            label: "Read skill",
            description:
              "Read instructions for a selected skill, or a text resource relative to its directory. Skills are not tool functions; actual tool calls must use the supplied tool schemas.",
            parameters: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  enum: resources.map((resource) => resource.id),
                },
                path: {
                  type: "string",
                  description:
                    "Relative text resource path; defaults to SKILL.md.",
                },
              },
              required: ["id"],
              additionalProperties: false,
            },
          },
        ]
      : [],
    executeTool: async (parameters, signal) => {
      signal.throwIfAborted();
      const args = parameters as Record<string, unknown> | null;
      const resource = resources.find((item) => item.id === args?.id);
      const name = args?.path ?? "SKILL.md";
      if (
        !resource ||
        typeof name !== "string" ||
        isAbsolute(name) ||
        name.includes("\0")
      )
        throw new Error("Invalid selected skill resource");
      const path = realpathSync(resolve(resource.directory, name));
      const relation = relative(resource.directory, path);
      if (
        !relation ||
        relation === ".." ||
        relation.startsWith("..\\") ||
        relation.startsWith("../") ||
        isAbsolute(relation)
      )
        throw new Error("Skill resource is outside the selected skill");
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size > maximumSkillBytes)
        throw new Error("Skill resource is not a bounded text file");
      const bytes = readFileSync(path);
      if (bytes.includes(0))
        throw new Error("Skill resource is not a text file");
      return JSON.stringify({
        skill: resource.id,
        path: relation,
        content: bytes.toString("utf8"),
      });
    },
  };
}
