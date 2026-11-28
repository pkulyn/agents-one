import type { AgentRuntimeDefinition } from "../../shared/agent-runtimes";
import {
  BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS,
  REMOTE_CLI_PILOT_MANIFESTS,
  remoteCliPilotManifest,
  type AgentRuntimeAdapterManifest,
} from "../../shared/runtime-adapters";
import type { RuntimeAdapter } from "./types";
import { openCodeAcpAdapter } from "./builtin/opencode-adapter";
import { openClawGatewayAdapter } from "./builtin/openclaw-gateway";

const ADAPTER_ID = /^[a-z][a-z0-9._:-]{1,127}$/;
const SUPPORTED_LOCATIONS = new Set(["local", "remote"]);
const SUPPORTED_TRANSPORTS = new Set([
  "gateway-v1",
  "local-cli",
  "local-api",
  "local-web",
  "local-sdk",
]);

/** Remote OpenCode is enabled by default. Deployment/tests may still set the
 * environment variable explicitly to force it on or off; an unset value keeps
 * the default. */
export const REMOTE_OPENCODE_ACP_V1_ENV = "AGENTS_ONE_REMOTE_OPENCODE_V1";

export function isRemoteOpenCodeAcpV1Enabled(): boolean {
  const value = process.env[REMOTE_OPENCODE_ACP_V1_ENV]?.trim().toLowerCase();
  if (value === undefined || value === "") return true;
  return value === "1" || value === "true" || value === "on";
}

export function isRemoteCliPilotEnabled(adapterId: string): boolean {
  const pilot = remoteCliPilotManifest(adapterId);
  const flag = pilot && process.env[pilot.rolloutEnv]?.trim().toLowerCase();
  if (flag === undefined || flag === "") return true;
  return flag === "1" || flag === "true" || flag === "on";
}

function validateManifest(manifest: AgentRuntimeAdapterManifest): void {
  if (
    !ADAPTER_ID.test(manifest.adapterId) ||
    !ADAPTER_ID.test(manifest.vendorId) ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.adapterVersion)
  ) {
    throw new Error(
      `Runtime adapter manifest identity is invalid: ${manifest.adapterId}`,
    );
  }
  if (!manifest.displayName.trim() || !manifest.description.trim()) {
    throw new Error(
      `Runtime adapter manifest text is invalid: ${manifest.adapterId}`,
    );
  }
  if (
    !manifest.kinds.length ||
    manifest.kinds.some((kind) => !ADAPTER_ID.test(kind)) ||
    (manifest.legacyKinds || []).some((kind) => !ADAPTER_ID.test(kind))
  ) {
    throw new Error(
      `Runtime adapter manifest kinds are invalid: ${manifest.adapterId}`,
    );
  }
  if (
    manifest.locations.some((location) => !SUPPORTED_LOCATIONS.has(location)) ||
    manifest.transports.some(
      (transport) => !SUPPORTED_TRANSPORTS.has(transport),
    )
  ) {
    throw new Error(
      `Runtime adapter manifest routing is invalid: ${manifest.adapterId}`,
    );
  }
  if (manifest.localCliCommand && !manifest.locations.includes("local")) {
    throw new Error(
      `Local CLI adapter must support local location: ${manifest.adapterId}`,
    );
  }
  if (manifest.localCliCommand && !manifest.transports.includes("local-cli")) {
    throw new Error(
      `Local CLI adapter must declare local-cli transport: ${manifest.adapterId}`,
    );
  }
  const fieldKeys = new Set<string>();
  for (const field of manifest.fields) {
    if (!field.key.trim() || fieldKeys.has(field.key)) {
      throw new Error(
        `Runtime adapter manifest fields are duplicated: ${manifest.adapterId}`,
      );
    }
    fieldKeys.add(field.key);
    if (field.secret && field.type !== "password") {
      throw new Error(
        `Secret adapter fields must use password type: ${manifest.adapterId}`,
      );
    }
  }
}

export class RuntimeAdapterRegistry {
  private readonly adapters = new Map<string, RuntimeAdapter>();

  register(adapter: RuntimeAdapter): void {
    const id = adapter.manifest.adapterId.trim();
    if (!id) throw new Error("Runtime adapterId is required.");
    validateManifest(adapter.manifest);
    if (this.adapters.has(id)) {
      throw new Error(`Runtime adapter is already registered: ${id}`);
    }
    this.adapters.set(id, adapter);
  }

  get(adapterId: string | undefined): RuntimeAdapter | undefined {
    if (!adapterId) return undefined;
    return this.adapters.get(adapterId);
  }

  resolve(
    runtime: Pick<AgentRuntimeDefinition, "adapterId" | "kind">,
  ): RuntimeAdapter | undefined {
    if (runtime.adapterId) return this.adapters.get(runtime.adapterId);
    for (const adapter of this.adapters.values()) {
      if (
        adapter.manifest.kinds.includes(runtime.kind) ||
        adapter.manifest.legacyKinds?.includes(runtime.kind)
      ) {
        return adapter;
      }
    }
    return undefined;
  }

  list(): RuntimeAdapter[] {
    return [...this.adapters.values()];
  }

  manifests(): AgentRuntimeAdapterManifest[] {
    return this.list().map((adapter) => adapter.manifest);
  }
}

function manifestAdapter(
  manifest: AgentRuntimeAdapterManifest,
): RuntimeAdapter {
  return { manifest };
}

/** The single built-in registry instance used by the main process. */
export const runtimeAdapterRegistry = new RuntimeAdapterRegistry();
const builtinImplementations = new Map<string, RuntimeAdapter>([
  [openCodeAcpAdapter.manifest.adapterId, openCodeAcpAdapter],
  [openClawGatewayAdapter.manifest.adapterId, openClawGatewayAdapter],
]);
for (const manifest of BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS) {
  runtimeAdapterRegistry.register(
    builtinImplementations.get(manifest.adapterId) || manifestAdapter(manifest),
  );
}

for (const manifest of REMOTE_CLI_PILOT_MANIFESTS)
  runtimeAdapterRegistry.register(manifestAdapter(manifest));

export function resolveRuntimeAdapter(
  runtime: Pick<AgentRuntimeDefinition, "adapterId" | "kind">,
): RuntimeAdapter | undefined {
  return runtimeAdapterRegistry.resolve(runtime);
}

export function listRuntimeAdapterManifests(): AgentRuntimeAdapterManifest[] {
  return runtimeAdapterRegistry
    .manifests()
    .filter(
      (manifest) =>
        !remoteCliPilotManifest(manifest.adapterId) ||
        isRemoteCliPilotEnabled(manifest.adapterId),
    )
    .map((manifest) => {
      if (manifest.adapterId !== "opencode") {
        return manifest;
      }
      if (isRemoteOpenCodeAcpV1Enabled()) {
        return {
          ...manifest,
          locations: ["local", "remote"] as const,
          transports: ["local-cli", "gateway-v1"] as const,
        };
      }
      return {
        ...manifest,
        locations: ["local"] as const,
        transports: ["local-cli"] as const,
      };
    });
}
