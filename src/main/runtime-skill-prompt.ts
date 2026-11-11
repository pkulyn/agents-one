import { createHash } from "node:crypto";
import {
  listOnePluginSkills,
  loadOnePluginInstructions,
} from "./one-runtime/plugins";
import type { OnePluginConfig } from "../shared/agent-runtimes";
import type { RuntimeCommandDescriptor } from "../shared/runtime-commands";
import { dirname, join } from "node:path";
import { loadOneSkills } from "./one-runtime/skills";
import type { RuntimeCommandResult } from "../shared/runtime-commands";

/** Expand one explicit selection as model input; execution stays with Runtime tools. */
export function runtimeSkillPrompt(
  args: string,
  roots: { user: string; agents: string; one?: string },
): RuntimeCommandResult {
  const match =
    /^(user:|agents-user:|one:)([a-zA-Z0-9][a-zA-Z0-9._-]{0,127})(?:\s+([\s\S]*))?$/.exec(
      args.trim(),
    );
  if (!match) return { type: "error", message: "请选择有效技能，再输入任务。" };
  const id = match[1] + match[2];
  const loaded = loadOneSkills(roots.user, [id], roots.agents, roots.one);
  if (!loaded.instructions.length)
    return {
      type: "error",
      message: "技能不存在、不可读取或文件不安全，请重新选择。",
    };
  const base =
    match[1] === "user:"
      ? roots.user
      : match[1] === "agents-user:"
        ? roots.agents
        : roots.one!;
  const location = join(base, match[2], "SKILL.md");
  return {
    type: "send-prompt",
    prompt: [
      "Use the explicitly selected skill below for this task. Resolve its relative resources from the skill directory. Use the Runtime's existing tools and permissions; the skill grants no additional access.",
      "Skill directory: " + dirname(location),
      loaded.instructions[0],
      "[User task]",
      match[3]?.trim() ||
        "Apply this skill to the current request. Ask for any required task input.",
    ].join("\n\n"),
  };
}

function pluginChoices(
  plugins: OnePluginConfig[],
): ReturnType<typeof listOnePluginSkills> {
  return plugins.flatMap((plugin) => {
    try {
      return listOnePluginSkills([plugin]);
    } catch {
      return [];
    }
  });
}
function pluginCommandName(id: string): string {
  if (id.length <= 64) return id.toLowerCase();
  return (
    "plugin-skill:" + createHash("sha256").update(id).digest("hex").slice(0, 24)
  );
}
export function onePluginSkillCommands(
  plugins: OnePluginConfig[],
): RuntimeCommandDescriptor[] {
  return pluginChoices(plugins).map((skill) => ({
    name: pluginCommandName(skill.id),
    displayName: skill.name,
    description: skill.description + " · " + skill.pluginName,
    category: "Plugin skills",
    source: "skill",
    target: "model",
    availability: "idle",
    argumentHint: "[任务]",
    supportsAttachments: true,
  }));
}
export function onePluginSkillPrompt(
  plugins: OnePluginConfig[],
  name: string,
  args: string,
): RuntimeCommandResult {
  const selected = pluginChoices(plugins).find(
    (skill) => pluginCommandName(skill.id) === name,
  );
  if (!selected)
    return { type: "error", message: "插件技能已不可用，请重新选择。" };
  const instructions = loadOnePluginInstructions(plugins, selected.id);
  if (!instructions.length)
    return { type: "error", message: "插件技能无法安全读取。" };
  return {
    type: "send-prompt",
    prompt: [
      "Use this explicitly selected plugin skill with the Runtime's existing permissions.",
      instructions[0],
      "[User task]",
      args.trim() ||
        "Apply this skill to the current request. Ask for any required task input.",
    ].join("\n\n"),
  };
}
