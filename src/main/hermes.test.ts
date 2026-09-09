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
  setEnvValue: vi.fn(),
  invalidateSecretsCache: vi.fn(),
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
vi.mock("./secrets", () => ({
  getSecret: vi.fn(() => null),
  providerListSafe: vi.fn(() => ({})),
}));
vi.mock("child_process", () => {
  const spawn = vi.fn();
  return { spawn, ChildProcess: class {}, default: { spawn } };
});

import { spawn } from "child_process";
import {
  getApiServerKey,
  getConnectionConfig,
  getModelConfig,
  invalidateSecretsCache,
  readEnv,
  setEnvValue,
} from "./config";
import type { ConnectionConfig } from "./config";
import { getSecret, providerListSafe } from "./secrets";
import {
  getVoiceInputPublicConfig,
  saveVoiceInputConfig,
  sendMessage,
  shouldForceCliForSessionOverride,
  stopHealthPolling,
  testVoiceInputService,
  transcribeAudio,
} from "./hermes";
import type { ChatCallbacks } from "./hermes";

const mockedGetModelConfig = vi.mocked(getModelConfig);
const mockedGetApiServerKey = vi.mocked(getApiServerKey);
const mockedGetConnectionConfig = vi.mocked(getConnectionConfig);
const mockedReadEnv = vi.mocked(readEnv);
const mockedSetEnvValue = vi.mocked(setEnvValue);
const mockedInvalidateSecretsCache = vi.mocked(invalidateSecretsCache);
const mockedGetSecret = vi.mocked(getSecret);
const mockedProviderListSafe = vi.mocked(providerListSafe);
const mockedSpawn = vi.mocked(spawn);

function testConnection(
  fields: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  return {
    mode: "local",
    ...fields,
  };
}

describe("transcribeAudio API route", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    delete process.env.AGENTS_ONE_VOICE_API_URL;
    delete process.env.AGENTS_ONE_VOICE_API_KEY;
    mockedGetApiServerKey.mockReset();
    mockedGetApiServerKey.mockReturnValue("");
    mockedGetConnectionConfig.mockReset();
    mockedGetConnectionConfig.mockReturnValue(testConnection({}));
    mockedGetModelConfig.mockReset();
    mockedReadEnv.mockReset();
    mockedReadEnv.mockReturnValue({});
    mockedSetEnvValue.mockReset();
    mockedInvalidateSecretsCache.mockReset();
    mockedGetSecret.mockReset();
    mockedGetSecret.mockReturnValue(null);
    mockedProviderListSafe.mockReset();
    mockedGetModelConfig.mockReturnValue({
      baseUrl: "https://api.groq.com/openai/v1",
    } as ReturnType<typeof getModelConfig>);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ text: "transcribed" }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete process.env.AGENTS_ONE_VOICE_API_URL;
    delete process.env.AGENTS_ONE_VOICE_API_KEY;
    vi.unstubAllGlobals();
  });

  function sentRequest(): [string, RequestInit] {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    return fetchMock.mock.calls[0] as [string, RequestInit];
  }

  it("keeps voice input disabled until an open-source user configures a service", async () => {
    // @lat: [[voice-input#Main-process service routing]]
    expect(getVoiceInputPublicConfig("default")).toEqual({
      enabled: false,
      url: "",
      hasApiKey: false,
      configured: false,
    });
    await expect(
      transcribeAudio(new Uint8Array([1, 2, 3]), "audio/webm", "default"),
    ).rejects.toThrow("语音输入尚未启用");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not route a legacy Hermes selector to local transcription", async () => {
    mockedReadEnv.mockReturnValue({ AGENTS_ONE_VOICE_API_URL: "hermes" });
    await expect(
      transcribeAudio(new Uint8Array([1, 2, 3]), "audio/webm", "default"),
    ).rejects.toThrow("语音服务地址无效");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the configured OpenAI-compatible voice service with multipart audio", async () => {
    // @lat: [[voice-input#Main-process service routing]]
    mockedReadEnv.mockReturnValue({
      AGENTS_ONE_VOICE_API_URL: "http://115.191.47.168/voice",
    });
    mockedGetSecret.mockReturnValue("test-token");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ text: "你好，Agents One。" }),
    });

    await expect(
      transcribeAudio(new Uint8Array([1, 2, 3]), "audio/webm;codecs=opus"),
    ).resolves.toBe("你好，Agents One。");

    const [url, init] = sentRequest();
    expect(url).toBe("http://115.191.47.168/voice/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer test-token" });
    const form = init.body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("recording.webm");
    expect(file.type).toBe("audio/webm;codecs=opus");
    expect(file.size).toBe(3);
  });

  it("accepts a full transcription endpoint without duplicating its path", async () => {
    mockedReadEnv.mockReturnValue({
      AGENTS_ONE_VOICE_API_URL:
        "https://voice.example.test/voice/v1/audio/transcriptions",
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ text: "done" }),
    });

    await transcribeAudio(new Uint8Array([4]), "audio/mp4");

    const [url] = sentRequest();
    expect(url).toBe(
      "https://voice.example.test/voice/v1/audio/transcriptions",
    );
  });

  it("accepts the v1.4 direct WebSocket stream endpoint", async () => {
    mockedReadEnv.mockReturnValue({
      AGENTS_ONE_VOICE_API_URL:
        "ws://115.191.47.168/voice/v1/audio/transcriptions/stream",
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ text: "done" }),
    });

    await transcribeAudio(new Uint8Array([4]), "audio/mp4");

    const [url] = sentRequest();
    expect(url).toBe("http://115.191.47.168/voice/v1/audio/transcriptions");
  });

  it("surfaces backend transcription errors", async () => {
    mockedReadEnv.mockReturnValue({
      AGENTS_ONE_VOICE_API_URL: "http://voice.example.test/voice",
      AGENTS_ONE_VOICE_ENABLED: "1",
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal server error",
    });

    await expect(
      transcribeAudio(new Uint8Array([1, 2, 3]), "audio/webm", "default"),
    ).rejects.toThrow(
      "Voice service transcription failed (500). internal server error",
    );
  });

  it("saves only whitelisted voice settings and never returns the API key", () => {
    mockedReadEnv.mockReturnValue({
      AGENTS_ONE_VOICE_API_URL: "https://voice.example.test/voice",
      AGENTS_ONE_VOICE_ENABLED: "1",
    });
    mockedGetSecret.mockReturnValue("stored-key");

    const result = saveVoiceInputConfig(
      {
        enabled: true,
        url: "https://voice.example.test/voice/",
        apiKey: "replacement-key",
      },
      "default",
    );

    expect(mockedSetEnvValue).toHaveBeenCalledWith(
      "AGENTS_ONE_VOICE_ENABLED",
      "1",
      "default",
    );
    expect(mockedSetEnvValue).toHaveBeenCalledWith(
      "AGENTS_ONE_VOICE_API_URL",
      "https://voice.example.test/voice",
      "default",
    );
    expect(mockedSetEnvValue).toHaveBeenCalledWith(
      "AGENTS_ONE_VOICE_API_KEY",
      "replacement-key",
      "default",
    );
    expect(mockedInvalidateSecretsCache).toHaveBeenCalledOnce();
    expect(result).toEqual({
      enabled: true,
      url: "https://voice.example.test/voice",
      hasApiKey: true,
      configured: true,
    });
    expect(result).not.toHaveProperty("apiKey");
  });

  it("tests the service health endpoint without uploading audio", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok",
        version: "1.4.0",
        stream_backend: "qwen3",
      }),
    });

    await expect(
      testVoiceInputService({
        url: "https://voice.example.test/voice",
        apiKey: "draft-key",
      }),
    ).resolves.toEqual({
      ok: true,
      message: "语音服务连接正常。",
      version: "1.4.0",
      streamBackend: "qwen3",
    });
    const [url, init] = sentRequest();
    expect(String(url)).toBe("https://voice.example.test/voice/health");
    expect(init.method).toBeUndefined();
    expect(init.headers).toEqual({ Authorization: "Bearer draft-key" });
    expect(init.body).toBeUndefined();
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
