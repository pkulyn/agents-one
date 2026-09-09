import { describe, expect, it } from "vitest";
import {
  BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS,
  type AgentRuntimeAdapterManifest,
} from "../src/shared/runtime-adapters";
import { RuntimeAdapterRegistry } from "../src/main/runtime-adapters/registry";

const adapterIdPattern = /^[a-z][a-z0-9._:-]{1,127}$/;

describe("Runtime Adapter Registry conformance", () => {
  it("keeps every built-in manifest routable and renderer-safe", () => {
    const registry = new RuntimeAdapterRegistry();
    for (const manifest of BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS) {
      registry.register({ manifest });
    }

    for (const manifest of registry.manifests()) {
      expect(adapterIdPattern.test(manifest.adapterId)).toBe(true);
      expect(adapterIdPattern.test(manifest.vendorId)).toBe(true);
      expect(manifest.kinds.length).toBeGreaterThan(0);
      expect(new Set(manifest.kinds).size).toBe(manifest.kinds.length);
      expect(new Set(manifest.fields.map((field) => field.key)).size).toBe(
        manifest.fields.length,
      );
      for (const field of manifest.fields) {
        expect(field.label.trim()).not.toBe("");
        if (field.secret) expect(field.type).toBe("password");
      }
      if (manifest.localCliCommand) {
        expect(manifest.locations).toContain("local");
        expect(manifest.transports).toContain("local-cli");
      }
    }
  });

  it.each([
    [
      "duplicate field",
      {
        fields: [
          { key: "endpoint", label: "A", type: "text" },
          { key: "endpoint", label: "B", type: "text" },
        ],
      },
    ],
    [
      "secret field type",
      {
        fields: [{ key: "token", label: "Token", type: "text", secret: true }],
      },
    ],
    [
      "local command transport",
      {
        locations: ["local"],
        transports: ["gateway-v1"],
        localCliCommand: "agent",
      },
    ],
  ])("rejects invalid %s manifests", (_label, override) => {
    const registry = new RuntimeAdapterRegistry();
    const manifest = {
      ...BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS[0],
      adapterId: `test-${String(_label).replace(/\s+/g, "-")}`,
      ...override,
    } as AgentRuntimeAdapterManifest;
    expect(() => registry.register({ manifest })).toThrow(/adapter|manifest/);
  });
});
