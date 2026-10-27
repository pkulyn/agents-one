import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { listAgentRuntimes, startAgentRuntimeTask } from "../agent-runtimes";
import { getActiveProfileNameSync } from "../utils";
import { assertAgentsOneWritesAllowed } from "../restore-write-lock";
import { resolveAuthorizedWorkspaceId } from "../workspace-authority";
import {
  deriveAgentTransport,
  type AgentRuntimeDefinition,
} from "../../shared/agent-runtimes";
import { automaticRuntimeTaskMode } from "../../shared/runtime-permissions";
import type { DesktopConversationRepository } from "./desktop-conversations";
import {
  createDesktopExecutionBackend,
  desktopRuntimePolicyFingerprint,
  type DesktopExecutionPolicyCatalog,
  type EnforcedDesktopExecutionPolicy,
} from "./desktop-execution";
import type { OwnerExecutionBackend } from "./execution-types";

interface SelectionSource {
  guard(): void;
  runtimes(): AgentRuntimeDefinition[];
  projects(): Array<{ id: string; identity: string }>;
}
const prefix = "desktop-task-";
function denied(code = "unverified_policy"): never {
  throw Object.assign(Error(code), { code, status: 403 });
}
type Policy = EnforcedDesktopExecutionPolicy & { unattendedApproved: boolean };

/** Desktop modes selected at task creation, without a second approval document. */
export class DesktopTaskSelectionCatalog implements DesktopExecutionPolicyCatalog {
  constructor(
    private readonly source: SelectionSource,
    private readonly legacy: DesktopExecutionPolicyCatalog,
  ) {}
  list(): Policy[] {
    this.source.guard();
    const projects = this.source.projects();
    const rows: Policy[] = [];
    for (const runtime of this.source.runtimes()) {
      if (
        !runtime.enabled ||
        runtime.configurationIssue ||
        runtime.needsReauthorization
      )
        continue;
      const runtimeConfigurationHash = desktopRuntimePolicyFingerprint(runtime);
      for (const project of [undefined, ...projects]) {
        for (const mode of project
          ? ([
              "desktop_analysis",
              "desktop_auto",
              "desktop_full_access",
            ] as const)
          : ([
              "desktop_analysis",
              "desktop_auto",
              "desktop_full_access",
            ] as const)) {
          const id =
            prefix +
            createHash("sha256")
              .update(
                JSON.stringify([
                  runtime.id,
                  runtimeConfigurationHash,
                  project?.id ?? null,
                  project?.identity ?? null,
                  mode,
                ]),
              )
              .digest("hex");
          rows.push({
            id,
            runtimeId: runtime.id,
            projectId: project?.id,
            mode,
            enforced: true,
            runtimeConfigurationHash,
            unattendedApproved: mode !== "desktop_full_access",
          });
        }
      }
    }
    this.source.guard();
    return [
      ...rows,
      ...this.legacy.list().map((row) => ({
        ...row,
        unattendedApproved: row.unattendedApproved === true,
      })),
    ];
  }
  authorize(id: string): Policy {
    this.source.guard();
    if (!id.startsWith(prefix)) return this.legacy.authorize(id) as Policy;
    const policy = this.list().find((row) => row.id === id);
    if (!policy) denied();
    return policy;
  }
}

export function desktopTaskInput(
  mode: Policy["mode"],
  runtime: AgentRuntimeDefinition,
  projectId: string | undefined,
): {
  mode: "analysis" | "safe_write" | "full_access";
  fullAccessConfirmed?: true;
  workspaceId?: string;
} {
  return {
    mode:
      mode === "desktop_full_access"
        ? "full_access"
        : mode === "desktop_analysis"
          ? "analysis"
          : mode === "desktop_auto"
            ? automaticRuntimeTaskMode(runtime, Boolean(projectId))
            : "safe_write",
    ...(mode === "desktop_full_access"
      ? { fullAccessConfirmed: true as const }
      : {}),
    ...(projectId ? { workspaceId: projectId } : {}),
  };
}

/** Reuses the normal desktop dispatcher and modes; old strict policy IDs retain their path. */
export function createDesktopTaskAccess(
  profile: string,
  repository: DesktopConversationRepository,
  legacy: DesktopExecutionPolicyCatalog,
): { policies: DesktopExecutionPolicyCatalog; backend: OwnerExecutionBackend } {
  const guard = (): void => {
    if (
      getActiveProfileNameSync() !== profile ||
      repository.profile !== profile
    )
      denied("profile_inactive");
    assertAgentsOneWritesAllowed();
  };
  const policies = new DesktopTaskSelectionCatalog(
    {
      guard,
      runtimes: listAgentRuntimes,
      projects: () =>
        repository.projects().flatMap((project) => {
          try {
            const root = resolveAuthorizedWorkspaceId(project.id);
            const path = realpathSync(project.path);
            if (
              !root ||
              root !==
                (process.platform === "win32" ? path.toLowerCase() : path)
            )
              return [];
            const stat = lstatSync(project.path);
            if (stat.isSymbolicLink() || !stat.isDirectory()) return [];
            return [
              {
                id: project.id,
                identity: JSON.stringify([
                  root,
                  stat.dev,
                  stat.ino,
                  stat.birthtimeMs,
                ]),
              },
            ];
          } catch {
            return [];
          }
        }),
    },
    legacy,
  );
  const old = createDesktopExecutionBackend(profile, legacy);
  const backend: OwnerExecutionBackend = {
    authorize(policyId, runtimeId, projectId) {
      guard();
      if (!policyId.startsWith(prefix)) {
        const approved = old.authorize(policyId, runtimeId, projectId);
        return {
          ...approved,
          dispatchOptions: {
            ...approved.dispatchOptions,
            ...(approved.runtime.kind === "codex" &&
            approved.runtime.location === "local" &&
            deriveAgentTransport(approved.runtime) === "local-cli" &&
            approved.task.mode === "analysis"
              ? { codexMobileInspection: true as const }
              : {}),
          },
        };
      }
      const policy = policies.authorize(policyId);
      const runtime = listAgentRuntimes().find((row) => row.id === runtimeId);
      if (
        !runtime ||
        policy.runtimeId !== runtimeId ||
        policy.projectId !== projectId ||
        desktopRuntimePolicyFingerprint(runtime) !==
          policy.runtimeConfigurationHash
      )
        denied();
      guard();
      return {
        policyId,
        runtime,
        projectId,
        task: desktopTaskInput(policy.mode, runtime, projectId),
      };
    },
    start(runtimeId, input, options) {
      guard();
      return startAgentRuntimeTask(runtimeId, { ...input, profile }, options);
    },
    get: old.get,
    cancel: old.cancel,
  };
  return { policies, backend };
}
