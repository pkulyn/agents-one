import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { agentsOneDataRoot } from "./agents-one-data-root";
import { agentsOneProfileHome, profileHome } from "./utils";

const DENIED =
  "[Agents One 权限不足] 当前项目目录包含应用私有数据或位于受保护的数据目录内。请改选具体的项目源目录。 / Select a project directory separate from application private data.";
const normalized = (path: string): string =>
  process.platform === "win32" ? path.toLowerCase() : path;
function inside(root: string, path: string): boolean {
  const rel = relative(normalized(root), normalized(path));
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
  );
}
function physical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw Error(DENIED);
    const parent = dirname(path);
    if (parent === path) throw Error(DENIED);
    return resolve(physical(parent), relative(parent, path));
  }
}

// @lat: [[runtime-chat#Claude private workspace exclusion]]
export function assertClaudeWorkspaceBoundary(
  cwd: string,
  profile?: string,
  ownedConversationDirectory = false,
): void {
  const workspace = resolve(cwd);
  const actual = physical(workspace);
  const profileRoot = resolve(agentsOneProfileHome(profile));
  if (ownedConversationDirectory) {
    const suffix = join("desktop", "runtime-chat", "claude-code");
    if (
      normalized(workspace) !== normalized(join(profileRoot, suffix)) ||
      normalized(actual) !== normalized(join(physical(profileRoot), suffix))
    )
      throw Error(DENIED);
    return;
  }
  const roots = [
    dirname(agentsOneDataRoot()),
    profileRoot,
    profileHome("default"),
    process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"),
  ];
  for (const root of roots) {
    const logical = resolve(root);
    const canonical = physical(logical);
    if (
      inside(logical, workspace) ||
      inside(workspace, logical) ||
      inside(canonical, actual) ||
      inside(actual, canonical)
    )
      throw Error(DENIED);
  }
}
