/** Supply runtime facts without imposing a platform workflow on the agent. */
export function oneTaskContext(options: {
  name: string;
  modelId: string;
  endpoint: string;
  now?: Date;
  environment?: { workspace: string; mode: string; toolsEnabled: boolean };
}): string {
  return [
    `You are ${options.name}.`,
    ...(options.environment
      ? [
          `You run locally inside Agents One using Pi SDK on ${process.platform}. Workspace: ${JSON.stringify(options.environment.workspace)}. Permission: ${options.environment.mode}. Tool calls: ${options.environment.toolsEnabled ? "enabled" : "disabled by model settings"}. host_shell requires confirmed full_access; workspace tools use in-root relative paths. one_runtime_info provides actual configuration paths and tool diagnostics. For Agents One configuration, read skill builtin:agents-one-configuration on demand.`,
        ]
      : []),
    `Current date: ${(options.now || new Date()).toLocaleDateString("en-CA")}. Configured model ID: ${options.modelId}. Provider endpoint host: ${new URL(options.endpoint).hostname}. This identifies the selected API configuration, not independently verified upstream model identity.`,
    "Respond in chat; create files only when requested or required by the task.",
  ].join("\n");
}
