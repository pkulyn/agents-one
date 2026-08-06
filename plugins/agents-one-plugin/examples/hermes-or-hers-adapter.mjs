/**
 * Skeleton for a Hermes Dashboard / Hers Relay adapter.
 * Feed completed Dashboard events into `emit`; do not forward raw thoughts.
 */
export function mapHermesEvent(source) {
  if (source.kind === "thought" && source.summary) {
    return {
      id: source.id,
      type: "reasoning.summary",
      data: { reasoningSummary: source.summary },
    };
  }
  if (source.kind === "tool") {
    return {
      id: source.id,
      type: source.status === "failed" ? "tool.failed" : "tool.completed",
      data: {
        tool: {
          kind: source.mcp ? "mcp" : source.skill ? "skill" : "tool",
          name: source.name,
          outputSummary: source.summary,
        },
      },
    };
  }
  if (source.kind === "assistant" && source.final) {
    return {
      id: source.id,
      type: "assistant.completed",
      data: { text: source.text },
    };
  }
  return undefined;
}

/**
 * Generic model-tool shape for publishing a Hers/Hermes output file.
 * The Connector owns `readOutput`: it must reject paths outside this run's
 * approved output directory and return Buffer/Uint8Array bytes only.
 */
export function createAgentsOneArtifactTool({ publishArtifact, readOutput }) {
  if (
    typeof publishArtifact !== "function" ||
    typeof readOutput !== "function"
  ) {
    throw new Error("publishArtifact and readOutput are required.");
  }
  return {
    name: "agents_one_publish_artifact",
    description: "Publish a generated file as an Agents One output artifact.",
    inputSchema: {
      type: "object",
      required: ["path", "name", "mime"],
      properties: {
        path: { type: "string", description: "Run-output-relative file path." },
        name: { type: "string", description: "Download filename." },
        mime: { type: "string", description: "IANA media type." },
      },
      additionalProperties: false,
    },
    async execute({ path, name, mime }) {
      const bytes = await readOutput(path);
      return await publishArtifact({ name, mime, bytes });
    },
  };
}
