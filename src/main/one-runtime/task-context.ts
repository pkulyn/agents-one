/** Supply runtime facts without imposing a platform workflow on the agent. */
export function oneTaskContext(options: {
  name: string;
  modelId: string;
  endpoint: string;
  now?: Date;
}): string {
  return [
    `You are ${options.name}.`,
    `Current date: ${(options.now || new Date()).toLocaleDateString("en-CA")}. Configured model ID: ${options.modelId}. Provider endpoint host: ${new URL(options.endpoint).hostname}. This identifies the selected API configuration, not independently verified upstream model identity.`,
    "Respond in chat; create files only when requested or required by the task.",
  ].join("\n");
}
