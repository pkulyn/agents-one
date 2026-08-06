import type {
  AgentRuntimeArtifact,
  AgentRuntimeEvent,
} from "../../../../shared/agent-runtimes";
import type { RuntimeConversationMessage } from "../../../../shared/runtime-conversations";
import type {
  Attachment,
  ChatBubbleMessage,
  ChatMessage,
  ReasoningMessage,
  SystemMessage,
  ToolCallMessage,
  ToolResultMessage,
} from "../Chat/types";

export interface RuntimeChatMessageAdapterOptions {
  /**
   * Runtime protocol markers (for example collaboration proposals) can be
   * removed before the native MessageRow renders the assistant bubble.
   */
  getAgentContent?: (message: RuntimeConversationMessage) => string;
  /** Live events keep their last tool call open until a result arrives. */
  live?: boolean;
  idPrefix?: string;
}

function normalizedSummary(summary: string): string {
  return summary.replace(/\s+/g, " ").trim();
}

/** Recover a stable human-readable tool name from legacy flat summaries. */
export function toolNameFromRuntimeSummary(summary: string): string {
  const value = normalizedSummary(summary);
  const match =
    value.match(/(?:MCP|技能|工具|受控工作区)\s+([^：:.。\s]+)/i) ||
    value.match(/正在调用\s*([^：:.。\s]+)/i) ||
    value.match(/调用\s+([^：:.。\s]+)/i) ||
    value.match(/已收到\s*([^：:.。\s]+)结果/i) ||
    value.match(/已完成\s*([^：:.。\s]+)/i);
  return match?.[1]?.trim() || "工具";
}

function nativeToolName(name: string): string {
  if (/^(bash|cmd|shell|terminal|command|命令)$/i.test(name)) {
    return "Terminal";
  }
  if (/^(read|read_file)$/i.test(name)) return "Read File";
  if (/^(write|write_file|edit)$/i.test(name)) return "Write File";
  return name;
}

function toolArgumentsFromSummary(summary: string): string {
  const value = normalizedSummary(summary);
  const separator = value.search(/[：:]/);
  if (separator < 0) return value;
  return value.slice(separator + 1).trim() || value;
}

interface RuntimeToolEvidence {
  name: string;
  callId?: string;
  input?: string;
  output?: string;
}

function runtimeToolEvidence(event: AgentRuntimeEvent): RuntimeToolEvidence {
  const tool = event.tool;
  return {
    name: nativeToolName(
      tool?.name || toolNameFromRuntimeSummary(event.summary),
    ),
    ...(tool?.callId ? { callId: tool.callId } : {}),
    ...(tool?.inputSummary
      ? { input: tool.inputSummary }
      : event.type === "tool_call"
        ? { input: toolArgumentsFromSummary(event.summary) }
        : {}),
    ...(tool?.outputSummary
      ? { output: tool.outputSummary }
      : event.type === "tool_result"
        ? { output: event.detail || event.summary }
        : {}),
  };
}

function eventDetail(event: AgentRuntimeEvent): string {
  return (
    event.detail?.trim() ||
    normalizedSummary(event.summary) ||
    "运行时未提供详细信息。"
  );
}

const HIDDEN_PLATFORM_PROGRESS = new Set([
  "已建立不会自动到期的受控本机工作区授权；任务结束或取消时撤销。",
  "本轮未授予远程工作区权限，已按普通只读对话执行。",
]);

function isPlatformLifecycleProgress(event: AgentRuntimeEvent): boolean {
  return HIDDEN_PLATFORM_PROGRESS.has(normalizedSummary(event.summary));
}

function isImageArtifact(artifact: AgentRuntimeArtifact): boolean {
  return Boolean(
    artifact.path &&
      ((artifact.mime || "").toLowerCase().startsWith("image/") ||
        /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(artifact.path)),
  );
}

function runtimeArtifactMediaTokens(
  execution: RuntimeConversationMessage["execution"],
): string {
  return (execution?.artifacts || [])
    .filter(isImageArtifact)
    .map((artifact) => {
      const path = artifact.path!.replace(/`/g, "");
      return `MEDIA:\`${path}\``;
    })
    .join("\n");
}

const EXPLICIT_MEDIA_TOKEN_RE =
  /MEDIA[：:][ \t]*(?:`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|\S+)/gi;

/** Remove remote/private paths once their Artifact API copy is available. */
function removeRemoteArtifactMediaTokens(
  content: string,
  execution: RuntimeConversationMessage["execution"],
): string {
  if (!execution?.artifacts?.some(isImageArtifact)) return content;
  return content
    .replace(EXPLICIT_MEDIA_TOKEN_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function runtimeArtifactAttachments(
  execution: RuntimeConversationMessage["execution"],
): Attachment[] {
  return (execution?.artifacts || [])
    .filter((artifact) => artifact.path && !isImageArtifact(artifact))
    .map((artifact, index) => ({
      id: `runtime-artifact-${artifact.id || index}`,
      kind: "path-ref" as const,
      name: artifact.label,
      mime: artifact.mime || "application/octet-stream",
      size: artifact.size || 0,
      path: artifact.path,
    }));
}

function runtimeEventMessages(
  events: AgentRuntimeEvent[],
  options: Pick<RuntimeChatMessageAdapterOptions, "live" | "idPrefix"> = {},
): ChatMessage[] {
  const prefix = options.idPrefix || "runtime";
  const messages: ChatMessage[] = [];
  const callIndexes = new Map<string, number>();
  const callIndexesById = new Map<string, number>();
  const activeCallNames: string[] = [];

  const findCallIndex = (
    name: string,
    callId?: string,
    allowLatestFallback = true,
  ): number | undefined => {
    if (callId) {
      const byId = callIndexesById.get(callId);
      if (byId !== undefined) return byId;
    }
    const direct = callIndexes.get(name);
    if (direct !== undefined) return direct;
    if (!allowLatestFallback) return undefined;
    return activeCallNames
      .slice()
      .reverse()
      .map((candidate) => callIndexes.get(candidate))
      .find((index): index is number => index !== undefined);
  };

  for (const event of events) {
    const id = `${prefix}:event:${event.id}`;
    if (event.type === "progress") {
      if (isPlatformLifecycleProgress(event)) continue;
      const message: ReasoningMessage = {
        id,
        kind: "reasoning",
        role: "agent",
        text: eventDetail(event),
      };
      messages.push(message);
      continue;
    }

    if (event.type === "tool_call") {
      const evidence = runtimeToolEvidence(event);
      const callId = evidence.callId || `${prefix}:call:${event.id}`;
      const message: ToolCallMessage = {
        id,
        kind: "tool_call",
        role: "agent",
        callId,
        name: evidence.name,
        args: evidence.input || toolArgumentsFromSummary(event.summary),
        status: options.live ? "running" : "completed",
      };
      callIndexes.set(evidence.name, messages.length);
      callIndexesById.set(callId, messages.length);
      activeCallNames.push(evidence.name);
      messages.push(message);
      continue;
    }

    if (event.type === "tool_result") {
      const evidence = runtimeToolEvidence(event);
      const callIndex = findCallIndex(evidence.name, evidence.callId);
      const call = callIndex === undefined ? undefined : messages[callIndex];
      const callId =
        evidence.callId ||
        (call && call.kind === "tool_call"
          ? call.callId
          : `${prefix}:call:${event.id}`);
      if (call && call.kind === "tool_call" && callIndex !== undefined) {
        (messages[callIndex] as ToolCallMessage).status = "completed";
      }
      const result: ToolResultMessage = {
        id,
        kind: "tool_result",
        role: "agent",
        callId,
        name: call && call.kind === "tool_call" ? call.name : evidence.name,
        content: evidence.output || eventDetail(event),
      };
      messages.push(result);
      continue;
    }

    if (event.type === "error" || event.type === "timed_out") {
      const evidence = runtimeToolEvidence(event);
      const rawName =
        event.tool?.name || toolNameFromRuntimeSummary(event.summary);
      const callIndex = findCallIndex(
        evidence.name,
        evidence.callId,
        rawName === "工具",
      );
      const call = callIndex === undefined ? undefined : messages[callIndex];
      if (call && call.kind === "tool_call") {
        call.status = "failed";
      }
      continue;
    }

    if (event.type === "artifact_published") {
      continue;
    }

    if (event.type === "cancelled") {
      const message: SystemMessage = {
        id,
        kind: "system",
        role: "agent",
        title: "任务已取消",
        detail: eventDetail(event),
      };
      messages.push(message);
    }
  }

  return messages;
}

function runtimeConversationMessage(
  message: RuntimeConversationMessage,
  options: RuntimeChatMessageAdapterOptions,
): ChatBubbleMessage {
  const isUser = message.role === "user";
  const content =
    !isUser && options.getAgentContent
      ? options.getAgentContent(message)
      : message.content;
  const mediaTokens = isUser ? "" : runtimeArtifactMediaTokens(message.execution);
  const attachments = isUser ? [] : runtimeArtifactAttachments(message.execution);
  const displayContent = isUser
    ? content
    : removeRemoteArtifactMediaTokens(content, message.execution);
  return {
    id: message.id,
    kind: isUser ? "user" : "assistant",
    role: isUser ? "user" : "agent",
    content: [displayContent, mediaTokens].filter(Boolean).join("\n"),
    ...(attachments.length ? { attachments } : {}),
    timestamp: message.createdAt,
  };
}

/**
 * Convert the durable Runtime conversation into the same message union used
 * by the mature native Chat surface. Keeping this adapter pure makes it easy
 * to test provider compatibility without mounting Electron UI.
 */
export function runtimeConversationToChatMessages(
  messages: RuntimeConversationMessage[],
  options: RuntimeChatMessageAdapterOptions = {},
): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "agent" && message.execution?.events?.length) {
      result.push(
        ...runtimeEventMessages(message.execution.events, {
          idPrefix: `${message.id}:${message.execution.runId}`,
        }),
      );
    }
    result.push(runtimeConversationMessage(message, options));
  }
  return result;
}

/** Convert the currently running flat event timeline into native history rows. */
export function runtimeEventsToChatMessages(
  events: AgentRuntimeEvent[],
  options: Pick<RuntimeChatMessageAdapterOptions, "live" | "idPrefix"> = {},
): ChatMessage[] {
  return runtimeEventMessages(events, options);
}
