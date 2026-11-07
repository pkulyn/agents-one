import { describe, expect, it } from "vitest";
import { normalizeOneModelChoices } from "./one-model-api";

describe("normalizeOneModelChoices", () => {
  it("keeps trimmed, unique model IDs and accepts a missing list", () => {
    expect(normalizeOneModelChoices(undefined)).toBeUndefined();
    expect(
      normalizeOneModelChoices([" model-a ", "model-a", "model-b"]),
    ).toEqual(["model-a", "model-b"]);
  });

  it("rejects empty IDs, control characters, oversized IDs, and oversized lists", () => {
    expect(() => normalizeOneModelChoices([""])).toThrow(
      "One model choices are invalid.",
    );
    expect(() => normalizeOneModelChoices(["model\n-id"])).toThrow(
      "One model choices are invalid.",
    );
    expect(() => normalizeOneModelChoices(["x".repeat(257)])).toThrow(
      "One model choices are invalid.",
    );
    expect(() =>
      normalizeOneModelChoices(
        Array.from({ length: 33 }, (_, index) => `m${index}`),
      ),
    ).toThrow("One model choices are invalid.");
  });
});
