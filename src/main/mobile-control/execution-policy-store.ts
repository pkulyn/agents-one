import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import type { AgentRuntimeDefinition } from "../../shared/agent-runtimes";
import type {
  DesktopExecutionPolicyCatalog,
  EnforcedDesktopExecutionPolicy,
} from "./desktop-execution";
import { desktopRuntimePolicyFingerprint } from "./desktop-execution";

export interface OwnerPolicySelection {
  runtimeId: string;
  projectId?: string;
  mode: "inspect" | "project_write";
  unattendedApproved: boolean;
}
/** Produced by a trusted Main verifier for the actual executor/tool boundary. */
export interface OwnerPolicyEvidence {
  enforcementId: string;
  enforcementFingerprint: string;
  runtimeConfigurationHash: string;
  /** Main's effective original Codex config, including the selected explicit model. */
  codexConfigurationHash?: string;
  codexProjectWriteWorkerHash?: string;
  projectCapabilityHash?: string;
  mode: "inspect" | "project_write";
  verified: boolean;
  unattendedSupported: boolean;
  expiresAt: number;
}
export interface OwnerPolicyAuthority {
  runtime(id: string): AgentRuntimeDefinition | undefined;
  project(id: string): { capabilityHash: string } | undefined;
  verify(
    selection: OwnerPolicySelection,
    runtime: AgentRuntimeDefinition,
  ): OwnerPolicyEvidence | undefined;
  assertWritesAllowed(): void;
}
interface Approval extends OwnerPolicySelection {
  id: string;
  runtimeConfigurationHash: string;
  codexConfigurationHash?: string;
  codexProjectWriteWorkerHash?: string;
  projectCapabilityHash?: string;
  enforcementId: string;
  enforcementFingerprint: string;
  approvedAt: number;
  [key: string]: unknown;
}
interface Document {
  schemaVersion: 1;
  revision: string;
  approvals: Approval[];
  [key: string]: unknown;
}
type StoredPolicy = EnforcedDesktopExecutionPolicy & { mode: "inspect" | "project_write"; unattendedApproved: boolean };
const id = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) &&
  !value.includes("..");
const fingerprint = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const revision = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]{0,63})$/.test(value);
function fail(code: string, status = 403): never {
  throw Object.assign(Error(code), { code, status });
}
function selection(value: OwnerPolicySelection): boolean {
  return Boolean(
    value &&
    id(value.runtimeId) &&
    (value.projectId === undefined || id(value.projectId)) &&
    ["inspect", "project_write"].includes(value.mode) &&
    typeof value.unattendedApproved === "boolean" &&
    (value.mode !== "project_write" || value.projectId),
  );
}
function approval(value: unknown): value is Approval {
  if (!value || typeof value !== "object") return false;
  const row = value as Approval;
  return (
    selection(row) &&
    id(row.id) &&
    fingerprint(row.runtimeConfigurationHash) &&
    (row.codexConfigurationHash === undefined ||
      fingerprint(row.codexConfigurationHash)) &&
    (row.codexProjectWriteWorkerHash === undefined ||
      fingerprint(row.codexProjectWriteWorkerHash)) &&
    (row.projectId
      ? fingerprint(row.projectCapabilityHash)
      : row.projectCapabilityHash === undefined) &&
    id(row.enforcementId) &&
    fingerprint(row.enforcementFingerprint) &&
    Number.isSafeInteger(row.approvedAt) &&
    row.approvedAt >= 0
  );
}

/** Approval persists intent; current trusted proof supplies authority on every use. */
export class MobileExecutionPolicyStore implements DesktopExecutionPolicyCatalog {
  constructor(
    readonly file: string,
    private readonly authority: OwnerPolicyAuthority,
    private readonly now: () => number = Date.now,
  ) {}
  private read(): Document {
    if (!existsSync(this.file))
      return { schemaVersion: 1, revision: "0", approvals: [] };
    try {
      const value = JSON.parse(readFileSync(this.file, "utf8")) as Document;
      if (
        value.schemaVersion !== 1 ||
        !revision(value.revision) ||
        !Array.isArray(value.approvals) ||
        !value.approvals.every(approval) ||
        new Set(value.approvals.map((row) => row.id)).size !==
          value.approvals.length
      )
        throw Error();
      return value;
    } catch {
      return fail("requires_owner_action", 409);
    }
  }
  currentRevision(): string {
    return this.read().revision;
  }
  /** Saved Owner intent only; each selection still requires fresh trusted Main evidence. */
  approvalSelections(): OwnerPolicySelection[] {
    return this.read().approvals.map((row) => ({
      runtimeId: row.runtimeId,
      ...(row.projectId ? { projectId: row.projectId } : {}),
      mode: row.mode,
      unattendedApproved: row.unattendedApproved,
    }));
  }
  /** Read-only capability review; never accepts renderer-provided evidence. */
  inspect(
    input: OwnerPolicySelection,
  ): Pick<OwnerPolicyEvidence, "unattendedSupported" | "expiresAt"> {
    const proof = this.proof(input);
    return {
      unattendedSupported: proof.unattendedSupported,
      expiresAt: proof.expiresAt,
    };
  }
  private proof(input: OwnerPolicySelection): OwnerPolicyEvidence {
    if (!selection(input)) fail("invalid_input", 422);
    const runtime = this.authority.runtime(input.runtimeId);
    if (!runtime) fail("resource_not_found", 404);
    if (
      !runtime.enabled ||
      runtime.configurationIssue ||
      runtime.needsReauthorization
    )
      fail("requires_owner_action");
    const project = input.projectId
      ? this.authority.project(input.projectId)
      : undefined;
    if (input.projectId && !project) fail("resource_not_found", 404);
    const value = this.authority.verify(input, runtime);
    if (
      !value ||
      value.verified !== true ||
      value.mode !== input.mode ||
      !id(value.enforcementId) ||
      !fingerprint(value.enforcementFingerprint) ||
      value.runtimeConfigurationHash !==
        desktopRuntimePolicyFingerprint(runtime) ||
      (value.codexConfigurationHash !== undefined &&
        !fingerprint(value.codexConfigurationHash)) ||
      (value.codexProjectWriteWorkerHash !== undefined &&
        !fingerprint(value.codexProjectWriteWorkerHash)) ||
      value.projectCapabilityHash !== project?.capabilityHash ||
      (project && !fingerprint(project.capabilityHash)) ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= this.now() ||
      (input.unattendedApproved && value.unattendedSupported !== true)
    )
      fail("unverified_policy");
    return value;
  }
  private validate(row: Approval): void {
    const proof = this.proof(row);
    if (
      proof.runtimeConfigurationHash !== row.runtimeConfigurationHash ||
      proof.codexConfigurationHash !== row.codexConfigurationHash ||
      proof.codexProjectWriteWorkerHash !== row.codexProjectWriteWorkerHash ||
      proof.projectCapabilityHash !== row.projectCapabilityHash ||
      proof.enforcementId !== row.enforcementId ||
      proof.enforcementFingerprint !== row.enforcementFingerprint
    )
      fail("unverified_policy");
  }
  private publicPolicy(
    row: Approval,
    enforced: boolean,
  ): StoredPolicy {
    return {
      id: row.id,
      runtimeId: row.runtimeId,
      projectId: row.projectId,
      mode: row.mode,
      enforced,
      runtimeConfigurationHash: row.runtimeConfigurationHash,
      ...(enforced && row.codexConfigurationHash
        ? { codexConfigurationHash: row.codexConfigurationHash }
        : {}),
      ...(enforced && row.codexProjectWriteWorkerHash
        ? { codexProjectWriteWorkerHash: row.codexProjectWriteWorkerHash }
        : {}),
      unattendedApproved: enforced && row.unattendedApproved,
    };
  }
  list(): StoredPolicy[] {
    return this.snapshot().policies;
  }
  snapshot(): {
    revision: string;
    policies: StoredPolicy[];
  } {
    const document = this.read();
    const policies = document.approvals.map((row) => {
      let enforced = false;
      try {
        this.validate(row);
        enforced = true;
      } catch {
        /* Keep revoked approval visible as restricted. */
      }
      return this.publicPolicy(row, enforced);
    });
    return { revision: document.revision, policies };
  }
  authorize(
    policyId: string,
  ): StoredPolicy {
    const row = this.read().approvals.find((value) => value.id === policyId);
    if (!row) fail("resource_not_found", 404);
    this.validate(row);
    return this.publicPolicy(row, true);
  }
  approve(
    input: OwnerPolicySelection,
    expectedRevision: string,
    policyId = `policy-${randomUUID()}`,
  ): string {
    this.authority.assertWritesAllowed();
    if (!id(policyId)) fail("invalid_input", 422);
    const value = this.read();
    if (!revision(expectedRevision) || value.revision !== expectedRevision)
      fail("revision_conflict", 409);
    const proof = this.proof(input);
    const previous = value.approvals.find((row) => row.id === policyId);
    const row: Approval = {
      ...previous,
      ...input,
      id: policyId,
      runtimeConfigurationHash: proof.runtimeConfigurationHash,
      codexConfigurationHash: proof.codexConfigurationHash,
      codexProjectWriteWorkerHash: proof.codexProjectWriteWorkerHash,
      projectCapabilityHash: proof.projectCapabilityHash,
      enforcementId: proof.enforcementId,
      enforcementFingerprint: proof.enforcementFingerprint,
      approvedAt: this.now(),
    };
    value.approvals = [
      row,
      ...value.approvals.filter((item) => item.id !== policyId),
    ];
    value.revision = (BigInt(value.revision) + 1n).toString();
    if (!revision(value.revision)) fail("requires_owner_action", 409);
    this.write(value, () => this.validate(row));
    return policyId;
  }
  revoke(policyId: string, expectedRevision: string): void {
    this.authority.assertWritesAllowed();
    const value = this.read();
    if (!revision(expectedRevision) || value.revision !== expectedRevision)
      fail("revision_conflict", 409);
    if (!value.approvals.some((row) => row.id === policyId))
      fail("resource_not_found", 404);
    value.approvals = value.approvals.filter((row) => row.id !== policyId);
    value.revision = (BigInt(value.revision) + 1n).toString();
    if (!revision(value.revision)) fail("requires_owner_action", 409);
    this.write(value);
  }
  private write(value: Document, beforeCommit?: () => void): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp-${randomUUID()}`;
    let handle: number | undefined;
    try {
      handle = openSync(temporary, "wx", 0o600);
      const bytes = Buffer.from(JSON.stringify(value));
      let offset = 0;
      while (offset < bytes.length)
        offset += writeSync(handle, bytes, offset, bytes.length - offset);
      fsyncSync(handle);
      closeSync(handle);
      handle = undefined;
      beforeCommit?.();
      this.authority.assertWritesAllowed();
      renameSync(temporary, this.file);
    } catch (error) {
      if (handle !== undefined) closeSync(handle);
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
  }
}

/** Opaque project capability binding; full paths stay on the Owner. */
export function mobileProjectCapabilityHash(project: {
  id: string;
  path: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([project.id, project.path]))
    .digest("hex");
}
