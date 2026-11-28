import { isAbsolute } from "node:path";
import { resolveWorkspaceToolPath } from "./remote-workspace.mjs";

export const PI_WORKSPACE_PROBE = "agents-one-host-policy";
export const PI_READ_TOOLS = ["read", "grep", "find", "ls"];
export const PI_WRITE_TOOLS = ["edit", "write"];
export function resolvePiToolPath(cwd, allowed, name, input) {
  if (
    !allowed.includes(name) ||
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  )
    return undefined;
  if (name === "find" || name === "grep") {
    const pattern = name === "find" ? input.pattern : input.glob;
    if (
      pattern !== undefined &&
      (typeof pattern !== "string" ||
        pattern.includes("..") ||
        isAbsolute(pattern) ||
        /^[A-Za-z]:/.test(pattern))
    )
      return undefined;
  }
  const search = name === "grep" || name === "find" || name === "ls";
  return resolveWorkspaceToolPath(
    cwd,
    input.path ?? (search ? "." : undefined),
    name === "write",
  );
}

export default function configurePiWorkspacePolicy(pi) {
  const cwd = process.env.AGENTS_ONE_PI_WORKSPACE;
  const allowed =
    process.env.AGENTS_ONE_PI_MODE === "safe_write"
      ? [...PI_READ_TOOLS, ...PI_WRITE_TOOLS]
      : PI_READ_TOOLS;
  pi.on("tool_call", (event) => {
    if (!cwd || !resolvePiToolPath(cwd, allowed, event.toolName, event.input))
      return {
        block: true,
        reason: "Tool or path is outside the Host workspace authority.",
      };
    return undefined;
  });
  pi.registerCommand(PI_WORKSPACE_PROBE, {
    description: "Indicates the Host workspace policy is active.",
    handler: async () => {},
  });
}
