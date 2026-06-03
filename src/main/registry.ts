import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { profileHome, safeWriteFile } from "./utils";
import { installSkill, listInstalledSkills } from "./skills";
import { createProfile } from "./profiles";
import { listMcpServers } from "./installer";
import type {
  RegistryKind,
  RegistryItem,
  RegistryCatalog,
  InstalledRegistry,
} from "../shared/registry";

export type {
  RegistryKind,
  RegistryItem,
  RegistryCatalog,
} from "../shared/registry";

/**
 * The "Discover" marketplace reads its catalog from a public GitHub repo:
 *   https://github.com/fathah/hermes-registry
 *
 * `index.json` is a flat list of entries, each with a `type`
 * (agent|mcp|skill|workflow) and a `path` to its folder in the repo. "Set up"
 * actions download the entry's files into the active profile.
 */
const REGISTRY_REPO = "fathah/hermes-registry";
const REGISTRY_BRANCH = "main";
const REGISTRY_RAW_BASE = `https://raw.githubusercontent.com/${REGISTRY_REPO}/refs/heads/${REGISTRY_BRANCH}`;
const REGISTRY_REPO_BASE = `https://github.com/${REGISTRY_REPO}/tree/${REGISTRY_BRANCH}`;
const INDEX_URL = `${REGISTRY_RAW_BASE}/index.json`;
const TREE_URL = `https://api.github.com/repos/${REGISTRY_REPO}/git/trees/${REGISTRY_BRANCH}?recursive=1`;

/** index.json entry shape. */
interface IndexEntry {
  id: string;
  type: "agent" | "mcp" | "skill" | "workflow";
  category?: string;
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  author?: string | { name?: string };
  platforms?: string[];
  path?: string;
}

/** Per-entry manifest.json (mcp / agent / workflow). */
interface EntryManifest {
  transport?: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  entry?: string;
}

const TYPE_TO_KIND: Record<IndexEntry["type"], RegistryKind> = {
  skill: "skills",
  mcp: "mcps",
  agent: "agents",
  workflow: "workflows",
};

const EMPTY_CATALOG: RegistryCatalog = {
  skills: [],
  mcps: [],
  agents: [],
  workflows: [],
};

// Short-lived cache so flipping between Discover sub-tabs doesn't refetch.
let cache: { at: number; data: RegistryCatalog } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function authorName(author: IndexEntry["author"]): string | undefined {
  if (!author) return undefined;
  return typeof author === "string" ? author : author.name;
}

function toItem(e: IndexEntry): RegistryItem {
  return {
    id: e.id,
    name: e.name || e.id,
    description: e.description || "",
    author: authorName(e.author),
    category: e.category,
    tags: e.tags,
    version: e.version,
    platforms: e.platforms,
    path: e.path,
    homepage: e.path ? `${REGISTRY_REPO_BASE}/${e.path}` : undefined,
  };
}

/**
 * Fetch and normalise the community catalog. Network/parse failures resolve to
 * an empty catalog (with `error` set) rather than throwing, so the screen can
 * render an empty state instead of crashing.
 */
export async function fetchRegistry(
  force = false,
): Promise<RegistryCatalog & { error?: string }> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  try {
    const res = await fetch(INDEX_URL, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { ...EMPTY_CATALOG, error: `Registry returned ${res.status}` };
    }
    const raw = (await res.json()) as { entries?: IndexEntry[] };
    const data: RegistryCatalog = {
      skills: [],
      mcps: [],
      agents: [],
      workflows: [],
    };
    for (const entry of raw.entries ?? []) {
      const kind = TYPE_TO_KIND[entry.type];
      if (kind && entry.id) data[kind].push(toItem(entry));
    }
    cache = { at: Date.now(), data };
    return data;
  } catch (err) {
    return {
      ...EMPTY_CATALOG,
      error: err instanceof Error ? err.message : "Failed to load registry",
    };
  }
}

/**
 * Names already present in the active profile, per kind, so the UI can mark
 * catalog items as "Installed".
 */
export function listInstalledRegistry(profile?: string): InstalledRegistry {
  let skills: string[] = [];
  let mcps: string[] = [];
  let workflows: string[] = [];
  try {
    skills = listInstalledSkills(profile).map((s) => s.name);
  } catch {
    /* ignore */
  }
  try {
    mcps = listMcpServers(profile).map((s) => s.name);
  } catch {
    /* ignore */
  }
  try {
    const dir = join(profileHome(profile), "workflows");
    if (existsSync(dir)) {
      // Workflows install as either <id>.<ext> files or <id>/ folders.
      workflows = readdirSync(dir).map((f) =>
        f.replace(/\.(js|mjs|ts|json)$/, ""),
      );
    }
  } catch {
    /* ignore */
  }
  return { skills, mcps, workflows };
}

export interface InstallResult {
  success: boolean;
  error?: string;
}

/**
 * Markdown preview for an item's detail modal. Skills/agents have a prose doc;
 * MCPs/workflows show their manifest as a fenced JSON block.
 */
export async function fetchRegistryReadme(
  kind: RegistryKind,
  item: RegistryItem,
): Promise<string> {
  if (!item.path) return item.description || "";
  const candidates =
    kind === "skills"
      ? ["SKILL.md", "README.md"]
      : kind === "agents"
        ? ["AGENT.md", "README.md", "manifest.json"]
        : ["manifest.json", "README.md"];
  for (const file of candidates) {
    try {
      const res = await fetch(`${REGISTRY_RAW_BASE}/${item.path}/${file}`);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim()) continue;
      return file.endsWith(".json") ? `\`\`\`json\n${text}\n\`\`\`` : text;
    } catch {
      /* try next */
    }
  }
  return item.description || "";
}

async function fetchManifest(path: string): Promise<EntryManifest | null> {
  try {
    const res = await fetch(`${REGISTRY_RAW_BASE}/${path}/manifest.json`);
    if (!res.ok) return null;
    return (await res.json()) as EntryManifest;
  } catch {
    return null;
  }
}

/** One blob in the repo's recursive git tree. */
interface TreeBlob {
  path: string;
  type: string;
}
let treeCache: { at: number; blobs: TreeBlob[] } | null = null;

/** All file paths under a folder, via the cached recursive git tree. */
async function listFolderFiles(folder: string): Promise<string[]> {
  if (!treeCache || Date.now() - treeCache.at >= CACHE_TTL_MS) {
    const res = await fetch(TREE_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`Tree fetch failed (${res.status})`);
    const json = (await res.json()) as { tree?: TreeBlob[] };
    treeCache = { at: Date.now(), blobs: json.tree ?? [] };
  }
  const prefix = `${folder}/`;
  return treeCache.blobs
    .filter((b) => b.type === "blob" && b.path.startsWith(prefix))
    .map((b) => b.path);
}

/** Download every file under an entry's repo folder into a local directory. */
async function downloadFolder(
  repoFolder: string,
  destDir: string,
): Promise<InstallResult> {
  const files = await listFolderFiles(repoFolder);
  if (files.length === 0) {
    return { success: false, error: "No files found for this entry" };
  }
  for (const file of files) {
    const rel = file.slice(repoFolder.length + 1);
    const res = await fetch(`${REGISTRY_RAW_BASE}/${file}`);
    if (!res.ok) return { success: false, error: `Fetch failed: ${rel}` };
    const body = await res.text();
    safeWriteFile(join(destDir, rel), body);
  }
  return { success: true };
}

/** Quote a string for single-line YAML if it needs it. */
function yamlScalar(value: string): string {
  return /[:#{}[\],&*?|<>=!%@`"']/.test(value) || value.trim() !== value
    ? JSON.stringify(value)
    : value;
}

/** Render one MCP server (from its manifest) as an indented YAML block. */
function renderMcpYaml(id: string, m: EntryManifest): string {
  const lines: string[] = [`  ${id}:`];
  if (m.transport === "http" || m.url) {
    if (m.url) lines.push(`    url: ${yamlScalar(m.url)}`);
    if (m.headers) {
      lines.push(`    headers:`);
      for (const [k, v] of Object.entries(m.headers)) {
        lines.push(`      ${k}: ${yamlScalar(String(v))}`);
      }
    }
  } else {
    if (m.command) lines.push(`    command: ${yamlScalar(m.command)}`);
    if (m.args?.length) {
      lines.push(`    args:`);
      for (const a of m.args) lines.push(`      - ${yamlScalar(String(a))}`);
    }
    if (m.env && Object.keys(m.env).length) {
      lines.push(`    env:`);
      for (const [k, v] of Object.entries(m.env)) {
        lines.push(`      ${k}: ${yamlScalar(String(v))}`);
      }
    }
  }
  lines.push(`    enabled: true`);
  return lines.join("\n") + "\n";
}

/**
 * Add an MCP server entry under `mcp_servers:` in the profile's config.yaml.
 * Mirrors the regex-based reader in installer.ts — no YAML lib is available,
 * so we splice text directly.
 */
async function installMcp(
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  if (!item.path) return { success: false, error: "MCP entry has no path" };
  const m = await fetchManifest(item.path);
  if (!m || (!m.url && !m.command)) {
    return { success: false, error: "MCP manifest has no connection config" };
  }

  const configPath = join(profileHome(profile), "config.yaml");
  let content = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const block = renderMcpYaml(item.id, m);
  const sectionRe = /^mcp_servers:\s*\n/m;

  if (sectionRe.test(content)) {
    if (new RegExp(`^[ ]{2}${item.id}:\\s*$`, "m").test(content)) {
      return { success: false, error: "Already configured" };
    }
    content = content.replace(sectionRe, (mm) => mm + block);
  } else {
    if (content.length && !content.endsWith("\n")) content += "\n";
    content += `mcp_servers:\n${block}`;
  }

  try {
    safeWriteFile(configPath, content);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to write config",
    };
  }
}

/** Download a registry skill's folder into <profile>/skills/<category>/<id>/. */
async function installRegistrySkill(
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  if (!item.path) return { success: false, error: "Skill entry has no path" };
  const category = item.category || "uncategorized";
  const dest = join(profileHome(profile), "skills", category, item.id);
  return downloadFolder(item.path, dest);
}

/** Download a workflow's folder into <profile>/workflows/<id>/. */
async function installWorkflow(
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  if (!item.path)
    return { success: false, error: "Workflow entry has no path" };
  const dest = join(profileHome(profile), "workflows", item.id);
  return downloadFolder(item.path, dest);
}

/**
 * Install/"set up" a catalog item into the active profile.
 *   - skill    → download the entry folder into <profile>/skills/<category>/<id>/
 *                (bundled skills, which carry `source` and no `path`, install
 *                via `hermes skills install <source>`)
 *   - mcp      → append the manifest's server to config.yaml `mcp_servers:`
 *   - agent    → create a cloned profile named after the agent
 *   - workflow → download the entry folder into <profile>/workflows/<id>/
 */
export async function installRegistryItem(
  kind: RegistryKind,
  item: RegistryItem,
  profile?: string,
): Promise<InstallResult> {
  try {
    switch (kind) {
      case "skills":
        return item.path
          ? await installRegistrySkill(item, profile)
          : installSkill(item.source || item.id, profile);
      case "mcps":
        return await installMcp(item, profile);
      case "agents":
        return createProfile(item.id, true);
      case "workflows":
        return await installWorkflow(item, profile);
      default:
        return { success: false, error: "Unknown item kind" };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Install failed",
    };
  }
}
