import type { MobileOwnerLedger } from "./owner-ledger";

type PublicLedgerMethodName = {
  [K in keyof MobileOwnerLedger]: MobileOwnerLedger[K] extends (
    ...args: never[]
  ) => unknown
    ? K
    : never;
}[keyof MobileOwnerLedger];

export type MobileOwnerLedgerRpcMethod = Exclude<
  PublicLedgerMethodName,
  "writeRecoverySnapshot" | "snapshotExecutionEntries"
>;

export const MOBILE_OWNER_LEDGER_RPC_METHODS = [
  "close",
  "observeReadonlySource",
  "operation",
  "accept",
  "complete",
  "reject",
  "uncertain",
  "operations",
  "stageExecution",
  "execution",
  "executionEntries",
  "executionPrepared",
  "executionObserved",
  "executionCancelling",
  "executionUncertain",
  "executionRejected",
  "stageExecutionFinal",
  "executionFinalCommitted",
  "indexMessages",
  "delivered",
  "readPosition",
  "markRead",
  "publish",
  "observeSourceEvents",
  "sourceEventKeys",
  "observeSourceEventChanges",
  "cursor",
  "parseCursor",
  "eventsAfter",
] as const satisfies readonly MobileOwnerLedgerRpcMethod[];

type LedgerMethods = {
  [K in MobileOwnerLedgerRpcMethod]: MobileOwnerLedger[K] extends (
    ...args: infer A
  ) => infer R
    ? (...args: A) => R | Promise<Awaited<R>>
    : never;
};

export type MobileOwnerLedgerPort = Pick<
  MobileOwnerLedger,
  "ownerId" | "spaceId" | "dataEpoch" | "changeSeq"
> &
  LedgerMethods;
