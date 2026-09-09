import type { AgentRuntimeProbe } from "../../../shared/agent-runtimes";
import { manifestForAdapterId } from "../../../shared/runtime-adapters";
import type { RuntimeAdapter } from "../types";
import { probeOpenCodeRuntime } from "./opencode-acp";

const manifest = manifestForAdapterId("opencode");
if (!manifest) throw new Error("OpenCode adapter manifest is missing.");

export const openCodeAcpAdapter: RuntimeAdapter = {
  manifest,
  async probe({ runtime }): Promise<AgentRuntimeProbe> {
    const result = await probeOpenCodeRuntime({
      executablePath: runtime.config.executablePath,
      acpArgs: runtime.config.acpArgs,
      model: runtime.config.model,
      agent: runtime.config.agent,
      workspace: runtime.config.workspace,
      timeoutMs: runtime.config.timeoutMs,
    });
    return {
      runtimeId: runtime.id,
      state: result.healthy ? "healthy" : "unreachable",
      capabilities: result.healthy
        ? result.capabilities
        : {
            ...result.capabilities,
            chat: false,
            taskDispatch: false,
            streaming: false,
            cancellation: false,
            tools: false,
            workspaceAccess: false,
          },
      checkedAt: Date.now(),
      ...(result.message ? { message: result.message } : {}),
    };
  },
};
