import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { homedir } from "node:os";
import type {
  ConversationFileInfo,
  ConversationFileRef,
} from "../shared/conversation-files";
import {
  documentPath,
  findDocumentReferences,
} from "../shared/conversation-files";
import { getRuntimeConversation } from "./runtime-conversation-store";
import {
  listAgentRuntimes,
  resolveAgentRuntimeArtifactPath,
  restoreConversationArtifactFile,
} from "./agent-runtimes";
import { isAuthorizedMediaPath } from "./media";
import { getActiveProfileNameSync } from "./utils";

const remoteDownloads = new Map<string, Promise<string | null>>();
/** Read-only authority is tied to one saved assistant reply, never a directory grant. */
export async function resolveConversationFile(
  ref: ConversationFileRef,
): Promise<ConversationFileInfo | null> {
  const profile = getActiveProfileNameSync();
  if (
    !ref ||
    typeof ref.conversationId !== "string" ||
    typeof ref.messageId !== "string" ||
    ref.conversationId.length > 256 ||
    ref.messageId.length > 256
  )
    return null;
  const conversation = getRuntimeConversation(ref.conversationId);
  const message = conversation?.messages.find(
    (item) =>
      item.id === ref.messageId && item.role === "agent" && !item.controlAudit,
  );
  if (!conversation || !message) return null;
  let candidate: string | undefined;
  let name: string | undefined;
  if (ref.artifactId) {
    const artifact = message.execution?.artifacts?.find(
      (item) => item.id === ref.artifactId && item.kind === "file",
    );
    if (!artifact) return null;
    name = artifact.label;
    candidate = resolveAgentRuntimeArtifactPath(
      message.execution!.runId,
      ref.artifactId,
    )?.path;
    if (!candidate && artifact.path && isAuthorizedMediaPath(artifact.path))
      candidate = artifact.path;
    if (!candidate) {
      const runtimeId = message.agentRuntimeId || conversation.runtimeId;
      const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
      if (
        runtime?.location === "local" ||
        (!runtime && conversation.runtimeLocation === "local")
      ) {
        const paths = findDocumentReferences(message.content)
          .map((item) => item.path)
          .filter((path) => path.split(/[\\/]/).pop() === artifact.label);
        const unique = [...new Set(paths)];
        if (unique.length === 1) candidate = unique[0];
      }
    }
    if (!candidate) {
      const runtimeId = message.agentRuntimeId || conversation.runtimeId;
      const key = JSON.stringify([profile, runtimeId, ref.artifactId]);
      let pending = remoteDownloads.get(key);
      if (!pending) {
        pending = restoreConversationArtifactFile(runtimeId, ref.artifactId);
        remoteDownloads.set(key, pending);
        if (remoteDownloads.size > 100)
          remoteDownloads.delete(remoteDownloads.keys().next().value!);
      }
      candidate = (await pending) || undefined;
      if (!candidate) remoteDownloads.delete(key);
      else if (!(await stat(candidate).catch(() => null))?.isFile()) {
        remoteDownloads.delete(key);
        candidate =
          (await restoreConversationArtifactFile(runtimeId, ref.artifactId)) ||
          undefined;
      }
    }
  } else if (typeof ref.path === "string" && ref.path.length <= 32768) {
    const requested = documentPath(ref.path);
    if (
      !requested ||
      !findDocumentReferences(message.content).some(
        (item) => item.path === requested,
      )
    )
      return null;
    // A remote machine can use the same username/drive letters. Its prose is not local authority.
    const runtime = listAgentRuntimes().find(
      (item) => item.id === (message.agentRuntimeId || conversation.runtimeId),
    );
    if (
      runtime
        ? runtime.location !== "local"
        : conversation.runtimeLocation !== "local"
    )
      return null;
    candidate =
      requested.startsWith("~/") || requested.startsWith("~\\")
        ? resolve(homedir(), requested.slice(2))
        : requested;
  }
  if (
    !candidate ||
    !isAbsolute(candidate) ||
    profile !== getActiveProfileNameSync()
  )
    return null;
  try {
    const path = await realpath(candidate);
    const info = await stat(path);
    if (!info.isFile()) return null;
    return {
      name: name || basename(path),
      path,
      relativePath:
        relative(conversation.workspace || dirname(path), path) ||
        basename(path),
      size: info.size,
      image: /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path),
    };
  } catch {
    return null;
  }
}
