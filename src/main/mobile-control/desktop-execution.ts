import { createHash } from "node:crypto";
import {
  getAgentRuntimeRun,
  listAgentRuntimes,
  requestAgentRuntimeTaskCancellation,
  startAgentRuntimeTask,
} from "../agent-runtimes";
import {
  beginRuntimeConversationTurn,
  completeRuntimeConversationTurn,
  getRuntimeConversation,
} from "../runtime-conversation-store";
import { getActiveProfileNameSync } from "../utils";
import {
  deriveAgentTransport,
  type AgentRuntimeDefinition,
} from "../../shared/agent-runtimes";
import type { RuntimeConversation } from "../../shared/runtime-conversations";
import { DesktopMobileCatalog } from "./desktop-catalog";
import type { DesktopConversationRepository } from "./desktop-conversations";
import type {
  OwnerExecutionBackend,
  OwnerExecutionStore,
} from "./execution-types";

export interface EnforcedDesktopExecutionPolicy {
  id: string;
  runtimeId: string;
  projectId?: string;
  mode:
    | "inspect"
    | "project_write"
    | "desktop_analysis"
    | "desktop_execute"
    | "desktop_auto"
    | "desktop_full_access";
  enforced: boolean;
  /** Binds approval to the actual execution configuration, excluding appearance. */
  runtimeConfigurationHash: string;
  /** Main-only effective configuration binding; never accepted from a mobile command. */
  codexConfigurationHash?: string;
  codexProjectWriteWorkerHash?: string;
  workspaceRef?: string;
  timeoutMs?: number;
}
/** Implemented by Owner-owned capability/approval storage, never by a phone request. */
export interface DesktopExecutionPolicyProvider {
  authorize(id: string): EnforcedDesktopExecutionPolicy;
}
export interface DesktopExecutionPolicyCatalog extends DesktopExecutionPolicyProvider {
  list(): Array<
    EnforcedDesktopExecutionPolicy & { unattendedApproved?: boolean }
  >;
}

export function createDesktopMobileCatalog(
  profile: string,
  repository: DesktopConversationRepository,
  policies: DesktopExecutionPolicyCatalog,
  backend: OwnerExecutionBackend,
): DesktopMobileCatalog {
  return new DesktopMobileCatalog(
    {
      runtimes: () => {
        if (
          getActiveProfileNameSync() !== profile ||
          repository.profile !== profile
        )
          fail("profile_inactive");
        return listAgentRuntimes();
      },
      projects: () => repository.projects(),
      policies: () => policies.list(),
    },
    backend,
  );
}
function fail(code: string, status = 403): never {
  throw Object.assign(Error(code), { code, status });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
export function desktopRuntimePolicyFingerprint(
  runtime: AgentRuntimeDefinition,
): string {
  return createHash("sha256")
    .update(
      canonical({
        id: runtime.id,
        kind: runtime.kind,
        location: runtime.location,
        adapterId: runtime.adapterId,
        adapterVersion: runtime.adapterVersion,
        connectionProfile: runtime.connectionProfile,
        config: runtime.config,
      }),
    )
    .digest("hex");
}
/** Shares the real Main dispatcher and cancellation evidence without expanding IPC. */
export function createDesktopExecutionBackend(
  profile: string,
  policies: DesktopExecutionPolicyProvider,
): OwnerExecutionBackend {
  const authorize: OwnerExecutionBackend["authorize"] = (
    policyId,
    runtimeId,
    projectId,
  ) => {
    if (getActiveProfileNameSync() !== profile) fail("profile_inactive");
    const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
    if (!runtime) fail("resource_not_found", 404);
    if (
      !runtime.enabled ||
      runtime.configurationIssue ||
      runtime.needsReauthorization
    )
      fail("requires_owner_action");
    const policy = policies.authorize(policyId);
    if (
      !policy.enforced ||
      policy.id !== policyId ||
      policy.runtimeId !== runtimeId ||
      policy.projectId !== projectId ||
      policy.runtimeConfigurationHash !==
        desktopRuntimePolicyFingerprint(runtime) ||
      !["inspect", "project_write"].includes(policy.mode)
    )
      fail("unverified_policy");
    if (policy.mode === "project_write" && !projectId)
      fail("unverified_policy");
    const expectedConfiguration = policy.codexConfigurationHash;
    const expectedWorker = policy.codexProjectWriteWorkerHash;
    if (
      policy.mode === "project_write" &&
      runtime.kind === "codex" &&
      (!expectedConfiguration || !/^[a-f0-9]{64}$/.test(expectedWorker ?? ""))
    )
      fail("unverified_policy");
    const expectedRuntime = policy.runtimeConfigurationHash;
    const expectedMode = policy.mode;
    const expectedWorkspaceRef = policy.workspaceRef;
    const configurationGuard = expectedConfiguration
      ? (configurationHash: string): void => {
          const current = policies.authorize(policyId);
          const currentRuntime = listAgentRuntimes().find(
            (item) => item.id === runtimeId,
          );
          if (
            getActiveProfileNameSync() !== profile ||
            !currentRuntime ||
            !currentRuntime.enabled ||
            currentRuntime.configurationIssue ||
            currentRuntime.needsReauthorization ||
            !current.enforced ||
            current.id !== policyId ||
            current.runtimeId !== runtimeId ||
            current.projectId !== projectId ||
            current.mode !== expectedMode ||
            current.workspaceRef !== expectedWorkspaceRef ||
            current.codexProjectWriteWorkerHash !== expectedWorker ||
            current.codexConfigurationHash !== expectedConfiguration ||
            configurationHash !== expectedConfiguration ||
            current.runtimeConfigurationHash !== expectedRuntime ||
            current.runtimeConfigurationHash !==
              desktopRuntimePolicyFingerprint(currentRuntime)
          )
            fail("unverified_policy");
        }
      : undefined;
    return {
      policyId,
      runtime,
      projectId,
      task: {
        mode: policy.mode === "inspect" ? "analysis" : "safe_write",
        ...(projectId ? { workspaceId: projectId } : {}),
        ...(policy.workspaceRef ? { workspaceRef: policy.workspaceRef } : {}),
        ...(policy.timeoutMs !== undefined
          ? { timeoutMs: policy.timeoutMs }
          : {}),
      },
      ...((projectId || configurationGuard) &&
      runtime.kind === "codex" &&
      runtime.location === "local" &&
      deriveAgentTransport(runtime) === "local-cli"
        ? {
            dispatchOptions: {
              ...(policy.mode === "project_write"
                ? {
                    codexMobileProjectWrite: true as const,
                    codexMobileProjectWriteWorkerHash: expectedWorker,
                  }
                : {}),
              ...(configurationGuard
                ? { codexMobileConfigurationGuard: configurationGuard }
                : {}),
              ...(projectId
                ? {
                    codexMobileProjectGuard: () => {
                      const current = authorize(policyId, runtimeId, projectId);
                      if (
                        current.task.mode !==
                          (expectedMode === "inspect"
                            ? "analysis"
                            : "safe_write") ||
                        current.task.workspaceId !== projectId ||
                        current.task.workspaceRef !== expectedWorkspaceRef
                      )
                        fail("unverified_policy");
                    },
                  }
                : {}),
            },
          }
        : {}),
    };
  };
  return {
    authorize,
    start: (runtimeId, input, options) => {
      const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
      return startAgentRuntimeTask(
        runtimeId,
        { ...input, profile },
        {
          ...options,
          ...(runtime?.kind === "codex" &&
          runtime.location === "local" &&
          deriveAgentTransport(runtime) === "local-cli" &&
          input.mode === "analysis"
            ? { codexMobileInspection: true as const }
            : {}),
        },
      );
    },
    get: getAgentRuntimeRun,
    cancel: requestAgentRuntimeTaskCancellation,
  };
}
export function createDesktopExecutionStore(
  profile: string,
  projectId: (value: RuntimeConversation) => string | undefined = (value) =>
    value.workspaceId,
): OwnerExecutionStore {
  return {
    get: (id) => getRuntimeConversation(id, profile, { fullHistory: true }),
    projectId,
    begin: (id, revision, runId, message) =>
      beginRuntimeConversationTurn(id, revision, runId, message, profile),
    finish: (id, runId, checkpoint) =>
      completeRuntimeConversationTurn(
        id,
        runId,
        checkpoint.message,
        checkpoint.sessionId,
        profile,
      ),
  };
}
