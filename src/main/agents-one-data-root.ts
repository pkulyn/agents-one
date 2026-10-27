import { app } from "electron";
import { homedir } from "os";
import { join, resolve } from "path";

const PROFILE_NAME_RE = /^[a-z0-9_][a-z0-9_-]{0,63}$/;

/** The app-owned data root follows Electron's effective userData path. */
export function agentsOneDataRoot(userDataDirectory?: string): string {
  const userData =
    userDataDirectory ||
    process.env.AGENTS_ONE_USER_DATA_DIR?.trim() ||
    app?.getPath?.("userData") ||
    join(homedir(), ".agents-one");
  return join(resolve(userData), "data");
}

/** Desktop profile data is separate from Hermes' native profile home. */
export function agentsOneProfileHome(
  profile: unknown = "default",
  userDataDirectory?: string,
): string {
  if (profile !== undefined && profile !== "" && profile !== "default") {
    if (typeof profile !== "string" || !PROFILE_NAME_RE.test(profile)) {
      throw new Error("Invalid Agents One profile name.");
    }
  }
  return join(
    agentsOneDataRoot(userDataDirectory),
    "profiles",
    profile && profile !== "default" ? String(profile) : "default",
  );
}
