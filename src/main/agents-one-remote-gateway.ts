import type {
  AgentRuntimeArtifact,
  AgentRuntimeCapabilities,
  AgentRuntimePluginInfo,
  AgentRuntimeRun,
} from "../shared/agent-runtimes";
import { NO_AGENT_RUNTIME_CAPABILITIES } from "../shared/agent-runtimes";
import {
  AGENT_EVENT_STREAM_V1,
  parseAgentEventStreamEvents,
  normalizeAgentEventStreamModel,
  normalizeAgentEventStreamUsage,
  type AgentEventStreamEvent,
  type AgentEventStreamModel,
  type AgentEventStreamSupport,
  type AgentEventStreamUsage,
} from "../shared/agent-event-stream";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export interface AgentsOneRemoteGatewayConfig {
  endpoint: string;
  timeoutMs?: number;
}

export interface AgentsOneRemoteGatewayAuth {
  bearerToken?: string;
}

export interface AgentsOneRemoteGatewayProbe {
  healthy: boolean;
  capabilities: AgentRuntimeCapabilities;
  message?: string;
}

export interface AgentsOneRemoteGatewayRunInput {
  /** Stable Agents One runtime id used by a shared Gateway to route to the
   * correct remote Connector. Gateways bound to one agent may ignore it. */
  runtimeId?: string;
  mode: "conversation" | "task";
  conversationId?: string;
  projectId?: string;
  text: string;
  artifactIds?: string[];
  workspaceRef?: string;
  timeoutSeconds: number;
  permission: "read" | "write";
}

export interface AgentsOneRemoteGatewayArtifactUploadInput {
  name: string;
  mime: string;
  bytes: Buffer;
  sha256: string;
}

export interface AgentsOneRemoteGatewayArtifact {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256?: string;
  expiresAt?: string;
}

export interface AgentsOneRemoteGatewayArtifactDownload
  extends AgentsOneRemoteGatewayArtifact {
  bytes: Buffer;
}

export interface AgentsOneRemoteGatewayRun {
  id: string;
  status: AgentRuntimeRun["status"];
  output?: string;
  conversationId?: string;
  error?: string;
  artifacts?: AgentRuntimeArtifact[];
  /** Optional structured trace emitted by an Event Stream v1 capable Gateway. */
  events?: AgentEventStreamEvent[];
  model?: AgentEventStreamModel;
  usage?: AgentEventStreamUsage;
}

function endpointUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, "")}${path}`;
}

function isSelfSignedCertificateError(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  if (
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN"
  ) {
    return true;
  }
  return Boolean(
    error &&
      typeof error === "object" &&
      "cause" in error &&
      isSelfSignedCertificateError((error as { cause?: unknown }).cause),
  );
}

async function requestJsonOnce(
  config: AgentsOneRemoteGatewayConfig,
  path: string,
  auth?: AgentsOneRemoteGatewayAuth,
  init?: { method?: "POST"; body?: unknown },
  rejectUnauthorized?: boolean,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = new URL(endpointUrl(config.endpoint, path));
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Gateway 地址必须使用 HTTP 或 HTTPS。");
  }
  const timeoutMs = Math.max(1_000, config.timeoutMs || 10_000);
  const payload =
    init?.body === undefined ? undefined : JSON.stringify(init.body);
  return await new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: init?.method || "GET",
        headers: {
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
          ...(auth?.bearerToken
            ? { Authorization: `Bearer ${auth.bearerToken}` }
            : {}),
        },
        ...(url.protocol === "https:" && rejectUnauthorized === false
          ? { rejectUnauthorized: false }
          : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () => {
          const status = response.statusCode || 0;
          const text = Buffer.concat(chunks).toString("utf8");
          let body: unknown = undefined;
          try {
            body = text ? JSON.parse(text) : undefined;
          } catch {
            resolve({ ok: false, status, body: undefined });
            return;
          }
          resolve({ ok: status >= 200 && status < 300, status, body });
        });
      },
    );
    request.once("error", reject);
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error("Gateway 请求超时。")),
    );
    if (payload) request.write(payload);
    request.end();
  });
}

async function requestJson(
  config: AgentsOneRemoteGatewayConfig,
  path: string,
  auth?: AgentsOneRemoteGatewayAuth,
  init?: { method?: "POST"; body?: unknown },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const response = await fetch(endpointUrl(config.endpoint, path), {
      method: init?.method || "GET",
      headers: {
        Accept: "application/json",
        ...(init?.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(auth?.bearerToken
          ? { Authorization: `Bearer ${auth.bearerToken}` }
          : {}),
      },
      ...(init?.body === undefined
        ? {}
        : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(
        Math.max(1_000, config.timeoutMs || 10_000),
      ),
    });
    let body: unknown = undefined;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    // The endpoint is explicitly configured by the user. Retry only the
    // self-signed-certificate case; hostname, protocol, and other TLS failures
    // remain strict.
    if (
      config.endpoint.trim().toLowerCase().startsWith("https://") &&
      isSelfSignedCertificateError(error)
    ) {
      return await requestJsonOnce(config, path, auth, init, false);
    }
    throw error;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function runStatus(value: unknown): AgentRuntimeRun["status"] | null {
  switch (string(value)?.toLowerCase()) {
    case "queued":
    case "running":
    case "cancelling":
      return "running";
    case "succeeded":
    case "success":
    case "completed":
    case "done":
      return "succeeded";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "timed_out":
    case "timeout":
      return "timed_out";
    case "failed":
    case "error":
      return "failed";
    default:
      return null;
  }
}

function outputFrom(root: Record<string, unknown>): string | undefined {
  const direct = string(root.output) || string(root.text);
  if (direct) return direct;
  const result = object(root.result);
  const assistant = object(root.assistant);
  return (
    string(result?.text) || string(result?.output) || string(assistant?.text)
  );
}

function artifactsFrom(value: unknown): AgentRuntimeArtifact[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const artifacts = value.flatMap((item): AgentRuntimeArtifact[] => {
    const artifact = object(item);
    if (!artifact) return [];
    const label =
      string(artifact.label) || string(artifact.name) || string(artifact.id);
    if (!label) return [];
    const path = string(artifact.path) || string(artifact.relativePath);
    const content = string(artifact.content);
    return [
      {
        kind: "final",
        label,
        ...(string(artifact.id) ? { id: string(artifact.id) } : {}),
        ...(string(artifact.mime) || string(artifact.contentType)
          ? { mime: string(artifact.mime) || string(artifact.contentType) }
          : {}),
        ...(typeof artifact.size === "number" && artifact.size >= 0
          ? { size: Math.floor(artifact.size) }
          : {}),
        ...(string(artifact.sha256) ? { sha256: string(artifact.sha256) } : {}),
        ...(path ? { path } : {}),
        ...(content ? { content } : {}),
      },
    ];
  });
  return artifacts.length ? artifacts : undefined;
}

function artifactsFromEvents(
  events: AgentEventStreamEvent[],
): AgentRuntimeArtifact[] | undefined {
  const artifacts = events.flatMap((event): AgentRuntimeArtifact[] => {
    if (event.type !== "artifact.created" || !event.data?.artifact) return [];
    const artifact = event.data.artifact;
    const label = artifact.label || artifact.name || artifact.id;
    if (!label) return [];
    return [
      {
        kind: "final",
        label,
        ...(artifact.id ? { id: artifact.id } : {}),
        ...(artifact.mime ? { mime: artifact.mime } : {}),
        ...(artifact.size !== undefined ? { size: artifact.size } : {}),
        ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
        ...(artifact.path ? { path: artifact.path } : {}),
      },
    ];
  });
  return artifacts.length ? artifacts : undefined;
}

/**
 * A legacy Connector may describe an artifact in its final text while still
 * storing the bytes behind the Artifact API. Recover the stable id from that
 * protocol-shaped text so the main process can download the object instead
 * of trying to read the Connector's private filesystem path in the renderer.
 */
function artifactsFromOutput(
  output: string | undefined,
): AgentRuntimeArtifact[] | undefined {
  if (!output) return undefined;
  const marker = /artifact\.created\b/i.exec(output);
  if (!marker) return undefined;
  const tail = output.slice(marker.index);
  const field = (name: string): string | undefined =>
    new RegExp(`\\b${name}\\s*[:=]\\s*([^\\s,;]+)`, "i").exec(tail)?.[1];
  const id = field("id");
  const label = field("name") || field("label");
  if (!id || !label) return undefined;
  const mime = field("mime") || field("contentType");
  const rawSize = field("size");
  const size = rawSize && /^\d+$/.test(rawSize) ? Number(rawSize) : undefined;
  const sha256 = field("sha256");
  return [
    {
      kind: "final",
      id,
      label,
      ...(mime ? { mime } : {}),
      ...(size !== undefined ? { size } : {}),
      ...(sha256 ? { sha256 } : {}),
    },
  ];
}

function mergeArtifacts(
  ...sources: Array<AgentRuntimeArtifact[] | undefined>
): AgentRuntimeArtifact[] | undefined {
  const merged = new Map<string, AgentRuntimeArtifact>();
  for (const source of sources) {
    for (const artifact of source || []) {
      const key = artifact.id
        ? `id:${artifact.id}`
        : `label:${artifact.label}:${artifact.sha256 || ""}`;
      const previous = merged.get(key);
      merged.set(key, previous ? { ...previous, ...artifact } : artifact);
    }
  }
  return merged.size ? [...merged.values()] : undefined;
}

function modelFrom(value: unknown): AgentEventStreamModel | undefined {
  return normalizeAgentEventStreamModel(value);
}

function usageFrom(value: unknown): AgentEventStreamUsage | undefined {
  return normalizeAgentEventStreamUsage(value);
}

function metadataCandidates(
  root: Record<string, unknown>,
): Record<string, unknown>[] {
  return [
    root,
    // Gateway adapters commonly return run metadata inside a response/data
    // envelope. Keep this tolerant while preserving the canonical v1 shape.
    object(root.data),
    object(root.metadata),
    object(root.meta),
    object(root.response),
    object(root.result),
    object(root.output),
    object(root.state),
    object(root.run),
  ].filter((value): value is Record<string, unknown> => Boolean(value));
}

function modelFromRoot(root: Record<string, unknown>): AgentEventStreamModel | undefined {
  for (const source of metadataCandidates(root)) {
    const model =
      modelFrom(source.model) ||
      modelFrom({
        id:
          source.modelId ??
          source.model_id ??
          source.modelName ??
          source.model_name,
        provider: source.provider ?? source.vendor,
        contextWindowTokens:
          source.contextWindowTokens ??
          source.context_window_tokens ??
          source.contextWindow ??
          source.context_window ??
          source.maxContextTokens ??
          source.max_context_tokens ??
          source.contextMaxTokens ??
          source.context_max_tokens ??
          source.context_max ??
          source.contextLength ??
          source.context_length,
      });
    if (model) return model;
  }
  return undefined;
}

function usageFromRoot(root: Record<string, unknown>): AgentEventStreamUsage | undefined {
  for (const source of metadataCandidates(root)) {
    const usage =
      usageFrom(source.usage) ||
      usageFrom({
        inputTokens:
          source.inputTokens ?? source.input_tokens ?? source.prompt_tokens,
        outputTokens:
          source.outputTokens ??
          source.output_tokens ??
          source.completion_tokens,
        totalTokens: source.totalTokens ?? source.total_tokens,
        contextUsedTokens:
          source.contextUsedTokens ??
          source.context_used_tokens ??
          source.context_used ??
          source.contextUsed ??
          source.usedContextTokens,
        contextWindowTokens:
          source.contextWindowTokens ??
          source.context_window_tokens ??
          source.contextWindow ??
          source.context_window ??
          source.maxContextTokens ??
          source.max_context_tokens ??
          source.contextMaxTokens ??
          source.context_max_tokens ??
          source.context_max ??
          source.contextLength ??
          source.context_length,
      });
    if (usage) return usage;
  }
  return undefined;
}

function finalAssistantOutputFrom(
  events: AgentEventStreamEvent[],
): string | undefined {
  for (const event of [...events].reverse()) {
    if (event.type !== "assistant.completed") continue;
    const output = string(event.data?.text) || string(event.data?.summary);
    if (output) return output;
  }
  return undefined;
}

function latestEventModel(
  events: AgentEventStreamEvent[],
): AgentEventStreamModel | undefined {
  for (const event of [...events].reverse()) {
    const model =
      modelFrom(event.data?.model) ||
      modelFromRoot((event.data || {}) as unknown as Record<string, unknown>);
    if (model) return model;
  }
  return undefined;
}

function latestEventUsage(
  events: AgentEventStreamEvent[],
): AgentEventStreamUsage | undefined {
  for (const event of [...events].reverse()) {
    const usage =
      usageFrom(event.data?.usage) ||
      usageFromRoot((event.data || {}) as unknown as Record<string, unknown>);
    if (usage) return usage;
  }
  return undefined;
}

function errorMessageFrom(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  const source = object(value);
  if (!source) return undefined;
  const code = string(source.code);
  const message = string(source.message);
  const detail = string(source.detail);
  const nested = errorMessageFrom(source.error);
  const parts = [code, message, detail, nested].filter(
    (part, index, values): part is string => Boolean(part) && values.indexOf(part) === index,
  );
  return parts.length ? parts.join(": ") : undefined;
}

function isGenericFailureText(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return [
    "failed",
    "error",
    "远程任务结束：failed。",
    "远程任务结束: failed.",
    "任务执行失败。",
    "gateway 运行失败，但未返回错误详情。",
  ].includes(normalized);
}

/** Convert protocol error codes into a user-actionable runtime diagnosis. */
export function explainAgentsOneRemoteGatewayError(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : errorMessageFrom(error) || String(error);
  if (/\brun[_ -]?not[_ -]?found\b|\brun not found\b/i.test(raw)) {
    return "当前远程运行已不存在（run_not_found）。这通常发生在 Relay 重启、热更新或清理了运行状态之后；为避免重复执行文件操作，请确认 Relay 已稳定后重新发送本条消息。";
  }
  if (/\bagent_offline\b/i.test(raw)) {
    return "远程智能体当前离线（agent_offline）。请在该智能体所在设备启动 Agents One Plugin/Connector，并确认它已连接到 Gateway；连接恢复后再重试。";
  }
  if (/\bconnector_offline\b/i.test(raw)) {
    return "远程智能体连接器当前离线（connector_offline）。请在该智能体所在设备启动 Agents One Plugin/Connector，并确认它已连接到 Gateway；连接恢复后再重试。";
  }
  return raw;
}

export function isAgentsOneRemoteGatewayRunNotFound(error: unknown): boolean {
  const raw =
    error instanceof Error ? error.message : errorMessageFrom(error) || String(error);
  return /\brun[_ -]?not[_ -]?found\b|\brun not found\b/i.test(raw);
}

function eventFailureMessage(events: AgentEventStreamEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    if (
      event.type !== "run.failed" &&
      event.type !== "tool.failed" &&
      event.type !== "workspace.blocked"
    ) {
      continue;
    }
    const code = string(event.data?.code);
    const detail = string(event.data?.detail);
    if (code && !isGenericFailureText(code)) {
      const explained = explainAgentsOneRemoteGatewayError(code);
      return detail && !isGenericFailureText(detail)
        ? `${explained} 详细信息：${detail}`
        : explained;
    }
    const candidates = [
      string(event.data?.error),
      detail,
      string(event.data?.summary),
      string(event.data?.text),
      string(event.data?.reasoningSummary),
    ];
    const message = candidates.find(
      (candidate): candidate is string =>
        Boolean(candidate) && !isGenericFailureText(candidate),
    );
    if (message) {
      return explainAgentsOneRemoteGatewayError(message);
    }
  }
  return undefined;
}

function runEnvelopeFrom(value: unknown): {
  envelope: Record<string, unknown> | null;
  root: Record<string, unknown> | null;
} {
  const envelope = object(value);
  if (!envelope) return { envelope: null, root: null };
  const data = object(envelope.data);
  const dataLooksLikeRun = Boolean(
    data &&
      (string(data.id) || string(data.runId)),
  );
  const root =
    object(envelope.run) ||
    object(data?.run) ||
    (dataLooksLikeRun ? data : null) ||
    envelope;
  return { envelope, root };
}

function gatewayRunFrom(value: unknown): AgentsOneRemoteGatewayRun {
  const { envelope, root } = runEnvelopeFrom(value);
  const id = string(root?.id) || string(root?.runId);
  const status = runStatus(root?.status);
  if (!root || !id || !status) {
    throw new Error("Gateway 返回了无效的运行记录。");
  }
  const events = parseAgentEventStreamEvents(
    root.events || envelope?.events || object(envelope?.data)?.events,
  );
  const output = outputFrom(root) || finalAssistantOutputFrom(events);
  const conversationId = string(root.conversationId);
  const explicitError =
    errorMessageFrom(root.error) ||
    errorMessageFrom(root.failure) ||
    errorMessageFrom(root.details);
  const eventError = eventFailureMessage(events);
  const genericError =
    explicitError?.toLowerCase() === status || isGenericFailureText(explicitError);
  // Some adapters return `error: "failed"` without the actual cause. Prefer
  // the durable failed event, and always provide a useful diagnostic instead
  // of rendering a bare status word in the conversation.
  const message =
    status === "succeeded"
      ? undefined
      : (genericError ? eventError : explicitError && explainAgentsOneRemoteGatewayError(explicitError)) ||
        eventError ||
        (status === "failed" ? "Gateway 运行失败，但未返回错误详情。" : undefined);
  const artifacts = mergeArtifacts(
    artifactsFrom(root.artifacts),
    artifactsFromEvents(events),
    artifactsFromOutput(output),
  );
  const model = modelFromRoot(root) || latestEventModel(events);
  const usage = usageFromRoot(root) || latestEventUsage(events);
  return {
    id,
    status,
    ...(output ? { output } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(message ? { error: message } : {}),
    ...(artifacts ? { artifacts } : {}),
    ...(events.length ? { events } : {}),
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
  };
}

function eventStreamFrom(value: unknown): AgentEventStreamSupport | undefined {
  const source = object(value);
  if (!source || source.protocol !== AGENT_EVENT_STREAM_V1) return undefined;
  const transport = string(source.transport);
  if (transport !== "sse" && transport !== "poll" && transport !== "websocket") {
    return undefined;
  }
  return {
    protocol: AGENT_EVENT_STREAM_V1,
    transport,
    ...(bool(source.reasoningSummaries) ? { reasoningSummaries: true } : {}),
    ...(bool(source.toolEvents) ? { toolEvents: true } : {}),
    ...(bool(source.modelMetadata) ? { modelMetadata: true } : {}),
    ...(bool(source.usageMetadata) ? { usageMetadata: true } : {}),
  };
}

function pluginFrom(
  root: Record<string, unknown>,
  capabilities: Record<string, unknown>,
): AgentRuntimePluginInfo | undefined {
  // pluginInfo is accepted during the SDK migration. Canonical gateways
  // should publish the same object as `plugin` at the response root.
  const pluginValue =
    root.plugin ??
    capabilities.plugin ??
    root.pluginInfo ??
    capabilities.pluginInfo;
  const plugin = object(pluginValue);
  const id =
    string(plugin?.id) ||
    string(plugin?.name) ||
    string(plugin?.packageName) ||
    string(root.pluginId) ||
    string(root.pluginName) ||
    (typeof pluginValue === "string" ? string(pluginValue) : undefined);
  const version =
    string(plugin?.version) ||
    string(plugin?.pluginVersion) ||
    string(root.pluginVersion);
  if (!id && !version) return undefined;
  const kind = string(plugin?.kind) || string(root.pluginKind);
  return {
    id: id || "agents-one-plugin",
    ...(version ? { version } : {}),
    ...(kind === "remote-gateway" || kind === "cli-adapter" ? { kind } : {}),
  };
}

function capabilitiesFrom(value: unknown): AgentRuntimeCapabilities | null {
  const root = object(value);
  if (!root || typeof root.protocolVersion !== "string") return null;
  if (!/^1(?:\.|$)/.test(root.protocolVersion)) return null;
  const capabilities = object(root.capabilities);
  if (!capabilities) return null;
  const conversation = object(capabilities.conversation);
  const tasks = object(capabilities.tasks);
  const orchestration = object(capabilities.orchestration);
  const eventStream = eventStreamFrom(
    capabilities.eventStream || conversation?.eventStream,
  );
  const plugin = pluginFrom(root, capabilities);
  const nestedWorkspaceGateway = object(
    capabilities.outboundWorkspaceGateway,
  );
  // The original Workspace Gateway rollout exposed the feature as a flat
  // boolean plus sibling fields. Keep that shape compatible while remote
  // plugins move to the canonical nested capability object.
  const outboundWorkspaceGateway =
    nestedWorkspaceGateway ||
    (capabilities.outboundWorkspaceGateway === true ? capabilities : undefined);
  const workspaceOperations = Array.isArray(
    outboundWorkspaceGateway?.operations,
  )
    ? outboundWorkspaceGateway.operations.filter(
        (operation): operation is string => typeof operation === "string",
      )
    : [];
  const workspaceGatewayEnabled = nestedWorkspaceGateway
    ? bool(outboundWorkspaceGateway?.enabled)
    : capabilities.outboundWorkspaceGateway === true;
  const maxGrantSeconds = outboundWorkspaceGateway?.maxGrantSeconds;
  const grantLifetimeSupported =
    maxGrantSeconds === undefined ||
    maxGrantSeconds === null ||
    (typeof maxGrantSeconds === "number" && maxGrantSeconds > 0);
  const workspaceAccess =
    workspaceGatewayEnabled &&
    ["list", "read", "write", "move", "delete"].every((operation) =>
      workspaceOperations.includes(operation),
    ) &&
    typeof outboundWorkspaceGateway?.maxOperationBytes === "number" &&
    outboundWorkspaceGateway.maxOperationBytes > 0 &&
    grantLifetimeSupported;
  return {
    chat: Boolean(conversation),
    taskDispatch: bool(tasks?.start),
    streaming:
      conversation?.stream === "sse" ||
      conversation?.stream === "websocket" ||
      Boolean(eventStream),
    cancellation: bool(tasks?.cancel),
    tools: bool(capabilities.tools),
    memory: bool(capabilities.memory),
    orchestration: Boolean(orchestration),
    readOnlyPlanning: bool(orchestration?.readOnlyPlanning),
    mailbox: bool(capabilities.mailbox),
    securityEvents: bool(capabilities.securityEvents),
    artifacts: Boolean(
      object(capabilities.artifacts)?.upload ||
      object(capabilities.artifacts)?.download,
    ),
    artifactUpload: bool(object(capabilities.artifacts)?.upload),
    workspaceAccess,
    ...(eventStream ? { eventStream } : {}),
    ...(plugin ? { plugin } : {}),
  };
}

/** Probe only the public v1 contract. It never exposes the endpoint token. */
export async function probeAgentsOneRemoteGateway(
  config: AgentsOneRemoteGatewayConfig,
  auth?: AgentsOneRemoteGatewayAuth,
): Promise<AgentsOneRemoteGatewayProbe> {
  if (!config.endpoint.trim()) {
    return {
      healthy: false,
      capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
      message: "统一 Gateway 地址不能为空。",
    };
  }
  try {
    const response = await requestJson(config, "/capabilities", auth);
    if (!response.ok) {
      return {
        healthy: false,
        capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
        message:
          response.status === 401 || response.status === 403
            ? "Gateway Token 无效或无权访问。"
            : `Gateway capabilities 请求失败（HTTP ${response.status}）。`,
      };
    }
    const capabilities = capabilitiesFrom(response.body);
    if (!capabilities) {
      return {
        healthy: false,
        capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
        message: "该服务不是兼容的 Agents One Remote Gateway v1。",
      };
    }
    const pluginMessage = capabilities.plugin?.version
      ? `已识别 Agents One 插件 v${capabilities.plugin.version}。`
      : capabilities.plugin
        ? "已识别 Agents One 插件，但未声明版本。"
        : "未声明 Agents One 插件信息。";
    return {
      healthy: true,
      capabilities,
      message: `统一 Gateway v1 已连接。${pluginMessage}`,
    };
  } catch {
    return {
      healthy: false,
      capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
      message: "无法连接统一 Gateway；请检查地址、Relay 在线状态和网络。",
    };
  }
}

/** Start one v1 run. Vendor-specific transport stays entirely behind the Gateway. */
export async function startAgentsOneRemoteGatewayRun(
  config: AgentsOneRemoteGatewayConfig,
  input: AgentsOneRemoteGatewayRunInput,
  auth?: AgentsOneRemoteGatewayAuth,
): Promise<AgentsOneRemoteGatewayRun> {
  // A Workspace Grant is scoped to one run. Keep continuation context through
  // conversationId, but use task mode so the Relay mounts this run's tools.
  const mode = input.workspaceRef ? "task" : input.mode;
  const response = await requestJson(config, "/runs", auth, {
    method: "POST",
    body: {
      ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
      mode,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      input: {
        text: input.text,
        // Keep the stable route ID in the nested payload as well. The v1
        // field is top-level, but older remote adapters commonly inspect the
        // provider input object instead of the complete request envelope.
        ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
        ...(input.artifactIds?.length
          ? { artifactIds: input.artifactIds, artifact_ids: input.artifactIds }
          : {}),
        ...(input.workspaceRef ? { workspaceRef: input.workspaceRef } : {}),
      },
      execution: {
        timeoutSeconds: input.timeoutSeconds,
        permission: input.permission,
      },
    },
  });
  if (!response.ok) {
    const detail = errorMessageFrom(response.body);
    throw new Error(
      `Gateway 启动运行失败（HTTP ${response.status}）${detail ? `：${detail}` : "。"}`,
    );
  }
  return gatewayRunFrom(response.body);
}

const MAX_ARTIFACT_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ARTIFACT_DOWNLOAD_BYTES = 25 * 1024 * 1024;

function artifactFrom(value: unknown): AgentsOneRemoteGatewayArtifact {
  const root = object(value);
  const artifact = object(root?.artifact) || root;
  const id = string(artifact?.id);
  const name = string(artifact?.name);
  const mime = string(artifact?.mime) || "application/octet-stream";
  const size = typeof artifact?.size === "number" ? artifact.size : 0;
  if (!id || !name || size < 0) {
    throw new Error("Gateway 返回了无效的附件记录。");
  }
  return {
    id,
    name,
    mime,
    size,
    ...(string(artifact?.sha256) ? { sha256: string(artifact?.sha256) } : {}),
    ...(string(artifact?.expiresAt) || string(artifact?.expires_at)
      ? { expiresAt: string(artifact?.expiresAt) || string(artifact?.expires_at) }
      : {}),
  };
}

export async function uploadAgentsOneRemoteGatewayArtifact(
  config: AgentsOneRemoteGatewayConfig,
  input: AgentsOneRemoteGatewayArtifactUploadInput,
  auth?: AgentsOneRemoteGatewayAuth,
): Promise<AgentsOneRemoteGatewayArtifact> {
  if (
    !input.name.trim() ||
    input.name.length > 160 ||
    /[\x00-\x1F<>:"/\\|?*]/.test(input.name) // eslint-disable-line no-control-regex
  ) {
    throw new Error("附件名称无效。");
  }
  if (!input.mime.trim() || input.mime.length > 160) {
    throw new Error("附件 MIME 类型无效。");
  }
  if (
    !Buffer.isBuffer(input.bytes) ||
    !input.bytes.length ||
    input.bytes.length > MAX_ARTIFACT_UPLOAD_BYTES
  ) {
    throw new Error("附件大小超出 Gateway 上传限制。");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.sha256)) {
    throw new Error("附件 SHA-256 校验值无效。");
  }
  const response = await requestJson(config, "/artifacts", auth, {
    method: "POST",
    body: {
      name: input.name.trim(),
      mime: input.mime,
      size: input.bytes.length,
      sha256: input.sha256.toLowerCase(),
      contentBase64: input.bytes.toString("base64"),
      content_base64: input.bytes.toString("base64"),
    },
  });
  if (!response.ok) {
    const detail = errorMessageFrom(response.body);
    throw new Error(
      `Gateway 上传附件失败（HTTP ${response.status}）${detail ? `：${detail}` : "。"}`,
    );
  }
  return artifactFrom(response.body);
}

function artifactContentBase64(value: unknown): string | undefined {
  const root = object(value);
  const artifact = object(root?.artifact);
  return (
    string(root?.contentBase64) ||
    string(root?.content_base64) ||
    string(artifact?.contentBase64) ||
    string(artifact?.content_base64)
  );
}

function decodeArtifactBytes(value: string): Buffer {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Gateway 返回的附件内容不是有效的 Base64。");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MAX_ARTIFACT_DOWNLOAD_BYTES) {
    throw new Error("Gateway 附件大小超出本机暂存限制。");
  }
  return bytes;
}

export async function getAgentsOneRemoteGatewayArtifact(
  config: AgentsOneRemoteGatewayConfig,
  artifactId: string,
  auth?: AgentsOneRemoteGatewayAuth,
): Promise<AgentsOneRemoteGatewayArtifactDownload> {
  if (!artifactId || typeof artifactId !== "string" || artifactId.length > 256) {
    throw new Error("附件 id 无效。");
  }
  const response = await requestJson(
    config,
    `/artifacts/${encodeURIComponent(artifactId)}`,
    auth,
  );
  if (!response.ok) {
    const detail = errorMessageFrom(response.body);
    throw new Error(
      `Gateway 下载附件失败（HTTP ${response.status}）${detail ? `：${detail}` : "。"}`,
    );
  }
  const metadata = artifactFrom(response.body);
  const content = artifactContentBase64(response.body);
  if (!content) throw new Error("Gateway 仅返回了附件元数据，未返回可下载内容。");
  const bytes = decodeArtifactBytes(content);
  if (metadata.size > 0 && metadata.size !== bytes.length) {
    throw new Error("Gateway 附件大小校验失败。");
  }
  if (metadata.sha256) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual.toLowerCase() !== metadata.sha256.toLowerCase()) {
      throw new Error("Gateway 附件 SHA-256 校验失败。");
    }
  }
  return { ...metadata, size: bytes.length, bytes };
}

export async function getAgentsOneRemoteGatewayRun(
  config: AgentsOneRemoteGatewayConfig,
  runId: string,
  auth?: AgentsOneRemoteGatewayAuth,
): Promise<AgentsOneRemoteGatewayRun> {
  const response = await requestJson(
    config,
    `/runs/${encodeURIComponent(runId)}`,
    auth,
  );
  if (!response.ok) {
    const detail = errorMessageFrom(response.body);
    throw new Error(
      `Gateway 查询运行失败（HTTP ${response.status}）${detail ? `：${detail}` : "。"}`,
    );
  }
  return gatewayRunFrom(response.body);
}

export async function cancelAgentsOneRemoteGatewayRun(
  config: AgentsOneRemoteGatewayConfig,
  runId: string,
  auth?: AgentsOneRemoteGatewayAuth,
): Promise<AgentsOneRemoteGatewayRun> {
  const response = await requestJson(
    config,
    `/runs/${encodeURIComponent(runId)}/cancel`,
    auth,
    { method: "POST", body: {} },
  );
  if (!response.ok) {
    const detail = errorMessageFrom(response.body);
    throw new Error(
      `Gateway 取消运行失败（HTTP ${response.status}）${detail ? `：${detail}` : "。"}`,
    );
  }
  return gatewayRunFrom(response.body);
}
