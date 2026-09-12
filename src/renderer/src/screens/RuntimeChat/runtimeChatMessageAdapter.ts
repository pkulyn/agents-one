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
  ChatMessageAgentIdentity,
} from "../Chat/types";
import { isSyntheticRemoteReasoningSummary } from "../../../../shared/agent-event-stream";
import { runtimeArtifactMediaUri } from "../Chat/mediaUtils";

export interface RuntimeChatMessageAdapterOptions {
  /**
   * Runtime protocol markers (for example collaboration proposals) can be
   * removed before the native MessageRow renders the assistant bubble.
   */
  getAgentContent?: (message: RuntimeConversationMessage) => string;
  /** Live events keep their last tool call open until a result arrives. */
  live?: boolean;
  idPrefix?: string;
  /** Identity of the Runtime that produced a live or durable event trace. */
  agentIdentity?: ChatMessageAgentIdentity;
  /** Localizes platform-authored fallback rows; Runtime-authored text is unchanged. */
  translate?: (key: string, options?: Record<string, unknown>) => string;
}

const DEFAULT_PLATFORM_TEXT: Record<string, string> = {
  "runtimeChat.events.noDetail": "运行时未提供详细信息。",
  "runtimeChat.events.cancelled": "任务已取消",
  "runtimeChat.events.traceUnavailable": "思考记录未上报",
  "runtimeChat.events.toolsWithoutReasoning":
    "该智能体的运行服务本轮提供了工具调用记录，但没有提供可展示的思考摘要。",
  "runtimeChat.events.lifecycleOnly":
    "该智能体的运行服务本轮只返回了生命周期和最终答复，没有提供可展示的思考摘要或工具调用事件。",
};

function platformText(
  options: Pick<RuntimeChatMessageAdapterOptions, "translate">,
  key: string,
): string {
  return options.translate?.(key) || DEFAULT_PLATFORM_TEXT[key] || key;
}

function identityForMessage(
  message: RuntimeConversationMessage,
): ChatMessageAgentIdentity | undefined {
  if (!message.agentRuntimeId) return undefined;
  return {
    agentRuntimeId: message.agentRuntimeId,
    ...(message.agentName ? { agentName: message.agentName } : {}),
    agentAvatar: message.agentAvatar ?? null,
    ...(message.agentColor ? { agentColor: message.agentColor } : {}),
    ...(message.collaborationRole
      ? { collaborationRole: message.collaborationRole }
      : {}),
    ...(message.collaborationAssignmentId
      ? { collaborationAssignmentId: message.collaborationAssignmentId }
      : {}),
  };
}

function withIdentity<T extends ChatMessage>(
  message: T,
  identity?: ChatMessageAgentIdentity,
): T {
  return identity ? { ...message, ...identity } : message;
}

function normalizedSummary(summary: string): string {
  return summary.replace(/\s+/g, " ").trim();
}

/** Pi (and a few CLI versions) emit cumulative reasoning snapshots. */
function isReasoningSnapshotOf(left: string, right: string): boolean {
  const a = normalizedSummary(left)
    .replace(/^Pi 思考：/, "")
    .toLowerCase();
  const b = normalizedSummary(right)
    .replace(/^Pi 思考：/, "")
    .toLowerCase();
  return Boolean(a && b && a !== b && (a.startsWith(b) || b.startsWith(a)));
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

function eventDetail(
  event: AgentRuntimeEvent,
  options: Pick<RuntimeChatMessageAdapterOptions, "translate"> = {},
): string {
  return (
    event.detail?.trim() ||
    normalizedSummary(event.summary) ||
    platformText(options, "runtimeChat.events.noDetail")
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
    artifact.id &&
    ((artifact.mime || "").toLowerCase().startsWith("image/") ||
      /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(artifact.label)),
  );
}

function runtimeArtifactMediaTokens(
  execution: RuntimeConversationMessage["execution"],
): string {
  return (execution?.artifacts || [])
    .filter(isImageArtifact)
    .map((artifact) => {
      return `MEDIA:\`${runtimeArtifactMediaUri(
        execution!.runId,
        artifact.id!,
        artifact.label,
      )}\``;
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
    .filter(
      (artifact) =>
        artifact.id &&
        !artifact.content &&
        artifact.kind !== "diff" &&
        !isImageArtifact(artifact),
    )
    .map((artifact, index) => ({
      id: `runtime-artifact-${artifact.id || index}`,
      kind: "path-ref" as const,
      name: artifact.label,
      mime: artifact.mime || "application/octet-stream",
      size: artifact.size || 0,
      runtimeArtifact: {
        runId: execution!.runId,
        artifactId: artifact.id!,
      },
    }));
}

function runtimeEventMessages(
  events: AgentRuntimeEvent[],
  options: Pick<
    RuntimeChatMessageAdapterOptions,
    "live" | "idPrefix" | "agentIdentity" | "translate"
  > = {},
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
      const previous = messages.at(-1);
      if (
        previous?.kind === "reasoning" &&
        isReasoningSnapshotOf(previous.text, eventDetail(event, options))
      ) {
        previous.text =
          eventDetail(event, options).length > previous.text.length
            ? eventDetail(event, options)
            : previous.text;
        continue;
      }
      const message: ReasoningMessage = {
        id,
        kind: "reasoning",
        role: "agent",
        text: eventDetail(event, options),
      };
      messages.push(withIdentity(message, options.agentIdentity));
      continue;
    }

    if (event.type === "tool_call") {
      const evidence = runtimeToolEvidence(event);
      const callId = evidence.callId || `${prefix}:call:${event.id}`;
      const existingIndex = callIndexesById.get(callId);
      const existing =
        existingIndex === undefined ? undefined : messages[existingIndex];
      if (existing?.kind === "tool_call" && existingIndex !== undefined) {
        existing.name = evidence.name;
        if (evidence.input) existing.args = evidence.input;
        existing.status = options.live ? "running" : "completed";
        callIndexes.set(evidence.name, existingIndex);
        continue;
      }
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
      messages.push(withIdentity(message, options.agentIdentity));
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
        content: evidence.output || eventDetail(event, options),
      };
      messages.push(withIdentity(result, options.agentIdentity));
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
        title: platformText(options, "runtimeChat.events.cancelled"),
        detail: eventDetail(event, options),
      };
      messages.push(withIdentity(message, options.agentIdentity));
    }
  }

  return messages;
}

function runtimeConversationMessage(
  message: RuntimeConversationMessage,
  options: RuntimeChatMessageAdapterOptions,
): ChatBubbleMessage {
  const isUser = message.role === "user";
  const isControlMessage =
    message.role === "system" || Boolean(message.controlAudit);
  const content =
    !isUser && options.getAgentContent
      ? options.getAgentContent(message)
      : message.content;
  const mediaTokens = isUser
    ? ""
    : runtimeArtifactMediaTokens(message.execution);
  const attachments = isUser
    ? []
    : runtimeArtifactAttachments(message.execution);
  const displayContent = isUser
    ? content
    : removeRemoteArtifactMediaTokens(content, message.execution);
  const startedAt = message.execution?.startedAt;
  const completedAt = message.execution?.completedAt;
  const durationMs =
    typeof startedAt === "number" &&
    typeof completedAt === "number" &&
    completedAt >= startedAt
      ? completedAt - startedAt
      : undefined;
  return {
    id: message.id,
    kind: isUser ? "user" : "assistant",
    role: isUser ? "user" : "agent",
    content: [displayContent, mediaTokens].filter(Boolean).join("\n"),
    ...(attachments.length ? { attachments } : {}),
    timestamp: message.createdAt,
    ...(isControlMessage ? { isControlMessage: true } : {}),
    ...(durationMs !== undefined
      ? {
          runtimeMeta: {
            durationMs,
          },
        }
      : {}),
    ...identityForMessage(message),
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
      const visibleEvents = message.execution.events.filter(
        (event) =>
          event.type !== "progress" ||
          !isSyntheticRemoteReasoningSummary(event.summary, message.content),
      );
      const hasReasoning = visibleEvents.some(
        (event) => event.type === "progress",
      );
      const hasTools = visibleEvents.some((event) =>
        ["tool_call", "tool_result"].includes(event.type),
      );
      if (message.collaborationRole && !hasReasoning) {
        result.push(
          withIdentity<SystemMessage>(
            {
              id: `${message.id}:${message.execution.runId}:trace-unavailable`,
              kind: "system",
              role: "agent",
              title: platformText(
                options,
                "runtimeChat.events.traceUnavailable",
              ),
              detail: hasTools
                ? platformText(
                    options,
                    "runtimeChat.events.toolsWithoutReasoning",
                  )
                : platformText(options, "runtimeChat.events.lifecycleOnly"),
            },
            identityForMessage(message),
          ),
        );
      }
      result.push(
        ...runtimeEventMessages(visibleEvents, {
          idPrefix: `${message.id}:${message.execution.runId}`,
          agentIdentity: identityForMessage(message),
          translate: options.translate,
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
  options: Pick<
    RuntimeChatMessageAdapterOptions,
    "live" | "idPrefix" | "agentIdentity" | "translate"
  > = {},
): ChatMessage[] {
  return runtimeEventMessages(events, options);
}
