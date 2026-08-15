import http from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// hermes.ts pulls in the full main-process import graph; mock the modules with
// import-time side effects (installer → electron) and the two seams under
// test (config's readEnv / secrets' providerListSafe). Everything else
// (run-stream, url-key-map, …) is pure and loads for real.
vi.mock("./installer", () => ({
  HERMES_HOME: "/tmp/hermes-test-home",
  HERMES_REPO: "/tmp/hermes-test-repo",
  HERMES_PYTHON: "python3",
  hermesCliArgs: vi.fn(() => []),
  getEnhancedPath: vi.fn(() => ""),
}));
vi.mock("./config", () => ({
  getApiServerKey: vi.fn(() => ""),
  getConnectionConfig: vi.fn(() => ({
    mode: "local",
    remoteUrl: "",
    apiKey: "",
  })),
  getConfigValue: vi.fn(() => null),
  getModelConfig: vi.fn(),
  readEnv: vi.fn(() => ({})),
}));
vi.mock("./utils", () => ({
  pidIsAliveAs: vi.fn(() => false),
  stripAnsi: (s: string) => s,
  profileHome: vi.fn(() => "/tmp/hermes-test-home"),
  profilePaths: vi.fn(() => ({
    configFile: "/tmp/hermes-test-home/config.yaml",
    envFile: "/tmp/hermes-test-home/.env",
  })),
  normalizeProfileName: (p?: string) => p,
  getActiveProfileNameSync: vi.fn(() => undefined),
}));
vi.mock("./gateway-ports", () => ({ getProfilePort: vi.fn(() => 8642) }));
vi.mock("./models", () => ({ readModels: vi.fn(() => []) }));
vi.mock("./secrets", () => ({ providerListSafe: vi.fn(() => ({})) }));
vi.mock("child_process", () => {
  const spawn = vi.fn();
  return { spawn, ChildProcess: class {}, default: { spawn } };
});

import { spawn } from "child_process";
import {
  getApiServerKey,
  getConnectionConfig,
  getModelConfig,
  readEnv,
} from "./config";
import type { ConnectionConfig } from "./config";
import { providerListSafe } from "./secrets";
import {
  sendMessage,
  shouldForceCliForSessionOverride,
  stopHealthPolling,
  transcribeAudio,
} from "./hermes";
import type { ChatCallbacks } from "./hermes";

const mockedGetModelConfig = vi.mocked(getModelConfig);
const mockedGetApiServerKey = vi.mocked(getApiServerKey);
const mockedGetConnectionConfig = vi.mocked(getConnectionConfig);
const mockedReadEnv = vi.mocked(readEnv);
const mockedProviderListSafe = vi.mocked(providerListSafe);
const mockedSpawn = vi.mocked(spawn);

function testConnection(fields: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    mode: "local",
    ...fields,
  };
}

describe("transcribeAudio API route", () => {
  const fetchMock = vi.fn();
  // The built-in Hermes connection is local-only, so transcribeAudio first
  // probes the local gateway /health over http.request. Respond 200 so the
  // readiness gate passes and the transcription fetch runs.
  const httpReqSpy = vi
    .spyOn(http, "request")
    .mockImplementation((url: unknown, ...rest: unknown[]) => {
      void url;
      const cb = rest[rest.length - 1] as (res: unknown) => void;
      cb({ statusCode: 200, resume: () => {} });
      return {
        on: () => {},
        end: () => {},
        destroy: () => {},
      } as unknown as ReturnType<typeof http.request>;
    });

  beforeEach(() => {
    mockedGetApiServerKey.mockReset();
    mockedGetApiServerKey.mockReturnValue("");
    mockedGetConnectionConfig.mockReset();
    mockedGetConnectionConfig.mockReturnValue(testConnection({}));
    mockedGetModelConfig.mockReset();
    mockedReadEnv.mockReset();
    mockedProviderListSafe.mockReset();
    mockedGetModelConfig.mockReturnValue({
      baseUrl: "https://api.groq.com/openai/v1",
    } as ReturnType<typeof getModelConfig>);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, transcript: "transcribed" }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    httpReqSpy.mockClear();
  });

  function sentRequest(): [string, RequestInit] {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    return fetchMock.mock.calls[0] as [string, RequestInit];
  }

  function sentJsonBody(): { data_url: string; mime_type: string } {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(init.body as string) as {
      data_url: string;
      mime_type: string;
    };
  }

  it("posts desktop recordings to the local Hermes audio endpoint", async () => {
    await expect(
      transcribeAudio(new Uint8Array([1, 2, 3]), "audio/webm", "default"),
    ).resolves.toBe("transcribed");

    const [url, init] = sentRequest();
    expect(url).toBe("http://127.0.0.1:8642/api/audio/transcribe");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
    });
    expect(sentJsonBody()).toEqual({
      data_url: "data:audio/webm;base64,AQID",
      mime_type: "audio/webm",
    });
  });

  it("calls the local desktop audio route", async () => {
    await transcribeAudio(new Uint8Array([1, 2, 3]), "audio/webm", "default");

    const [url] = sentRequest();
    expect(url).toBe("http://127.0.0.1:8642/api/audio/transcribe");
  });

  it("surfaces backend transcription errors", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal server error",
    });

    await expect(
      transcribeAudio(new Uint8Array([1, 2, 3]), "audio/webm", "default"),
    ).rejects.toThrow("Transcription failed (500). internal server error");
  });
});

describe("sendMessage session model override routing", () => {
  const noopCallbacks: ChatCallbacks = {
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  };

  function fakeChildProcess(): unknown {
    return {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      killed: false,
    };
  }

  function cliArgs(): string[] {
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    return mockedSpawn.mock.calls[0][1] as string[];
  }

  beforeEach(() => {
    mockedGetApiServerKey.mockReset();
    mockedGetApiServerKey.mockReturnValue("");
    mockedGetConnectionConfig.mockReset();
    mockedGetConnectionConfig.mockReturnValue(testConnection({}));
    mockedGetModelConfig.mockReset();
    mockedReadEnv.mockReset();
    mockedReadEnv.mockReturnValue({});
    mockedProviderListSafe.mockReset();
    mockedProviderListSafe.mockReturnValue({});
    mockedSpawn.mockReset();
    mockedSpawn.mockReturnValue(fakeChildProcess() as ReturnType<typeof spawn>);
    // Persisted default: GPT-5.5 on the (sticky) OpenAI-Codex provider.
    mockedGetModelConfig.mockReturnValue({
      provider: "openai-codex",
      model: "gpt-5.5",
      baseUrl: "https://chatgpt.com/backend-api/codex",
    } as ReturnType<typeof getModelConfig>);
  });

  afterEach(() => {
    stopHealthPolling();
  });

  // @lat: [[model-selection#Session model override#Text-only legacy fallback routes via CLI]]
  it("routes a cross-provider override through the CLI with its provider + model", async () => {
    await sendMessage(
      "hello",
      noopCallbacks,
      "default",
      undefined,
      undefined,
      undefined,
      undefined,
      { provider: "gemini", model: "gemini-2.5-pro", baseUrl: "" },
    );

    const args = cliArgs();
    expect(args).toContain("-m");
    expect(args[args.indexOf("-m") + 1]).toBe("gemini-2.5-pro");
    expect(args).toContain("--provider");
    expect(args[args.indexOf("--provider") + 1]).toBe("gemini");
  });

  // @lat: [[model-selection#Session model override#Attachment turns stay on session transport]]
  it("keeps attachment turns off the CLI override fallback", () => {
    const persisted = {
      provider: "openai-codex",
      model: "gpt-5.5",
      baseUrl: "https://chatgpt.com/backend-api/codex",
    } as ReturnType<typeof getModelConfig>;
    const effective = {
      provider: "gemini",
      model: "gemini-2.5-pro",
      baseUrl: "",
    } as ReturnType<typeof getModelConfig>;

    expect(
      shouldForceCliForSessionOverride(
        persisted,
        effective,
        { provider: "gemini", model: "gemini-2.5-pro", baseUrl: "" },
        [
          {
            id: "img-1",
            kind: "image",
            name: "cat.png",
            mime: "image/png",
            size: 12,
            dataUrl: "data:image/png;base64,AAAA",
          },
        ],
      ),
    ).toBe(false);
  });
});
