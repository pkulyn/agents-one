import {
  getRuntimeConversation,
  listRuntimeConversations,
} from "./runtime-conversation-store";
import { getActiveProfileNameSync } from "./utils";
import {
  isAuthorizedWorkspaceRoot,
  resolveAuthorizedWorkspaceId,
} from "./workspace-authority";
import type { ClaudeSdkStartupConfig } from "./claude-sdk-policy";
const refused =
  "[Agents One 权限不足] Claude 会话、项目或当前权限已改变，本轮命令未执行。 / Claude conversation authority changed; the command was not executed.";
// @lat: [[runtime-chat#Claude SDK startup authority]]
export function claudeControlScope(
  runtimeId: string,
  sessionId?: string,
): Pick<
  ClaudeSdkStartupConfig,
  "profile" | "runtimeId" | "workspace" | "assertCurrent" | "nativeContext"
> {
  const profile = getActiveProfileNameSync(),
    session = sessionId?.trim();
  const checkProfile = (): void => {
    if (getActiveProfileNameSync() !== profile) throw Error(refused);
  };
  if (!session) return { profile, runtimeId, assertCurrent: checkProfile };
  const matches = listRuntimeConversations(
    profile,
    Number.MAX_SAFE_INTEGER,
  ).filter(
    (c) =>
      c.runtimeId === runtimeId &&
      c.runtimeKind === "claude-code" &&
      c.runtimeSessionId === session &&
      !c.archived,
  );
  if (matches.length !== 1) throw Error(refused);
  const conversation = matches[0];
  const workspaceOf = (value: typeof conversation): string | undefined =>
    value.workspaceId
      ? resolveAuthorizedWorkspaceId(value.workspaceId) || undefined
      : value.workspace && isAuthorizedWorkspaceRoot(value.workspace)
        ? value.workspace
        : undefined;
  const workspace = workspaceOf(conversation);
  if ((conversation.workspaceId || conversation.workspace) && !workspace)
    throw Error(refused);
  const binding = (value: typeof conversation): string =>
    JSON.stringify([
      value.id,
      value.runtimeId,
      value.runtimeSessionId,
      value.accessMode,
      value.archived,
      value.workspaceId,
      value.workspace,
    ]);
  const expected = binding(conversation);
  const assertCurrent = (): void => {
    checkProfile();
    const current = getRuntimeConversation(conversation.id, profile);
    if (
      !current ||
      binding(current) !== expected ||
      workspaceOf(current) !== workspace
    )
      throw Error(refused);
  };
  return {
    profile,
    runtimeId,
    ...(workspace ? { workspace } : {}),
    assertCurrent,
    ...(workspace && conversation.accessMode === "full_access"
      ? { nativeContext: { cwd: workspace, assertCurrent } }
      : {}),
  };
}
