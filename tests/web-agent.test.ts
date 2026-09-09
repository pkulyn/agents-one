import { describe, expect, it } from "vitest";
import {
  assertWebAgentTransition,
  canTransitionWebAgentRun,
  isAllowedWebAgentUrl,
  isAllowedWebAgentNavigationUrl,
  isWebAgentResponseComplete,
  normalizeWebAgentProfileId,
  normalizeWebAgentResponseText,
  webAgentPartition,
  webAgentTextHash,
  type WebAgentResponseSnapshot,
} from "../src/shared/web-agent";

// @lat: [[web-agent-runtime#Runtime boundary]]
describe("Web Agent Runtime boundary", () => {
  it("isolates providers, profiles and allowed origins", () => {
    expect(normalizeWebAgentProfileId("  A/B..test  ")).toBe("a-b-test");
    expect(webAgentPartition("doubao", "A/B")).toBe(
      "persist:agents-one-web-doubao:a-b",
    );
    expect(isAllowedWebAgentUrl("doubao", "https://www.doubao.com/chat/")).toBe(
      true,
    );
    expect(isAllowedWebAgentUrl("doubao", "https://doubao.com/chat/")).toBe(
      true,
    );
    expect(
      isAllowedWebAgentUrl("doubao", "https://evil.example/doubao.com"),
    ).toBe(false);
    expect(isAllowedWebAgentUrl("doubao", "http://www.doubao.com/chat/")).toBe(
      false,
    );
    expect(
      isAllowedWebAgentUrl("doubao", "https://user:pass@www.doubao.com/chat/"),
    ).toBe(false);
    expect(
      isAllowedWebAgentNavigationUrl(
        "chatgpt",
        "https://auth.openai.com/log-in",
      ),
    ).toBe(true);
    expect(
      isAllowedWebAgentUrl("chatgpt", "https://auth.openai.com/log-in"),
    ).toBe(false);
    expect(
      isAllowedWebAgentNavigationUrl("chatgpt", "https://evil.example/"),
    ).toBe(false);
    expect(isAllowedWebAgentUrl("grok", "https://grok.com/c/example")).toBe(
      true,
    );
    expect(
      isAllowedWebAgentNavigationUrl(
        "grok",
        "https://accounts.x.ai/check-login?redirect=grok-com",
      ),
    ).toBe(true);
    expect(
      isAllowedWebAgentUrl(
        "grok",
        "https://accounts.x.ai/check-login?redirect=grok-com",
      ),
    ).toBe(false);
  });

  it("only permits the safe state-machine transitions", () => {
    expect(canTransitionWebAgentRun("preparing", "submitting")).toBe(true);
    expect(canTransitionWebAgentRun("generating", "succeeded")).toBe(false);
    expect(() => assertWebAgentTransition("submitting", "succeeded")).toThrow(
      "Invalid Web Agent state transition",
    );
  });
});

// @lat: [[web-agent-runtime#Event semantics]]
describe("Web Agent reply completion", () => {
  const base: WebAgentResponseSnapshot = {
    text: "已完成\n\n答复。",
    hash: webAgentTextHash("已完成\n\n答复。"),
    hasAssistantMessage: true,
    isGenerating: false,
    hasUploadInProgress: false,
    hasError: false,
    observedAt: 10_000,
  };

  it("requires a stable, visible, non-generating response", () => {
    expect(isWebAgentResponseComplete(base, base, 1_200)).toBe(true);
    expect(isWebAgentResponseComplete(base, base, 1_199)).toBe(false);
    expect(
      isWebAgentResponseComplete({ ...base, isGenerating: true }, base, 9_000),
    ).toBe(false);
    expect(isWebAgentResponseComplete({ ...base, text: "" }, base, 9_000)).toBe(
      false,
    );
    expect(
      isWebAgentResponseComplete(
        { ...base, hash: webAgentTextHash("新答复") },
        base,
        9_000,
      ),
    ).toBe(false);
  });

  it("normalizes text before hashing it", () => {
    expect(normalizeWebAgentResponseText("  a\r\n\r\n\r\n b  ")).toBe(
      "a\n\n b",
    );
    expect(webAgentTextHash("a\r\nb")).toBe(webAgentTextHash("a\nb"));
  });
});
