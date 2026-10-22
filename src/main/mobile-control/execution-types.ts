import type {
  AgentRuntimeDefinition,
  AgentRuntimeRun,
  AgentRuntimeTaskInput,
} from "../../shared/agent-runtimes";
import type {
  RuntimeConversation,
  RuntimeConversationMessage,
} from "../../shared/runtime-conversations";
import type { AgentRuntimeDispatchOptions } from "../agent-runtimes";
import type { Json } from "./conversation-projection";

export interface ExecutionCheckpoint {
  message: RuntimeConversationMessage;
  sessionId?: string;
  terminalRun: Json;
}
/** Control evidence and one uncommitted final reply, never a second history store. */
export interface OwnerExecutionEntry {
  operationKey: string;
  requestId: string;
  deviceId: string;
  expectedRevision: string;
  messageId: string;
  phase:
    | "preparing"
    | "dispatching"
    | "running"
    | "persisting"
    | "terminal"
    | "reconciliation_required";
  turn: Json;
  run: Json;
  seenEventIds: string[];
  checkpoint?: ExecutionCheckpoint;
}
export interface OwnerExecutionPreparation {
  turnId: string;
  conversationId: string;
  runtimeId: string;
  runId: string;
  messageId: string;
  policyId: string;
  expectedRevision: string;
  createdAt: number;
}
export interface ApprovedExecution {
  policyId: string;
  runtime: AgentRuntimeDefinition;
  projectId?: string;
  /** Main policy provider must supply an enforced, Runtime/project-bound policy. */
  task: Pick<
    AgentRuntimeTaskInput,
    "mode" | "fullAccessConfirmed" | "workspaceId" | "workspaceRef" | "timeoutMs"
  >;
  /** Functions retained only in Main; never persisted or serialized to a phone. */
  dispatchOptions?: Pick<
    AgentRuntimeDispatchOptions,
    | "codexMobileProjectGuard"
    | "codexMobileConfigurationGuard"
    | "codexMobileProjectWrite"
    | "codexMobileProjectWriteWorkerHash"
    | "codexMobileInspection"
  >;
}
export interface OwnerExecutionBackend {
  authorize(
    policyId: string,
    runtimeId: string,
    projectId: string | undefined,
  ): ApprovedExecution;
  start(
    runtimeId: string,
    input: AgentRuntimeTaskInput,
    options: AgentRuntimeDispatchOptions,
  ): Promise<AgentRuntimeRun>;
  get(runId: string): Promise<AgentRuntimeRun | null>;
  cancel(runId: string): Promise<{
    accepted: boolean;
    run: AgentRuntimeRun | null;
    uncertain?: boolean;
  }>;
}
export interface OwnerExecutionStore {
  get(id: string): RuntimeConversation | null;
  projectId(value: RuntimeConversation): string | undefined;
  begin(
    id: string,
    revision: string,
    runId: string,
    message: RuntimeConversationMessage,
  ): RuntimeConversation;
  finish(
    id: string,
    runId: string,
    checkpoint: ExecutionCheckpoint,
  ): RuntimeConversation;
}
