import { createRemoteGatewayPlugin } from "./remote-gateway-plugin.mjs";

const RUNTIME_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
export const REMOTE_CLI_HOST_VERSION = "0.1.0";

function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function adapterManifest(adapter) {
  const value =
    typeof adapter?.manifest === "function"
      ? adapter.manifest()
      : adapter?.manifest;
  return object(value);
}

function normalizedRuntimeLimits(value) {
  const source = object(value);
  const maxConcurrentRuns = Number(source.maxConcurrentRuns);
  return Number.isFinite(maxConcurrentRuns) && maxConcurrentRuns >= 1
    ? { maxConcurrentRuns: Math.min(Math.floor(maxConcurrentRuns), 100) }
    : {};
}

function normalizeRuntime(
  runtime,
  { trustedAdapterIds, verifyAdapter, requireAdapterManifest } = {},
) {
  if (!runtime || typeof runtime !== "object") {
    throw new Error("Remote CLI Host Runtime must be an object.");
  }
  const runtimeId =
    typeof runtime.runtimeId === "string" ? runtime.runtimeId.trim() : "";
  const displayName =
    typeof runtime.displayName === "string" ? runtime.displayName.trim() : "";
  if (
    !RUNTIME_ID_PATTERN.test(runtimeId) ||
    !displayName ||
    typeof runtime.adapter?.startRun !== "function"
  ) {
    throw new Error(
      "Each Remote CLI Host Runtime needs runtimeId, displayName and adapter.startRun.",
    );
  }
  const manifest = adapterManifest(runtime.adapter);
  const configuredAdapterId =
    typeof runtime.adapterId === "string" && runtime.adapterId.trim()
      ? runtime.adapterId.trim()
      : undefined;
  const manifestAdapterId =
    typeof manifest.adapterId === "string" && manifest.adapterId.trim()
      ? manifest.adapterId.trim()
      : undefined;
  if (
    configuredAdapterId &&
    manifestAdapterId &&
    configuredAdapterId !== manifestAdapterId
  ) {
    throw new Error(
      `Runtime adapterId does not match its manifest: ${configuredAdapterId}.`,
    );
  }
  const adapterId = configuredAdapterId || manifestAdapterId;
  if (requireAdapterManifest && !adapterId) {
    throw new Error(
      `Runtime ${runtimeId} must declare a registered Adapter manifest.`,
    );
  }
  if (
    trustedAdapterIds !== undefined &&
    (!adapterId ||
      (trustedAdapterIds instanceof Set
        ? !trustedAdapterIds.has(adapterId)
        : !trustedAdapterIds.includes(adapterId)))
  ) {
    throw new Error(
      `Runtime adapter is not trusted or registered: ${adapterId || "unknown"}.`,
    );
  }
  if (typeof verifyAdapter === "function") {
    const trusted = verifyAdapter({
      adapterId,
      manifest,
      adapter: runtime.adapter,
      runtimeId,
    });
    if (trusted !== true) {
      throw new Error(
        `Runtime adapter failed trust verification: ${adapterId || "unknown"}.`,
      );
    }
  }
  return {
    runtimeId,
    displayName: displayName.slice(0, 80),
    kind:
      typeof runtime.kind === "string" && runtime.kind.trim()
        ? runtime.kind.trim().slice(0, 128)
        : "cli",
    ...(adapterId
      ? {
          adapterId: adapterId.slice(0, 128),
        }
      : {}),
    ...(typeof (runtime.adapterVersion || manifest.version) === "string" &&
    (runtime.adapterVersion || manifest.version).trim()
      ? {
          adapterVersion: (runtime.adapterVersion || manifest.version)
            .trim()
            .slice(0, 64),
        }
      : {}),
    ...(runtime.enabled === false ? { enabled: false } : {}),
    limits: normalizedRuntimeLimits(runtime.limits),
    adapter: runtime.adapter,
  };
}

function runtimeIdFromInput(input) {
  const value = input?.runtimeId || input?.input?.runtimeId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hostError(code, status, message) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

/**
 * Shared host for remote CLI adapters.
 *
 * One Host owns one Gateway v1 server. Runtime selection is explicit and is
 * taken from the request's runtimeId; it is never inferred from a command,
 * path, or an arbitrary executable supplied by the caller. This keeps
 * OpenCode/Pi/Codex/Claude Code adapters behind the same auth, event, model,
 * usage, cancellation and artifact boundary.
 */
export function createRemoteCliHost({
  runtimes,
  token,
  limits = {},
  statePath,
  hostId = "remote-cli-host",
  hostDisplayName = "Agents One Remote CLI Host",
  trustedAdapterIds,
  verifyAdapter,
  requireAdapterManifest = false,
} = {}) {
  if (!Array.isArray(runtimes) || !runtimes.length) {
    throw new Error("At least one Remote CLI Host Runtime is required.");
  }
  const trustedIds =
    trustedAdapterIds === undefined
      ? undefined
      : new Set(
          (Array.isArray(trustedAdapterIds) ? trustedAdapterIds : [])
            .filter((value) => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean),
        );
  const entries = runtimes.map((runtime) =>
    normalizeRuntime(runtime, {
      trustedAdapterIds: trustedIds,
      verifyAdapter,
      requireAdapterManifest,
    }),
  );
  const byId = new Map();
  for (const entry of entries) {
    if (byId.has(entry.runtimeId))
      throw new Error(`Duplicate Runtime ID: ${entry.runtimeId}`);
    byId.set(entry.runtimeId, entry);
  }

  const resolveEntry = (input, record) => {
    const requested = runtimeIdFromInput(input) || record?.runtimeId;
    if (!requested) {
      if (entries.length === 1) return entries[0];
      throw hostError(
        "runtime_required",
        422,
        "runtimeId is required when the Host has multiple Runtimes.",
      );
    }
    const entry = byId.get(requested);
    if (!entry)
      throw hostError(
        "runtime_not_registered",
        404,
        `Runtime is not registered: ${requested}`,
      );
    if (entry.enabled === false)
      throw hostError(
        "runtime_disabled",
        409,
        `Runtime is disabled: ${requested}`,
      );
    return entry;
  };

  const contextFor = (entry, context = {}) => ({
    ...context,
    hostId,
    runtimeId: entry.runtimeId,
    displayName: entry.displayName,
  });

  const dispatch = {
    capabilities: {
      ...(entries[0].adapter.capabilities || {}),
      runtimes: entries.map((entry) => ({
        runtimeId: entry.runtimeId,
        ...(entry.adapter.capabilities &&
        typeof entry.adapter.capabilities === "object"
          ? entry.adapter.capabilities
          : {}),
      })),
    },
    async startRun(input, context) {
      const entry = resolveEntry(input);
      return entry.adapter.startRun(
        { ...input, runtimeId: entry.runtimeId },
        contextFor(entry, context),
      );
    },
    async getRun(vendorRunId, record, context) {
      const entry = resolveEntry(undefined, record);
      return typeof entry.adapter.getRun === "function"
        ? entry.adapter.getRun(vendorRunId, record, contextFor(entry, context))
        : {
            status: "failed",
            error:
              "adapter_unavailable: Runtime adapter does not expose getRun().",
          };
    },
    async reconcileRun(vendorRunId, record, context) {
      const entry = resolveEntry(undefined, record);
      if (typeof entry.adapter.reconcileRun !== "function") return undefined;
      return entry.adapter.reconcileRun(
        vendorRunId,
        record,
        contextFor(entry, context),
      );
    },
    async cancelRun(vendorRunId, record, context) {
      const entry = resolveEntry(undefined, record);
      if (typeof entry.adapter.cancelRun !== "function")
        throw hostError(
          "cancel_unsupported",
          409,
          "Runtime cancellation is unsupported.",
        );
      return entry.adapter.cancelRun(
        vendorRunId,
        record,
        contextFor(entry, context),
      );
    },
    async uploadArtifact(input, context) {
      const entry = resolveEntry(
        { ...input, runtimeId: context?.runtimeId },
        context?.record,
      );
      if (typeof entry.adapter.uploadArtifact !== "function")
        throw hostError(
          "artifact_upload_unsupported",
          409,
          "Runtime artifact upload is unsupported.",
        );
      return entry.adapter.uploadArtifact(input, contextFor(entry, context));
    },
    async getArtifact(id, context) {
      const entry = resolveEntry(
        { runtimeId: context?.runtimeId },
        context?.record,
      );
      if (typeof entry.adapter.getArtifact !== "function") return undefined;
      return entry.adapter.getArtifact(id, contextFor(entry, context));
    },
  };

  const gateway = createRemoteGatewayPlugin({
    agent: {
      id: hostId,
      kind: "remote-cli-host",
      displayName: hostDisplayName,
      version: REMOTE_CLI_HOST_VERSION,
    },
    token,
    adapter: dispatch,
    limits: {
      ...limits,
      runtimeLimits: {
        ...(limits.runtimeLimits || {}),
        ...Object.fromEntries(
          entries.map((entry) => [entry.runtimeId, entry.limits]),
        ),
      },
    },
    runtimes: entries,
    statePath,
  });

  return {
    protocol: gateway.protocol,
    server: gateway.server,
    gateway,
    runtimes: entries.map((runtime) =>
      Object.fromEntries(
        Object.entries(runtime).filter(([key]) => key !== "adapter"),
      ),
    ),
    async probeRuntime(runtimeId) {
      const entry = resolveEntry({ runtimeId });
      if (typeof entry.adapter.probe !== "function") {
        return {
          runtimeId,
          healthy: false,
          state: "unsupported",
          message: "Runtime adapter does not expose probe().",
        };
      }
      return entry.adapter.probe(contextFor(entry));
    },
    async listModels(runtimeId) {
      const entry = resolveEntry({ runtimeId });
      if (typeof entry.adapter.listModels !== "function") return [];
      return entry.adapter.listModels(contextFor(entry));
    },
    async listSessions(runtimeId) {
      const entry = resolveEntry({ runtimeId });
      if (typeof entry.adapter.listSessions !== "function") return [];
      return entry.adapter.listSessions(contextFor(entry));
    },
    async respondToPermission(runtimeId, runId, requestId, decision) {
      const entry = resolveEntry({ runtimeId });
      if (typeof entry.adapter.respondToPermission !== "function") {
        throw hostError(
          "permission_unsupported",
          409,
          "Runtime adapter does not support interactive permissions.",
        );
      }
      return entry.adapter.respondToPermission(
        runId,
        requestId,
        decision,
        contextFor(entry),
      );
    },
    listen: gateway.listen,
    close: gateway.close,
  };
}
