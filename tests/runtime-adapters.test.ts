import { describe, expect, it } from "vitest";
import {
  BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS,
  manifestForAdapterId,
  manifestForRuntimeKind,
} from "../src/shared/runtime-adapters";
import {
  isRemoteOpenCodeAcpV1Enabled,
  listRuntimeAdapterManifests,
  REMOTE_OPENCODE_ACP_V1_ENV,
  RuntimeAdapterRegistry,
  runtimeAdapterRegistry,
} from "../src/main/runtime-adapters/registry";

describe("Runtime Adapter Registry", () => {
  it("registers one manifest for every current built-in adapter", () => {
    const ids = BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS.map(
      (manifest) => manifest.adapterId,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "hermes",
      "codex",
      "claude-code",
      "pi",
      "opencode",
      "openclaw",
      "web-agent",
    ]);
    expect(runtimeAdapterRegistry.manifests()).toHaveLength(ids.length);
  });

  it("resolves legacy kinds and explicit adapter ids", () => {
    expect(runtimeAdapterRegistry.resolve({ kind: "codex" })).toMatchObject({
      manifest: { adapterId: "codex" },
    });
    expect(
      runtimeAdapterRegistry.resolve({
        kind: "openclaw",
        adapterId: "openclaw",
      }),
    ).toMatchObject({ manifest: { adapterId: "openclaw" } });
    expect(
      runtimeAdapterRegistry.resolve({
        kind: "future-agent",
        adapterId: "future-vendor.agent",
      }),
    ).toBeUndefined();
  });

  it("keeps duplicate adapter ids impossible", () => {
    const registry = new RuntimeAdapterRegistry();
    registry.register({ manifest: BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS[0] });
    expect(() =>
      registry.register({
        manifest: BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS[0],
      }),
    ).toThrow(/already registered/);
  });

  it("exposes stable lookup helpers for forms and migration", () => {
    expect(manifestForAdapterId("opencode")).toMatchObject({
      displayName: "OpenCode",
      localCliCommand: "opencode",
    });
    expect(manifestForRuntimeKind("openclaw")).toMatchObject({
      adapterId: "openclaw",
      transports: ["gateway-v1"],
    });
    expect(manifestForAdapterId("missing")).toBeUndefined();
  });

  it("can gray-disable only the remote OpenCode surface", () => {
    const previous = process.env[REMOTE_OPENCODE_ACP_V1_ENV];
    process.env[REMOTE_OPENCODE_ACP_V1_ENV] = "0";
    try {
      expect(isRemoteOpenCodeAcpV1Enabled()).toBe(false);
      const manifest = listRuntimeAdapterManifests().find(
        (item) => item.adapterId === "opencode",
      );
      expect(manifest?.locations).toEqual(["local"]);
      expect(manifest?.transports).toEqual(["local-cli"]);
    } finally {
      if (previous === undefined) {
        delete process.env[REMOTE_OPENCODE_ACP_V1_ENV];
      } else {
        process.env[REMOTE_OPENCODE_ACP_V1_ENV] = previous;
      }
    }
  });

  it("exposes the OpenCode remote surface only when the rollout is enabled", () => {
    const previous = process.env[REMOTE_OPENCODE_ACP_V1_ENV];
    process.env[REMOTE_OPENCODE_ACP_V1_ENV] = "1";
    try {
      expect(isRemoteOpenCodeAcpV1Enabled()).toBe(true);
      const manifest = listRuntimeAdapterManifests().find(
        (item) => item.adapterId === "opencode",
      );
      expect(manifest?.locations).toEqual(["local", "remote"]);
      expect(manifest?.transports).toEqual(["local-cli", "gateway-v1"]);
    } finally {
      if (previous === undefined) {
        delete process.env[REMOTE_OPENCODE_ACP_V1_ENV];
      } else {
        process.env[REMOTE_OPENCODE_ACP_V1_ENV] = previous;
      }
    }
  });
});
