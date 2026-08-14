// @lat: [[backup-recovery#Portable backup format]]
import { createHash, randomUUID } from "crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "path";
import * as tar from "tar";
import type { ReadEntry } from "tar";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { HERMES_HOME } from "./installer";
import Database from "./sqlite";
import type {
  AgentsOneBackupInspection,
  AgentsOneBackupResult,
  AgentsOneBackupSummary,
  AgentsOneRestoreResult,
} from "../shared/agents-one-backup";

export const AGENTS_ONE_BACKUP_SCHEMA_VERSION = 1;
const BACKUP_PRODUCT = "agents-one";
const MANIFEST_FILE = "manifest.json";
const PAYLOAD_DIR = "payload";
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILE_COUNT = 20_000;
const MAX_ARCHIVE_ENTRY_COUNT = 40_000;
const MAX_RESTORE_AFFECTED_PATHS = 60_000;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_CONFIG_BYTES = 32 * 1024 * 1024;
const MAX_CORE_JSON_BYTES = 128 * 1024 * 1024;
const RESTORE_TRANSACTION_DIRECTORY = ".restore-transaction";
const RESTORE_JOURNAL_FILE = "journal.json";
const RESTORE_JOURNAL_VERSION = 1;
const PROFILE_NAME_PATTERN = /^[a-z0-9_][a-z0-9_-]{0,63}$/;
const WINDOWS_RESERVED_NAME_PATTERN =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const ROOT_FILES = new Set([
  "desktop.json",
  "models.json",
  "portable-config.yaml",
  "active_profile",
  "profile-meta.json",
  "SOUL.md",
  "state.db",
]);
const PROFILE_FILES = new Set([
  "profile-meta.json",
  "SOUL.md",
  "state.db",
  "portable-config.yaml",
]);
const PROFILE_DIRECTORIES = new Set(["desktop", "memories", "skills"]);
const ROOT_DIRECTORIES = new Set([...PROFILE_DIRECTORIES, "desktop-staging"]);
const EXCLUDED_NAMES = new Set([
  ".env",
  "auth.json",
  "account.json",
  "wallets.json",
  "config.yaml",
  "gateway.pid",
  "gateway_state.json",
  "cloud-sync.json",
  "state.db-wal",
  "state.db-shm",
]);
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".venv",
  ".cache",
  RESTORE_TRANSACTION_DIRECTORY,
  "__pycache__",
  "node_modules",
  "backups",
  "worktrees",
  "safe-write-backups",
  "logs",
  "hermes-agent",
  "venv",
  "node",
  "git",
]);

const CORE_JSON_ARRAY_STORES = new Map<string, string>([
  ["desktop/runtime-conversations.json", "conversations"],
  ["desktop/quick-chats.json", "chats"],
  ["desktop/project-folders.json", "folders"],
  ["desktop/task-collaborations.json", "records"],
  ["desktop/task-schedules.json", "schedules"],
  ["desktop/archives.json", "items"],
  ["desktop/sessions.json", "sessions"],
  ["desktop/remote-session-cache.json", "sessions"],
  ["desktop/task-center.json", "tasks"],
  ["desktop/project-control.json", "projects"],
]);

export interface AgentsOneBackupFile {
  path: string;
  sourcePath: string;
  size: number;
  sha256: string;
}

interface AgentsOneBackupManifest {
  product: typeof BACKUP_PRODUCT;
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  profiles: string[];
  files: Array<Pick<AgentsOneBackupFile, "path" | "size" | "sha256">>;
  counts: {
    projects: number;
    tasks: number;
    chats: number;
    collaborations: number;
  };
  excluded: string[];
}

interface RestoreFileOperation {
  path: string;
  sourcePath: string;
}

interface RestoreTransactionJournal {
  version: typeof RESTORE_JOURNAL_VERSION;
  phase: "prepared" | "committed";
  affectedPaths: string[];
  existingPaths: string[];
}

interface PreparedBackup {
  temporaryRoot: string;
}

export interface ExportAgentsOneBackupOptions {
  sourceHome?: string;
  appVersion?: string;
}

export interface InspectAgentsOneBackupOptions {
  targetHome?: string;
}

export interface RestoreAgentsOneBackupOptions {
  targetHome?: string;
}

let backupOperationInProgress = false;

async function runExclusiveBackupOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (backupOperationInProgress) {
    throw new Error("另一个 Agents One 备份或恢复操作正在进行，请稍后再试。");
  }
  backupOperationInProgress = true;
  try {
    return await operation();
  } finally {
    backupOperationInProgress = false;
  }
}

function cleanRelativePath(input: string): string {
  return input.split(sep).join("/").replace(/^\.\//, "");
}

function isSafeRelativePath(input: string): boolean {
  if (
    !input ||
    input.length > 1024 ||
    input.includes("\0") ||
    isAbsolute(input)
  ) {
    return false;
  }
  if (/^[a-z]:/i.test(input) || input.startsWith("\\\\")) return false;
  const normalized = input.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.length > 255 ||
        /[\u0001-\u001f]/.test(part) ||
        /[. ]$/.test(part) ||
        WINDOWS_RESERVED_NAME_PATTERN.test(part),
    )
  ) {
    return false;
  }
  // NTFS alternate data streams are not portable and can hide content.
  return !parts.some((part) => part.includes(":"));
}

function sha256File(path: string): string {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function isExcludedName(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    EXCLUDED_NAMES.has(normalized) ||
    EXCLUDED_DIRECTORIES.has(normalized) ||
    normalized.startsWith(".env.") ||
    normalized.endsWith(".agents-one-backup") ||
    /\.(?:tmp|previous|restore)$/.test(normalized) ||
    /(?:^|[._-])(?:credentials?|secrets?|tokens?|wallets?)(?:[._-]|$)/i.test(
      normalized,
    )
  );
}

function isAllowedBackupRelativePath(
  input: string,
  profiles?: ReadonlySet<string>,
): boolean {
  if (!isSafeRelativePath(input) || input.includes("\\")) return false;
  const parts = input.split("/");
  if (parts.some(isExcludedName)) return false;

  if (parts.length === 1) return ROOT_FILES.has(parts[0]);
  if (ROOT_DIRECTORIES.has(parts[0])) return parts.length >= 2;
  if (parts[0] !== "profiles" || parts.length < 3) return false;

  const profile = parts[1];
  if (
    profile === "default" ||
    !PROFILE_NAME_PATTERN.test(profile) ||
    (profiles && !profiles.has(profile))
  ) {
    return false;
  }
  if (parts.length === 3) return PROFILE_FILES.has(parts[2]);
  return PROFILE_DIRECTORIES.has(parts[2]);
}

function addRegularFile(
  root: string,
  absolutePath: string,
  files: AgentsOneBackupFile[],
): void {
  const info = lstatSync(absolutePath);
  if (!info.isFile() || info.isSymbolicLink()) return;
  if (info.size > MAX_FILE_BYTES) {
    throw new Error(`单个 Agents One 数据文件过大：${absolutePath}`);
  }
  if (files.length >= MAX_FILE_COUNT) {
    throw new Error("Agents One 数据文件数量超过备份安全限制。");
  }
  const path = cleanRelativePath(relative(root, absolutePath));
  if (!isSafeRelativePath(path)) return;
  files.push({
    path,
    sourcePath: absolutePath,
    size: info.size,
    sha256: sha256File(absolutePath),
  });
}

function walkAllowedDirectory(
  root: string,
  directory: string,
  files: AgentsOneBackupFile[],
): void {
  if (!existsSync(directory)) return;
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (isExcludedName(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkAllowedDirectory(root, absolutePath, files);
    } else if (entry.isFile()) {
      addRegularFile(root, absolutePath, files);
    }
  }
}

function profileNames(root: string): string[] {
  const result = ["default"];
  const profiles = join(root, "profiles");
  if (!existsSync(profiles)) return result;
  for (const entry of readdirSync(profiles, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      !entry.isSymbolicLink() &&
      PROFILE_NAME_PATTERN.test(entry.name)
    ) {
      result.push(entry.name);
    }
  }
  return result.sort((left, right) =>
    left === "default"
      ? -1
      : right === "default"
        ? 1
        : left.localeCompare(right),
  );
}

function profileRoot(root: string, profile: string): string {
  return profile === "default" ? root : join(root, "profiles", profile);
}

function sanitizePortableJson(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const clone = JSON.parse(JSON.stringify(value)) as unknown;
  // Runtime credentials live in protected stores today. Defensively reject
  // any future secret-shaped keys that may accidentally be added to a draft.
  const sanitize = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(sanitize);
      return;
    }
    for (const key of Object.keys(node as Record<string, unknown>)) {
      const normalizedKey = key
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase();
      if (
        /(?:^|[_-])(?:api(?:[_-]server)?[_-]?key|access[_-]?key|private[_-]?key|key[_-]?path|token|auth(?:orization)?(?:[_-]?token)?|secret|password|passphrase|credential|cookie|jwt)(?:$|[_-])/.test(
          normalizedKey,
        )
      ) {
        delete (node as Record<string, unknown>)[key];
      } else {
        const child = (node as Record<string, unknown>)[key];
        if (
          typeof child === "string" &&
          /(?:url|endpoint|base[_-]?url)$/i.test(normalizedKey)
        ) {
          const safeUrl = sanitizePortableUrl(child);
          if (safeUrl) (node as Record<string, unknown>)[key] = safeUrl;
          else delete (node as Record<string, unknown>)[key];
        } else {
          sanitize(child);
        }
      }
    }
  };
  sanitize(clone);
  return clone;
}

function endpointFingerprint(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const runtime = value as Record<string, unknown>;
  const config =
    runtime.config && typeof runtime.config === "object"
      ? (runtime.config as Record<string, unknown>)
      : {};
  const hermes =
    config.hermes && typeof config.hermes === "object"
      ? (config.hermes as Record<string, unknown>)
      : {};
  const gateway =
    config.remoteGateway && typeof config.remoteGateway === "object"
      ? (config.remoteGateway as Record<string, unknown>)
      : {};
  const ssh =
    hermes.ssh && typeof hermes.ssh === "object"
      ? (hermes.ssh as Record<string, unknown>)
      : {};
  return JSON.stringify({
    kind: runtime.kind,
    location: runtime.location,
    endpoint: config.endpoint,
    workspaceGatewayEndpoint: config.workspaceGatewayEndpoint,
    hermesMode: hermes.mode,
    dashboardUrl: hermes.dashboardUrl,
    sshHost: ssh.host,
    sshPort: ssh.port,
    sshUsername: ssh.username,
    sshRemotePort: ssh.remotePort,
    gatewayProtocol: gateway.protocol,
  });
}

function disableUntrustedRestoredRuntimes(
  restored: Record<string, unknown>,
  current: unknown,
): Record<string, unknown> {
  const restoredRuntimes = Array.isArray(restored.agentRuntimes)
    ? (restored.agentRuntimes as Array<Record<string, unknown>>)
    : [];
  const currentRuntimes =
    current &&
    typeof current === "object" &&
    !Array.isArray(current) &&
    Array.isArray((current as Record<string, unknown>).agentRuntimes)
      ? ((current as Record<string, unknown>).agentRuntimes as Array<
          Record<string, unknown>
        >)
      : [];
  const currentById = new Map(
    currentRuntimes
      .filter((runtime) => typeof runtime?.id === "string")
      .map((runtime) => [runtime.id as string, runtime]),
  );
  restored.agentRuntimes = restoredRuntimes.map((runtime) => {
    const id = typeof runtime.id === "string" ? runtime.id : "";
    const existing = currentById.get(id);
    const remote =
      runtime.location === "remote" ||
      (
        (runtime.config as Record<string, unknown> | undefined)?.hermes as
          | Record<string, unknown>
          | undefined
      )?.mode === "ssh";
    if (!remote) {
      const config =
        runtime.config && typeof runtime.config === "object"
          ? { ...(runtime.config as Record<string, unknown>) }
          : {};
      const existingConfig =
        existing?.config && typeof existing.config === "object"
          ? (existing.config as Record<string, unknown>)
          : {};
      const executableChanged =
        typeof config.executablePath === "string" &&
        config.executablePath !== existingConfig.executablePath;
      const workspaceChanged =
        typeof config.workspace === "string" &&
        config.workspace !== existingConfig.workspace;
      if (!existing || executableChanged || workspaceChanged) {
        delete config.executablePath;
        delete config.workspace;
        return { ...runtime, config, enabled: false };
      }
    }
    if (remote) {
      const sameEndpoint = Boolean(
        existing &&
        endpointFingerprint(existing) === endpointFingerprint(runtime),
      );
      const config =
        runtime.config && typeof runtime.config === "object"
          ? { ...(runtime.config as Record<string, unknown>) }
          : {};
      const hermes =
        config.hermes && typeof config.hermes === "object"
          ? { ...(config.hermes as Record<string, unknown>) }
          : null;
      if (hermes?.ssh && typeof hermes.ssh === "object") {
        const ssh = { ...(hermes.ssh as Record<string, unknown>) };
        const existingConfig =
          existing?.config && typeof existing.config === "object"
            ? (existing.config as Record<string, unknown>)
            : {};
        const existingHermes =
          existingConfig.hermes && typeof existingConfig.hermes === "object"
            ? (existingConfig.hermes as Record<string, unknown>)
            : {};
        const existingSsh =
          existingHermes.ssh && typeof existingHermes.ssh === "object"
            ? (existingHermes.ssh as Record<string, unknown>)
            : {};
        ssh.keyPath =
          sameEndpoint && typeof existingSsh.keyPath === "string"
            ? existingSsh.keyPath
            : "";
        hermes.ssh = ssh;
        config.hermes = hermes;
      }
      const protectedRuntime = { ...runtime, config };
      if (!sameEndpoint) {
        return {
          ...protectedRuntime,
          enabled: false,
          needsReauthorization: true,
        };
      }
      return protectedRuntime;
    }
    return runtime;
  });

  const currentRecord =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  const restoredMode = restored.connectionMode;
  const currentMode = currentRecord.connectionMode;
  const restoredSsh =
    restored.sshConfig && typeof restored.sshConfig === "object"
      ? (restored.sshConfig as Record<string, unknown>)
      : {};
  const currentSsh =
    currentRecord.sshConfig && typeof currentRecord.sshConfig === "object"
      ? (currentRecord.sshConfig as Record<string, unknown>)
      : {};
  const sameBuiltInEndpoint =
    restoredMode === currentMode &&
    (restoredMode === "remote"
      ? restored.remoteUrl === currentRecord.remoteUrl
      : restoredMode === "ssh"
        ? restoredSsh.host === currentSsh.host &&
          restoredSsh.port === currentSsh.port &&
          restoredSsh.username === currentSsh.username &&
          restoredSsh.remotePort === currentSsh.remotePort
        : true);
  if (
    (restoredMode === "remote" || restoredMode === "ssh") &&
    !sameBuiltInEndpoint
  ) {
    restored.connectionMode = "local";
    restored.connectionNeedsReauthorization = true;
    if (restoredMode === "ssh") {
      restored.sshConfig = { ...restoredSsh, keyPath: "" };
    }
  } else if (restoredMode === "ssh") {
    restored.sshConfig = {
      ...restoredSsh,
      keyPath: typeof currentSsh.keyPath === "string" ? currentSsh.keyPath : "",
    };
  }
  return restored;
}

const PORTABLE_CONFIG_BLOCKED_KEY =
  /(?:^|[_-])(?:api(?:[_-]server)?[_-]?key|access[_-]?key|private[_-]?key|token|secret|password|passphrase|credential|cookie|authorization|jwt|command)(?:$|[_-])/i;
const PORTABLE_CONFIG_TOP_LEVEL_KEYS = new Set([
  "model",
  "memory",
  "network",
  "agent",
]);
const PORTABLE_CONFIG_CHILD_KEYS: Record<string, ReadonlySet<string>> = {
  model: new Set([
    "provider",
    "default",
    "base_url",
    "context_length",
    "api_mode",
  ]),
  memory: new Set(["provider"]),
  // Proxy endpoints are machine-specific trust boundaries. Preserve the
  // target device's proxy instead of importing one from an archive.
  network: new Set(["force_ipv4"]),
  agent: new Set(["service_tier", "reasoning_effort"]),
};

function sanitizePortableUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return undefined;
    if (url.search) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function sanitizePortableConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizePortableConfig);
  }
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    if (PORTABLE_CONFIG_BLOCKED_KEY.test(normalized)) continue;
    if (!PORTABLE_CONFIG_TOP_LEVEL_KEYS.has(key)) continue;
    if (!nested || typeof nested !== "object" || Array.isArray(nested))
      continue;
    const allowedChildren = PORTABLE_CONFIG_CHILD_KEYS[key];
    const section: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(
      nested as Record<string, unknown>,
    )) {
      if (!allowedChildren.has(childKey)) continue;
      if (
        typeof childValue === "string" ||
        typeof childValue === "number" ||
        typeof childValue === "boolean"
      ) {
        if (
          typeof childValue === "string" &&
          ((key === "model" && childKey === "base_url") ||
            (key === "network" && childKey === "proxy"))
        ) {
          const safeUrl = sanitizePortableUrl(childValue);
          if (safeUrl) section[childKey] = safeUrl;
        } else {
          section[childKey] = childValue;
        }
      }
    }
    if (Object.keys(section).length > 0) result[key] = section;
  }
  return result;
}

export function sanitizeDesktopConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return sanitizePortableJson(value) as Record<string, unknown>;
}

function materializeSanitizedJsonFile(
  root: string,
  temporaryRoot: string,
  name: "desktop.json" | "models.json",
): string | null {
  const source = join(root, name);
  if (!existsSync(source)) return null;
  if (statSync(source).size > MAX_CONFIG_BYTES) {
    throw new Error(`Agents One 配置 ${name} 过大，备份已取消。`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(source, "utf8"));
  } catch {
    throw new Error(`Agents One 配置 ${name} 无法解析，备份已取消。`);
  }
  if (
    (name === "desktop.json" &&
      (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) ||
    (name === "models.json" && !Array.isArray(parsed))
  ) {
    throw new Error(`Agents One 配置 ${name} 结构无效，备份已取消。`);
  }
  const destination = join(temporaryRoot, "sanitized", name);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    `${JSON.stringify(sanitizePortableJson(parsed), null, 2)}\n`,
    "utf8",
  );
  return destination;
}

function materializePortableYamlConfig(
  root: string,
  temporaryRoot: string,
  profile: string,
): { path: string; sourcePath: string } | null {
  const source = join(profileRoot(root, profile), "config.yaml");
  if (!existsSync(source)) return null;
  if (statSync(source).size > MAX_CONFIG_BYTES) {
    throw new Error(`配置档案 ${profile} 的 config.yaml 过大，备份已取消。`);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(source, "utf8"), {
      maxAliasCount: 0,
      prettyErrors: false,
    });
  } catch {
    throw new Error(
      `配置档案 ${profile} 的 config.yaml 无法解析，备份已取消。`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `配置档案 ${profile} 的 config.yaml 结构无效，备份已取消。`,
    );
  }
  const relativePath =
    profile === "default"
      ? "portable-config.yaml"
      : `profiles/${profile}/portable-config.yaml`;
  const destination = join(
    temporaryRoot,
    "sanitized",
    ...relativePath.split("/"),
  );
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    stringifyYaml(sanitizePortableConfig(parsed), { lineWidth: 0 }),
    "utf8",
  );
  return { path: relativePath, sourcePath: destination };
}

export function collectAgentsOneBackupFiles(
  root: string,
): AgentsOneBackupFile[] {
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot)) return [];
  const files: AgentsOneBackupFile[] = [];
  for (const name of ROOT_FILES) {
    if (name === "desktop.json" || name === "models.json") continue;
    const path = join(resolvedRoot, name);
    if (existsSync(path)) addRegularFile(resolvedRoot, path, files);
  }
  for (const profile of profileNames(resolvedRoot)) {
    const home = profileRoot(resolvedRoot, profile);
    for (const name of PROFILE_FILES) {
      if (profile === "default" && ROOT_FILES.has(name)) continue;
      const path = join(home, name);
      if (existsSync(path)) addRegularFile(resolvedRoot, path, files);
    }
    for (const name of PROFILE_DIRECTORIES) {
      walkAllowedDirectory(resolvedRoot, join(home, name), files);
    }
  }
  walkAllowedDirectory(
    resolvedRoot,
    join(resolvedRoot, "desktop-staging"),
    files,
  );
  const unique = new Map<string, AgentsOneBackupFile>();
  for (const file of files) unique.set(file.path.toLowerCase(), file);
  return [...unique.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function readJson(path: string): unknown {
  try {
    if (statSync(path).size > MAX_CONFIG_BYTES) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function arrayLength(value: unknown, key: string): number {
  if (!value || typeof value !== "object") return 0;
  const array = (value as Record<string, unknown>)[key];
  return Array.isArray(array) ? array.length : 0;
}

function countProfileData(root: string): AgentsOneBackupManifest["counts"] {
  let projects = 0;
  let tasks = 0;
  let chats = 0;
  let collaborations = 0;
  for (const profile of profileNames(root)) {
    const desktop = join(profileRoot(root, profile), "desktop");
    projects += arrayLength(
      readJson(join(desktop, "project-folders.json")),
      "folders",
    );
    const runtimeConversations = arrayLength(
      readJson(join(desktop, "runtime-conversations.json")),
      "conversations",
    );
    const quickChats = arrayLength(
      readJson(join(desktop, "quick-chats.json")),
      "chats",
    );
    const nativeSessions = arrayLength(
      readJson(join(desktop, "sessions.json")),
      "sessions",
    );
    chats += runtimeConversations + quickChats + nativeSessions;
    const profileCollaborations = arrayLength(
      readJson(join(desktop, "task-collaborations.json")),
      "records",
    );
    collaborations += profileCollaborations;
    tasks += Math.max(runtimeConversations, profileCollaborations);
    tasks += arrayLength(
      readJson(join(desktop, "task-schedules.json")),
      "schedules",
    );
  }
  return { projects, tasks, chats, collaborations };
}

function hasSqliteHeader(path: string): boolean {
  const descriptor = openSync(path, "r");
  const header = Buffer.alloc(16);
  try {
    return (
      readSync(descriptor, header, 0, header.length, 0) === header.length &&
      header.toString("utf8") === "SQLite format 3\0"
    );
  } finally {
    closeSync(descriptor);
  }
}

function isProfileStateDatabasePath(path: string): boolean {
  return path === "state.db" || /^profiles\/[^/]+\/state\.db$/.test(path);
}

function pathWithinProfile(path: string): string {
  const parts = path.split("/");
  return parts[0] === "profiles" ? parts.slice(2).join("/") : path;
}

function parseCoreJsonStore(path: string, label: string): unknown {
  const info = statSync(path);
  if (info.size > MAX_CORE_JSON_BYTES) {
    throw new Error(`核心数据文件过大，无法安全恢复：${label}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`核心数据文件无法解析：${label}`);
  }
}

function validateCoreJsonStore(path: string, label: string): void {
  const relative = pathWithinProfile(label);
  const arrayKey = CORE_JSON_ARRAY_STORES.get(relative);
  if (!arrayKey && relative !== "desktop/session-overlays.json") return;
  const parsed = parseCoreJsonStore(path, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`核心数据文件结构无效：${label}`);
  }
  const record = parsed as Record<string, unknown>;
  if (arrayKey && !Array.isArray(record[arrayKey])) {
    throw new Error(`核心数据文件缺少 ${arrayKey} 列表：${label}`);
  }
  if (
    relative === "desktop/session-overlays.json" &&
    (!record.sessions ||
      typeof record.sessions !== "object" ||
      Array.isArray(record.sessions))
  ) {
    throw new Error(`核心数据文件缺少 sessions 映射：${label}`);
  }
  if (
    relative === "desktop/runtime-conversations.json" ||
    relative === "desktop/quick-chats.json"
  ) {
    const conversations = record[arrayKey as string] as unknown[];
    for (const item of conversations) {
      const conversation = item as Record<string, unknown> | null;
      if (
        !conversation ||
        typeof conversation !== "object" ||
        typeof conversation.id !== "string" ||
        !Array.isArray(conversation.messages)
      ) {
        throw new Error(`聊天数据结构无效：${label}`);
      }
    }
  }
}

function assertValidSqliteDatabase(path: string, label: string): void {
  if (!hasSqliteHeader(path)) {
    throw new Error(`${label} 不是有效的 SQLite 数据库。`);
  }
  const database = new Database(path, { readonly: true });
  try {
    const row = database.prepare("PRAGMA quick_check").get() as
      | Record<string, unknown>
      | undefined;
    if (!row || !Object.values(row).some((value) => value === "ok")) {
      throw new Error(`${label} 未通过 SQLite 完整性检查。`);
    }
  } finally {
    database.close();
  }
}

function stageBackupFile(
  sourcePath: string,
  destination: string,
  relativePath: string,
): void {
  mkdirSync(dirname(destination), { recursive: true });
  if (isProfileStateDatabasePath(relativePath)) {
    assertValidSqliteDatabase(sourcePath, relativePath);
    const database = new Database(sourcePath);
    try {
      database.exec("PRAGMA busy_timeout = 5000");
      const escapedDestination = destination.replace(/'/g, "''");
      // VACUUM INTO reads a coherent SQLite snapshot, including committed WAL
      // pages, without copying non-portable -wal/-shm sidecars.
      database.exec(`VACUUM INTO '${escapedDestination}'`);
    } finally {
      database.close();
    }
    assertValidSqliteDatabase(destination, relativePath);
    return;
  }
  copyFileSync(sourcePath, destination);
}

function prepareBackup(root: string, appVersion: string): PreparedBackup {
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot)) {
    throw new Error("Agents One 数据目录不存在。");
  }
  const temporaryRoot = mkdtempSync(join(tmpdir(), "agents-one-backup-"));
  const payloadRoot = join(temporaryRoot, PAYLOAD_DIR);
  mkdirSync(payloadRoot, { recursive: true });
  try {
    const sourceFiles = collectAgentsOneBackupFiles(resolvedRoot);
    for (const name of ["desktop.json", "models.json"] as const) {
      const sanitizedConfig = materializeSanitizedJsonFile(
        resolvedRoot,
        temporaryRoot,
        name,
      );
      if (!sanitizedConfig) continue;
      sourceFiles.push({
        path: name,
        sourcePath: sanitizedConfig,
        size: statSync(sanitizedConfig).size,
        sha256: sha256File(sanitizedConfig),
      });
    }
    for (const profile of profileNames(resolvedRoot)) {
      const portableConfig = materializePortableYamlConfig(
        resolvedRoot,
        temporaryRoot,
        profile,
      );
      if (!portableConfig) continue;
      sourceFiles.push({
        path: portableConfig.path,
        sourcePath: portableConfig.sourcePath,
        size: statSync(portableConfig.sourcePath).size,
        sha256: sha256File(portableConfig.sourcePath),
      });
    }
    sourceFiles.sort((left, right) => left.path.localeCompare(right.path));
    if (sourceFiles.length === 0) {
      throw new Error("没有找到可备份的 Agents One 数据。");
    }
    const profiles = profileNames(resolvedRoot);
    const profileSet = new Set(profiles);
    const manifestFiles: AgentsOneBackupManifest["files"] = [];
    let totalBytes = 0;
    for (const file of sourceFiles) {
      if (!isAllowedBackupRelativePath(file.path, profileSet)) {
        throw new Error(`检测到不允许备份的数据路径：${file.path}`);
      }
      const destination = join(payloadRoot, ...file.path.split("/"));
      stageBackupFile(file.sourcePath, destination, file.path);
      const info = lstatSync(destination);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`无法安全读取备份数据：${file.path}`);
      }
      totalBytes += info.size;
      if (
        manifestFiles.length + 1 > MAX_FILE_COUNT ||
        info.size > MAX_FILE_BYTES ||
        totalBytes > MAX_TOTAL_BYTES
      ) {
        throw new Error("Agents One 数据数量或体积超过备份安全限制。");
      }
      manifestFiles.push({
        path: file.path,
        size: info.size,
        sha256: sha256File(destination),
      });
    }
    const manifest: AgentsOneBackupManifest = {
      product: BACKUP_PRODUCT,
      schemaVersion: AGENTS_ONE_BACKUP_SCHEMA_VERSION,
      appVersion,
      createdAt: new Date().toISOString(),
      profiles,
      files: manifestFiles,
      counts: countProfileData(resolvedRoot),
      excluded: [
        "API keys, login tokens and credentials",
        "wallets and recovery phrases",
        "project folders and local Runtime worktrees",
        "logs, caches and installed engines",
      ],
    };
    writeFileSync(
      join(temporaryRoot, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    return { temporaryRoot };
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function replaceArchiveAtomically(
  temporaryArchive: string,
  destination: string,
): void {
  if (!existsSync(destination)) {
    renameSync(temporaryArchive, destination);
    return;
  }
  if (
    !lstatSync(destination).isFile() ||
    lstatSync(destination).isSymbolicLink()
  ) {
    throw new Error("所选备份保存位置不是普通文件。");
  }
  const displaced = join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${randomUUID()}.previous`,
  );
  renameSync(destination, displaced);
  try {
    renameSync(temporaryArchive, destination);
  } catch (error) {
    try {
      renameSync(displaced, destination);
    } catch (rollbackError) {
      throw new Error(
        `备份写入失败，原备份位于 ${displaced}：${
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError)
        }`,
        { cause: error },
      );
    }
    throw error;
  }
  rmSync(displaced, { force: true });
}

export async function exportAgentsOneBackupTo(
  archivePath: string,
  options: ExportAgentsOneBackupOptions = {},
): Promise<AgentsOneBackupResult> {
  try {
    return await runExclusiveBackupOperation(() =>
      exportAgentsOneBackupUnlocked(archivePath, options),
    );
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function exportAgentsOneBackupUnlocked(
  archivePath: string,
  options: ExportAgentsOneBackupOptions,
): Promise<AgentsOneBackupResult> {
  const destination = resolve(archivePath);
  const root = options.sourceHome ? resolve(options.sourceHome) : HERMES_HOME;
  let prepared: PreparedBackup | null = null;
  let temporaryArchive = "";
  try {
    if (!archivePath.trim()) throw new Error("请选择备份文件保存位置。");
    const relativeToSource = relative(root, destination);
    if (
      !relativeToSource ||
      (relativeToSource !== ".." &&
        !relativeToSource.startsWith(`..${sep}`) &&
        !isAbsolute(relativeToSource))
    ) {
      throw new Error("备份文件不能保存在 Agents One 数据目录内。");
    }
    mkdirSync(dirname(destination), { recursive: true });
    prepared = prepareBackup(root, options.appVersion || "unknown");
    temporaryArchive = join(
      dirname(destination),
      `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
    );
    await tar.create(
      {
        cwd: prepared.temporaryRoot,
        file: temporaryArchive,
        gzip: true,
        portable: true,
        strict: true,
      },
      [MANIFEST_FILE, PAYLOAD_DIR],
    );
    const verified = await loadAndValidateArchive(temporaryArchive);
    rmSync(verified.extractionRoot, { recursive: true, force: true });
    replaceArchiveAtomically(temporaryArchive, destination);
    return { success: true, path: destination };
  } catch (error) {
    if (temporaryArchive) rmSync(temporaryArchive, { force: true });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (prepared) {
      rmSync(prepared.temporaryRoot, { recursive: true, force: true });
    }
  }
}

function validateArchiveFile(archivePath: string): string {
  if (!archivePath.trim()) throw new Error("请选择 Agents One 备份文件。");
  const archive = resolve(archivePath);
  if (!existsSync(archive) || !statSync(archive).isFile()) {
    throw new Error("备份文件不存在或无法读取。");
  }
  if (statSync(archive).size > MAX_ARCHIVE_BYTES) {
    throw new Error("备份文件过大，无法安全恢复。");
  }
  return archive;
}

function validateArchiveEntry(path: string, type: string): void {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  if (!isSafeRelativePath(normalized)) {
    throw new Error(`备份包含不安全路径：${path}`);
  }
  if (type !== "File" && type !== "Directory") {
    throw new Error(`备份包含不支持的链接或特殊文件：${path}`);
  }
  if (
    normalized !== MANIFEST_FILE &&
    normalized !== PAYLOAD_DIR &&
    !normalized.startsWith(`${PAYLOAD_DIR}/`)
  ) {
    throw new Error(`备份包含清单范围外的数据：${path}`);
  }
  if (
    (normalized === MANIFEST_FILE && type !== "File") ||
    (normalized === PAYLOAD_DIR && type !== "Directory")
  ) {
    throw new Error(`备份目录结构无效：${path}`);
  }
}

async function extractArchiveSafely(archivePath: string): Promise<string> {
  const extractionRoot = mkdtempSync(join(tmpdir(), "agents-one-restore-"));
  const seen = new Set<string>();
  let entryCount = 0;
  let fileCount = 0;
  let totalBytes = 0;
  try {
    await tar.extract({
      cwd: extractionRoot,
      file: archivePath,
      strict: true,
      preservePaths: false,
      unlink: true,
      noChmod: true,
      maxDepth: 32,
      filter: (path, entry) => {
        const archiveEntry = entry as ReadEntry;
        validateArchiveEntry(path, archiveEntry.type);
        entryCount += 1;
        if (entryCount > MAX_ARCHIVE_ENTRY_COUNT) {
          throw new Error("备份归档条目数量超过安全限制。");
        }
        const key = path.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
        if (seen.has(key)) throw new Error(`备份包含重复路径：${path}`);
        seen.add(key);
        if (archiveEntry.type === "File") {
          if (
            path.replace(/\\/g, "/") === MANIFEST_FILE &&
            entry.size > MAX_MANIFEST_BYTES
          ) {
            throw new Error("备份清单过大，无法安全恢复。");
          }
          fileCount += 1;
          totalBytes += entry.size;
          if (
            fileCount > MAX_FILE_COUNT ||
            entry.size > MAX_FILE_BYTES ||
            totalBytes > MAX_TOTAL_BYTES
          ) {
            throw new Error("备份解压后的文件数量或体积超过安全限制。");
          }
        }
        return true;
      },
    });
    return extractionRoot;
  } catch (error) {
    rmSync(extractionRoot, { recursive: true, force: true });
    throw error;
  }
}

function parseManifest(extractionRoot: string): AgentsOneBackupManifest {
  const path = join(extractionRoot, MANIFEST_FILE);
  if (!existsSync(path))
    throw new Error("这不是 Agents One 备份：缺少 manifest.json。");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("备份清单损坏，无法解析。");
  }
  if (!value || typeof value !== "object") throw new Error("备份清单无效。");
  const manifest = value as Partial<AgentsOneBackupManifest>;
  if (manifest.product !== BACKUP_PRODUCT) {
    throw new Error("这不是 Agents One 备份文件，无法导入。");
  }
  if (manifest.schemaVersion !== AGENTS_ONE_BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `不支持的备份版本 ${String(manifest.schemaVersion)}，请升级 Agents One 后再试。`,
    );
  }
  if (
    typeof manifest.createdAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    typeof manifest.appVersion !== "string" ||
    manifest.appVersion.length > 128 ||
    !Array.isArray(manifest.profiles) ||
    !Array.isArray(manifest.files) ||
    !manifest.counts ||
    typeof manifest.counts !== "object" ||
    !Array.isArray(manifest.excluded)
  ) {
    throw new Error("备份清单缺少必要字段。");
  }
  const seenProfiles = new Set<string>();
  for (const profile of manifest.profiles) {
    if (
      typeof profile !== "string" ||
      (profile !== "default" && !PROFILE_NAME_PATTERN.test(profile)) ||
      seenProfiles.has(profile.toLowerCase())
    ) {
      throw new Error("备份清单包含无效或重复的配置档案。");
    }
    seenProfiles.add(profile.toLowerCase());
  }
  if (!seenProfiles.has("default")) {
    throw new Error("备份清单缺少默认配置档案。");
  }
  const counts = manifest.counts as Partial<AgentsOneBackupManifest["counts"]>;
  for (const key of ["projects", "tasks", "chats", "collaborations"] as const) {
    const count = counts[key];
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      throw new Error("备份清单包含无效的数据计数。");
    }
  }
  if (
    manifest.files.length === 0 ||
    manifest.files.length > MAX_FILE_COUNT ||
    manifest.excluded.some(
      (item) => typeof item !== "string" || item.length > 256,
    )
  ) {
    throw new Error("备份清单包含无效的数据列表。");
  }
  return manifest as AgentsOneBackupManifest;
}

function validateManifestFiles(
  extractionRoot: string,
  manifest: AgentsOneBackupManifest,
): void {
  const paths = new Set<string>();
  const profiles = new Set(manifest.profiles);
  let totalBytes = 0;
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !isAllowedBackupRelativePath(file.path, profiles) ||
      typeof file.size !== "number" ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > MAX_FILE_BYTES ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(file.sha256)
    ) {
      throw new Error("备份清单包含无效文件记录。");
    }
    const key = file.path.toLowerCase();
    if (paths.has(key)) throw new Error(`备份清单包含重复路径：${file.path}`);
    paths.add(key);
    totalBytes += file.size;
    if (
      manifest.files.length > MAX_FILE_COUNT ||
      totalBytes > MAX_TOTAL_BYTES
    ) {
      throw new Error("备份内容超过安全恢复限制。");
    }
    const path = join(extractionRoot, PAYLOAD_DIR, ...file.path.split("/"));
    if (
      !existsSync(path) ||
      !lstatSync(path).isFile() ||
      lstatSync(path).isSymbolicLink()
    ) {
      throw new Error(`备份缺少数据文件：${file.path}`);
    }
    const info = statSync(path);
    if (
      info.size !== file.size ||
      sha256File(path) !== file.sha256.toLowerCase()
    ) {
      throw new Error(`备份完整性校验失败：${file.path}`);
    }
    validateCoreJsonStore(path, file.path);
    if (isProfileStateDatabasePath(file.path)) {
      assertValidSqliteDatabase(path, file.path);
    }
    if (file.path === "desktop.json" || file.path === "models.json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        throw new Error(`备份配置无法解析：${file.path}`);
      }
      const validShape =
        file.path === "desktop.json"
          ? Boolean(
              parsed && typeof parsed === "object" && !Array.isArray(parsed),
            )
          : Array.isArray(parsed);
      if (
        !validShape ||
        JSON.stringify(sanitizePortableJson(parsed)) !== JSON.stringify(parsed)
      ) {
        throw new Error(`备份配置包含无效结构或凭据字段：${file.path}`);
      }
    }
    if (file.path.endsWith("portable-config.yaml")) {
      let parsed: unknown;
      try {
        parsed = parseYaml(readFileSync(path, "utf8"), {
          maxAliasCount: 0,
          prettyErrors: false,
        });
      } catch {
        throw new Error(`备份配置无法解析：${file.path}`);
      }
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        JSON.stringify(sanitizePortableConfig(parsed)) !==
          JSON.stringify(parsed)
      ) {
        throw new Error(`备份配置包含无效结构或凭据字段：${file.path}`);
      }
    }
  }
  const actualFiles: string[] = [];
  const walk = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("备份包含符号链接。");
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        actualFiles.push(
          cleanRelativePath(
            relative(join(extractionRoot, PAYLOAD_DIR), path),
          ).toLowerCase(),
        );
      }
    }
  };
  walk(join(extractionRoot, PAYLOAD_DIR));
  if (
    actualFiles.length !== paths.size ||
    actualFiles.some((path) => !paths.has(path))
  ) {
    throw new Error("备份数据与清单不一致，已拒绝恢复。");
  }
  const activeProfileFile = manifest.files.find(
    (file) => file.path === "active_profile",
  );
  if (activeProfileFile) {
    if (activeProfileFile.size > 256) {
      throw new Error("备份中的当前配置档案无效，已拒绝恢复。");
    }
    const activeProfile = readFileSync(
      join(extractionRoot, PAYLOAD_DIR, "active_profile"),
      "utf8",
    ).trim();
    if (!profiles.has(activeProfile)) {
      throw new Error("备份中的当前配置档案不存在，已拒绝恢复。");
    }
  }
}

function deepMergePortableConfig(current: unknown, portable: unknown): unknown {
  if (Array.isArray(portable)) return portable;
  if (!portable || typeof portable !== "object") return portable;
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(
    portable as Record<string, unknown>,
  )) {
    base[key] = deepMergePortableConfig(base[key], value);
  }
  return base;
}

function protectPortableModelEndpoint(
  current: unknown,
  portable: unknown,
): unknown {
  if (!portable || typeof portable !== "object" || Array.isArray(portable)) {
    return portable;
  }
  const protectedConfig = JSON.parse(JSON.stringify(portable)) as Record<
    string,
    unknown
  >;
  const portableModel =
    protectedConfig.model && typeof protectedConfig.model === "object"
      ? (protectedConfig.model as Record<string, unknown>)
      : null;
  if (!portableModel) return protectedConfig;
  const currentModel =
    current &&
    typeof current === "object" &&
    !Array.isArray(current) &&
    (current as Record<string, unknown>).model &&
    typeof (current as Record<string, unknown>).model === "object"
      ? ((current as Record<string, unknown>).model as Record<string, unknown>)
      : null;
  const baseUrl =
    typeof portableModel.base_url === "string"
      ? portableModel.base_url.trim()
      : "";
  const sameEndpoint = Boolean(
    currentModel &&
    currentModel.provider === portableModel.provider &&
    currentModel.base_url === portableModel.base_url,
  );
  if (baseUrl && !sameEndpoint) {
    delete portableModel.base_url;
    // A migrated custom endpoint must be selected and authorized explicitly.
    if (portableModel.provider === "custom") delete portableModel.provider;
  }
  return protectedConfig;
}

function stagedRestorePathMap(
  manifest: AgentsOneBackupManifest,
  targetHome: string,
): Map<string, string> {
  const paths = new Map<string, string>();
  for (const file of manifest.files) {
    if (!file.path.toLowerCase().startsWith("desktop-staging/")) continue;
    paths.set(
      file.path.toLowerCase(),
      resolveRestoreDestination(targetHome, file.path),
    );
  }
  return paths;
}

function rebindStagedAttachmentPath(
  value: string,
  stagedPaths: ReadonlyMap<string, string>,
): string {
  const normalized = value.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const marker = "desktop-staging/";
  const markerIndex = lower.lastIndexOf(`/${marker}`);
  const archivePath =
    markerIndex >= 0
      ? normalized.slice(markerIndex + 1)
      : lower.startsWith(marker)
        ? normalized
        : "";
  return archivePath
    ? stagedPaths.get(archivePath.toLowerCase()) || value
    : value;
}

function rebindStagedAttachmentReferences(
  value: unknown,
  stagedPaths: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      rebindStagedAttachmentReferences(item, stagedPaths),
    );
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      if (key === "attachments" && Array.isArray(child)) {
        return [
          key,
          child.map((attachment) => {
            if (
              !attachment ||
              typeof attachment !== "object" ||
              Array.isArray(attachment)
            ) {
              return attachment;
            }
            const rebound = {
              ...(attachment as Record<string, unknown>),
            };
            if (typeof rebound.path === "string") {
              rebound.path = rebindStagedAttachmentPath(
                rebound.path,
                stagedPaths,
              );
            }
            return rebound;
          }),
        ];
      }
      return [key, rebindStagedAttachmentReferences(child, stagedPaths)];
    }),
  );
}

function normalizeRestoredStateDatabase(
  sourcePath: string,
  relativePath: string,
  temporaryRoot: string,
  stagedPaths: ReadonlyMap<string, string>,
): string {
  if (!isProfileStateDatabasePath(relativePath) || stagedPaths.size === 0) {
    return sourcePath;
  }
  const normalizedPath = join(
    temporaryRoot,
    "normalized",
    ...relativePath.split("/"),
  );
  mkdirSync(dirname(normalizedPath), { recursive: true });
  copyFileSync(sourcePath, normalizedPath);
  const database = new Database(normalizedPath);
  try {
    const table = database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .get("desktop_session_continuations");
    if (table) {
      const rows = database
        .prepare(
          "SELECT session_id, prefix_json FROM desktop_session_continuations",
        )
        .all() as Array<{ session_id: string; prefix_json: string }>;
      const update = database.prepare(
        "UPDATE desktop_session_continuations SET prefix_json = ? WHERE session_id = ?",
      );
      const apply = database.transaction(() => {
        for (const row of rows) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(row.prefix_json);
          } catch {
            throw new Error(
              `SQLite 会话附件数据无法解析：${relativePath}/${row.session_id}`,
            );
          }
          const rebound = rebindStagedAttachmentReferences(parsed, stagedPaths);
          update.run(JSON.stringify(rebound), row.session_id);
        }
      });
      apply();
    }
  } finally {
    database.close();
  }
  assertValidSqliteDatabase(normalizedPath, relativePath);
  return normalizedPath;
}

function normalizeRestoredCoreStore(
  sourcePath: string,
  relativePath: string,
  temporaryRoot: string,
  stagedPaths: ReadonlyMap<string, string>,
): string {
  const profileRelative = pathWithinProfile(relativePath);
  const needsRunNormalization =
    profileRelative === "desktop/runtime-conversations.json" ||
    profileRelative === "desktop/task-schedules.json";
  const mayContainStagedAttachments =
    profileRelative === "desktop/session-overlays.json" ||
    CORE_JSON_ARRAY_STORES.has(profileRelative);
  if (
    !needsRunNormalization &&
    !(stagedPaths.size && mayContainStagedAttachments)
  ) {
    return sourcePath;
  }
  const parsed = parseCoreJsonStore(sourcePath, relativePath) as Record<
    string,
    unknown
  >;
  if (profileRelative === "desktop/runtime-conversations.json") {
    parsed.conversations = (parsed.conversations as unknown[]).map((item) => {
      const conversation = { ...(item as Record<string, unknown>) };
      delete conversation.activeRuntimeRunId;
      return conversation;
    });
  } else if (profileRelative === "desktop/task-schedules.json") {
    parsed.schedules = (parsed.schedules as unknown[]).map((item) => {
      const schedule: Record<string, unknown> = {
        ...(item as Record<string, unknown>),
        enabled: false,
        pendingRuns: 0,
      };
      delete schedule.activeRuntimeRunId;
      return schedule;
    });
  }
  const rebound = rebindStagedAttachmentReferences(parsed, stagedPaths);
  const normalizedPath = join(
    temporaryRoot,
    "normalized",
    ...relativePath.split("/"),
  );
  mkdirSync(dirname(normalizedPath), { recursive: true });
  writeFileSync(
    normalizedPath,
    `${JSON.stringify(rebound, null, 2)}\n`,
    "utf8",
  );
  return normalizedPath;
}

function materializeRestoreOperations(
  extractionRoot: string,
  targetHome: string,
  manifest: AgentsOneBackupManifest,
): RestoreFileOperation[] {
  const operations: RestoreFileOperation[] = [];
  const mergeRoot = mkdtempSync(join(tmpdir(), "agents-one-config-merge-"));
  const stagedPaths = stagedRestorePathMap(manifest, targetHome);
  try {
    for (const file of manifest.files) {
      const sourcePath = join(
        extractionRoot,
        PAYLOAD_DIR,
        ...file.path.split("/"),
      );
      if (!file.path.endsWith("portable-config.yaml")) {
        if (file.path !== "desktop.json") {
          const normalizedDatabase = normalizeRestoredStateDatabase(
            sourcePath,
            file.path,
            mergeRoot,
            stagedPaths,
          );
          operations.push({
            path: file.path,
            sourcePath: normalizeRestoredCoreStore(
              normalizedDatabase,
              file.path,
              mergeRoot,
              stagedPaths,
            ),
          });
          continue;
        }
        const restored = JSON.parse(readFileSync(sourcePath, "utf8")) as Record<
          string,
          unknown
        >;
        const currentPath = resolveRestoreDestination(
          targetHome,
          "desktop.json",
        );
        let current: unknown = {};
        if (existsSync(currentPath)) {
          try {
            current = JSON.parse(readFileSync(currentPath, "utf8"));
          } catch {
            throw new Error(
              "目标 Agents One 配置 desktop.json 无法解析，未覆盖。",
            );
          }
        }
        const protectedDesktop = disableUntrustedRestoredRuntimes(
          restored,
          current,
        );
        const protectedPath = join(mergeRoot, "desktop.json");
        writeFileSync(
          protectedPath,
          `${JSON.stringify(protectedDesktop, null, 2)}\n`,
          "utf8",
        );
        operations.push({ path: file.path, sourcePath: protectedPath });
        continue;
      }
      const profilePrefix =
        file.path === "portable-config.yaml"
          ? ""
          : `${file.path.split("/").slice(0, 2).join("/")}/`;
      const destinationPath = `${profilePrefix}config.yaml`;
      const destination = resolveRestoreDestination(
        targetHome,
        destinationPath,
      );
      const portable = parseYaml(readFileSync(sourcePath, "utf8"), {
        maxAliasCount: 0,
        prettyErrors: false,
      });
      let current: unknown = {};
      if (existsSync(destination)) {
        try {
          current = parseYaml(readFileSync(destination, "utf8"), {
            maxAliasCount: 0,
            prettyErrors: false,
          });
        } catch {
          throw new Error(`目标配置无法解析，未覆盖：${destinationPath}`);
        }
      }
      const merged = deepMergePortableConfig(
        current,
        protectPortableModelEndpoint(current, portable),
      );
      const mergedPath = join(mergeRoot, ...destinationPath.split("/"));
      mkdirSync(dirname(mergedPath), { recursive: true });
      writeFileSync(
        mergedPath,
        stringifyYaml(merged, { lineWidth: 0 }),
        "utf8",
      );
      operations.push({ path: destinationPath, sourcePath: mergedPath });
    }
    if (!operations.some((operation) => operation.path === "active_profile")) {
      const activeProfilePath = join(mergeRoot, "active_profile");
      writeFileSync(activeProfilePath, "default\n", "utf8");
      operations.push({
        path: "active_profile",
        sourcePath: activeProfilePath,
      });
    }
    const durableRoot = join(extractionRoot, "restore-ready");
    for (const operation of operations) {
      if (!operation.sourcePath.startsWith(`${mergeRoot}${sep}`)) continue;
      const durablePath = join(durableRoot, ...operation.path.split("/"));
      mkdirSync(dirname(durablePath), { recursive: true });
      copyFileSync(operation.sourcePath, durablePath);
      operation.sourcePath = durablePath;
    }
    return operations;
  } finally {
    rmSync(mergeRoot, { recursive: true, force: true });
  }
}

function inspectionSummary(
  manifest: AgentsOneBackupManifest,
  targetHome: string,
): AgentsOneBackupSummary {
  const conflicts = manifest.files.filter((file) =>
    existsSync(join(targetHome, ...file.path.split("/"))),
  ).length;
  const warnings = [
    "已知凭据存储不会迁移；新增或端点变化的远程智能体会先停用，需重新授权。",
    "项目仅恢复登记和路径，不包含项目文件；目标电脑路径不同时需重新选择。",
    "定时任务会以停用状态恢复；请复核目标路径、权限和频率后逐项启用。",
    "仅导入可信备份；聊天、记忆、技能和附件可能含敏感内容，请像保管原始数据一样安全保管。",
    "MCP、消息平台、API 服务及其他可执行或联网集成不会自动迁移，请在目标设备重新配置。",
  ];
  return {
    createdAt: manifest.createdAt,
    appVersion: manifest.appVersion,
    profileCount: manifest.profiles.length,
    projectCount: manifest.counts.projects,
    taskCount: manifest.counts.tasks,
    chatCount: manifest.counts.chats,
    collaborationCount: manifest.counts.collaborations,
    conflictCount: conflicts,
    warnings,
  };
}

async function loadAndValidateArchive(
  archivePath: string,
): Promise<{ extractionRoot: string; manifest: AgentsOneBackupManifest }> {
  const archive = validateArchiveFile(archivePath);
  const extractionRoot = await extractArchiveSafely(archive);
  try {
    const manifest = parseManifest(extractionRoot);
    validateManifestFiles(extractionRoot, manifest);
    return { extractionRoot, manifest };
  } catch (error) {
    rmSync(extractionRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function inspectAgentsOneBackup(
  archivePath: string,
  options: InspectAgentsOneBackupOptions = {},
): Promise<AgentsOneBackupInspection> {
  let extractionRoot = "";
  try {
    const loaded = await loadAndValidateArchive(archivePath);
    extractionRoot = loaded.extractionRoot;
    const targetHome = resolve(options.targetHome || HERMES_HOME);
    return {
      success: true,
      summary: inspectionSummary(loaded.manifest, targetHome),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (extractionRoot)
      rmSync(extractionRoot, { recursive: true, force: true });
  }
}

function resolveRestoreDestination(targetHome: string, path: string): string {
  const destination = resolve(targetHome, ...path.split("/"));
  const targetRelative = relative(targetHome, destination);
  if (
    !targetRelative ||
    targetRelative === ".." ||
    targetRelative.startsWith(`..${sep}`) ||
    isAbsolute(targetRelative)
  ) {
    throw new Error(`恢复目标越界：${path}`);
  }
  return destination;
}

function isAllowedRestoreJournalPath(path: string): boolean {
  if (!isSafeRelativePath(path) || path.includes("\\")) return false;
  const withoutSidecar = path.replace(/-(?:wal|shm)$/i, "");
  if (
    withoutSidecar === "config.yaml" ||
    /^profiles\/[a-z0-9_][a-z0-9_-]{0,63}\/config\.yaml$/.test(withoutSidecar)
  ) {
    return true;
  }
  return isAllowedBackupRelativePath(withoutSidecar);
}

function restoreTransactionRoot(targetHome: string): string {
  return resolveRestoreDestination(targetHome, RESTORE_TRANSACTION_DIRECTORY);
}

function flushFile(path: string): void {
  const descriptor = openSync(path, "r+");
  try {
    try {
      fsyncSync(descriptor);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Some Windows enterprise filesystems reject fsync even for a writable
      // ordinary file. The journal remains recoverable; do not turn that OS
      // limitation into a failed restore.
      if (code !== "EPERM" && code !== "EINVAL" && code !== "ENOTSUP")
        throw error;
    }
  } finally {
    closeSync(descriptor);
  }
}

function writeRestoreJournal(
  transactionRoot: string,
  journal: RestoreTransactionJournal,
): void {
  const journalPath = join(transactionRoot, RESTORE_JOURNAL_FILE);
  const temporary = join(
    transactionRoot,
    `.${RESTORE_JOURNAL_FILE}.${process.pid}.${randomUUID()}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  flushFile(temporary);
  if (existsSync(journalPath)) rmSync(journalPath, { force: true });
  renameSync(temporary, journalPath);
  flushFile(journalPath);
}

function parseRestoreJournal(
  transactionRoot: string,
): RestoreTransactionJournal | null {
  const journalPath = join(transactionRoot, RESTORE_JOURNAL_FILE);
  if (!existsSync(journalPath)) return null;
  const info = lstatSync(journalPath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > MAX_MANIFEST_BYTES
  ) {
    throw new Error("恢复事务日志不是安全的普通文件。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch {
    throw new Error("恢复事务日志无法解析。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("恢复事务日志结构无效。");
  }
  const journal = parsed as Partial<RestoreTransactionJournal>;
  if (
    journal.version !== RESTORE_JOURNAL_VERSION ||
    (journal.phase !== "prepared" && journal.phase !== "committed") ||
    !Array.isArray(journal.affectedPaths) ||
    !Array.isArray(journal.existingPaths) ||
    journal.affectedPaths.length > MAX_RESTORE_AFFECTED_PATHS ||
    journal.existingPaths.length > journal.affectedPaths.length ||
    journal.affectedPaths.some(
      (path) => typeof path !== "string" || !isAllowedRestoreJournalPath(path),
    ) ||
    journal.existingPaths.some(
      (path) => typeof path !== "string" || !isAllowedRestoreJournalPath(path),
    )
  ) {
    throw new Error("恢复事务日志包含无效路径或字段。");
  }
  const affected = new Set(
    journal.affectedPaths.map((path) => path.toLowerCase()),
  );
  if (
    affected.size !== journal.affectedPaths.length ||
    journal.existingPaths.some((path) => !affected.has(path.toLowerCase()))
  ) {
    throw new Error("恢复事务日志包含重复或越界的文件记录。");
  }
  return journal as RestoreTransactionJournal;
}

function copyFileAtomically(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${randomUUID()}.rollback`,
  );
  try {
    copyFileSync(source, temporary);
    flushFile(temporary);
    if (existsSync(destination)) rmSync(destination, { force: true });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function recoverInterruptedAgentsOneRestore(
  targetHomeInput: string = HERMES_HOME,
): boolean {
  const targetHome = resolve(targetHomeInput);
  if (!existsSync(targetHome)) return false;
  assertNoSymlinkedPathComponents(
    targetHome,
    `${RESTORE_TRANSACTION_DIRECTORY}/${RESTORE_JOURNAL_FILE}`,
  );
  const transactionRoot = restoreTransactionRoot(targetHome);
  if (!existsSync(transactionRoot)) return false;
  const transactionInfo = lstatSync(transactionRoot);
  if (!transactionInfo.isDirectory() || transactionInfo.isSymbolicLink()) {
    throw new Error("恢复事务目录不安全，已停止启动。");
  }
  const journal = parseRestoreJournal(transactionRoot);
  if (!journal) {
    rmSync(transactionRoot, { recursive: true, force: true });
    return false;
  }
  if (journal.phase === "committed") {
    rmSync(transactionRoot, { recursive: true, force: true });
    return false;
  }
  const existing = new Set(
    journal.existingPaths.map((path) => path.toLowerCase()),
  );
  const snapshotRoot = join(transactionRoot, "snapshot");
  for (const path of [...journal.affectedPaths].reverse()) {
    assertNoSymlinkedPathComponents(targetHome, path);
    const destination = resolveRestoreDestination(targetHome, path);
    if (!existing.has(path.toLowerCase())) {
      rmSync(destination, { force: true });
      continue;
    }
    assertNoSymlinkedPathComponents(transactionRoot, `snapshot/${path}`);
    const snapshot = join(snapshotRoot, ...path.split("/"));
    if (
      !existsSync(snapshot) ||
      !lstatSync(snapshot).isFile() ||
      lstatSync(snapshot).isSymbolicLink()
    ) {
      throw new Error(`恢复救援快照缺少文件：${path}`);
    }
    copyFileAtomically(snapshot, destination);
  }
  rmSync(transactionRoot, { recursive: true, force: true });
  return true;
}

function prepareRestoreTransaction(
  targetHome: string,
  affectedPaths: string[],
): { transactionRoot: string; journal: RestoreTransactionJournal } {
  recoverInterruptedAgentsOneRestore(targetHome);
  const transactionRoot = restoreTransactionRoot(targetHome);
  mkdirSync(join(transactionRoot, "snapshot"), { recursive: true });
  const existingPaths: string[] = [];
  try {
    for (const path of affectedPaths) {
      assertNoSymlinkedPathComponents(targetHome, path);
      const destination = resolveRestoreDestination(targetHome, path);
      if (!existsSync(destination)) continue;
      const destinationInfo = lstatSync(destination);
      if (!destinationInfo.isFile() || destinationInfo.isSymbolicLink()) {
        throw new Error(`恢复目标不是普通文件：${path}`);
      }
      existingPaths.push(path);
      const snapshot = join(transactionRoot, "snapshot", ...path.split("/"));
      mkdirSync(dirname(snapshot), { recursive: true });
      copyFileSync(destination, snapshot);
      flushFile(snapshot);
    }
    const journal: RestoreTransactionJournal = {
      version: RESTORE_JOURNAL_VERSION,
      phase: "prepared",
      affectedPaths,
      existingPaths,
    };
    writeRestoreJournal(transactionRoot, journal);
    return { transactionRoot, journal };
  } catch (error) {
    rmSync(transactionRoot, { recursive: true, force: true });
    throw error;
  }
}

function assertNoSymlinkedPathComponents(
  targetHome: string,
  path: string,
): void {
  const resolvedTarget = resolve(targetHome);
  let cursor = resolvedTarget;
  if (existsSync(cursor)) {
    const rootInfo = lstatSync(cursor);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new Error("Agents One 恢复目录不是安全的普通目录。");
    }
    const realTarget = realpathSync(cursor);
    if (relative(resolvedTarget, realTarget)) {
      throw new Error("Agents One 恢复目录包含重定向或链接。");
    }
  }
  for (const segment of path.split("/").slice(0, -1)) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) continue;
    const info = lstatSync(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`恢复路径包含不安全的目录链接：${path}`);
    }
    const real = realpathSync(cursor);
    const realRelative = relative(resolvedTarget, real);
    if (
      realRelative === ".." ||
      realRelative.startsWith(`..${sep}`) ||
      isAbsolute(realRelative)
    ) {
      throw new Error(`恢复路径跳出了 Agents One 数据目录：${path}`);
    }
  }
}

function sqliteSidecarPaths(path: string): string[] {
  return isProfileStateDatabasePath(path) ? [`${path}-wal`, `${path}-shm`] : [];
}

function managedRestoreDeletions(
  targetHome: string,
  manifest: AgentsOneBackupManifest,
  operations: RestoreFileOperation[],
): string[] {
  const restoredProfiles = new Set(manifest.profiles);
  const operationPaths = new Set(
    operations.map((operation) => operation.path.toLowerCase()),
  );
  return collectAgentsOneBackupFiles(targetHome)
    .map((file) => file.path)
    .filter((path) => {
      if (operationPaths.has(path.toLowerCase())) return false;
      const parts = path.split("/");
      return parts[0] !== "profiles" || restoredProfiles.has(parts[1]);
    });
}

// @lat: [[backup-recovery#Rollback-safe restore]]
export async function restoreAgentsOneBackupFrom(
  archivePath: string,
  options: RestoreAgentsOneBackupOptions = {},
): Promise<AgentsOneRestoreResult> {
  try {
    return await runExclusiveBackupOperation(() =>
      restoreAgentsOneBackupUnlocked(archivePath, options),
    );
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function restoreAgentsOneBackupUnlocked(
  archivePath: string,
  options: RestoreAgentsOneBackupOptions,
): Promise<AgentsOneRestoreResult> {
  let extractionRoot = "";
  const targetHome = resolve(options.targetHome || HERMES_HOME);
  let transactionRoot = "";
  let transactionPrepared = false;
  let transactionCommitted = false;
  try {
    recoverInterruptedAgentsOneRestore(targetHome);
    const loaded = await loadAndValidateArchive(archivePath);
    extractionRoot = loaded.extractionRoot;
    mkdirSync(targetHome, { recursive: true });
    const operations = materializeRestoreOperations(
      extractionRoot,
      targetHome,
      loaded.manifest,
    );
    const deletionPaths = managedRestoreDeletions(
      targetHome,
      loaded.manifest,
      operations,
    );
    const affectedPaths = [
      ...new Set([
        ...operations.map((operation) => operation.path),
        ...deletionPaths,
        ...operations.flatMap((operation) =>
          sqliteSidecarPaths(operation.path),
        ),
        ...deletionPaths.flatMap((path) => sqliteSidecarPaths(path)),
      ]),
    ];
    const transaction = prepareRestoreTransaction(targetHome, affectedPaths);
    transactionRoot = transaction.transactionRoot;
    transactionPrepared = true;
    for (const path of deletionPaths) {
      for (const affected of [path, ...sqliteSidecarPaths(path)]) {
        const destination = resolveRestoreDestination(targetHome, affected);
        rmSync(destination, { force: true });
      }
    }
    for (const operation of operations) {
      const source = operation.sourcePath;
      const destination = resolveRestoreDestination(targetHome, operation.path);
      mkdirSync(dirname(destination), { recursive: true });
      for (const sidecarPath of sqliteSidecarPaths(operation.path)) {
        const sidecar = resolveRestoreDestination(targetHome, sidecarPath);
        rmSync(sidecar, { force: true });
      }
      const temporary = join(
        dirname(destination),
        `.${basename(destination)}.${process.pid}.${randomUUID()}.restore`,
      );
      try {
        copyFileSync(source, temporary);
        flushFile(temporary);
        if (existsSync(destination)) rmSync(destination, { force: true });
        renameSync(temporary, destination);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    const committedJournal: RestoreTransactionJournal = {
      ...transaction.journal,
      phase: "committed",
    };
    writeRestoreJournal(transactionRoot, committedJournal);
    transactionCommitted = true;
    const warnings =
      inspectionSummary(loaded.manifest, targetHome).warnings ?? [];
    return {
      success: true,
      restoredFiles: operations.length,
      warningCount: warnings.length,
      warnings,
      requiresRestart: true,
    };
  } catch (error) {
    if (transactionPrepared && !transactionCommitted) {
      try {
        recoverInterruptedAgentsOneRestore(targetHome);
      } catch (rollbackError) {
        return {
          success: false,
          error: `恢复失败且自动回滚未完成：${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }。救援快照保留在 ${transactionRoot}`,
        };
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (extractionRoot)
      rmSync(extractionRoot, { recursive: true, force: true });
    if (transactionCommitted && transactionRoot) {
      rmSync(transactionRoot, { recursive: true, force: true });
    }
  }
}
