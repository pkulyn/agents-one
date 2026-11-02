import { describe, it, expect } from "vitest";
import { runtimeModelFailureKind } from "./runtime-model-errors";
describe("model failure classification", () => {
  it.each([
    ["insufficient_quota", "quota"],
    ["Free usage limit reached.", "quota"],
    ["invalid_api_key", "auth"],
    ["Model abc not found", "model"],
    ["AI_APICallError: Failed to connect to provider", "network"],
  ])("classifies %s", (text, kind) =>
    expect(runtimeModelFailureKind(text)).toBe(kind),
  );
  it.each([
    "Retrying after insufficient_quota",
    "Tool search returned no matches",
    "No output for ten minutes",
  ])("preserves nonterminal activity: %s", (text) =>
    expect(runtimeModelFailureKind(text)).toBeUndefined(),
  );
});
