import {
  AGENT_RUNTIME_KINDS,
  NO_AGENT_RUNTIME_CAPABILITIES,
  type AgentRuntimeConfig,
  type AgentRuntimeDefinition,
  type AgentRuntimeDraft,
  type AgentRuntimeProbe,
  type AgentRuntimeRun,
  type AgentRuntimeTaskInput,
} from "../shared/agent-runtimes";
import {
  getConnectionConfig,
  readDesktopConfig,
  writeDesktopConfig,
} from "./config";
import { sendMessage, testRemoteConnection } from "./hermes";
import {
  cancelOpenClawTask,
  getOpenClawTask,
  probeOpenClawRuntime,
  startOpenClawTask,
  type OpenClawBridgeTask,
  type OpenClawRuntimeConfig,
} from "./openclaw-runtime";
import type { OpenClawRuntimeAuth } from "./openclaw-runtime";
import {
  cancelRemoteCoordinatorPlan,
  getRemoteCoordinatorPlan,
  probeRemoteCoordinatorBridge,
  startRemoteCoordinatorPlan,
  type RemoteCoordinatorConfig,
  type RemoteCoordinatorPlan,
} from "./remote-coordinator-bridge";
import { probeCodexRuntime, startCodexProcess } from "./codex-runtime";
import { probeClaudeCodeRuntime, startClaudeCodeProcess } from "./claude-code-runtime";
import { randomUUID } from "crypto";
import { getSecret } from "./secrets";
import { invalidateSecretsCache, setEnvValue } from "./config";

const RUNTIME_CONFIG_KEY = "agentRuntimes";
const RESERVED_RUNTIME_IDS = new Set(["hermes-local", "hermes-remote"]);
const RUNTIME_ID = /^[a-z][a-z0-9-]{1,63}$/;
const SECRET_CONFIG_KEY = /(token|secret|password|api.?key|credential)/i;
const MAX_RUNTIME_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TASK_PROMPT_LENGTH = 100_000;
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RETAINED_RUNS = 100;
const OPENCLAW_BEARER_SECRET_PREFIX = "HERMES_OPENCLAW_RUNTIME_";

interface RuntimeRunRecord {
  run: AgentRuntimeRun;
  timeout?: NodeJS.Timeout;
  abortHandle?: () => void;
  cancelRequested: boolean;
  openClaw?: {
    config: OpenClawRuntimeConfig;
    taskId: string;
  };
  remotePlan?: {
    config: RemoteCoordinatorConfig;
    planId: string;
  };
  codex?: {
    cancel: () => void;
  };
  claudeCode?: {
    cancel: () => void;
  };
}

const runtimeRuns = new Map<string, RuntimeRunRecord>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error("Runtime configuration contains an invalid string value.");
  }
  return value.trim() || undefined;
}

function runtimeConfigFrom(value: unknown): AgentRuntimeConfig {
  if (!isRecord(value)) return {};
  for (const key of Object.keys(value)) {
    if (SECRET_CONFIG_KEY.test(key)) {
      throw new Error("Runtime credentials must use the protected connection store.");
    }
  }
  const transport = value.transport;
  if (transport !== undefined && transport !== "http" && transport !== "cli") {
    throw new Error("Runtime transport must be http or cli.");
  }
  const timeoutMs = value.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1_000 ||
      timeoutMs > MAX_RUNTIME_TIMEOUT_MS)
  ) {
    throw new Error("Runtime timeout must be between 1000 and 600000 milliseconds.");
  }
  return {
    endpoint: optionalString(value.endpoint, 2048),
    transport,
    executablePath: optionalString(value.executablePath, 4096),
    workspace: optionalString(value.workspace, 4096),
    timeoutMs: timeoutMs as number | undefined,
  };
}

function normalizeUserRuntime(value: unknown): AgentRuntimeDefinition | null {
  if (!isRecord(value)) return null;
  const id = optionalString(value.id, 64);
  const name = optionalString(value.name, 80);
  const kind = value.kind;
  const location = value.location;
  if (
    !id ||
    !name ||
    !RUNTIME_ID.test(id) ||
    RESERVED_RUNTIME_IDS.has(id) ||
    !AGENT_RUNTIME_KINDS.includes(kind as (typeof AGENT_RUNTIME_KINDS)[number]) ||
    (location !== "local" && location !== "remote")
  ) {
    return null;
  }
  try {
    return {
      id,
      name,
      kind: kind as AgentRuntimeDefinition["kind"],
      location,
      enabled: value.enabled !== false,
      managed: "user",
      config: runtimeConfigFrom(value.config),
    };
  } catch {
    return null;
  }
}

function userRuntimes(): AgentRuntimeDefinition[] {
  const raw = readDesktopConfig()[RUNTIME_CONFIG_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeUserRuntime)
    .filter((runtime): runtime is AgentRuntimeDefinition => runtime !== null);
}

export function openClawBearerSecretKey(runtimeId: string): string {
  if (!RUNTIME_ID.test(runtimeId)) throw new Error("Runtime ID is invalid.");
  return `${OPENCLAW_BEARER_SECRET_PREFIX}${runtimeId.replace(/-/g, "_").toUpperCase()}_BEARER_TOKEN`;
}

function openClawRuntimeForSecret(runtimeId: string): AgentRuntimeDefinition {
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (!runtime || runtime.kind !== "openclaw" || runtime.location !== "remote") {
    throw new Error("Only remote OpenClaw runtimes may store a Bridge credential.");
  }
  return runtime;
}

function openClawAuth(runtimeId: string): OpenClawRuntimeAuth {
  return { bearerToken: getSecret(openClawBearerSecretKey(runtimeId)) || undefined };
}

function runtimeAuth(runtime: AgentRuntimeDefinition): { bearerToken?: string } | undefined {
  if (runtime.kind === "openclaw" && runtime.location === "remote") {
    return openClawAuth(runtime.id);
  }
  if (runtime.kind === "hermes" && runtime.location === "remote") {
    const token = getConnectionConfig().apiKey.trim();
    return token ? { bearerToken: token } : undefined;
  }
  return undefined;
}

function hasConstrainedPlanning(
  capabilities: {
    orchestration: boolean;
    readOnlyPlanning: boolean;
    cancellation: boolean;
    artifacts: boolean;
    securityEvents: boolean;
  },
): boolean {
  return Boolean(
    capabilities.orchestration &&
      capabilities.readOnlyPlanning &&
      capabilities.cancellation &&
      capabilities.artifacts &&
      capabilities.securityEvents,
  );
}

export function getAgentRuntimeCredentialStatus(runtimeId: string): {
  required: boolean;
  configured: boolean;
} {
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (!runtime) throw new Error("Runtime was not found.");
  if (runtime.kind !== "openclaw" || runtime.location !== "remote") {
    return { required: false, configured: false };
  }
  return {
    required: true,
    configured: Boolean(getSecret(openClawBearerSecretKey(runtimeId))),
  };
}

export function setAgentRuntimeBearerToken(runtimeId: string, bearerToken: string): {
  configured: true;
} {
  openClawRuntimeForSecret(runtimeId);
  if (
    typeof bearerToken !== "string" ||
    bearerToken.trim().length < 8 ||
    bearerToken.length > 4096 ||
    /[\0\r\n]/.test(bearerToken)
  ) {
    throw new Error("OpenClaw Bridge credential is invalid.");
  }
  setEnvValue(openClawBearerSecretKey(runtimeId), bearerToken.trim());
  invalidateSecretsCache();
  return { configured: true };
}

function writeUserRuntimes(runtimes: AgentRuntimeDefinition[]): void {
  const config = readDesktopConfig();
  config[RUNTIME_CONFIG_KEY] = runtimes.map(({ managed: _managed, ...runtime }) => runtime);
  writeDesktopConfig(config);
}

function builtInHermesRuntime(): AgentRuntimeDefinition {
  const connection = getConnectionConfig();
  const remote = connection.mode === "remote";
  return {
    id: remote ? "hermes-remote" : "hermes-local",
    name: remote ? "Remote Hermes" : "Local Hermes",
    kind: "hermes",
    location: remote ? "remote" : "local",
    enabled: true,
    managed: "builtin",
    config: remote
      ? { endpoint: connection.remoteUrl, transport: "http", timeoutMs: 15_000 }
      : { transport: "cli", timeoutMs: 15_000 },
  };
}

export function listAgentRuntimes(): AgentRuntimeDefinition[] {
  return [builtInHermesRuntime(), ...userRuntimes()];
}

export function saveAgentRuntime(draft: AgentRuntimeDraft): AgentRuntimeDefinition {
  // Validate config separately so callers receive the security-specific error
  // instead of a generic invalid-definition result.
  const config = runtimeConfigFrom(draft.config);
  const runtime = normalizeUserRuntime({
    ...draft,
    config,
    managed: "user",
  });
  if (!runtime) throw new Error("Runtime definition is invalid.");

  const runtimes = userRuntimes();
  const existingIndex = runtimes.findIndex((item) => item.id === runtime.id);
  if (existingIndex >= 0) runtimes[existingIndex] = runtime;
  else runtimes.push(runtime);
  writeUserRuntimes(runtimes);
  return runtime;
}

export function removeAgentRuntime(id: string): boolean {
  if (!RUNTIME_ID.test(id) || RESERVED_RUNTIME_IDS.has(id)) {
    throw new Error("Built-in or invalid runtimes cannot be removed.");
  }
  const runtimes = userRuntimes();
  const next = runtimes.filter((runtime) => runtime.id !== id);
  if (next.length === runtimes.length) return false;
  writeUserRuntimes(next);
  return true;
}

export async function probeAgentRuntime(id: string): Promise<AgentRuntimeProbe> {
  const runtime = listAgentRuntimes().find((item) => item.id === id);
  if (!runtime) throw new Error("Runtime was not found.");
  const checkedAt = Date.now();

  if (runtime.kind === "openclaw" && runtime.location === "remote") {
    if (!runtime.config.endpoint) {
      throw new Error("OpenClaw runtime endpoint is required.");
    }
    const result = await probeOpenClawRuntime({
      endpoint: runtime.config.endpoint,
      timeoutMs: runtime.config.timeoutMs,
    }, openClawAuth(runtime.id));
    return {
      runtimeId: id,
      state: result.state === "healthy" ? "healthy" : "unreachable",
      capabilities: result.capabilities,
      checkedAt,
      ...(result.message ? { message: result.message } : {}),
    };
  }

  if (runtime.kind === "codex" && runtime.location === "local") {
    const result = await probeCodexRuntime({
      executablePath: runtime.config.executablePath,
      workspace: runtime.config.workspace,
      timeoutMs: runtime.config.timeoutMs,
    });
    return {
      runtimeId: id,
      state: result.healthy ? "healthy" : "unreachable",
      capabilities: result.healthy
        ? {
            chat: false,
            taskDispatch: true,
            streaming: true,
            cancellation: true,
            tools: true,
            memory: false,
            orchestration: false,
            readOnlyPlanning: false,
            mailbox: false,
            securityEvents: false,
            artifacts: true,
            workspaceAccess: result.workspaceAccess,
          }
        : NO_AGENT_RUNTIME_CAPABILITIES,
      checkedAt,
      ...(result.message ? { message: result.message } : {}),
    };
  }

  if (runtime.kind === "claude-code" && runtime.location === "local") {
    const result = await probeClaudeCodeRuntime({
      executablePath: runtime.config.executablePath,
      workspace: runtime.config.workspace,
      timeoutMs: runtime.config.timeoutMs,
    });
    return {
      runtimeId: id,
      state: result.healthy ? "healthy" : "unreachable",
      capabilities: result.healthy
        ? {
            chat: false,
            taskDispatch: true,
            streaming: true,
            cancellation: true,
            tools: true,
            memory: false,
            orchestration: false,
            readOnlyPlanning: false,
            mailbox: false,
            securityEvents: false,
            artifacts: true,
            workspaceAccess: result.workspaceAccess,
          }
        : NO_AGENT_RUNTIME_CAPABILITIES,
      checkedAt,
      ...(result.message ? { message: result.message } : {}),
    };
  }

  if (runtime.kind !== "hermes" || runtime.location !== "remote") {
    return {
      runtimeId: id,
      state: "unsupported",
      capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
      checkedAt,
      message: `${runtime.kind} adapter is not installed yet.`,
    };
  }

  const connection = getConnectionConfig();
  if (runtime.config.endpoint) {
    const coordinatorProbe = await probeRemoteCoordinatorBridge(
      {
        endpoint: runtime.config.endpoint,
        timeoutMs: runtime.config.timeoutMs,
      },
      runtimeAuth(runtime),
    );
    if (coordinatorProbe.state === "healthy") {
      return {
        runtimeId: id,
        state: "healthy",
        capabilities: coordinatorProbe.capabilities,
        checkedAt,
        ...(coordinatorProbe.message ? { message: coordinatorProbe.message } : {}),
      };
    }
  }
  const healthy = await testRemoteConnection(connection.remoteUrl, connection.apiKey);
  return {
    runtimeId: id,
    state: healthy ? "healthy" : "unreachable",
    capabilities: healthy
      ? {
          chat: true,
          taskDispatch: true,
          streaming: true,
          cancellation: true,
          tools: true,
          memory: true,
          orchestration: false,
          readOnlyPlanning: false,
          mailbox: false,
          securityEvents: false,
          artifacts: false,
          workspaceAccess: false,
        }
      : NO_AGENT_RUNTIME_CAPABILITIES,
    checkedAt,
    ...(healthy ? {} : { message: "Remote Hermes health check failed." }),
  };
}

function statusFromOpenClaw(status: string): AgentRuntimeRun["status"] {
  switch (status.toLowerCase()) {
    case "running":
    case "queued":
    case "pending":
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
      return "failed";
  }
}

function statusFromRemotePlan(status: RemoteCoordinatorPlan["status"]): AgentRuntimeRun["status"] {
  switch (status) {
    case "queued":
    case "running":
    case "cancelling":
      return "running";
    case "succeeded":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "timed_out":
      return "timed_out";
    case "failed":
    default:
      return "failed";
  }
}

function applyOpenClawTask(
  record: RuntimeRunRecord,
  task: OpenClawBridgeTask,
): AgentRuntimeRun {
  const status = statusFromOpenClaw(task.status);
  const next: AgentRuntimeRun = {
    ...record.run,
    status,
    output: task.output ?? record.run.output,
    sessionId: task.sessionId ?? record.run.sessionId,
    error: task.error ?? record.run.error,
    ...(status === "running" ? {} : { completedAt: Date.now() }),
  };
  record.run = next;
  return { ...next };
}

function planOutput(plan: RemoteCoordinatorPlan): string {
  return plan.output || (plan.plan ? JSON.stringify(plan.plan, null, 2) : "");
}

function applyRemoteCoordinatorPlan(
  record: RuntimeRunRecord,
  plan: RemoteCoordinatorPlan,
): AgentRuntimeRun {
  const status = statusFromRemotePlan(plan.status);
  if (status !== "running" && record.timeout) {
    clearTimeout(record.timeout);
    record.timeout = undefined;
  }
  const output = planOutput(plan) || record.run.output;
  const artifacts = [
    ...(plan.artifacts || []),
    ...(status === "succeeded" && output
      ? [{ kind: "final" as const, label: "Coordinator plan", content: output }]
      : []),
  ];
  const next: AgentRuntimeRun = {
    ...record.run,
    status,
    output,
    error: plan.error ?? record.run.error,
    artifacts: artifacts.length ? artifacts : record.run.artifacts,
    ...(status === "running" ? {} : { completedAt: Date.now() }),
  };
  record.run = next;
  return { ...next };
}

function rememberRuntimeRun(record: RuntimeRunRecord): void {
  runtimeRuns.set(record.run.id, record);
  while (runtimeRuns.size > MAX_RETAINED_RUNS) {
    const oldest = runtimeRuns.keys().next().value as string | undefined;
    if (!oldest) break;
    runtimeRuns.delete(oldest);
  }
}

function finishRuntimeRun(
  record: RuntimeRunRecord,
  status: Exclude<AgentRuntimeRun["status"], "running">,
  details: Pick<
    AgentRuntimeRun,
    "output" | "sessionId" | "error" | "worktreePath" | "diffSummary" | "artifacts"
  > = {},
): AgentRuntimeRun {
  if (record.run.status !== "running") return { ...record.run };
  if (record.timeout) clearTimeout(record.timeout);
  record.run = {
    ...record.run,
    status,
    completedAt: Date.now(),
    ...details,
  };
  return { ...record.run };
}

function validatedTaskInput(input: AgentRuntimeTaskInput): {
  prompt: string;
  profile?: string;
  sessionId?: string;
  mode: "analysis" | "implementation";
  workspace?: string;
  timeoutMs: number;
  coordinatorPlan?: NonNullable<AgentRuntimeTaskInput["coordinatorPlan"]>;
} {
  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || prompt.length > MAX_TASK_PROMPT_LENGTH) {
    throw new Error("Runtime task prompt must be between 1 and 100000 characters.");
  }
  const profile = optionalString(input.profile, 128);
  const sessionId = optionalString(input.sessionId, 256);
  const mode = input.mode ?? "analysis";
  if (mode !== "analysis" && mode !== "implementation") {
    throw new Error("Runtime task mode must be analysis or implementation.");
  }
  const workspace = optionalString(input.workspace, 4096);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > MAX_RUNTIME_TIMEOUT_MS
  ) {
    throw new Error("Runtime task timeout must be between 1000 and 600000 milliseconds.");
  }
  const coordinatorPlan = input.coordinatorPlan;
  if (coordinatorPlan !== undefined) {
    if (
      !coordinatorPlan ||
      typeof coordinatorPlan !== "object" ||
      typeof coordinatorPlan.projectId !== "string" ||
      typeof coordinatorPlan.title !== "string" ||
      typeof coordinatorPlan.objective !== "string"
    ) {
      throw new Error("Coordinator planning context is invalid.");
    }
    return {
      prompt,
      profile,
      sessionId,
      mode,
      workspace,
      timeoutMs,
      coordinatorPlan: {
        projectId: coordinatorPlan.projectId.trim(),
        title: coordinatorPlan.title.trim(),
        objective: coordinatorPlan.objective.trim(),
        existingTasks: Array.isArray(coordinatorPlan.existingTasks)
          ? coordinatorPlan.existingTasks.map((item) => ({
              id: String(item.id || ""),
              title: String(item.title || ""),
              status: String(item.status || ""),
              ...(item.runtimeId ? { runtimeId: String(item.runtimeId) } : {}),
            }))
          : [],
      },
    };
  }
  return { prompt, profile, sessionId, mode, workspace, timeoutMs };
}

export async function startAgentRuntimeTask(
  runtimeId: string,
  input: AgentRuntimeTaskInput,
): Promise<AgentRuntimeRun> {
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (!runtime) throw new Error("Runtime was not found.");
  if (!runtime.enabled) throw new Error("Runtime is disabled.");
  if (
    runtime.kind !== "hermes" &&
    !(runtime.kind === "openclaw" && runtime.location === "remote") &&
    !(runtime.kind === "codex" && runtime.location === "local") &&
    !(runtime.kind === "claude-code" && runtime.location === "local")
  ) {
    throw new Error(`${runtime.kind} task dispatch is not available yet.`);
  }

  const task = validatedTaskInput(input);
  const id = `run-${randomUUID()}`;
  const startedAt = Date.now();
  const record: RuntimeRunRecord = {
    run: {
      id,
      runtimeId,
      status: "running",
      startedAt,
      output: "",
    },
    cancelRequested: false,
  };
  rememberRuntimeRun(record);

  if (task.coordinatorPlan) {
    if (
      runtime.location !== "remote" ||
      (runtime.kind !== "hermes" && runtime.kind !== "openclaw")
    ) {
      return finishRuntimeRun(record, "failed", {
        error: "Coordinator planning requires a remote Hermes or OpenClaw Bridge.",
      });
    }
    if (!runtime.config.endpoint) {
      return finishRuntimeRun(record, "failed", {
        error: "Remote coordinator endpoint is required.",
      });
    }
    try {
      const probe = await probeRemoteCoordinatorBridge(
        {
          endpoint: runtime.config.endpoint,
          timeoutMs: runtime.config.timeoutMs,
        },
        runtimeAuth(runtime),
      );
      if (probe.state !== "healthy" || !hasConstrainedPlanning(probe.capabilities)) {
        return finishRuntimeRun(record, "failed", {
          error:
            "Remote coordinator Bridge does not expose enforceable read-only planning.",
        });
      }
      const config: RemoteCoordinatorConfig = {
        endpoint: runtime.config.endpoint,
        timeoutMs: runtime.config.timeoutMs,
      };
      const plan = await startRemoteCoordinatorPlan(
        config,
        {
          projectId: task.coordinatorPlan.projectId,
          request: task.prompt,
          context: {
            title: task.coordinatorPlan.title,
            requirements: task.coordinatorPlan.objective,
            ...(task.workspace ? { workspace: task.workspace } : {}),
            existingTasks: task.coordinatorPlan.existingTasks,
          },
          timeoutSeconds: Math.ceil(task.timeoutMs / 1000),
        },
        runtimeAuth(runtime),
      );
      record.remotePlan = { config, planId: plan.id };
      record.timeout = setTimeout(() => {
        void cancelRemoteCoordinatorPlan(config, plan.id, runtimeAuth(runtime)).catch(() => undefined);
        finishRuntimeRun(record, "timed_out", {
          output: record.run.output,
          error: `Remote coordinator planning exceeded ${task.timeoutMs}ms.`,
        });
      }, task.timeoutMs);
      return applyRemoteCoordinatorPlan(record, plan);
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (runtime.kind === "codex") {
    try {
      const codex = await startCodexProcess(
        {
          executablePath: runtime.config.executablePath,
          workspace: runtime.config.workspace,
          timeoutMs: runtime.config.timeoutMs,
        },
        task,
        (chunk) => {
          if (record.run.status !== "running") return;
          record.run = {
            ...record.run,
            output: `${record.run.output ?? ""}${chunk}`.slice(-512 * 1024),
          };
        },
      );
      record.codex = { cancel: codex.cancel };
      if (codex.worktreePath) {
        record.run = { ...record.run, worktreePath: codex.worktreePath };
      }
      record.timeout = setTimeout(() => {
        codex.cancel();
        finishRuntimeRun(record, "timed_out", {
          output: record.run.output,
          worktreePath: record.run.worktreePath,
          error: `Runtime task exceeded ${task.timeoutMs}ms.`,
        });
      }, task.timeoutMs);
      void codex.completion.then((result) => {
        if (record.run.status !== "running") return;
        finishRuntimeRun(record, result.error ? "failed" : "succeeded", {
          output: result.output,
          ...(result.error ? { error: result.error } : {}),
          ...(result.worktreePath ? { worktreePath: result.worktreePath } : {}),
          ...(result.diffSummary ? { diffSummary: result.diffSummary } : {}),
          ...(result.artifacts.length ? { artifacts: result.artifacts } : {}),
        });
      });
      return { ...record.run };
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (runtime.kind === "claude-code") {
    try {
      const claudeCode = await startClaudeCodeProcess(
        {
          executablePath: runtime.config.executablePath,
          workspace: runtime.config.workspace,
          timeoutMs: runtime.config.timeoutMs,
        },
        task,
        (chunk) => {
          if (record.run.status !== "running") return;
          record.run = {
            ...record.run,
            output: `${record.run.output ?? ""}${chunk}`.slice(-512 * 1024),
          };
        },
      );
      record.claudeCode = { cancel: claudeCode.cancel };
      if (claudeCode.worktreePath) {
        record.run = { ...record.run, worktreePath: claudeCode.worktreePath };
      }
      record.timeout = setTimeout(() => {
        claudeCode.cancel();
        finishRuntimeRun(record, "timed_out", {
          output: record.run.output,
          worktreePath: record.run.worktreePath,
          error: `Runtime task exceeded ${task.timeoutMs}ms.`,
        });
      }, task.timeoutMs);
      void claudeCode.completion.then((result) => {
        if (record.run.status !== "running") return;
        finishRuntimeRun(record, result.error ? "failed" : "succeeded", {
          output: result.output,
          ...(result.error ? { error: result.error } : {}),
          ...(result.worktreePath ? { worktreePath: result.worktreePath } : {}),
          ...(result.diffSummary ? { diffSummary: result.diffSummary } : {}),
          ...(result.artifacts.length ? { artifacts: result.artifacts } : {}),
        });
      });
      return { ...record.run };
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (runtime.kind === "openclaw") {
    if (!runtime.config.endpoint) {
      throw new Error("OpenClaw runtime endpoint is required.");
    }
    const config: OpenClawRuntimeConfig = {
      endpoint: runtime.config.endpoint,
      timeoutMs: runtime.config.timeoutMs,
    };
    return startOpenClawTask(config, {
      prompt: task.prompt,
      profile: task.profile,
      sessionId: task.sessionId,
    }, openClawAuth(runtime.id))
      .then((bridgeTask) => {
        record.openClaw = { config, taskId: bridgeTask.id };
        return applyOpenClawTask(record, bridgeTask);
      })
      .catch((error) => {
        return finishRuntimeRun(record, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  const finish = (
    status: Exclude<AgentRuntimeRun["status"], "running">,
    details: Pick<AgentRuntimeRun, "output" | "sessionId" | "error"> = {},
  ): void => {
    finishRuntimeRun(record, status, details);
  };

  record.timeout = setTimeout(() => {
    record.abortHandle?.();
    finish("timed_out", {
      output: record.run.output,
      error: `Runtime task exceeded ${task.timeoutMs}ms.`,
    });
  }, task.timeoutMs);

  void sendMessage(
    task.prompt,
    {
      onChunk: (chunk) => {
        if (record.run.status !== "running") return;
        record.run = {
          ...record.run,
          output: `${record.run.output ?? ""}${chunk}`,
        };
      },
      onDone: (sessionId) =>
        finish("succeeded", { output: record.run.output, sessionId }),
      onError: (error) =>
        finish("failed", { output: record.run.output, error }),
    },
    task.profile,
    task.sessionId,
  )
    .then((handle) => {
      record.abortHandle = handle.abort;
      if (record.cancelRequested || record.run.status !== "running") {
        handle.abort();
      }
    })
    .catch((error) => {
      finish("failed", {
        output: record.run.output,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return { ...record.run };
}

export async function getAgentRuntimeRun(
  runId: string,
): Promise<AgentRuntimeRun | null> {
  const record = runtimeRuns.get(runId);
  if (!record) return null;
  if (record.remotePlan && record.run.status === "running") {
    try {
      const plan = await getRemoteCoordinatorPlan(
        record.remotePlan.config,
        record.remotePlan.planId,
        runtimeAuth(listAgentRuntimes().find((item) => item.id === record.run.runtimeId)!),
      );
      return applyRemoteCoordinatorPlan(record, plan);
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        output: record.run.output,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (record.openClaw && record.run.status === "running") {
    try {
      const task = await getOpenClawTask(
        record.openClaw.config,
        record.openClaw.taskId,
        openClawAuth(record.run.runtimeId),
      );
      return applyOpenClawTask(record, task);
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        output: record.run.output,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { ...record.run };
}

export async function runAgentRuntimeTask(
  runtimeId: string,
  input: AgentRuntimeTaskInput,
): Promise<AgentRuntimeRun> {
  const run = await startAgentRuntimeTask(runtimeId, input);
  return new Promise<AgentRuntimeRun>((resolve) => {
    const interval = setInterval(async () => {
      const current = await getAgentRuntimeRun(run.id);
      if (!current || current.status === "running") return;
      clearInterval(interval);
      resolve(current);
    }, 25);
  });
}

export async function cancelAgentRuntimeTask(runId: string): Promise<boolean> {
  const record = runtimeRuns.get(runId);
  if (!record || record.run.status !== "running") return false;
  record.cancelRequested = true;
  if (record.remotePlan) {
    try {
      const runtime = listAgentRuntimes().find((item) => item.id === record.run.runtimeId);
      const plan = await cancelRemoteCoordinatorPlan(
        record.remotePlan.config,
        record.remotePlan.planId,
        runtime ? runtimeAuth(runtime) : undefined,
      );
      applyRemoteCoordinatorPlan(record, plan);
    } catch (error) {
      finishRuntimeRun(record, "failed", {
        output: record.run.output,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }
  if (record.openClaw) {
    try {
      const task = await cancelOpenClawTask(
        record.openClaw.config,
        record.openClaw.taskId,
        openClawAuth(record.run.runtimeId),
      );
      applyOpenClawTask(record, task);
    } catch (error) {
      finishRuntimeRun(record, "failed", {
        output: record.run.output,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }
  if (record.codex) {
    record.codex.cancel();
    finishRuntimeRun(record, "cancelled", {
      output: record.run.output,
      worktreePath: record.run.worktreePath,
      error: "Runtime task was cancelled.",
    });
    return true;
  }
  if (record.claudeCode) {
    record.claudeCode.cancel();
    finishRuntimeRun(record, "cancelled", {
      output: record.run.output,
      worktreePath: record.run.worktreePath,
      error: "Runtime task was cancelled.",
    });
    return true;
  }
  record.abortHandle?.();
  finishRuntimeRun(record, "cancelled", {
    output: record.run.output,
    error: "Runtime task was cancelled.",
  });
  return true;
}
