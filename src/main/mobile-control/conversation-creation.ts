import type {
  OwnerExecutionBackend,
  ApprovedExecution,
} from "./execution-types";
import type { RuntimeConversation } from "../../shared/runtime-conversations";
import {
  getRuntimeConversation,
  saveRuntimeConversation,
} from "../runtime-conversation-store";

export interface NewMobileConversation {
  runtimeId: string;
  executionPolicyId: string;
  projectId?: string | null;
  title?: string;
}
export interface MobileConversationCreation {
  validate(input: NewMobileConversation): void;
  create(id: string, input: NewMobileConversation): RuntimeConversation;
}

/** Empty original records use the same trusted policy checks as the first Turn. */
export class DesktopConversationCreation implements MobileConversationCreation {
  constructor(
    private readonly profile: string,
    private readonly backend: OwnerExecutionBackend,
  ) {}
  validate(input: NewMobileConversation): void {
    this.authorize(input);
  }
  private authorize(input: NewMobileConversation): ApprovedExecution {
    const desktopTaskPolicy = input.executionPolicyId.startsWith("desktop-task-");
    const approved = this.backend.authorize(
      input.executionPolicyId,
      input.runtimeId,
      input.projectId ?? undefined,
    );
    const mode = approved.task.mode;
    if (
      approved.policyId !== input.executionPolicyId ||
      approved.runtime.id !== input.runtimeId ||
      approved.projectId !== (input.projectId ?? undefined) ||
      !(mode === "analysis" || mode === "safe_write" || mode === "full_access") ||
      (mode === "safe_write" && !approved.projectId && !desktopTaskPolicy) ||
      (mode === "full_access" &&
        (!desktopTaskPolicy || approved.task.fullAccessConfirmed !== true))
    )
      throw Object.assign(Error("unverified_policy"), {
        code: "unverified_policy",
        status: 403,
      });
    return approved;
  }
  create(id: string, input: NewMobileConversation): RuntimeConversation {
    const approved = this.authorize(input);
    if (getRuntimeConversation(id, this.profile, { fullHistory: true }))
      throw Object.assign(Error("reconciliation_required"), {
        code: "reconciliation_required",
        status: 409,
      });
    const runtime = approved.runtime;
    if (
      approved.runtime.id !== input.runtimeId ||
      approved.projectId !== (input.projectId ?? undefined)
    )
      throw Object.assign(Error("unverified_policy"), {
        code: "unverified_policy",
        status: 403,
      });
    return saveRuntimeConversation({
      profile: this.profile,
      id,
      title: input.title?.trim() || runtime.name,
      runtimeId: runtime.id,
      runtimeName: runtime.name,
      runtimeKind: runtime.kind,
      runtimeLocation: runtime.location,
      runtimeAvatar: runtime.avatar,
      runtimeColor: runtime.color,
      workspaceId: approved.projectId,
      accessMode:
        approved.task.mode === "analysis"
          ? "analysis"
          : approved.task.mode === "full_access"
            ? "full_access"
            : "auto",
      messages: [],
    });
  }
}
