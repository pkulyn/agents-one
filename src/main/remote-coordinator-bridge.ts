import { randomUUID } from "crypto";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import {
  NO_AGENT_RUNTIME_CAPABILITIES,
  type AgentRuntimeArtifact,
  type AgentRuntimeCapabilities,
} from "../shared/agent-runtimes";

export interface RemoteCoordinatorConfig {
  endpoint: string;
  timeoutMs?: number;
}

export interface RemoteCoordinatorAuth {
  bearerToken?: string;
}

export interface RemoteCoordinatorProbeResult {
  state: "healthy" | "unhealthy" | "not_found";
  capabilities: AgentRuntimeCapabilities;
  message?: string;
}

export interface RemoteCoordinatorPlanInput {
  projectId: string;
  request: string;
  context: {
    title: string;
    requirements: string;
    workspace?: string;
    existingTasks?: Array<{
      id: string;
      title: string;
      status: string;
      runtimeId?: string;
    }>;
  };
  timeoutSeconds?: number;
}

export interface RemoteCoordinatorPlan {
  id: string;
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "cancelling"
    | "timed_out";
  output?: string;
  error?: string;
  cleanedUp?: boolean;
  plan?: unknown;
  artifacts?: AgentRuntimeArtifact[];
  enforced?: {
    toolPolicy?: string;
    filesystem?: string;
    network?: string;
    timeoutSeconds?: number;
  };
}

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential|auth|cookie)/i;
const COORDINATOR_CAPABILITIES: AgentRuntimeCapabilities = {
  ...NO_AGENT_RUNTIME_CAPABILITIES,
  chat: true,
  taskDispatch: true,
  cancellation: true,
  artifacts: true,
};

class RemoteCoordinatorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteCoordinatorValidationError";
  }
}

export class RemoteCoordinatorHttpError extends Error {
  constructor(readonly status: number) {
    super(`Remote coordinator Bridge returned HTTP ${status}.`);
    this.name = "RemoteCoordinatorHttpError";
  }
}

class RemoteCoordinatorTimeoutError extends Error {
  constructor() {
    super("Remote coordinator Bridge request timed out.");
    this.name = "RemoteCoordinatorTimeoutError";
  }
}

function assertNoSecretKeys(value: unknown, label: string): void {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new RemoteCoordinatorValidationError(
        `${label} must not include secret or credential fields.`,
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timeoutMsFromConfig(config: RemoteCoordinatorConfig): number {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new RemoteCoordinatorValidationError(
      "Remote coordinator timeoutMs must be between 1000 and 600000.",
    );
  }
  return timeoutMs;
}

function endpointUrlFromConfig(config: RemoteCoordinatorConfig): URL {
  assertNoSecretKeys(config, "Remote coordinator config");
  if (!config.endpoint || typeof config.endpoint !== "string") {
    throw new RemoteCoordinatorValidationError(
      "Remote coordinator endpoint must be an http/https URL.",
    );
  }

  let url: URL;
  try {
    url = new URL(config.endpoint);
  } catch {
    throw new RemoteCoordinatorValidationError(
      "Remote coordinator endpoint must be an http/https URL.",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RemoteCoordinatorValidationError(
      "Remote coordinator endpoint must use http or https.",
    );
  }
  if (url.username || url.password) {
    throw new RemoteCoordinatorValidationError(
      "Remote coordinator endpoint must not include credentials.",
    );
  }
  if (url.search || url.hash) {
    throw new RemoteCoordinatorValidationError(
      "Remote coordinator endpoint must not include query strings or fragments.",
    );
  }
  return url;
}

function coordinatorUrl(config: RemoteCoordinatorConfig, segments: string[]): URL {
  const url = endpointUrlFromConfig(config);
  const basePath = url.pathname.replace(/\/+$/, "");
  const path = segments.map((segment) => encodeURIComponent(segment)).join("/");
  url.pathname = `${basePath}/${path}`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

function headersFrom(init: RequestInit, bearerToken?: string): Record<string, string> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (bearerToken) headers.set("Authorization", `Bearer ${bearerToken}`);
  return Object.fromEntries(headers.entries());
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof RemoteCoordinatorHttpError) {
    return `Remote coordinator Bridge returned HTTP ${error.status}.`;
  }
  if (error instanceof RemoteCoordinatorTimeoutError) {
    return "Remote coordinator Bridge request timed out.";
  }
  return "Remote coordinator Bridge request failed.";
}

function isSelfSignedCertificateError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  return code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "SELF_SIGNED_CERT_IN_CHAIN";
}

async function requestJsonOnce<T>(
  url: URL,
  timeoutMs: number,
  init: RequestInit,
  bearerToken: string | undefined,
  rejectUnauthorized: boolean | undefined,
): Promise<T> {
  const body = typeof init.body === "string" ? init.body : undefined;
  return new Promise<T>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: init.method || "GET",
        headers: headersFrom(init, bearerToken),
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
          if (status < 200 || status >= 300) {
            reject(new RemoteCoordinatorHttpError(status));
            return;
          }
          if (status === 204) {
            resolve(undefined as T);
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
          } catch {
            reject(new Error("Remote coordinator Bridge returned invalid JSON."));
          }
        });
      },
    );
    request.once("error", reject);
    request.setTimeout(timeoutMs, () => request.destroy(new RemoteCoordinatorTimeoutError()));
    if (body) request.write(body);
    request.end();
  });
}

async function requestJson<T>(
  config: RemoteCoordinatorConfig,
  segments: string[],
  init: RequestInit = {},
  auth?: RemoteCoordinatorAuth,
): Promise<T> {
  const url = coordinatorUrl(config, segments);
  const timeoutMs = timeoutMsFromConfig(config);
  const bearerToken = auth?.bearerToken?.trim();
  if (bearerToken && /[\r\n]/.test(bearerToken)) {
    throw new RemoteCoordinatorValidationError("Remote coordinator credential is invalid.");
  }

  try {
    try {
      return await requestJsonOnce<T>(url, timeoutMs, init, bearerToken, undefined);
    } catch (error) {
      if (url.protocol === "https:" && isSelfSignedCertificateError(error)) {
        return await requestJsonOnce<T>(url, timeoutMs, init, bearerToken, false);
      }
      throw error;
    }
  } catch (error) {
    if (
      error instanceof RemoteCoordinatorValidationError ||
      error instanceof RemoteCoordinatorHttpError ||
      error instanceof RemoteCoordinatorTimeoutError
    ) {
      throw error;
    }
    throw new Error("Remote coordinator Bridge request failed.");
  }
}

function capabilitiesFromResponse(value: unknown): AgentRuntimeCapabilities | null {
  if (!isRecord(value)) return null;
  return {
    ...COORDINATOR_CAPABILITIES,
    chat: Boolean(value.chat ?? COORDINATOR_CAPABILITIES.chat),
    taskDispatch: Boolean(value.taskDispatch ?? COORDINATOR_CAPABILITIES.taskDispatch),
    streaming: Boolean(value.streaming ?? COORDINATOR_CAPABILITIES.streaming),
    cancellation: Boolean(value.cancellation ?? COORDINATOR_CAPABILITIES.cancellation),
    tools: Boolean(value.tools ?? COORDINATOR_CAPABILITIES.tools),
    memory: Boolean(value.memory ?? COORDINATOR_CAPABILITIES.memory),
    orchestration: Boolean(value.orchestration ?? COORDINATOR_CAPABILITIES.orchestration),
    readOnlyPlanning: Boolean(value.readOnlyPlanning ?? COORDINATOR_CAPABILITIES.readOnlyPlanning),
    mailbox: Boolean(value.mailbox ?? COORDINATOR_CAPABILITIES.mailbox),
    securityEvents: Boolean(value.securityEvents ?? COORDINATOR_CAPABILITIES.securityEvents),
    artifacts: Boolean(value.artifacts ?? COORDINATOR_CAPABILITIES.artifacts),
    workspaceAccess: Boolean(value.workspaceAccess ?? COORDINATOR_CAPABILITIES.workspaceAccess),
  };
}

export async function probeRemoteCoordinatorBridge(
  config: RemoteCoordinatorConfig,
  auth?: RemoteCoordinatorAuth,
): Promise<RemoteCoordinatorProbeResult> {
  endpointUrlFromConfig(config);
  timeoutMsFromConfig(config);
  try {
    const response = await requestJson<{
      capabilities?: unknown;
      message?: unknown;
    }>(config, ["capabilities"], {}, auth);
    const capabilities = capabilitiesFromResponse(response.capabilities);
    if (!capabilities) {
      return {
        state: "unhealthy",
        capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
        message: "Remote coordinator Bridge returned no capabilities.",
      };
    }
    return {
      state: "healthy",
      capabilities,
      message: typeof response.message === "string" ? response.message : undefined,
    };
  } catch (error) {
    if (error instanceof RemoteCoordinatorValidationError) throw error;
    if (error instanceof RemoteCoordinatorHttpError && error.status === 404) {
      return {
        state: "not_found",
        capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
        message: "Remote coordinator Bridge capabilities endpoint was not found.",
      };
    }
    return {
      state: "unhealthy",
      capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
      message: safeErrorMessage(error),
    };
  }
}

function planBodyFromInput(input: RemoteCoordinatorPlanInput): string {
  assertNoSecretKeys(input, "Remote coordinator plan input");
  if (!input.projectId || typeof input.projectId !== "string") {
    throw new RemoteCoordinatorValidationError("Remote coordinator projectId is required.");
  }
  if (!input.request || typeof input.request !== "string") {
    throw new RemoteCoordinatorValidationError("Remote coordinator plan request is required.");
  }
  if (!isRecord(input.context)) {
    throw new RemoteCoordinatorValidationError("Remote coordinator plan context is required.");
  }
  return JSON.stringify({
    projectId: input.projectId,
    request: input.request,
    context: input.context,
    constraints: {
      toolPolicy: "disabled",
      filesystem: "disabled",
      network: "disabled",
      maxOutputChars: 20_000,
      timeoutSeconds: input.timeoutSeconds ?? 120,
    },
  });
}

function normalizeArtifacts(value: unknown): AgentRuntimeArtifact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AgentRuntimeArtifact[] => {
    if (!isRecord(item)) return [];
    const kind = item.kind === "diff" || item.kind === "worktree" || item.kind === "final"
      ? item.kind
      : "final";
    const label = typeof item.label === "string" && item.label.trim()
      ? item.label.trim()
      : "Remote artifact";
    const path = typeof item.path === "string" ? item.path : undefined;
    const content = typeof item.content === "string" ? item.content : undefined;
    return [{ kind, label, ...(path ? { path } : {}), ...(content ? { content } : {}) }];
  });
}

function normalizePlanResponse(value: unknown): RemoteCoordinatorPlan {
  if (!isRecord(value)) {
    throw new Error("Remote coordinator Bridge returned an invalid plan response.");
  }
  const id = typeof value.id === "string"
    ? value.id
    : typeof value.planId === "string"
      ? value.planId
      : undefined;
  const status = typeof value.status === "string" ? value.status : undefined;
  if (!id || !status) {
    throw new Error("Remote coordinator Bridge returned an invalid plan response.");
  }
  const normalizedStatus = status.toLowerCase() as RemoteCoordinatorPlan["status"];
  const enforced = isRecord(value.enforced)
    ? {
        toolPolicy:
          typeof value.enforced.toolPolicy === "string"
            ? value.enforced.toolPolicy
            : undefined,
        filesystem:
          typeof value.enforced.filesystem === "string"
            ? value.enforced.filesystem
            : undefined,
        network:
          typeof value.enforced.network === "string"
            ? value.enforced.network
            : undefined,
        timeoutSeconds:
          typeof value.enforced.timeoutSeconds === "number"
            ? value.enforced.timeoutSeconds
            : undefined,
      }
    : undefined;
  const output = typeof value.output === "string"
    ? value.output
    : typeof value.summary === "string"
      ? value.summary
      : value.plan
        ? JSON.stringify(value.plan, null, 2)
        : undefined;
  return {
    id,
    status: normalizedStatus,
    output,
    error: typeof value.error === "string" ? value.error : undefined,
    cleanedUp: typeof value.cleanedUp === "boolean" ? value.cleanedUp : undefined,
    plan: value.plan,
    artifacts: normalizeArtifacts(value.artifacts),
    ...(enforced ? { enforced } : {}),
  };
}

function assertReadOnlyEnforcement(plan: RemoteCoordinatorPlan): void {
  const enforced = plan.enforced;
  if (
    !enforced ||
    enforced.toolPolicy !== "disabled" ||
    enforced.filesystem !== "disabled" ||
    enforced.network !== "disabled"
  ) {
    throw new RemoteCoordinatorValidationError(
      "Remote coordinator Bridge did not confirm enforced read-only planning.",
    );
  }
}

export async function startRemoteCoordinatorPlan(
  config: RemoteCoordinatorConfig,
  input: RemoteCoordinatorPlanInput,
  auth?: RemoteCoordinatorAuth,
): Promise<RemoteCoordinatorPlan> {
  const response = await requestJson<unknown>(
    config,
    ["orchestration", "plans"],
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: planBodyFromInput(input),
    },
    auth,
  );
  const plan = normalizePlanResponse(response);
  assertReadOnlyEnforcement(plan);
  return plan;
}

export async function getRemoteCoordinatorPlan(
  config: RemoteCoordinatorConfig,
  planId: string,
  auth?: RemoteCoordinatorAuth,
): Promise<RemoteCoordinatorPlan> {
  if (!planId || typeof planId !== "string") {
    throw new RemoteCoordinatorValidationError("Remote coordinator plan id is required.");
  }
  const response = await requestJson<unknown>(
    config,
    ["orchestration", "plans", planId],
    {},
    auth,
  );
  return normalizePlanResponse(response);
}

export async function cancelRemoteCoordinatorPlan(
  config: RemoteCoordinatorConfig,
  planId: string,
  auth?: RemoteCoordinatorAuth,
): Promise<RemoteCoordinatorPlan> {
  if (!planId || typeof planId !== "string") {
    throw new RemoteCoordinatorValidationError("Remote coordinator plan id is required.");
  }
  const response = await requestJson<unknown>(
    config,
    ["orchestration", "plans", planId, "cancel"],
    { method: "POST" },
    auth,
  );
  return normalizePlanResponse(response);
}
