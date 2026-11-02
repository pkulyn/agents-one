import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  AgentRuntimeTaskInput,
  AgentRuntimeDefinition,
} from "../shared/agent-runtimes";
import { agentsOneProfileHome, getActiveProfileNameSync } from "./utils";
import { getTaskCollaboration } from "./task-collaboration-store";
const ownedDirectory = Symbol("Main-owned collaboration directory");
type BoundInput = AgentRuntimeTaskInput & {
  [ownedDirectory]?: { profile?: string; taskId: string };
};
function canonicalDirectory(taskId: string, profile?: string): string {
  const profileRoot = resolve(agentsOneProfileHome(profile));
  mkdirSync(profileRoot, { recursive: true });
  let logical = profileRoot,
    physical = realpathSync.native(profileRoot);
  for (const segment of [
    "desktop",
    "collaboration-workspaces",
    createHash("sha256").update(taskId).digest("hex"),
  ]) {
    logical = join(logical, segment);
    physical = join(physical, segment);
    if (existsSync(logical)) {
      if (
        (process.platform === "win32"
          ? realpathSync.native(logical).toLowerCase()
          : realpathSync.native(logical)) !==
        (process.platform === "win32" ? physical.toLowerCase() : physical)
      )
        throw Error("collaboration_workspace_alias");
    } else mkdirSync(logical);
  }
  return logical;
}
/** Only Main can attach this symbol; Renderer input cannot serialize it. */
export function bindCollaborationWorkingDirectory<
  T extends AgentRuntimeTaskInput,
>(
  input: T,
  context: AgentRuntimeTaskInput["collaborationContext"],
  runtime: AgentRuntimeDefinition,
): T {
  if (!context) return input;
  if (
    typeof context.taskId !== "string" ||
    !context.taskId ||
    typeof context.assignmentId !== "string" ||
    !context.assignmentId
  )
    throw Error("collaboration_assignment_unavailable");
  const profile = input.profile || getActiveProfileNameSync();
  const record = getTaskCollaboration(context.taskId, profile);
  const assignmentIds = [
    context.assignmentId,
    context.assignmentId?.replace(/::final-review$/, ""),
  ];
  if (
    !record ||
    record.taskMode === "single" ||
    !record.assignments.some(
      (a, index) =>
        assignmentIds.includes(a.id || `legacy:${index}:${a.role}`) &&
        a.runtimeId === runtime.id,
    )
  )
    throw Error("collaboration_assignment_unavailable");
  if (runtime.location !== "local" || input.workspace || input.workspaceId)
    return input;
  canonicalDirectory(record.taskId, profile);
  Object.defineProperty(input, ownedDirectory, {
    value: { profile, taskId: record.taskId },
    enumerable: true,
  });
  return input;
}
/** Recheck physical identity at each adapter startup, including model retries. */
export function collaborationWorkingDirectory(
  input: AgentRuntimeTaskInput,
): string | undefined {
  const owned = (input as BoundInput)[ownedDirectory];
  return owned ? canonicalDirectory(owned.taskId, owned.profile) : undefined;
}
