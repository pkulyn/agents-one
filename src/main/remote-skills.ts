import { getConnectionConfig, getRemoteDashboardSessionConfig } from "./config";
import { remoteRequestJson } from "./remote-sessions";
import type { InstalledSkill, SkillCliResult } from "./skills";

// Remote (HTTP) mode routing for the Skills screen. The skills IPC handlers
// used to fall through to the local CLI in remote mode, so the desktop showed
// (and mutated!) the LOCAL machine's skills while connected to a remote
// dashboard — or errored outright on a machine without a local install. The
// remote dashboard serves the real data: GET /api/skills, GET
// /api/skills/content, POST /api/skills/hub/install|uninstall (web_server.py).
// SSH mode has its own path (sshListInstalledSkills et al.) and is unaffected.

// Marker prefix for skill "paths" that live on the remote dashboard. The
// desktop keys skill content lookups by path; remote skills are keyed by
// NAME + PROFILE on the API, so the path we hand the renderer is
// `remote-skill:<profile>:<name>` and remoteGetSkillContent unwraps both.
// The profile must ride in the path (mirroring how local/SSH paths carry the
// full location): the content lookup has no other channel for it, and using
// the globally active profile instead would query the wrong profile whenever
// the Skills screen is scoped to a named one.
export const REMOTE_SKILL_PREFIX = "remote-skill:";

export function remoteSkillPath(name: string, profile?: string): string {
  return `${REMOTE_SKILL_PREFIX}${profile?.trim() || "default"}:${name}`;
}

async function skillsApi<T>(
  path: string,
  init: RequestInit = {},
  profile?: string,
  query?: Record<string, string>,
): Promise<T> {
  const config = getRemoteDashboardSessionConfig(
    getConnectionConfig(),
    profile,
  );
  const pathUrl = new URL(path, "http://hermes.local");
  for (const [key, value] of Object.entries(query ?? {})) {
    pathUrl.searchParams.set(key, value);
  }
  const scopedPath = `${pathUrl.pathname}${pathUrl.search}`;
  // Reuse the shared dashboard client: it scopes named profiles, sends both
  // supported auth headers, applies the narrowly configured TLS exception,
  // and gives remote Skills the same timeout/error behavior as every other
  // remote management surface.
  return remoteRequestJson<T>(config, scopedPath, {
    method:
      (init.method as "GET" | "POST" | "PATCH" | "PUT" | "DELETE") ??
      "GET",
    body: init.body ? JSON.parse(String(init.body)) : undefined,
  });
}

export async function remoteListInstalledSkills(
  profile?: string,
): Promise<InstalledSkill[]> {
  try {
    const skills = await skillsApi<
      Array<{ name?: string; category?: string; description?: string }>
    >("/api/skills", {}, profile);
    if (!Array.isArray(skills)) return [];
    return skills
      .filter((s) => typeof s?.name === "string" && s.name)
      .map((s) => ({
        name: s.name as string,
        category: s.category || "",
        description: s.description || "",
        path: remoteSkillPath(s.name as string, profile),
      }));
  } catch {
    // Unreachable remote — an empty list beats a renderer error toast here,
    // matching sshListInstalledSkills' behavior.
    return [];
  }
}

export async function remoteGetSkillContent(
  skillPath: string,
  fallbackProfile?: string,
): Promise<string> {
  // Paths from remoteListInstalledSkills embed the profile they were listed
  // under (`remote-skill:<profile>:<name>`). A path without the separator is
  // treated as a bare name and scoped to fallbackProfile.
  let name = skillPath;
  let profile = fallbackProfile;
  if (skillPath.startsWith(REMOTE_SKILL_PREFIX)) {
    name = skillPath.slice(REMOTE_SKILL_PREFIX.length);
    const sep = name.indexOf(":");
    if (sep !== -1) {
      profile = name.slice(0, sep);
      name = name.slice(sep + 1);
    }
  }
  const result = await skillsApi<{ content?: string }>(
    "/api/skills/content",
    {},
    profile,
    { name },
  );
  return result.content ?? "";
}

// NB: the hub endpoints SPAWN `hermes skills install/uninstall` on the remote
// and return immediately ({ok, pid}) — unlike the local/SSH paths, success
// here means "started", not "completed". The renderer's list refresh picks up
// the result; a resolution failure surfaces only in the remote's logs.
export async function remoteInstallSkill(
  identifier: string,
  profile?: string,
): Promise<SkillCliResult> {
  try {
    const result = await skillsApi<{ ok?: boolean }>(
      "/api/skills/hub/install",
      { method: "POST", body: JSON.stringify({ identifier, profile }) },
      profile,
    );
    return result.ok
      ? { success: true }
      : { success: false, error: "Remote install did not start." };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function remoteUninstallSkill(
  name: string,
  profile?: string,
): Promise<SkillCliResult> {
  try {
    const result = await skillsApi<{ ok?: boolean }>(
      "/api/skills/hub/uninstall",
      { method: "POST", body: JSON.stringify({ name, profile }) },
      profile,
    );
    return result.ok
      ? { success: true }
      : { success: false, error: "Remote uninstall did not start." };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
