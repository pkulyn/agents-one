/**
 * Shared types for the "Discover" community marketplace. The catalog is served
 * from the hermes-registry GitHub repo and consumed by both the main process
 * (fetch + install) and the renderer (browse UI).
 */

export type RegistryKind = "skills" | "mcps" | "agents" | "workflows";

export interface RegistryItem {
  /** Stable identifier, unique within its kind. */
  id: string;
  name: string;
  description: string;
  author?: string;
  category?: string;
  tags?: string[];
  homepage?: string;
  version?: string;
  platforms?: string[];
  /** Folder for this entry within the registry repo (e.g. "skills/apple/apple-notes"). */
  path?: string;
  /** Bundled skills only: install identifier for `hermes skills install`. */
  source?: string;
}

export interface RegistryCatalog {
  skills: RegistryItem[];
  mcps: RegistryItem[];
  agents: RegistryItem[];
  workflows: RegistryItem[];
}

export interface InstalledRegistry {
  skills: string[];
  mcps: string[];
  workflows: string[];
}
