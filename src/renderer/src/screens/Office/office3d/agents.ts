import { createAgentAvatarProfileFromSeed } from "./avatars/profile";
import type { OfficeAgent } from "./core/types";

/**
 * A profile as surfaced by the desktop's `listProfiles` IPC. Only the fields
 * the office needs to render an agent are required here.
 */
export interface OfficeProfileInput {
  name: string;
  model?: string;
  provider?: string;
  gatewayRunning?: boolean;
}

// Stable, pleasant accent colors keyed off the profile name so each agent keeps
// the same color between renders.
const AGENT_COLORS = [
  "#7090ff",
  "#34d399",
  "#f59e0b",
  "#f43f5e",
  "#8b5cf6",
  "#0891b2",
  "#db2777",
  "#22c55e",
];

function hashName(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Map a desktop profile to an office agent. Each profile becomes one 3D agent;
 * a running gateway reads as "working" (green), otherwise "idle" (amber).
 */
export function profileToOfficeAgent(profile: OfficeProfileInput): OfficeAgent {
  const seed = profile.name || "agent";
  const color = AGENT_COLORS[hashName(seed) % AGENT_COLORS.length];
  return {
    id: seed,
    name: profile.name,
    subtitle: profile.model || profile.provider || null,
    status: profile.gatewayRunning ? "working" : "idle",
    color,
    item: "desk",
    avatarProfile: createAgentAvatarProfileFromSeed(seed),
    model: profile.model,
    provider: profile.provider,
    gatewayRunning: profile.gatewayRunning,
    position: "employee",
  };
}

export function profilesToOfficeAgents(
  profiles: OfficeProfileInput[],
): OfficeAgent[] {
  return profiles.map(profileToOfficeAgent);
}
