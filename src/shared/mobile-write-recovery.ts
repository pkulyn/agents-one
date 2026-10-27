export interface MobileWriteRecoveryItem {
  id: string;
  runId: string;
  projectId: string;
  path: string;
  state:
    | "matches_requested"
    | "matches_previous"
    | "changed"
    | "unavailable"
    | "blocked";
  reviewToken?: string;
  restrictionReason?:
    | "run_active"
    | "run_unavailable"
    | "requires_owner_action";
}
export type MobileWriteRecoveryCommand =
  | { action: "status" }
  | { action: "release"; id: string; reviewToken: string; acknowledged: true };
export interface MobileWriteRecoveryStatus {
  items: MobileWriteRecoveryItem[];
  capacityExceeded: boolean;
}
