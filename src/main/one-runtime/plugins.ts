import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { OnePluginConfig } from "../../shared/agent-runtimes";

const maxManifestBytes = 256 * 1024;
const maxSkillBytes = 64 * 1024;
const skillName = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export interface OneImportedPlugin {
  id: string;
  name: string;
  version?: string;
  directory: string;
  skillCount: number;
}

function safeDirectory(path: string): string {
  const resolved = resolve(path);
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Plugin path must be a real directory.");
  const real = realpathSync(resolved);
  const canonical = (value: string): string =>
    value
      .replace(/^\\\\\?\\/, "")
      .replace(/\\/g, "/")
      .replace(/\/$/, "")
      .toLowerCase();
  if (canonical(real) !== canonical(resolved))
    throw new Error("Plugin path aliases are not allowed.");
  return resolved;
}

function safePluginChildDirectory(root: string, candidate: string): string {
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("Plugin skill paths must stay inside the plugin folder.");
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink())
      throw new Error("Plugin skill folders cannot use symbolic links.");
    if (!stat.isDirectory())
      throw new Error("Plugin skill folders must be real directories.");
  }
  const real = realpathSync(candidate);
  const canonical = (value: string): string =>
    value
      .replace(/^\\\\\?\\/, "")
      .replace(/\\/g, "/")
      .replace(/\/$/, "")
      .toLowerCase();
  if (canonical(real) !== canonical(candidate))
    throw new Error("Plugin skill path aliases are not allowed.");
  return candidate;
}

function pluginSkillDirectories(directory: string, raw: unknown): string[] {
  const declarations =
    typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  if (declarations.length > 32)
    throw new Error("Plugin has too many skill folders.");
  const root = resolve(directory);
  return declarations.flatMap((value) => {
    if (typeof value !== "string" || !value.trim()) return [];
    const candidate = resolve(root, value.replace(/^\.\//, ""));
    const rel = relative(root, candidate);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error("Plugin skill paths must stay inside the plugin folder.");
    if (!existsSync(candidate)) return [];
    return [safePluginChildDirectory(root, candidate)];
  });
}

function readManifest(directory: string): {
  raw: Record<string, unknown>;
  path: string;
} {
  const root = safeDirectory(directory);
  const candidates = [
    join(root, ".zcode-plugin", "plugin.json"),
    join(root, ".claude-plugin", "plugin.json"),
    join(root, "plugin.json"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new Error("Plugin manifest was not found.");
  for (const item of [
    root,
    join(root, relative(root, path).split(sep)[0]),
    path,
  ]) {
    const stat = lstatSync(item);
    if (stat.isSymbolicLink())
      throw new Error("Plugin manifest cannot use symbolic links.");
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > maxManifestBytes)
    throw new Error("Plugin manifest is invalid or too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Plugin manifest is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Plugin manifest must be a JSON object.");
  return { raw: parsed as Record<string, unknown>, path };
}

function pluginMetadata(directory: string): OneImportedPlugin {
  const root = safeDirectory(directory);
  const { raw } = readManifest(root);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const id = typeof raw.id === "string" ? raw.id : name;
  const version = typeof raw.version === "string" ? raw.version : undefined;
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id) ||
    !name ||
    name.length > 128 ||
    (version && version.length > 64)
  )
    throw new Error("Plugin manifest needs a valid name, ID, and version.");
  const skillFolders = pluginSkillDirectories(
    root,
    raw.skills ?? (existsSync(join(root, "skills")) ? "skills" : undefined),
  );
  const skillCount = skillFolders.reduce((count, skillFolder) => {
    return (
      count +
      readdirSync(skillFolder, { withFileTypes: true }).filter((entry) => {
        if (!entry.isDirectory() || !skillName.test(entry.name)) return false;
        const file = join(skillFolder, entry.name, "SKILL.md");
        try {
          const fileStat = lstatSync(file);
          return (
            fileStat.isFile() &&
            !fileStat.isSymbolicLink() &&
            fileStat.size <= maxSkillBytes
          );
        } catch {
          return false;
        }
      }).length
    );
  }, 0);
  return {
    id,
    name,
    ...(version ? { version } : {}),
    directory: root,
    skillCount,
  };
}

export function inspectOnePlugin(directory: string): OneImportedPlugin {
  return pluginMetadata(directory);
}

export function listOnePluginSkills(plugins: OnePluginConfig[]): Array<{
  id: string;
  name: string;
  description: string;
  pluginId: string;
  pluginName: string;
}> {
  const result: Array<{
    id: string;
    name: string;
    description: string;
    pluginId: string;
    pluginName: string;
  }> = [];
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    const metadata = pluginMetadata(plugin.directory);
    const { raw } = readManifest(metadata.directory);
    for (const root of pluginSkillDirectories(
      metadata.directory,
      raw.skills ??
        (existsSync(join(metadata.directory, "skills")) ? "skills" : undefined),
    )) {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !skillName.test(entry.name)) continue;
        const path = join(root, entry.name, "SKILL.md");
        try {
          const stat = lstatSync(path);
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.size > maxSkillBytes
          )
            continue;
          const body = readFileSync(path, "utf8");
          const frontName = body
            .match(/^name:\s*["']?([^\n"']+)/m)?.[1]
            ?.trim();
          const description = body
            .match(/^description:\s*["']?([^\n"']+)/m)?.[1]
            ?.trim();
          result.push({
            id: `plugin:${plugin.id}:${entry.name}`,
            name: frontName || entry.name,
            description: description || plugin.name,
            pluginId: plugin.id,
            pluginName: plugin.name,
          });
        } catch {
          continue;
        }
      }
    }
  }
  return result.slice(0, 64);
}

export function loadOnePluginInstructions(
  plugins: OnePluginConfig[],
): string[] {
  const instructions: string[] = [];
  let totalBytes = 0;
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    try {
      const metadata = pluginMetadata(plugin.directory);
      const { raw } = readManifest(metadata.directory);
      for (const root of pluginSkillDirectories(
        metadata.directory,
        raw.skills ??
          (existsSync(join(metadata.directory, "skills"))
            ? "skills"
            : undefined),
      )) {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory() || !skillName.test(entry.name)) continue;
          const path = join(root, entry.name, "SKILL.md");
          const directory = join(root, entry.name);
          const directoryStat = lstatSync(directory);
          const fileStat = lstatSync(path, { throwIfNoEntry: false });
          if (
            !directoryStat.isDirectory() ||
            directoryStat.isSymbolicLink() ||
            !fileStat?.isFile() ||
            fileStat.isSymbolicLink() ||
            fileStat.size > maxSkillBytes
          )
            continue;
          totalBytes += fileStat.size;
          if (instructions.length >= 32 || totalBytes > 128 * 1024)
            return instructions;
          instructions.push(
            `[Plugin skill ${plugin.name} / ${entry.name}]\n${readFileSync(path, "utf8")}`,
          );
        }
      }
    } catch {
      // A removed or malformed plugin must not prevent normal One tasks.
      continue;
    }
  }
  return instructions;
}
