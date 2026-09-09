import type { AgentRuntimeProbe } from "../../../shared/agent-runtimes";
import { manifestForAdapterId } from "../../../shared/runtime-adapters";
import {
  probeAgentsOneRemoteGateway,
  type AgentsOneRemoteGatewayConfig,
} from "../../agents-one-remote-gateway";
import type { RuntimeAdapter } from "../types";

const manifest = manifestForAdapterId("openclaw");
if (!manifest) throw new Error("OpenClaw adapter manifest is missing.");

/**
 * The desktop deliberately speaks only Gateway v1. OpenClaw's native
 * WebSocket/Bridge protocol stays behind the remote Connector/Adapter.
 */
export const openClawGatewayAdapter: RuntimeAdapter = {
  manifest,
  async probe({ runtime, auth, transientAuth }): Promise<AgentRuntimeProbe> {
    const endpoint = runtime.config.endpoint?.trim() || "";
    const result = await probeAgentsOneRemoteGateway(
      {
        endpoint,
        timeoutMs: runtime.config.timeoutMs,
        connect: runtime.config.connect,
      } satisfies AgentsOneRemoteGatewayConfig,
      transientAuth || auth,
    );
    return {
      runtimeId: runtime.id,
      state: result.healthy ? "healthy" : "unreachable",
      capabilities: result.capabilities,
      checkedAt: Date.now(),
      ...(result.message ? { message: result.message } : {}),
    };
  },
};
