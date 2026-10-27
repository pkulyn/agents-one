import {
  getRuntimeConversation,
  listRuntimeConversations,
} from "./runtime-conversation-store";
import { getActiveProfileNameSync } from "./utils";
import {
  isAuthorizedWorkspaceRoot,
  resolveAuthorizedWorkspaceId,
} from "./workspace-authority";
import type { PiNativeCommandContext } from "./pi-runtime";

/** Resolve native resource authority from current Main-owned conversation data. */
export function piNativeCommandContext(
  runtimeId: string,
  sessionId?: string,
  conversationId?: string,
): PiNativeCommandContext | undefined {
  const profile = getActiveProfileNameSync();
  const session = sessionId?.trim();
  if (!session) return undefined;
  const selected = conversationId
    ? getRuntimeConversation(conversationId, profile)
    : undefined;
  const candidates = conversationId
    ? selected
      ? [selected]
      : []
    : listRuntimeConversations(profile, Number.MAX_SAFE_INTEGER).filter(
        (item) =>
          item.runtimeId === runtimeId && item.runtimeSessionId === session,
      );
  if (candidates.length !== 1) return undefined;
  const conversation = candidates[0];
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
  if (
    conversation.runtimeId !== runtimeId ||
    conversation.runtimeSessionId !== session ||
    conversation.accessMode !== "full_access" ||
    conversation.archived
  )
    return undefined;
  const cwd = conversation.workspaceId
    ? resolveAuthorizedWorkspaceId(conversation.workspaceId)
    : conversation.workspace &&
        isAuthorizedWorkspaceRoot(conversation.workspace)
      ? conversation.workspace
      : undefined;
  if (!cwd) return undefined;
  const expected = binding(conversation);
  return {
    profile,
    cwd,
    assertCurrent: (): void => {
      const current = getRuntimeConversation(conversation.id, profile);
      const currentCwd = current?.workspaceId
        ? resolveAuthorizedWorkspaceId(current.workspaceId)
        : current?.workspace && isAuthorizedWorkspaceRoot(current.workspace)
          ? current.workspace
          : undefined;
      if (
        getActiveProfileNameSync() !== profile ||
        !current ||
        binding(current) !== expected ||
        currentCwd !== cwd
      )
        throw Error(
          "[Agents One 权限不足] Pi 完全访问会话或项目授权已改变，本轮原生命令未执行。 / Pi native command authority changed; the command was not executed.",
        );
    },
  };
}

/** Project context for controls grants no permission to execute native resources. */
export function piControlScope(
  runtimeId: string,
  sessionId?: string,
): { profile: string; workspace?: string } {
  const profile = getActiveProfileNameSync();
  const session = sessionId?.trim();
  const matches = session
    ? listRuntimeConversations(profile, Number.MAX_SAFE_INTEGER).filter(
        (item) =>
          item.runtimeId === runtimeId &&
          item.runtimeSessionId === session &&
          !item.archived,
      )
    : [];
  if (matches.length !== 1) return { profile };
  const conversation = matches[0];
  const workspace = conversation.workspaceId
    ? resolveAuthorizedWorkspaceId(conversation.workspaceId)
    : conversation.workspace &&
        isAuthorizedWorkspaceRoot(conversation.workspace)
      ? conversation.workspace
      : undefined;
  return { profile, ...(workspace ? { workspace } : {}) };
}
