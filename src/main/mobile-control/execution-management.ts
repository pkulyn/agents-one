import type {
  MobileExecutionManagementCommand,
  MobileExecutionManagementResult,
  MobileExecutionReview,
  MobileExecutionSelection,
} from "../../shared/mobile-execution-management";
import { MobileExecutionPolicyStore } from "./execution-policy-store";
import { createDesktopExecutionPolicyStore } from "./desktop-policy-authority";
import { refreshDesktopExecutionApprovals } from "./desktop-policy-authority";
import {
  prepareDesktopCodexPolicy,
  verifyDesktopCodexPolicy,
} from "./codex-policy-verifier";
import { DesktopConversationRepository } from "./desktop-conversations";
import { listAgentRuntimes } from "../agent-runtimes";
import { getActiveProfileNameSync, agentsOneProfileHome } from "../utils";
import {
  assertAgentsOneWritesAllowed,
  isAgentsOneRestoreWriteLocked,
} from "../restore-write-lock";

interface ManagementSource {
  store: MobileExecutionPolicyStore;
  runtimes(): Array<{ id: string; name: string; available: boolean }>;
  projects(): Array<{ id: string; name: string }>;
  guard(write: boolean): void;
}
const id = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) &&
  !value.includes("..");
const revision = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]{0,63})$/.test(value);
function fail(code: string): never {
  throw Object.assign(Error(code), { code });
}
function fields(
  value: unknown,
  allowed: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    fail("invalid_input");
}
function validate(command: MobileExecutionManagementCommand): void {
  fields(command, ["action", "selection", "expectedRevision", "id"]);
  if (!["status", "review", "approve", "revoke"].includes(command.action))
    fail("invalid_input");
  fields(command, [
    "action",
    ...{
      status: [],
      review: ["selection"],
      approve: ["selection", "expectedRevision"],
      revoke: ["id", "expectedRevision"],
    }[command.action],
  ]);
  if (command.action === "approve" || command.action === "revoke")
    if (!revision(command.expectedRevision)) fail("invalid_input");
  if (command.action === "revoke") {
    if (!id(command.id)) fail("invalid_input");
  }
  if (command.action === "review" || command.action === "approve") {
    const input = command.selection;
    fields(input, ["runtimeId", "projectId", "mode", "unattendedApproved"]);
    if (
      !id(input.runtimeId) ||
      (input.projectId !== undefined && !id(input.projectId)) ||
      !["inspect", "project_write"].includes(input.mode) ||
      typeof input.unattendedApproved !== "boolean" ||
      (input.mode === "project_write" && !input.projectId)
    )
      fail("invalid_input");
  }
}
const errors = [
  "invalid_input",
  "profile_inactive",
  "restore_write_locked",
  "revision_conflict",
  "resource_not_found",
  "requires_owner_action",
  "unverified_policy",
];
export function mobileExecutionManagementError(error: unknown): string {
  const value = error as { code?: string; message?: string };
  return (
    errors.find((code) => value?.code === code || value?.message === code) ||
    "mobile_execution_unavailable"
  );
}

/** Local Owner approval UI uses current proof and CAS, independently of cloud pairing. */
export class MobileExecutionManagement {
  constructor(private readonly source: ManagementSource) {}
  execute(
    command: MobileExecutionManagementCommand,
  ): MobileExecutionManagementResult {
    validate(command);
    this.source.guard(
      command.action === "approve" || command.action === "revoke",
    );
    let review: MobileExecutionReview | undefined;
    if (command.action === "review") {
      const selection: MobileExecutionSelection = { ...command.selection };
      try {
        review = {
          selection,
          verified: true,
          ...this.source.store.inspect(selection),
        };
      } catch (error) {
        review = {
          selection,
          verified: false,
          unattendedSupported: false,
          restrictionReason: mobileExecutionManagementError(error),
        };
      }
    }
    if (command.action === "approve")
      this.source.store.approve(command.selection, command.expectedRevision);
    if (command.action === "revoke")
      this.source.store.revoke(command.id, command.expectedRevision);
    this.source.guard(false);
    const snapshot = this.source.store.snapshot();
    const result: MobileExecutionManagementResult = {
      status: {
        revision: snapshot.revision,
        runtimes: this.source.runtimes().map((row) => ({
          id: row.id,
          name: row.name,
          available: row.available,
        })),
        projects: this.source
          .projects()
          .map((row) => ({ id: row.id, name: row.name })),
        policies: snapshot.policies.map((row) => ({
          id: row.id,
          runtimeId: row.runtimeId,
          ...(row.projectId ? { projectId: row.projectId } : {}),
          mode: row.mode,
          unattendedApproved: row.unattendedApproved,
          verified: row.enforced,
        })),
      },
      ...(review ? { review } : {}),
    };
    this.source.guard(false);
    return result;
  }
}

export function manageMobileExecutionPolicies(
  profile: string | undefined,
  command: MobileExecutionManagementCommand,
): MobileExecutionManagementResult {
  try {
    if (profile !== undefined && (typeof profile !== "string" || !profile))
      fail("invalid_input");
    const name = profile ?? getActiveProfileNameSync();
    const home = agentsOneProfileHome(name);
    const guard = (write: boolean): void => {
      if (getActiveProfileNameSync() !== name || agentsOneProfileHome(name) !== home)
        fail("profile_inactive");
      if (write && isAgentsOneRestoreWriteLocked())
        fail("restore_write_locked");
      if (write) assertAgentsOneWritesAllowed();
    };
    guard(false);
    const repository = new DesktopConversationRepository(name);
    const manager = new MobileExecutionManagement({
      store: createDesktopExecutionPolicyStore(name, repository),
      runtimes: () =>
        listAgentRuntimes().map((row) => ({
          id: row.id,
          name: row.name,
          available:
            row.enabled && !row.configurationIssue && !row.needsReauthorization,
        })),
      projects: () => repository.projects(),
      guard,
    });
    return manager.execute(command);
  } catch (error) {
    return fail(mobileExecutionManagementError(error));
  }
}

/** Validate before any native preparation; only the trusted desktop frame invokes this. */
const preparedReviews = new Map<
  string,
  { fingerprint: string; revision: string; expiresAt: number }
>();
export async function prepareAndManageMobileExecutionPolicies(
  profile: string | undefined,
  command: MobileExecutionManagementCommand,
  assertRequestCurrent: () => void = () => undefined,
): Promise<MobileExecutionManagementResult> {
  try {
    validate(command);
    command =
      command.action === "review" || command.action === "approve"
        ? { ...command, selection: { ...command.selection } }
        : { ...command };
    if (profile !== undefined && (typeof profile !== "string" || !profile))
      fail("invalid_input");
    const name = profile ?? getActiveProfileNameSync();
    const home = agentsOneProfileHome(name);
    const guard = (): void => {
      assertRequestCurrent();
      if (getActiveProfileNameSync() !== name || agentsOneProfileHome(name) !== home)
        fail("profile_inactive");
      if (isAgentsOneRestoreWriteLocked()) fail("restore_write_locked");
    };
    guard();
    const repository = new DesktopConversationRepository(name);
    const reviewKey =
      command.action === "review" || command.action === "approve"
        ? JSON.stringify([
            name,
            home,
            command.selection.runtimeId,
            command.selection.projectId ?? null,
            command.selection.mode,
            command.selection.unattendedApproved,
          ])
        : undefined;
    if (command.action === "review" || command.action === "approve") {
      const selection = command.selection;
      const runtime = listAgentRuntimes().find(
        (value) => value.id === selection.runtimeId,
      );
      if (!runtime) fail("resource_not_found");
      const previousReview = preparedReviews.get(reviewKey!);
      if (command.action === "review") preparedReviews.delete(reviewKey!);
      if (command.action === "approve") {
        if (
          !previousReview ||
          previousReview.expiresAt <= Date.now() ||
          previousReview.revision !== command.expectedRevision
        )
          fail("unverified_policy");
        if (
          createDesktopExecutionPolicyStore(
            name,
            repository,
          ).currentRevision() !== command.expectedRevision
        )
          fail("revision_conflict");
      }
      try {
        await prepareDesktopCodexPolicy(
          name,
          repository,
          command.selection,
          runtime,
          true,
        );
      } catch (error) {
        if (command.action === "approve") throw error;
      }
      guard();
      if (command.action === "approve") {
        preparedReviews.delete(reviewKey!);
        const current = verifyDesktopCodexPolicy(
          name,
          repository,
          command.selection,
          runtime,
        );
        if (
          !current ||
          current.enforcementFingerprint !== previousReview!.fingerprint
        )
          fail("unverified_policy");
      }
    } else if (command.action === "status") {
      await refreshDesktopExecutionApprovals(name, repository);
    }
    guard();
    const result = manageMobileExecutionPolicies(name, command);
    if (command.action === "review" && result.review?.verified) {
      const selection = command.selection;
      const runtime = listAgentRuntimes().find(
        (value) => value.id === selection.runtimeId,
      );
      const evidence =
        runtime &&
        verifyDesktopCodexPolicy(name, repository, command.selection, runtime);
      if (!evidence) fail("unverified_policy");
      while (preparedReviews.size >= 64)
        preparedReviews.delete(preparedReviews.keys().next().value!);
      preparedReviews.set(reviewKey!, {
        fingerprint: evidence.enforcementFingerprint,
        revision: result.status.revision,
        expiresAt: evidence.expiresAt,
      });
    }
    return result;
  } catch (error) {
    return fail(mobileExecutionManagementError(error));
  }
}
