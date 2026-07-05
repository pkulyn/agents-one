import { getApiUrl, getRemoteAuthHeader } from "./hermes";
import type { InstalledSkill, SkillCliResult } from "./skills";

// Remote (HTTP) mode routing for the Skills screen. The skills IPC handlers
// used to fall through to the local CLI in remote mode, so the desktop showed
// (and mutated!) the LOCAL machine's skills while connected to a remote
// dashboard — or errored outright on a machine without a local install. The
// remote dashboard serves the real data: GET /api/skills, GET
// /api/skills/content, POST /api/skills/hub/install|uninstall (web_server.py).
// SSH mode has its own path (sshListInstalledSkills et al.) and is unaffected.

// Marker prefix for skill "paths" that live on the remote dashboard. The
// desktop keys skill content lookups by path; remote skills are keyed by NAME
// on the API, so the path we hand the renderer is this prefix + name and
// remoteGetSkillContent unwraps it. Mirrors ssh-remote's `ssh:` REMOTE_PREFIX.
export const REMOTE_SKILL_PREFIX = "remote-skill:";

async function skillsApi<T>(
  path: string,
  init: RequestInit = {},
  profile?: string,
): Promise<T> {
  const url = new URL(`${getApiUrl()}${path}`);
  // Scope to the requested profile on the unified dashboard; "default" needs
  // no param (matches dashboardApiUrl's convention in remote-sessions.ts).
  if (profile && profile !== "default") {
    url.searchParams.set("profile", profile);
  }
  const headers: Record<string, string> = {
    ...getRemoteAuthHeader(),
    ...((init.headers as Record<string, string>) || {}),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url.toString(), { ...init, headers });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new Error(`Remote skills API ${response.status}: ${detail}`);
  }
  return (await response.json()) as T;
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
        path: `${REMOTE_SKILL_PREFIX}${s.name}`,
      }));
  } catch {
    // Unreachable remote — an empty list beats a renderer error toast here,
    // matching sshListInstalledSkills' behavior.
    return [];
  }
}

export async function remoteGetSkillContent(
  skillPath: string,
  profile?: string,
): Promise<string> {
  const name = skillPath.startsWith(REMOTE_SKILL_PREFIX)
    ? skillPath.slice(REMOTE_SKILL_PREFIX.length)
    : skillPath;
  const result = await skillsApi<{ content?: string }>(
    `/api/skills/content?name=${encodeURIComponent(name)}`,
    {},
    profile,
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
