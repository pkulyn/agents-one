/**
 * Runtime commands are deliberate control-plane operations. They are kept
 * separate from ordinary chat prompts so a typed `/compact` cannot silently
 * become model-visible prose when an adapter does not support it.
 */

export type RuntimeCommandTarget =
  | "desktop"
  | "runtime-control"
  | "runtime-native"
  | "model";

export type RuntimeCommandAvailability = "idle" | "running" | "any";

export type RuntimeCommandSource = "desktop" | "runtime" | "skill" | "plugin";

export interface RuntimeCommandDescriptor {
  name: string;
  aliases?: string[];
  description: string;
  category: string;
  argumentHint?: string;
  source: RuntimeCommandSource;
  target: RuntimeCommandTarget;
  availability: RuntimeCommandAvailability;
  supportsAttachments?: boolean;
}

export interface RuntimeCommandCatalog {
  commands: RuntimeCommandDescriptor[];
  resolve: (name: string) => RuntimeCommandDescriptor | undefined;
}

/** Serializable command catalogue returned across the Electron IPC boundary. */
export interface RuntimeCommandCatalogSnapshot {
  commands: RuntimeCommandDescriptor[];
  fetchedAt: number;
}

export interface RuntimeCommandRequest {
  /** Client-generated idempotency/audit id; opaque and never provider auth. */
  requestId?: string;
  runtimeId: string;
  /** Agents One conversation identity; never a provider secret. */
  conversationId?: string;
  /** Native provider session/thread identity, when one is available. */
  sessionId?: string;
  /** The active Agents One run is required by controls such as `/abort`. */
  runId?: string;
  name: string;
  args?: string;
}

/** Transient, provider-originated control-plane progress for the active request. */
export interface RuntimeCommandProgress {
  requestId: string;
  runtimeId: string;
  phase: "started" | "progress";
  message: string;
  createdAt: number;
}

/** Bounded metadata retained with a native or platform compaction audit. */
export interface RuntimeCompactionMetadata {
  trigger: "manual" | "auto" | "platform";
  tokensBefore?: number;
  tokensAfter?: number;
  /** Opaque provider/platform reference; never the summary body itself. */
  summaryRef?: string;
}

export type RuntimeCommandResult =
  | {
      type: "handled";
      message?: string;
      /** A command may update UI-only, conversation-scoped state. */
      statePatch?: {
        model?: string;
        /** Runtime-confirmed, conversation-scoped thinking/reasoning level. */
        thinkingLevel?: string;
        compacted?: boolean;
        compaction?: RuntimeCompactionMetadata;
      };
    }
  | {
      type: "needs-input";
      input: "model-picker" | "thinking-picker" | "confirmation";
      models?: RuntimeModelOption[];
      /** Only levels explicitly returned by the active Runtime are exposed. */
      thinkingLevels?: string[];
      /** Current session level, when the Runtime reports it. */
      thinkingLevel?: string;
    }
  /** Explicit Runtime/template expansion that is allowed to become a chat turn. */
  | { type: "send-prompt"; prompt: string }
  | { type: "unsupported"; reason: string }
  | { type: "error"; message: string };

export interface RuntimeModelOption {
  id: string;
  provider?: string;
  displayName?: string;
  reasoningEfforts?: string[];
  isDefault?: boolean;
}

export interface CreateRuntimeCommandCatalogOptions {
  /** Agents One-owned definitions. They deterministically win collisions. */
  desktop?: RuntimeCommandDescriptor[];
  /** Runtime/skill/plugin metadata is treated as untrusted input. */
  runtime?: RuntimeCommandDescriptor[];
}

const MAX_COMMAND_NAME_LENGTH = 64;
const MAX_COMMAND_DESCRIPTION_LENGTH = 240;
const MAX_COMMAND_CATEGORY_LENGTH = 64;
const MAX_COMMAND_ALIASES = 24;
const COMMAND_NAME = /^[a-z0-9][a-z0-9:_-]*$/;
const COMMAND_TARGETS = new Set<RuntimeCommandTarget>([
  "desktop",
  "runtime-control",
  "runtime-native",
  "model",
]);
const COMMAND_SOURCES = new Set<RuntimeCommandSource>([
  "desktop",
  "runtime",
  "skill",
  "plugin",
]);
const COMMAND_AVAILABILITY = new Set<RuntimeCommandAvailability>([
  "idle",
  "running",
  "any",
]);

export function normalizeRuntimeCommandName(name: string): string {
  return name.trim().replace(/^\/+/, "").toLowerCase();
}

function normalizeDescriptor(raw: unknown): RuntimeCommandDescriptor | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.name !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.category !== "string" ||
    !COMMAND_TARGETS.has(candidate.target as RuntimeCommandTarget) ||
    !COMMAND_SOURCES.has(candidate.source as RuntimeCommandSource) ||
    !COMMAND_AVAILABILITY.has(
      candidate.availability as RuntimeCommandAvailability,
    )
  ) {
    return null;
  }
  const name = normalizeRuntimeCommandName(candidate.name);
  if (
    !name ||
    name.length > MAX_COMMAND_NAME_LENGTH ||
    !COMMAND_NAME.test(name)
  ) {
    return null;
  }
  const description = candidate.description.trim().replace(/\s+/g, " ");
  if (!description) return null;
  const category = candidate.category.trim().replace(/\s+/g, " ") || "Runtime";
  const rawAliases = Array.isArray(candidate.aliases)
    ? candidate.aliases.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const aliases = Array.from(
    new Set(
      rawAliases
        .slice(0, MAX_COMMAND_ALIASES)
        .map(normalizeRuntimeCommandName)
        .filter(
          (alias) =>
            Boolean(alias) &&
            alias !== name &&
            alias.length <= MAX_COMMAND_NAME_LENGTH &&
            COMMAND_NAME.test(alias),
        ),
    ),
  );
  return {
    name,
    description: description.slice(0, MAX_COMMAND_DESCRIPTION_LENGTH),
    category: category.slice(0, MAX_COMMAND_CATEGORY_LENGTH),
    source: candidate.source as RuntimeCommandSource,
    target: candidate.target as RuntimeCommandTarget,
    availability: candidate.availability as RuntimeCommandAvailability,
    ...(aliases.length ? { aliases } : {}),
    ...(typeof candidate.argumentHint === "string" &&
    candidate.argumentHint.trim()
      ? { argumentHint: candidate.argumentHint.trim().slice(0, 160) }
      : {}),
    ...(candidate.supportsAttachments === true
      ? { supportsAttachments: true }
      : {}),
  };
}

/**
 * Merge the app-owned and runtime-provided definitions into a catalog that is
 * safe to render and resolve. A runtime cannot squat a desktop name or alias.
 */
export function createRuntimeCommandCatalog({
  desktop = [],
  runtime = [],
}: CreateRuntimeCommandCatalogOptions): RuntimeCommandCatalog {
  const commands = new Map<string, RuntimeCommandDescriptor>();
  const aliases = new Map<string, string>();

  const register = (
    raw: RuntimeCommandDescriptor,
    ownedByDesktop: boolean,
  ): void => {
    const command = normalizeDescriptor(raw);
    if (!command) return;
    if (commands.has(command.name) || aliases.has(command.name)) return;

    const safeAliases = (command.aliases ?? []).filter(
      (alias) => !commands.has(alias) && !aliases.has(alias),
    );
    const normalized = {
      ...command,
      ...(safeAliases.length ? { aliases: safeAliases } : {}),
    };
    commands.set(normalized.name, normalized);
    for (const alias of safeAliases) aliases.set(alias, normalized.name);

    // `ownedByDesktop` documents the precedence at the call site. Runtime
    // entries are registered only after all desktop names/aliases are known.
    void ownedByDesktop;
  };

  for (const command of desktop) register(command, true);
  for (const command of runtime) register(command, false);

  const ordered = Array.from(commands.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return {
    commands: ordered,
    resolve(name: string): RuntimeCommandDescriptor | undefined {
      const key = normalizeRuntimeCommandName(name);
      return commands.get(aliases.get(key) ?? key);
    },
  };
}

function editDistance(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }
  return previous[right.length];
}

export function runtimeCommandSuggestions(
  catalog: RuntimeCommandCatalog,
  value: string,
  limit = 3,
): string[] {
  const needle = normalizeRuntimeCommandName(value);
  if (!needle || limit <= 0) return [];
  const threshold = Math.max(1, Math.floor(needle.length / 3));
  return catalog.commands
    .map((command) => ({
      name: command.name,
      distance: editDistance(needle, command.name),
    }))
    .filter((candidate) => candidate.distance <= threshold)
    .sort((left, right) =>
      left.distance === right.distance
        ? left.name.localeCompare(right.name)
        : left.distance - right.distance,
    )
    .slice(0, limit)
    .map((candidate) => candidate.name);
}
