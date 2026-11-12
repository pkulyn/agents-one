import { expect, it } from "vitest";
import type { AgentRuntimeDefinition } from "../../shared/agent-runtimes";
import { oneConversationModels, oneRuntimeForModel } from "./model-controls";
import { oneModelProviderKey } from "../../shared/one-model-api";
const runtime: AgentRuntimeDefinition = {
  id: "one",
  name: "One",
  kind: "one",
  location: "local",
  enabled: true,
  managed: "user",
  config: {
    agentTransport: "local-sdk",
    model: "same-model",
    endpoint: "https://a.test/v1",
    oneActiveProviderId: "a",
    oneContextWindow: 128000,
    oneImageInput: true,
    oneProviders: [
      {
        id: "a",
        name: "Provider A",
        endpoint: "https://a.test/v1",
        apiType: "openai-completions",
        enabled: true,
        models: ["same-model", "a-second"],
      },
      {
        id: "b",
        name: "Provider B",
        endpoint: "https://b.test/v1",
        apiType: "anthropic-messages",
        enabled: true,
        models: ["same-model", "b-disabled"],
      },
      {
        id: "disabled",
        name: "Disabled",
        endpoint: "https://d.test/v1",
        apiType: "openai-completions",
        enabled: false,
        models: ["hidden"],
      },
    ],
    oneModelsByProvider: {
      [oneModelProviderKey("https://b.test/v1", "anthropic-messages")]: [
        "same-model",
      ],
    },
  },
};
it("lists every enabled provider choice with distinct identities and preserves configured defaults", () => {
  const before = structuredClone(runtime);
  const models = oneConversationModels(runtime);
  expect(models[0].reasoningEfforts).toEqual([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "max",
  ]);
  expect(models.map((m) => m.displayName)).toEqual([
    "same-model",
    "a-second",
    "same-model",
  ]);
  expect(new Set(models.map((m) => m.id)).size).toBe(3);
  const b = models.find((m) => m.provider === "Provider B")!;
  expect(oneRuntimeForModel(runtime, b.id).config).toMatchObject({
    endpoint: "https://b.test/v1",
    oneApiType: "anthropic-messages",
    oneActiveProviderId: "b",
    model: "same-model",
    oneContextWindow: undefined,
    oneImageInput: false,
  });
  expect(runtime).toEqual(before);
  expect(() =>
    oneRuntimeForModel(runtime, "one-provider:disabled:hidden"),
  ).toThrow();
  expect(() =>
    oneRuntimeForModel(runtime, "one-provider:b:b-disabled"),
  ).toThrow();
});
