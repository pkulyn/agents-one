import type { TaskSchedule } from "../../shared/task-schedules";
import { assertAgentsOneWritesAllowed } from "../restore-write-lock";
import { DesktopConversationRepository } from "./desktop-conversations";
import { createDesktopExecutionPolicyStore } from "./desktop-policy-authority";
import type { DesktopExecutionPolicyCatalog } from "./desktop-execution";
import { createDesktopTaskAccess } from "./desktop-task-selection";
import type {
  OwnerExecutionBackend,
  ApprovedExecution,
} from "./execution-types";
import type { Json } from "./conversation-projection";

export interface MobileScheduleAuthority {
  authorize(draft: Json): "analysis" | "auto";
  available(): boolean;
}
const deny = (): never => {
  throw Object.assign(Error("unverified_policy"), {
    code: "unverified_policy",
    status: 403,
  });
};
/** Uses actual Owner approvals and fresh trusted proof, including unattended consent. */
export function desktopMobileScheduleAuthority(
  policies: DesktopExecutionPolicyCatalog,
  backend: OwnerExecutionBackend,
): MobileScheduleAuthority {
  return {
    available: () => {
      try {
        return policies
          .list()
          .some((policy) => policy.enforced && policy.unattendedApproved);
      } catch {
        return false;
      }
    },
    authorize(draft) {
      assertAgentsOneWritesAllowed();
      const policyId = String(draft.executionPolicyId);
      const projectId =
        draft.projectId == null ? undefined : String(draft.projectId);
      const policy = policies.authorize(policyId);
      if (!(policy as { unattendedApproved?: boolean }).unattendedApproved)
        return deny();
      const approved = backend.authorize(
        policyId,
        String(draft.runtimeId),
        projectId,
      );
      return approved.task.mode === "analysis"
        ? "analysis"
        : approved.task.mode === "safe_write"
          ? "auto"
          : deny();
    },
  };
}
/** Called independently of the mobile transport, so disconnecting cannot bypass policy. */
export function authorizeOriginalMobileSchedule(
  schedule: TaskSchedule,
  profile: string,
): {
  backend: OwnerExecutionBackend;
  task: ApprovedExecution["task"];
  dispatchOptions?: ApprovedExecution["dispatchOptions"];
} {
  if (
    typeof schedule.mobileExecutionPolicyId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(
      schedule.mobileExecutionPolicyId,
    )
  )
    return deny();
  const repository = new DesktopConversationRepository(profile);
  const legacy = createDesktopExecutionPolicyStore(profile, repository);
  const { policies, backend } = createDesktopTaskAccess(
    profile,
    repository,
    legacy,
  );
  const mode = desktopMobileScheduleAuthority(policies, backend).authorize({
    executionPolicyId: schedule.mobileExecutionPolicyId,
    runtimeId: schedule.runtimeId,
    projectId: schedule.workspaceId ?? null,
  });
  if (schedule.mode !== mode || schedule.workspace) return deny();
  const approved = backend.authorize(
    schedule.mobileExecutionPolicyId,
    schedule.runtimeId,
    schedule.workspaceId,
  );
  return {
    backend,
    task: approved.task,
    dispatchOptions: approved.dispatchOptions,
  };
}
