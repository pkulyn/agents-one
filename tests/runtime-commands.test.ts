import { describe, expect, it } from "vitest";
import {
  createRuntimeCommandCatalog,
  normalizeRuntimeCommandName,
  runtimeCommandSuggestions,
  type RuntimeCommandDescriptor,
} from "../src/shared/runtime-commands";

const desktopModel: RuntimeCommandDescriptor = {
  name: "model",
  description: "选择当前会话模型",
  category: "Runtime",
  source: "desktop",
  target: "runtime-control",
  availability: "any",
};

describe("Runtime command catalog", () => {
  it("normalizes slash-prefixed command names", () => {
    expect(normalizeRuntimeCommandName("  //MODEL ")).toBe("model");
    expect(normalizeRuntimeCommandName(" /")).toBe("");
  });

  it("keeps desktop names and aliases ahead of untrusted runtime metadata", () => {
    const catalog = createRuntimeCommandCatalog({
      desktop: [{ ...desktopModel, aliases: ["m"] }],
      runtime: [
        {
          name: "/model",
          description: "attempted override",
          category: "Runtime native",
          source: "runtime",
          target: "runtime-native",
          availability: "any",
        },
        {
          name: "m",
          description: "attempted alias override",
          category: "Runtime native",
          source: "runtime",
          target: "runtime-native",
          availability: "any",
        },
        {
          name: "review",
          description: "Review the current change",
          category: "Runtime native",
          source: "runtime",
          target: "runtime-native",
          availability: "idle",
        },
      ],
    });

    expect(catalog.resolve("model")?.source).toBe("desktop");
    expect(catalog.resolve("m")?.name).toBe("model");
    expect(catalog.resolve("review")?.target).toBe("runtime-native");
    expect(catalog.commands.map((command) => command.name)).toEqual([
      "model",
      "review",
    ]);
  });

  it("drops malformed or overlong remote command metadata", () => {
    const catalog = createRuntimeCommandCatalog({
      runtime: [
        {
          name: "valid-name",
          description: "  concise description  ",
          category: "Runtime native",
          source: "runtime",
          target: "runtime-native",
          availability: "any",
        },
        {
          name: "invalid name",
          description: "must not be exposed",
          category: "Runtime native",
          source: "runtime",
          target: "runtime-native",
          availability: "any",
        },
        {
          name: "x".repeat(65),
          description: "must not be exposed",
          category: "Runtime native",
          source: "runtime",
          target: "runtime-native",
          availability: "any",
        },
      ],
    });

    expect(catalog.commands).toEqual([
      expect.objectContaining({
        name: "valid-name",
        description: "concise description",
      }),
    ]);
  });

  it("does not trust enum fields, aliases, or attachment flags from a remote catalog", () => {
    const catalog = createRuntimeCommandCatalog({
      runtime: [
        {
          name: "unsafe-target",
          description: "must be discarded",
          category: "Runtime",
          source: "runtime",
          target: "renderer-eval",
          availability: "any",
        } as unknown as RuntimeCommandDescriptor,
        {
          name: "safe",
          description: "safe command",
          category: "Runtime",
          source: "runtime",
          target: "runtime-native",
          availability: "any",
          aliases: "not-an-array",
          supportsAttachments: "yes",
        } as unknown as RuntimeCommandDescriptor,
      ],
    });

    expect(catalog.resolve("unsafe-target")).toBeUndefined();
    expect(catalog.resolve("safe")).toEqual(
      expect.objectContaining({ name: "safe", target: "runtime-native" }),
    );
    expect(catalog.resolve("safe")?.supportsAttachments).toBeUndefined();
  });

  it("returns bounded nearest suggestions for unknown commands", () => {
    const catalog = createRuntimeCommandCatalog({
      desktop: [desktopModel],
      runtime: [
        {
          name: "compact",
          description: "压缩上下文",
          category: "Runtime",
          source: "runtime",
          target: "runtime-control",
          availability: "idle",
        },
        {
          name: "context",
          description: "查看上下文",
          category: "Runtime",
          source: "runtime",
          target: "runtime-control",
          availability: "any",
        },
      ],
    });

    expect(runtimeCommandSuggestions(catalog, "compct")).toEqual(["compact"]);
    expect(runtimeCommandSuggestions(catalog, "", 2)).toEqual([]);
  });
});
