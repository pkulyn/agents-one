import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Resolve a private app-owned workspace, keeping sessions and conversations separate. */
export function resolveOneConversationWorkspace(
  stateDir: string,
  options: { conversationId?: string; sessionId?: string; runId: string },
): { workspace: string; bind: (sessionId: string) => void } {
  const bindings = join(stateDir, "bindings");
  const bindingPath = (sessionId: string): string =>
    join(bindings, digest(sessionId) + ".json");
  const conversationKey = options.conversationId
    ? digest("conversation:" + options.conversationId)
    : undefined;
  let workspaceKey: string;
  if (options.sessionId) {
    const path = bindingPath(options.sessionId);
    if (!existsSync(path))
      throw new Error("One session workspace binding was not found");
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      !("workspaceKey" in value) ||
      typeof value.workspaceKey !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.workspaceKey)
    )
      throw new Error("One session workspace binding is invalid");
    workspaceKey = value.workspaceKey;
    if (conversationKey && conversationKey !== workspaceKey)
      throw new Error("One session belongs to another conversation");
  } else {
    workspaceKey = conversationKey || digest("run:" + options.runId);
  }
  const workspace = join(stateDir, "workspaces", workspaceKey);
  mkdirSync(workspace, { recursive: true });
  function bind(sessionId: string): void {
    if (!sessionId || sessionId.length > 256)
      throw new Error("One session ID is invalid");
    mkdirSync(bindings, { recursive: true });
    const path = bindingPath(sessionId);
    const record = JSON.stringify({ workspaceKey });
    try {
      writeFileSync(path, record, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EEXIST" ||
        readFileSync(path, "utf8") !== record
      )
        throw error;
    }
  }
  return { workspace, bind };
}
