import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { projectCodexMobileModelCatalog } from "../src/main/mobile-control/codex-model-capabilities";

const metadata = {
  slug: "gpt-6-sol",
  tool_mode: "code_mode_only",
  shell_type: "unified_exec",
  node_repl_disabled: false,
  multi_agent_version: "v2",
  model_messages: { instructions_template: "original instructions" },
  future_field: { preserved: true },
};
const bytes = (models: unknown[] = [metadata]): Buffer =>
  Buffer.from(JSON.stringify({ models, identity: "cache-private-identity" }));
const sha = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

describe("Main-owned Codex model capability projection", () => {
  // @lat: [[mobile-data#Mobile data#Codex capability projection preserves model identity]]
  it("keeps the selected model and unknown metadata while binding original and projected bytes", () => {
    const input = bytes([{ slug: "other-model" }, metadata]);
    const result = projectCodexMobileModelCatalog(input, "gpt-6-sol");
    expect(JSON.parse(result.contents)).toEqual({
      models: [{ ...metadata, multi_agent_version: null }],
    });
    expect(result.model).toBe(metadata.slug);
    expect(result.originalCatalogHash).toBe(sha(input));
    expect(result.originalMetadataHash).toBe(sha(JSON.stringify(metadata)));
    expect(result.projectedCatalogHash).toBe(sha(result.contents));
    expect(result.completeExecutionPolicyVerified).toBe(false);
    expect(result.contents).not.toContain("cache-private-identity");
    expect(JSON.parse(input.toString()).models[1]).toEqual(metadata);
    const changed = projectCodexMobileModelCatalog(
      bytes([{ ...metadata, future_field: { preserved: false } }]),
      "gpt-6-sol",
    );
    expect(changed.projectedCatalogHash).not.toBe(result.projectedCatalogHash);
  });

  // @lat: [[mobile-data#Mobile data#Codex capability metadata never falls back]]
  it("rejects absent, duplicate, unknown or incompatible selected metadata", () => {
    for (const models of [
      [],
      [{ slug: "other-model" }],
      [metadata, metadata],
      [{ ...metadata, tool_mode: "direct" }],
      [{ ...metadata, multi_agent_version: "v3" }],
      [{ ...metadata, node_repl_disabled: true }],
      [{ ...metadata, shell_type: "unknown" }],
    ])
      expect(() =>
        projectCodexMobileModelCatalog(bytes(models), "gpt-6-sol"),
      ).toThrow("capabilities are unavailable");
    expect(() =>
      projectCodexMobileModelCatalog(bytes(), "other-model"),
    ).toThrow("capabilities are unavailable");
  });

  // @lat: [[mobile-data#Mobile data#Codex capability input is bounded and private]]
  it("rejects corrupt or oversized input without echoing private catalog data", () => {
    for (const input of [
      Buffer.alloc(0),
      Buffer.alloc(8 * 1024 * 1024 + 1),
      Buffer.from([0xff, 0xfe]),
      Buffer.from('{"private-secret"'),
      Buffer.from('{"models":{}}'),
    ]) {
      expect(() => projectCodexMobileModelCatalog(input, "gpt-6-sol")).toThrow(
        "Codex mobile model capabilities are unavailable.",
      );
    }
  });
});
