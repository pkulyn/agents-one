export interface OpenClawRuntimeConfig {
  endpoint: string;
  timeoutMs?: number;
}

/** Resolved only in the Electron main process; never persisted in runtime config. */
export interface OpenClawRuntimeAuth {
  bearerToken?: string;
}

export interface OpenClawBridgeCapabilities {
  chat: boolean;
  taskDispatch: boolean;
  streaming: boolean;
  cancellation: boolean;
  tools: boolean;
  memory: boolean;
  orchestration: boolean;
  readOnlyPlanning: boolean;
  mailbox: boolean;
  securityEvents: boolean;
  artifacts: boolean;
  workspaceAccess: boolean;
}

export interface OpenClawRuntimeProbeResult {
  state: "healthy" | "unhealthy";
  capabilities: OpenClawBridgeCapabilities;
  message?: string;
}

export interface OpenClawTaskInput {
  prompt: string;
  profile?: string;
  sessionId?: string;
}

export interface OpenClawBridgeTask {
  id: string;
  status: string;
  output?: string;
  sessionId?: string;
  error?: string;
}

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;

const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential|auth)/i;

export const DEFAULT_OPENCLAW_CAPABILITIES: OpenClawBridgeCapabilities = {
  chat: true,
  taskDispatch: true,
  streaming: false,
  cancellation: true,
  tools: false,
  memory: false,
  orchestration: false,
  readOnlyPlanning: false,
  mailbox: false,
  securityEvents: false,
  artifacts: false,
  workspaceAccess: false,
};

const UNHEALTHY_OPENCLAW_CAPABILITIES: OpenClawBridgeCapabilities = {
  chat: false,
  taskDispatch: false,
  streaming: false,
  cancellation: false,
  tools: false,
  memory: false,
  orchestration: false,
  readOnlyPlanning: false,
  mailbox: false,
  securityEvents: false,
  artifacts: false,
  workspaceAccess: false,
};

class OpenClawRuntimeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawRuntimeValidationError";
  }
}

class OpenClawRuntimeHttpError extends Error {
  constructor(readonly status: number) {
    super(`OpenClaw runtime request failed with HTTP ${status}.`);
    this.name = "OpenClawRuntimeHttpError";
  }
}

class OpenClawRuntimeTimeoutError extends Error {
  constructor() {
    super("OpenClaw runtime request timed out.");
    this.name = "OpenClawRuntimeTimeoutError";
  }
}

function assertNoSecretKeys(value: unknown, label: string): void {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new OpenClawRuntimeValidationError(
        `${label} must not include secret or credential fields.`,
      );
    }
  }
}

function timeoutMsFromConfig(config: OpenClawRuntimeConfig): number {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new OpenClawRuntimeValidationError(
      "OpenClaw runtime timeoutMs must be between 1000 and 600000.",
    );
  }
  return timeoutMs;
}

function endpointUrlFromConfig(config: OpenClawRuntimeConfig): URL {
  assertNoSecretKeys(config, "OpenClaw runtime config");
  if (!config.endpoint || typeof config.endpoint !== "string") {
    throw new OpenClawRuntimeValidationError(
      "OpenClaw runtime endpoint must be an http/https URL.",
    );
  }

  let url: URL;
  try {
    url = new URL(config.endpoint);
  } catch {
    throw new OpenClawRuntimeValidationError(
      "OpenClaw runtime endpoint must be an http/https URL.",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OpenClawRuntimeValidationError(
      "OpenClaw runtime endpoint must use http or https.",
    );
  }
  if (url.username || url.password) {
    throw new OpenClawRuntimeValidationError(
      "OpenClaw runtime endpoint must not include credentials.",
    );
  }
  if (url.search || url.hash) {
    throw new OpenClawRuntimeValidationError(
      "OpenClaw runtime endpoint must not include query strings or fragments.",
    );
  }

  return url;
}

function openClawUrl(config: OpenClawRuntimeConfig, segments: string[]): URL {
  const url = endpointUrlFromConfig(config);
  const basePath = url.pathname.replace(/\/+$/, "");
  const path = segments.map((segment) => encodeURIComponent(segment)).join("/");
  url.pathname = `${basePath}/${path}`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof OpenClawRuntimeHttpError) {
    return `OpenClaw runtime returned HTTP ${error.status}.`;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "OpenClaw runtime request timed out.";
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "OpenClaw runtime request timed out.";
  }
  if (error instanceof OpenClawRuntimeTimeoutError) {
    return "OpenClaw runtime request timed out.";
  }
  return "OpenClaw runtime request failed.";
}

function headersFrom(init: RequestInit, bearerToken?: string): Record<string, string> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (bearerToken) headers.set("Authorization", `Bearer ${bearerToken}`);
  return Object.fromEntries(headers.entries());
}

export function isSelfSignedCertificateError(error: unknown): boolean {
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
            reject(new OpenClawRuntimeHttpError(status));
            return;
          }
          if (status === 204) {
            resolve(undefined as T);
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
          } catch {
            reject(new Error("OpenClaw runtime returned invalid JSON."));
          }
        });
      },
    );
    request.once("error", reject);
    request.setTimeout(timeoutMs, () => request.destroy(new OpenClawRuntimeTimeoutError()));
    if (body) request.write(body);
    request.end();
  });
}

async function requestJson<T>(
  config: OpenClawRuntimeConfig,
  segments: string[],
  init: RequestInit = {},
  auth?: OpenClawRuntimeAuth,
): Promise<T> {
  const url = openClawUrl(config, segments);
  const timeoutMs = timeoutMsFromConfig(config);
  const bearerToken = auth?.bearerToken?.trim();
  if (bearerToken && /[\r\n]/.test(bearerToken)) {
    throw new OpenClawRuntimeValidationError("OpenClaw runtime credential is invalid.");
  }

  try {
    try {
      return await requestJsonOnce<T>(url, timeoutMs, init, bearerToken, undefined);
    } catch (error) {
      // A self-signed NAS certificate can be trusted only after the user has
      // explicitly configured this exact OpenClaw Bridge endpoint. Retry this
      // one request without CA verification; all other TLS errors stay strict.
      if (url.protocol === "https:" && isSelfSignedCertificateError(error)) {
        return await requestJsonOnce<T>(url, timeoutMs, init, bearerToken, false);
      }
      throw error;
    }
  } catch (error) {
    if (
      error instanceof OpenClawRuntimeValidationError ||
      error instanceof OpenClawRuntimeHttpError
    ) {
      throw error;
    }
    if (error instanceof OpenClawRuntimeTimeoutError) {
      throw error;
    }
    throw new Error("OpenClaw runtime request failed.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function capabilitiesFromResponse(
  value: unknown,
): OpenClawBridgeCapabilities | null {
  if (!isRecord(value)) return null;
  return {
    ...DEFAULT_OPENCLAW_CAPABILITIES,
    chat: Boolean(value.chat ?? DEFAULT_OPENCLAW_CAPABILITIES.chat),
    taskDispatch: Boolean(
      value.taskDispatch ?? DEFAULT_OPENCLAW_CAPABILITIES.taskDispatch,
    ),
    streaming: Boolean(
      value.streaming ?? DEFAULT_OPENCLAW_CAPABILITIES.streaming,
    ),
    cancellation: Boolean(
      value.cancellation ?? DEFAULT_OPENCLAW_CAPABILITIES.cancellation,
    ),
    tools: Boolean(value.tools ?? DEFAULT_OPENCLAW_CAPABILITIES.tools),
    memory: Boolean(value.memory ?? DEFAULT_OPENCLAW_CAPABILITIES.memory),
    orchestration: Boolean(
      value.orchestration ?? DEFAULT_OPENCLAW_CAPABILITIES.orchestration,
    ),
    readOnlyPlanning: Boolean(
      value.readOnlyPlanning ?? DEFAULT_OPENCLAW_CAPABILITIES.readOnlyPlanning,
    ),
    mailbox: Boolean(value.mailbox ?? DEFAULT_OPENCLAW_CAPABILITIES.mailbox),
    securityEvents: Boolean(
      value.securityEvents ?? DEFAULT_OPENCLAW_CAPABILITIES.securityEvents,
    ),
    artifacts: Boolean(
      value.artifacts ?? DEFAULT_OPENCLAW_CAPABILITIES.artifacts,
    ),
    workspaceAccess: Boolean(
      value.workspaceAccess ?? DEFAULT_OPENCLAW_CAPABILITIES.workspaceAccess,
    ),
  };
}

function normalizeTaskResponse(value: unknown): OpenClawBridgeTask {
  if (!isRecord(value)) {
    throw new Error("OpenClaw runtime returned an invalid task response.");
  }

  const id = typeof value.id === "string" ? value.id : undefined;
  const status = typeof value.status === "string" ? value.status : undefined;
  if (!id || !status) {
    throw new Error("OpenClaw runtime returned an invalid task response.");
  }

  return {
    id,
    status,
    output: typeof value.output === "string" ? value.output : undefined,
    sessionId:
      typeof value.sessionId === "string" ? value.sessionId : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
  };
}

function taskBodyFromInput(input: OpenClawTaskInput): string {
  assertNoSecretKeys(input, "OpenClaw task input");
  if (!input.prompt || typeof input.prompt !== "string") {
    throw new OpenClawRuntimeValidationError(
      "OpenClaw task input prompt is required.",
    );
  }

  return JSON.stringify({
    prompt: input.prompt,
    profile: input.profile,
    sessionId: input.sessionId,
  });
}

export async function probeOpenClawRuntime(
  config: OpenClawRuntimeConfig,
  auth?: OpenClawRuntimeAuth,
): Promise<OpenClawRuntimeProbeResult> {
  endpointUrlFromConfig(config);
  timeoutMsFromConfig(config);

  try {
    // v1 coordination Bridges advertise their contract separately. Older
    // OpenClaw deployments only expose /health, so only a 404 may fall back.
    try {
      const capabilities = await requestJson<{
        capabilities?: unknown;
        message?: unknown;
      }>(config, ["capabilities"], {}, auth);
      const normalized = capabilitiesFromResponse(capabilities?.capabilities);
      if (normalized) {
        return {
          state: "healthy",
          capabilities: normalized,
          message: typeof capabilities?.message === "string" ? capabilities.message : undefined,
        };
      }
    } catch (error) {
      if (!(error instanceof OpenClawRuntimeHttpError && error.status === 404)) throw error;
    }
    const health = await requestJson<{
      capabilities?: unknown;
      message?: unknown;
    }>(config, ["health"], {}, auth);
    return {
      state: "healthy",
      capabilities:
        capabilitiesFromResponse(health?.capabilities) ??
        DEFAULT_OPENCLAW_CAPABILITIES,
      message: typeof health?.message === "string" ? health.message : undefined,
    };
  } catch (error) {
    if (error instanceof OpenClawRuntimeValidationError) {
      throw error;
    }
    return {
      state: "unhealthy",
      capabilities: UNHEALTHY_OPENCLAW_CAPABILITIES,
      message: safeErrorMessage(error),
    };
  }
}

export async function startOpenClawTask(
  config: OpenClawRuntimeConfig,
  input: OpenClawTaskInput,
  auth?: OpenClawRuntimeAuth,
): Promise<OpenClawBridgeTask> {
  const task = await requestJson<unknown>(config, ["tasks"], {
    method: "POST",
    body: taskBodyFromInput(input),
  }, auth);
  return normalizeTaskResponse(task);
}

export async function getOpenClawTask(
  config: OpenClawRuntimeConfig,
  taskId: string,
  auth?: OpenClawRuntimeAuth,
): Promise<OpenClawBridgeTask> {
  if (!taskId || typeof taskId !== "string") {
    throw new OpenClawRuntimeValidationError("OpenClaw task id is required.");
  }
  const task = await requestJson<unknown>(config, ["tasks", taskId], {}, auth);
  return normalizeTaskResponse(task);
}

export async function cancelOpenClawTask(
  config: OpenClawRuntimeConfig,
  taskId: string,
  auth?: OpenClawRuntimeAuth,
): Promise<OpenClawBridgeTask> {
  if (!taskId || typeof taskId !== "string") {
    throw new OpenClawRuntimeValidationError("OpenClaw task id is required.");
  }
  // Cancellation is a state transition, so POST preserves the task resource for
  // later inspection instead of treating cancellation as record deletion.
  const task = await requestJson<unknown>(config, ["tasks", taskId, "cancel"], {
    method: "POST",
  }, auth);
  return normalizeTaskResponse(task);
}
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
