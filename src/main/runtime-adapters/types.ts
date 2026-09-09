import type {
  AgentRuntimeDefinition,
  AgentRuntimeProbe,
  AgentRuntimeRun,
  AgentRuntimeTaskInput,
} from "../../shared/agent-runtimes";
import type { AgentRuntimeAdapterManifest } from "../../shared/runtime-adapters";

export interface RuntimeAdapterContext {
  runtime: AgentRuntimeDefinition;
  /** Main-process-only secret material; never serialized to the renderer. */
  auth?: { bearerToken?: string };
  transientAuth?: { bearerToken?: string };
}

export interface RuntimeAdapterStartContext extends RuntimeAdapterContext {
  input: AgentRuntimeTaskInput;
}

/** The execution-facing contract implemented by built-in and plugin adapters. */
export interface RuntimeAdapter {
  readonly manifest: AgentRuntimeAdapterManifest;
  /** Optional during the legacy-wrapper migration; required for new adapters. */
  probe?(context: RuntimeAdapterContext): Promise<AgentRuntimeProbe>;
  start?(context: RuntimeAdapterStartContext): Promise<AgentRuntimeRun>;
  get?(
    runId: string,
    context: RuntimeAdapterContext,
  ): Promise<AgentRuntimeRun | null>;
  cancel?(runId: string, context: RuntimeAdapterContext): Promise<boolean>;
  continue?(context: RuntimeAdapterStartContext): Promise<AgentRuntimeRun>;
  listModels?(context: RuntimeAdapterContext): Promise<unknown[]>;
  dispose?(): Promise<void>;
}
