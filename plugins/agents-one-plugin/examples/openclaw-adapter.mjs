/** Map OpenClaw Bridge/subagent lifecycle events to Agents One events. */
export function mapOpenClawEvent(source) {
  if (source.type === "subagent_started") {
    return { id: source.id, type: "handoff.created", data: { summary: `已交接给 ${source.agentName}。` } };
  }
  if (source.type === "subagent_completed") {
    return { id: source.id, type: "handoff.completed", data: { summary: `${source.agentName} 已完成交接。` } };
  }
  if (source.type === "artifact" && source.path && source.sha256) {
    return { id: source.id, type: "artifact.created", data: { artifact: { label: source.label || source.path, path: source.path, sha256: source.sha256, summary: source.summary } } };
  }
  return undefined;
}
