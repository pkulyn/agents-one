/** Native Codex side-effect gates for mobile inspection, separate from public task input. */
export const CODEX_INSPECT_DISABLED_FEATURES = Object.freeze([
  "hooks",
  "apps",
  "plugins",
  "remote_plugin",
  "multi_agent",
  "multi_agent_v2",
  "computer_use",
  "browser_use",
  "browser_use_external",
  "image_generation",
  "view_image",
  "goals",
  "shell_tool",
  "unified_exec",
  "code_mode_host",
  "workspace_dependencies",
  "in_app_local_automation",
  "memories",
  "daemon_auto_start",
  "shell_snapshot",
  "skill_mcp_dependency_install",
  "auth_elicitation",
  "tool_suggest",
]);

/** Approval requires proof for the actual native binary, model/provider and configuration environment. */
export function codexMobileInspectionArgs(): string[] {
  // @lat: [[mobile-data#Mobile data#Codex native mobile inspection]]
  return [
    "--ignore-user-config",
    "--ignore-rules",
    ...CODEX_INSPECT_DISABLED_FEATURES.flatMap((feature) => [
      "--disable",
      feature,
    ]),
    "-c",
    'web_search="disabled"',
  ];
}
