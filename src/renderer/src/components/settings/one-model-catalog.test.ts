import { describe, expect, it } from "vitest";
import { inferOneModelMetadata } from "./one-model-catalog";

// @lat: [[main-process#Main Process#One session resume reconciliation#One model provider catalog discovery#Prefills known model context and input capabilities]]
describe("inferOneModelMetadata", () => {
  it("uses the ZCode catalog entry for known Ark and Kimi coding-plan models", () => {
    const ark = inferOneModelMetadata("doubao-seed-2.1-pro");
    expect(ark).toMatchObject({
      contextWindow: 1_024_000,
      maxOutputTokens: 65_536,
      input: { image: true, video: true },
      source: "catalog",
    });
    const kimi = inferOneModelMetadata("kimi-k3.1-pro");
    expect(kimi).toMatchObject({
      contextWindow: 1_048_576,
      maxOutputTokens: 131_072,
      input: { image: true, video: true },
      source: "catalog",
    });
    expect(inferOneModelMetadata("gpt-6-astra")).toMatchObject({
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
      input: { image: true, pdf: true },
      source: "catalog",
    });
    expect(inferOneModelMetadata("gpt-5.4")).toMatchObject({
      contextWindow: 1_050_000,
      input: { image: true, pdf: true },
      source: "catalog",
    });
    expect(inferOneModelMetadata("gpt-5.4-mini")).toMatchObject({
      contextWindow: 400_000,
      input: { image: true, pdf: true },
      source: "catalog",
    });
    expect(inferOneModelMetadata("claude-sonnet-5-5")).toMatchObject({
      contextWindow: 1_000_000,
      input: { image: true, pdf: true },
      source: "catalog",
    });
    expect(inferOneModelMetadata("glm-5.3-flash")).toMatchObject({
      contextWindow: 1_000_000,
      input: { image: true, video: true, pdf: true },
      source: "catalog",
    });
  });

  it("marks unknown model IDs for manual review instead of inventing capabilities", () => {
    expect(inferOneModelMetadata("custom-provider-alias")).toMatchObject({
      contextWindow: 32_768,
      input: { image: false, video: false, pdf: false, audio: false },
      source: "manual",
    });
  });

  it("fills the Ark Agent Plan doubao-seed-2.0-mini metadata", () => {
    expect(inferOneModelMetadata("doubao-seed-2.0-mini")).toMatchObject({
      contextWindow: 262_144,
      maxOutputTokens: 128_000,
      input: { text: true, image: true, video: false, pdf: false },
      source: "catalog",
    });
    expect(inferOneModelMetadata("doubao-seed-2-0-mini-260428")).toMatchObject({
      contextWindow: 262_144,
      maxOutputTokens: 128_000,
      input: { image: true, video: false },
      source: "catalog",
    });
  });
});
