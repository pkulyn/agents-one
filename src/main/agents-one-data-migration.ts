import { createHash, randomUUID } from "crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import Database from "./sqlite";
import { agentsOneDataRoot } from "./agents-one-data-root";

const MIGRATION_VERSION = 1;
const MARKER = "migration-v1.json";
const PROFILE_NAME_RE = /^[a-z0-9_][a-z0-9_-]{0,63}$/;
const RETAINED_LEGACY_DIRECTORIES = new Set([
  "worktrees", // Existing Git worktrees can point outside the legacy root.
  "recovery-backups",
  "safe-write-backups",
]);
const ATTACHMENT_REFERENCE_STORES = new Set([
  "runtime-conversations.json",
  "quick-chats.json",
  "task-collaborations.json",
  "archives.json",
  "task-center.json",
  "project-control.json",
  "sessions.json",
]);

export interface AgentsOneDataMigrationOptions {
  legacyHermesHome: string;
  userDataDirectory?: string;
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function requireOrdinaryFile(path: string): void {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new Error(`Unsafe legacy data file: ${path}`);
  }
}

function requireOrdinaryDirectory(path: string): void {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Unsafe legacy data directory: ${path}`);
  }
}

function copyVerifiedFile(source: string, target: string): void {
  requireOrdinaryFile(source);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  if (
    statSync(source).size !== statSync(target).size ||
    hashFile(source) !== hashFile(target)
  ) {
    throw new Error(`Legacy data changed during migration: ${source}`);
  }
}

function copyDirectory(
  source: string,
  target: string,
  skip = new Set<string>(),
): void {
  if (!existsSync(source)) return;
  requireOrdinaryDirectory(source);
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) copyVerifiedFile(from, to);
    else throw new Error(`Unsafe legacy data entry: ${from}`);
  }
}

export function copyDesktopTables(
  legacyDatabase: string,
  targetDatabase: string,
): void {
  if (!existsSync(legacyDatabase)) return;
  requireOrdinaryFile(legacyDatabase);
  const source = new Database(legacyDatabase, { readonly: true });
  try {
    const tables = source
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name GLOB 'desktop_*' ORDER BY name",
      )
      .all() as Array<{ name: string; sql: string }>;
    if (!tables.length) return;
    mkdirSync(dirname(targetDatabase), { recursive: true });
    const target = new Database(targetDatabase);
    try {
      target.transaction(() => {
        for (const table of tables) {
          if (!/^desktop_[a-z0-9_]+$/.test(table.name) || !table.sql) {
            throw new Error(`Unsupported desktop table: ${table.name}`);
          }
          target.exec(table.sql);
          const columns = (
            source.prepare(`PRAGMA table_info(${table.name})`).all() as Array<{
              name: string;
            }>
          ).map((column) => column.name);
          if (
            !columns.length ||
            columns.some((column) => !/^[a-z][a-z0-9_]*$/.test(column))
          ) {
            throw new Error(`Unsupported desktop table columns: ${table.name}`);
          }
          const quotedColumns = columns
            .map((column) => `"${column}"`)
            .join(", ");
          const insert = target.prepare(
            `INSERT INTO "${table.name}" (${quotedColumns}) VALUES (${columns.map(() => "?").join(", ")})`,
          );
          const sourceCount = (
            source
              .prepare(`SELECT COUNT(*) AS count FROM "${table.name}"`)
              .get() as { count: number }
          ).count;
          const select = source.prepare(
            `SELECT ${quotedColumns} FROM "${table.name}" LIMIT ? OFFSET ?`,
          );
          for (let offset = 0; offset < sourceCount; offset += 100) {
            for (const row of select.all(100, offset) as Array<
              Record<string, unknown>
            >) {
              insert.run(...columns.map((column) => row[column]));
            }
          }
          const targetCount = (
            target
              .prepare(`SELECT COUNT(*) AS count FROM "${table.name}"`)
              .get() as { count: number }
          ).count;
          if (sourceCount !== targetCount)
            throw new Error(`Desktop table count mismatch: ${table.name}`);
        }
        for (const index of source
          .prepare(
            "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name GLOB 'desktop_*' AND sql IS NOT NULL ORDER BY name",
          )
          .all() as Array<{ name: string; sql: string }>) {
          if (!/^idx_desktop_[a-z0-9_]+$/.test(index.name))
            throw new Error(`Unsupported desktop index: ${index.name}`);
          target.exec(index.sql);
        }
      })();
      if (
        (
          target.prepare("PRAGMA integrity_check").get() as {
            integrity_check: string;
          }
        ).integrity_check !== "ok"
      ) {
        throw new Error("Agents One desktop database integrity check failed.");
      }
    } finally {
      target.close();
    }
  } finally {
    source.close();
  }
}

function rebindStagedAttachmentReferences(
  stage: string,
  targetRoot: string,
  sourceRoot: string,
): void {
  const oldStaging = resolve(sourceRoot, "desktop-staging");
  const stagedStaging = join(stage, "desktop-staging");
  const newStaging = join(targetRoot, "desktop-staging");
  const rebind = (value: unknown, key = ""): unknown => {
    if (
      typeof value === "string" &&
      /(path|uri|file)/i.test(key) &&
      isAbsolute(value)
    ) {
      const within = relative(oldStaging, resolve(value));
      if (
        within &&
        within !== ".." &&
        !within.startsWith(`..${sep}`) &&
        !isAbsolute(within)
      ) {
        const copied = join(stagedStaging, within);
        if (existsSync(copied)) {
          requireOrdinaryFile(copied);
          return join(newStaging, within);
        }
      }
    }
    if (Array.isArray(value)) return value.map((item) => rebind(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [
          childKey,
          rebind(child, childKey),
        ]),
      );
    }
    return value;
  };
  for (const profile of readdirSync(join(stage, "profiles"), {
    withFileTypes: true,
  })) {
    if (!profile.isDirectory()) continue;
    const desktop = join(stage, "profiles", profile.name, "desktop");
    if (!existsSync(desktop)) continue;
    for (const name of ATTACHMENT_REFERENCE_STORES) {
      const path = join(desktop, name);
      if (!existsSync(path)) continue;
      requireOrdinaryFile(path);
      const original = readFileSync(path, "utf8");
      const updated = JSON.stringify(rebind(JSON.parse(original)));
      if (updated !== JSON.stringify(JSON.parse(original)))
        writeFileSync(path, updated);
    }
  }
}

function listFiles(root: string, directory = root): string[] {
  if (!existsSync(directory)) return [];
  requireOrdinaryDirectory(directory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(root, path);
    requireOrdinaryFile(path);
    return [relative(root, path).split(sep).join("/")];
  });
}

/** Copy app-owned legacy files before any desktop reader or writer is started. */
export function migrateLegacyAgentsOneData(
  options: AgentsOneDataMigrationOptions,
): boolean {
  const sourceRoot = resolve(options.legacyHermesHome);
  const targetRoot = agentsOneDataRoot(options.userDataDirectory);
  const marker = join(targetRoot, MARKER);
  if (existsSync(marker)) {
    requireOrdinaryFile(marker);
    const value = JSON.parse(readFileSync(marker, "utf8")) as {
      version?: unknown;
    };
    if (value.version !== MIGRATION_VERSION)
      throw new Error("Unsupported Agents One data migration version.");
    return false;
  }
  if (existsSync(targetRoot))
    throw new Error(
      `Agents One data target already exists without migration marker: ${targetRoot}`,
    );
  const stage = `${targetRoot}.migrating-${randomUUID()}`;
  mkdirSync(dirname(targetRoot), { recursive: true });
  try {
    mkdirSync(stage);
    const sourceFiles: string[] = [];
    const copyFileIfPresent = (
      relativeSource: string,
      relativeTarget: string,
    ): void => {
      const from = join(sourceRoot, ...relativeSource.split("/"));
      if (!existsSync(from)) return;
      copyVerifiedFile(from, join(stage, ...relativeTarget.split("/")));
      sourceFiles.push(relativeSource);
    };
    copyFileIfPresent("desktop.json", "desktop.json");
    copyFileIfPresent(
      "profile-meta.json",
      "profiles/default/profile-meta.json",
    );
    copyFileIfPresent("active_profile", "active_profile");
    if (existsSync(join(sourceRoot, "desktop"))) {
      copyDirectory(
        join(sourceRoot, "desktop"),
        join(stage, "profiles", "default", "desktop"),
        RETAINED_LEGACY_DIRECTORIES,
      );
    }
    copyDirectory(
      join(sourceRoot, "desktop-staging"),
      join(stage, "desktop-staging"),
    );
    copyDesktopTables(
      join(sourceRoot, "state.db"),
      join(stage, "profiles", "default", "desktop.db"),
    );
    const profilesRoot = join(sourceRoot, "profiles");
    if (existsSync(profilesRoot)) {
      requireOrdinaryDirectory(profilesRoot);
      for (const profile of readdirSync(profilesRoot, {
        withFileTypes: true,
      })) {
        if (!profile.isDirectory() || !PROFILE_NAME_RE.test(profile.name))
          continue;
        const oldHome = join(profilesRoot, profile.name);
        requireOrdinaryDirectory(oldHome);
        const newHome = join(stage, "profiles", profile.name);
        const oldMeta = join(oldHome, "profile-meta.json");
        if (existsSync(oldMeta))
          copyVerifiedFile(oldMeta, join(newHome, "profile-meta.json"));
        copyDirectory(
          join(oldHome, "desktop"),
          join(newHome, "desktop"),
          RETAINED_LEGACY_DIRECTORIES,
        );
        copyDesktopTables(
          join(oldHome, "state.db"),
          join(newHome, "desktop.db"),
        );
      }
    }
    const selectedFile = join(stage, "active_profile");
    if (existsSync(selectedFile)) {
      const selected = readFileSync(selectedFile, "utf8").trim();
      if (selected !== "default" && !PROFILE_NAME_RE.test(selected))
        throw new Error("Invalid legacy active profile.");
    }
    mkdirSync(join(stage, "profiles", "default"), { recursive: true });
    rebindStagedAttachmentReferences(stage, targetRoot, sourceRoot);
    const files = listFiles(stage)
      .sort()
      .map((path) => ({
        path,
        sha256: hashFile(join(stage, ...path.split("/"))),
      }));
    writeFileSync(
      join(stage, MARKER),
      JSON.stringify(
        {
          version: MIGRATION_VERSION,
          sourceRoot,
          migratedAt: new Date().toISOString(),
          sourceFiles,
          retainedLegacyDirectories: [...RETAINED_LEGACY_DIRECTORIES],
          files,
        },
        null,
        2,
      ),
    );
    renameSync(stage, targetRoot);
    return true;
  } catch (error) {
    if (existsSync(stage)) {
      requireOrdinaryDirectory(stage);
      rmSync(stage, { recursive: true, force: true });
    }
    throw error;
  }
}
