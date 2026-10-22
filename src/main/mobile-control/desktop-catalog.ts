import { assertMobileSchema } from "../../shared/mobile-control";
import {
  deriveAgentTransport,
  type AgentRuntimeDefinition,
} from "../../shared/agent-runtimes";
import type { OwnerExecutionBackend } from "./execution-types";
import type { EnforcedDesktopExecutionPolicy } from "./desktop-execution";
import type { Json } from "./conversation-projection";
import { projectRuntimeAvatar } from "./runtime-avatar";
import { automaticRuntimeTaskMode } from "../../shared/runtime-permissions";

export interface DesktopCatalogSource {
  runtimes(): AgentRuntimeDefinition[];
  projects(): Array<{ id: string; name: string }>;
  policies(): Array<
    EnforcedDesktopExecutionPolicy & { unattendedApproved?: boolean }
  >;
}
export interface MobileCatalogSnapshot {
  runtimes: Json[];
  projects: Json[];
  policies: Json[];
}
export interface MobileDesktopCatalog {
  snapshot(): MobileCatalogSnapshot;
  avatar?(runtimeId: string, avatarId: string): Json;
}
const capabilities = [
  "chat",
  "taskDispatch",
  "streaming",
  "cancellation",
  "tools",
  "memory",
  "orchestration",
  "readOnlyPlanning",
  "mailbox",
  "securityEvents",
  "artifacts",
  "artifactUpload",
  "workspaceAccess",
  "commands",
  "modelSelection",
] as const;
function unique(values: { id: string }[]): void {
  if (new Set(values.map((value) => value.id)).size !== values.length)
    throw Object.assign(Error("requires_owner_action"), {
      code: "requires_owner_action",
      status: 409,
    });
}

/** Public directory entries never become execution authority; every mutation reauthorizes. */
export class DesktopMobileCatalog implements MobileDesktopCatalog {
  constructor(
    private readonly source: DesktopCatalogSource,
    private readonly backend: OwnerExecutionBackend,
    private readonly now: () => number = Date.now,
  ) {}
  snapshot(): MobileCatalogSnapshot {
    const runtimes = this.source.runtimes(),
      projects = this.source.projects(),
      policies = this.source.policies();
    unique(runtimes);
    unique(projects);
    unique(policies);
    const runtimeIds = new Set(runtimes.map((value) => value.id));
    const projectIds = new Set(projects.map((value) => value.id));
    const policyRows = policies.map((policy) => {
      let verified = false;
      const candidate = runtimes.find(
        (runtime) => runtime.id === policy.runtimeId,
      );
      if (
        runtimeIds.has(policy.runtimeId) &&
        candidate?.enabled &&
        !candidate.configurationIssue &&
        !candidate.needsReauthorization &&
        (!policy.projectId || projectIds.has(policy.projectId))
      ) {
        try {
          const approved = this.backend.authorize(
            policy.id,
            policy.runtimeId,
            policy.projectId,
          );
          verified =
            policy.enforced &&
            approved.policyId === policy.id &&
            approved.runtime.id === policy.runtimeId &&
            approved.projectId === policy.projectId &&
            approved.task.mode ===
              (policy.mode === "desktop_full_access"
                ? "full_access"
                : ["inspect", "desktop_analysis"].includes(policy.mode)
                  ? "analysis"
                  : policy.mode === "desktop_auto"
                    ? automaticRuntimeTaskMode(candidate!, Boolean(policy.projectId))
                    : "safe_write") &&
            (["inspect", "desktop_analysis", "desktop_auto", "desktop_full_access"].includes(policy.mode) || Boolean(policy.projectId)) &&
            (policy.mode !== "desktop_full_access" || approved.task.fullAccessConfirmed === true);
        } catch {
          /* Unapproved policies remain visible with a restriction. */
        }
      }
      const value: Json = {
        id: policy.id,
        runtimeId: policy.runtimeId,
        projectId: policy.projectId ?? null,
        mode: policy.mode,
        enforced: verified,
        unattendedApproved: verified && policy.unattendedApproved === true,
        allowedActions: verified
          ? [
              "create",
              "advance",
              ...(policy.unattendedApproved === true ? ["trigger"] : []),
            ]
          : [],
        restrictionReason: verified ? null : "unverified_policy",
      };
      assertMobileSchema("ExecutionPolicy", value);
      return value;
    });
    // @lat: [[mobile-data#Mobile data#Public desktop selection catalog]]
    return {
      runtimes: runtimes.map((runtime) => {
        const available =
          runtime.enabled &&
          !runtime.configurationIssue &&
          !runtime.needsReauthorization;
        const executable =
          available &&
          policyRows.some(
            (policy) =>
              policy.runtimeId === runtime.id && policy.enforced === true,
          );
        const probe = runtime.lastProbe;
        const age = probe ? this.now() - probe.checkedAt : Infinity;
        const value: Json = {
          id: runtime.id,
          name: runtime.name,
          category:
            deriveAgentTransport(runtime) === "local-web"
              ? "web"
              : runtime.location,
          avatar: projectRuntimeAvatar(runtime.avatar)?.id ?? null,
          healthy:
            available &&
            probe?.state === "healthy" &&
            age >= 0 &&
            age <= 300000,
          capabilities: capabilities.filter(
            (key) => runtime.capabilitySnapshot?.[key] === true,
          ),
          allowedActions: [
            "read",
            ...(executable ? ["create", "advance"] : []),
          ],
          restrictionReason: executable ? null : "requires_owner_action",
          ...(runtime.color && /^#[\da-f]{6}$/i.test(runtime.color)
            ? { color: runtime.color }
            : {}),
        };
        assertMobileSchema("Runtime", value);
        return value;
      }),
      projects: projects.map((project) => {
        const value: Json = {
          id: project.id,
          name: project.name,
          allowedExecutionPolicyIds: policyRows
            .filter(
              (policy) =>
                policy.projectId === project.id && policy.enforced === true,
            )
            .map((policy) => policy.id),
        };
        assertMobileSchema("Project", value);
        return value;
      }),
      policies: policyRows,
    };
  }
  avatar(runtimeId: string, avatarId: string): Json {
    const runtimes = this.source.runtimes();
    unique(runtimes);
    const runtime = runtimes.find((value) => value.id === runtimeId);
    const content = projectRuntimeAvatar(runtime?.avatar);
    if (!content || content.id !== avatarId)
      throw Object.assign(Error("resource_not_found"), {
        code: "resource_not_found",
        status: 404,
      });
    const value: Json = { ...content, runtimeId };
    assertMobileSchema("RuntimeAvatar", value);
    return value;
  }
}
