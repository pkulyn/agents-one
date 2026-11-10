import { afterEach, expect, it, vi } from "vitest";
import { discoverOneProviderModels } from "./model-catalog";

afterEach(() => vi.unstubAllGlobals());

// @lat: [[main-process#Main Process#One session resume reconciliation#One model provider catalog discovery#Lists models from the selected provider protocol]]
it("discovers only model IDs from the configured provider endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [
          { id: "doubao-seed-2.1-pro" },
          { id: "doubao-seed-2.1-pro" },
          { id: "doubao-seed-2.1-lite" },
          { id: "invalid\nmodel" },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    discoverOneProviderModels(
      "https://ark.cn-beijing.volces.com/api/plan/v3",
      "openai-completions",
      "api-key-test-value",
    ),
  ).resolves.toEqual(["doubao-seed-2.1-lite", "doubao-seed-2.1-pro"]);

  expect(fetchMock).toHaveBeenCalledWith(
    new URL("https://ark.cn-beijing.volces.com/api/plan/v3/models"),
    expect.objectContaining({
      redirect: "error",
      headers: expect.objectContaining({
        Authorization: "Bearer api-key-test-value",
      }),
    }),
  );
});

// @lat: [[main-process#Main Process#One session resume reconciliation#One model provider catalog discovery#Uses API-specific discovery authentication]]
it("uses Anthropic model-list endpoint and authentication", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5" }] }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    discoverOneProviderModels(
      "https://api.anthropic.com/v1",
      "anthropic-messages",
      "anthropic-test-key",
    ),
  ).resolves.toEqual(["claude-sonnet-5"]);
  expect(fetchMock).toHaveBeenCalledWith(
    new URL("https://api.anthropic.com/v1/models"),
    expect.objectContaining({
      headers: expect.objectContaining({
        "x-api-key": "anthropic-test-key",
        "anthropic-version": "2023-06-01",
      }),
    }),
  );
});

it("rejects insecure remote model discovery URLs", async () => {
  await expect(
    discoverOneProviderModels(
      "http://192.168.1.20/v1",
      "openai-completions",
      "",
    ),
  ).rejects.toThrow("HTTPS");
});
