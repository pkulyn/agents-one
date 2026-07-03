import type {
  AgentCommandsCatalogResponse,
  AgentSlashCommand,
  SlashCommandCatalog,
  SlashCommandDefinition,
} from "./types";

export interface CreateCatalogOptions {
  agentCommands?: SlashCommandDefinition[];
  desktopCommands?: SlashCommandDefinition[];
  aliases?: Record<string, string>;
}

function normalizeName(name: string): string {
  return name.trim().replace(/^\/+/, "").toLowerCase();
}

function registerCommand(
  byName: Map<string, SlashCommandDefinition>,
  aliases: Map<string, string>,
  command: SlashCommandDefinition,
): void {
  const key = normalizeName(command.name);
  if (!key) throw new Error("Slash command name cannot be empty");
  if (byName.has(key) || aliases.has(key)) {
    throw new Error(`Duplicate slash command: /${key}`);
  }
  byName.set(key, { ...command, name: key });
}

function registerAlias(
  byName: Map<string, SlashCommandDefinition>,
  aliases: Map<string, string>,
  alias: string,
  target: string,
): void {
  const aliasKey = normalizeName(alias);
  const targetKey = normalizeName(target);
  if (!aliasKey) throw new Error("Slash command alias cannot be empty");
  if (!byName.has(targetKey)) {
    throw new Error(
      `Slash alias /${aliasKey} targets unknown command /${targetKey}`,
    );
  }
  if (byName.has(aliasKey) || aliases.has(aliasKey)) {
    throw new Error(`Duplicate slash command alias: /${aliasKey}`);
  }
  aliases.set(aliasKey, targetKey);
}

export function createSlashCatalog({
  agentCommands = [],
  desktopCommands = [],
  aliases = {},
}: CreateCatalogOptions): SlashCommandCatalog {
  const byName = new Map<string, SlashCommandDefinition>();
  const aliasMap = new Map<string, string>();

  for (const cmd of agentCommands) {
    registerCommand(byName, aliasMap, cmd);
    if (cmd.aliases) {
      for (const a of cmd.aliases) {
        registerAlias(byName, aliasMap, a, cmd.name);
      }
    }
  }

  for (const cmd of desktopCommands) {
    registerCommand(byName, aliasMap, cmd);
    if (cmd.aliases) {
      for (const a of cmd.aliases) {
        registerAlias(byName, aliasMap, a, cmd.name);
      }
    }
  }

  for (const [alias, target] of Object.entries(aliases)) {
    registerAlias(byName, aliasMap, alias, target);
  }

  const commands = Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return {
    commands,
    byName,
    aliases: aliasMap,
    resolve(name: string): SlashCommandDefinition | undefined {
      const key = normalizeName(name);
      const resolvedName = aliasMap.get(key) ?? key;
      return byName.get(resolvedName);
    },
  };
}

export function agentCommandsFromCatalog(
  catalog: AgentCommandsCatalogResponse,
): { commands: AgentSlashCommand[]; aliases: Record<string, string> } {
  const pairs =
    catalog.pairs ?? catalog.categories?.flatMap((c) => c.pairs) ?? [];
  const seen = new Set<string>();
  const commands: AgentSlashCommand[] = [];

  for (const [rawName, description] of pairs) {
    const name = normalizeName(rawName);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    commands.push({
      name,
      description,
      category: "Hermes Agent",
      source: "agent",
      target: "agent",
      allowWhileBusy: true,
    });
  }

  const aliases: Record<string, string> = {};
  for (const [rawAlias, rawTarget] of Object.entries(catalog.canon ?? {})) {
    const alias = normalizeName(rawAlias);
    const target = normalizeName(rawTarget);
    if (!alias || !target || alias === target || !seen.has(target)) continue;
    // A name that is already a first-class command (from `pairs`) can't also be
    // an alias — the backend can expose both (e.g. `/compact` as a standalone
    // TUI command and as an alias of `/compress`). Dropping the redundant alias
    // keeps the reconciled catalog self-consistent so createSlashCatalog does
    // not throw on the collision and crash the app. See #802 / #804.
    if (seen.has(alias)) continue;
    aliases[alias] = target;
  }

  return { commands, aliases };
}
