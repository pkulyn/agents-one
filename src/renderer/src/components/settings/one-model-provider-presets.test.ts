import { describe, expect, it } from "vitest";
import {
  getOneModelProviderPresetId,
  ONE_MODEL_PROVIDER_PRESETS,
} from "./one-model-provider-presets";

describe("One model provider presets", () => {
  it("provides unique, editable HTTPS defaults using the supported chat protocol", () => {
    const ids = ONE_MODEL_PROVIDER_PRESETS.map((preset) => preset.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "ark-agent-plan",
      "deepseek",
      "openai",
      "bigmodel",
      "zai",
      "kimi",
      "minimax",
      "bailian",
    ]);
    for (const preset of ONE_MODEL_PROVIDER_PRESETS) {
      expect(preset.endpoint).toMatch(/^https:\/\//);
      expect(preset.model.trim()).not.toBe("");
      expect(preset.apiType).toBe("openai-completions");
    }
  });

  it("recognizes legacy defaults, but leaves other protocols and endpoints custom", () => {
    expect(
      getOneModelProviderPresetId(
        "https://ark.cn-beijing.volces.com/api/plan/v3",
        undefined,
      ),
    ).toBe("ark-agent-plan");
    expect(
      getOneModelProviderPresetId(
        "https://api.moonshot.cn/v1",
        "openai-completions",
      ),
    ).toBe("kimi");
    expect(
      getOneModelProviderPresetId(
        "https://api.moonshot.cn/v1",
        "anthropic-messages",
      ),
    ).toBe("custom");
    expect(
      getOneModelProviderPresetId("https://example.test/v1", undefined),
    ).toBe("custom");
  });
});
