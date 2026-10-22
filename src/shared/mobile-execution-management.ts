export interface MobileExecutionSelection {
  runtimeId: string;
  projectId?: string;
  mode: "inspect" | "project_write";
  unattendedApproved: boolean;
}
export interface MobileExecutionApprovalStatus {
  revision: string;
  runtimes: Array<{ id: string; name: string; available: boolean }>;
  projects: Array<{ id: string; name: string }>;
  policies: Array<MobileExecutionSelection & { id: string; verified: boolean }>;
}
export interface MobileExecutionReview {
  selection: MobileExecutionSelection;
  verified: boolean;
  unattendedSupported: boolean;
  expiresAt?: number;
  restrictionReason?: string;
}
export type MobileExecutionManagementCommand =
  | { action: "status" }
  | { action: "review"; selection: MobileExecutionSelection }
  | {
      action: "approve";
      selection: MobileExecutionSelection;
      expectedRevision: string;
    }
  | { action: "revoke"; id: string; expectedRevision: string };
export interface MobileExecutionManagementResult {
  status: MobileExecutionApprovalStatus;
  review?: MobileExecutionReview;
}
