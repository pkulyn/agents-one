import { readFileSync } from "fs";
import { join } from "path";
import { readDesktopConfig, writeDesktopConfig } from "./config";
import type { AgentRuntimeDefinition } from "../shared/agent-runtimes";

/** Seed once; upgrades never replace existing One definitions or revive deletion. */
export function initializeDefaultOne(): void {
  const config = readDesktopConfig();
  if (config.oneDefaultInitialized === true) return;
  const entries = [config.oneAgentRuntimes, config.agentRuntimes].flatMap(
    (value) => (Array.isArray(value) ? value : []),
  );
  const hasOne = entries.some(
    (entry) => entry && typeof entry === "object" && entry.kind === "one",
  );
  // Unrecognized dedicated data belongs to the user, too. Do not replace it.
  if (!hasOne && !("oneAgentRuntimes" in config)) {
    const used = new Set(
      entries.map((entry) => String(entry?.id || "").toLowerCase()),
    );
    let id = "one";
    for (let suffix = 2; used.has(id); suffix++) id = `one-${suffix}`;
    const runtime: AgentRuntimeDefinition = {
      id,
      name: "One",
      kind: "one",
      adapterId: "one",
      vendorId: "agents-one",
      adapterVersion: "1.0.0",
      location: "local",
      connectionProfile: "local",
      enabled: true,
      managed: "user",
      color: "#159A9C",
      avatar: `data:image/png;base64,${readFileSync(join(__dirname, "../../resources/one-avatar.png")).toString("base64")}`,
      config: {
        agentTransport: "local-sdk",
        endpoint: "",
        model: "",
        oneApiType: "openai-completions",
        timeoutMs: 300_000,
      },
    };
    config.oneAgentRuntimes = [runtime];
    const appearances = config.agentRuntimeAppearances;
    // Appearance overrides are read separately from the runtime registry.
    // Preserve existing overrides (including an explicit null avatar).
    if (
      !appearances ||
      (typeof appearances === "object" && !Array.isArray(appearances))
    ) {
      config.agentRuntimeAppearances = {
        ...(appearances as Record<string, unknown> | undefined),
        [id]: {
          avatar: runtime.avatar,
          color: runtime.color,
          ...(appearances as Record<string, object> | undefined)?.[id],
        },
      };
    }
  }
  config.oneDefaultInitialized = true;
  writeDesktopConfig(config);
}
