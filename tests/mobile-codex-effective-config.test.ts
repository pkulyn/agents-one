import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  projectCodexMobileConfiguration,
  readCodexMobileConfiguration,
} from "../src/main/mobile-control/codex-effective-config";

const mock = vi.hoisted(() => ({ spawn: vi.fn(), terminate: vi.fn() }));
vi.mock("child_process", () => ({ spawn: mock.spawn }));
vi.mock("../src/main/codex-runtime", () => ({
  codexInvocation: () => ({ command: "native-codex", prefix: [] }),
}));
vi.mock("../src/main/process-control", () => ({
  terminateProcessTree: mock.terminate,
}));
beforeEach(() => {
  mock.spawn.mockReset();
  mock.terminate.mockReset();
  mock.terminate.mockResolvedValue(undefined);
});

function rpc(
  reply: (frame: Record<string, unknown>) => unknown,
): EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
} {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  child.stdin.on("data", (chunk: Buffer) => {
    const frame = JSON.parse(chunk.toString()) as Record<string, unknown>;
    if (frame.id === undefined) return;
    queueMicrotask(() =>
      child.stdout.write(`${JSON.stringify(reply(frame))}\n`),
    );
  });
  mock.spawn.mockReturnValue(child);
  return child;
}
describe("Codex mobile effective configuration", () => {
  // @lat: [[mobile-data#Mobile data#Codex configuration fingerprint stability]]
  it("binds explicit model selection and full source response while ignoring object key ordering", () => {
    const first = projectCodexMobileConfiguration({
      config: {
        model: "original",
        model_provider: "openai",
        features: { b: true, a: false },
      },
      origins: { b: 2, a: 1 },
    });
    const reordered = projectCodexMobileConfiguration({
      origins: { a: 1, b: 2 },
      config: {
        features: { a: false, b: true },
        model_provider: "openai",
        model: "original",
      },
    });
    expect(reordered.configurationHash).toBe(first.configurationHash);
    expect(
      projectCodexMobileConfiguration({ config: { model: "original" } }, "one")
        .configurationHash,
    ).not.toBe(
      projectCodexMobileConfiguration({ config: { model: "original" } }, "two")
        .configurationHash,
    );
    expect(
      projectCodexMobileConfiguration(
        { config: { model: "original" } },
        " original ",
      ).configurationHash,
    ).toBe(
      projectCodexMobileConfiguration({ config: { model: "original" } })
        .configurationHash,
    );
  });
  // @lat: [[mobile-data#Mobile data#Codex implicit model and provider preservation]]
  it("keeps the effective implicit model, runtime explicit priority and only the selected provider", () => {
    const config = {
      model: "original-model",
      model_provider: "company",
      model_reasoning_effort: "high",
      service_tier: "priority",
      model_providers: {
        company: {
          name: "Company",
          base_url: "https://models.example/v1",
          wire_api: "responses",
          env_key: "COMPANY_MODEL_KEY",
          requires_openai_auth: false,
        },
        ignored: { http_headers: { Authorization: "private-secret" } },
      },
      mcp_servers: { unapproved: { command: "do-not-copy" } },
      notify: ["do-not-copy"],
    };
    const result = projectCodexMobileConfiguration({ config, origins: {} });
    expect(result.model).toBe("original-model");
    expect(result.providerId).toBe("company");
    expect(result.args).toEqual([
      "-c",
      'model_provider="company"',
      "-c",
      'model_providers.company.name="Company"',
      "-c",
      'model_providers.company.base_url="https://models.example/v1"',
      "-c",
      'model_providers.company.wire_api="responses"',
      "-c",
      'model_providers.company.env_key="COMPANY_MODEL_KEY"',
      "-c",
      "model_providers.company.requires_openai_auth=false",
      "-c",
      'model_reasoning_effort="high"',
      "-c",
      'service_tier="priority"',
    ]);
    expect(JSON.stringify(result)).not.toContain("private-secret");
    expect(JSON.stringify(result)).not.toContain("do-not-copy");
    expect(
      projectCodexMobileConfiguration({ config }, " explicit-model ").model,
    ).toBe("explicit-model");
    expect(result.configurationHash).toMatch(/^[a-f0-9]{64}$/);
  });
  // @lat: [[mobile-data#Mobile data#Codex unsupported provider rejection]]
  it("refuses credentials, helpers, unknown provider effects, missing models and unsafe endpoints without echoing inputs", () => {
    const base = {
      model: "original",
      model_provider: "company",
      model_providers: {
        company: {
          name: "Company",
          base_url: "https://models.example/v1",
          wire_api: "responses",
        },
      },
    };
    const inputs = [
      {},
      { model: null },
      { model: "unsafe\nmodel" },
      { model: "original", model_catalog_json: "private-path" },
      { ...base, model_provider: "unknown" },
      ...[
        "http_headers",
        "env_http_headers",
        "experimental_bearer_token",
        "api_key_helper",
        "unknown_future_key",
      ].map((key) => ({
        ...base,
        model_providers: {
          company: { ...base.model_providers.company, [key]: "private-secret" },
        },
      })),
      ...[
        "https://user:private-secret@models.example/v1",
        "https://models.example/?token=private-secret",
        "http://models.example/v1",
        "file:///private-secret",
        "https://models.example/#private-secret",
      ].map((base_url) => ({
        ...base,
        model_providers: {
          company: { ...base.model_providers.company, base_url },
        },
      })),
      {
        ...base,
        model_providers: {
          company: {
            ...base.model_providers.company,
            env_key: "private-secret=key",
          },
        },
      },
      {
        ...base,
        model_providers: {
          company: { ...base.model_providers.company, wire_api: "chat" },
        },
      },
    ];
    for (const config of inputs) {
      try {
        projectCodexMobileConfiguration({ config });
        throw Error("unexpected_success");
      } catch (error) {
        expect(String(error)).toMatch(/unsupported or unavailable/);
        expect(String(error)).not.toContain("private-secret");
      }
    }
  });
  it("retains built-in OpenAI base URLs and binds all original configuration changes without copying tool settings", () => {
    const config = {
      model: "original",
      model_provider: null,
      model_providers: {},
      openai_base_url: "https://models.example/v1",
      chatgpt_base_url: "https://chat.example/backend-api",
      mcp_servers: {},
    };
    const first = projectCodexMobileConfiguration({ config });
    const second = projectCodexMobileConfiguration({
      config: { ...config, mcp_servers: { changed: {} } },
    });
    expect(first.providerId).toBe("openai");
    expect(first.args).toContain('openai_base_url="https://models.example/v1"');
    expect(first.configurationHash).not.toBe(second.configurationHash);
    expect(first.args).toEqual(second.args);
  });
  // @lat: [[mobile-data#Mobile data#Codex configuration RPC isolation]]
  it("only initializes and reads effective cwd configuration, uses the same environment and terminates its own process", async () => {
    const methods: string[] = [];
    rpc((frame) => {
      methods.push(frame.method as string);
      if (frame.method === "config/read")
        expect(frame.params).toEqual({
          cwd: "project-root",
          includeLayers: true,
        });
      return {
        id: frame.id,
        result:
          frame.method === "config/read"
            ? { config: { model: "original" } }
            : {},
      };
    });
    const result = await readCodexMobileConfiguration(
      { executablePath: "native-codex" },
      "project-root",
      { SAFE: "value", SECRET: "private-secret" },
    );
    expect(result.model).toBe("original");
    expect(methods).toEqual(["initialize", "config/read"]);
    expect(mock.spawn).toHaveBeenCalledWith(
      "native-codex",
      ["app-server", "--stdio"],
      expect.objectContaining({
        cwd: "project-root",
        env: { SAFE: "value", SECRET: "private-secret" },
        shell: false,
        windowsHide: true,
      }),
    );
    expect(mock.terminate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private-secret");
  });
  // @lat: [[mobile-data#Mobile data#Codex configuration RPC failure bounds]]
  it("rejects RPC failures, malformed UTF8/JSON and oversized frames without exposing stderr or dispatching a turn", async () => {
    for (const mode of ["rpc", "utf8", "json", "oversized", "close", "error"]) {
      const child = rpc((frame) => ({
        id: frame.id,
        error: { message: "private-secret" },
      }));
      child.stdin.removeAllListeners("data");
      child.stdin.once("data", () =>
        queueMicrotask(() => {
          child.stderr.write("private-secret");
          if (mode === "rpc")
            child.stdout.write(
              '{"id":1,"error":{"message":"private-secret"}}\n',
            );
          if (mode === "utf8") child.stdout.write(Buffer.from([0xff]));
          if (mode === "json") child.stdout.write("invalid\n");
          if (mode === "oversized")
            child.stdout.write("x".repeat(4 * 1024 * 1024 + 1));
          if (mode === "close") child.emit("close", 1);
          if (mode === "error") child.emit("error", Error("private-secret"));
        }),
      );
      await expect(
        readCodexMobileConfiguration({}, "root", {}),
      ).rejects.toThrow("unsupported or unavailable");
    }
    expect(mock.terminate).toHaveBeenCalledTimes(6);
  });
  it("bounds silence and waits for process cleanup before returning failure", async () => {
    vi.useFakeTimers();
    try {
      const child = rpc(() => ({}));
      child.stdin.removeAllListeners("data");
      let release!: () => void;
      mock.terminate.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const pending = readCodexMobileConfiguration({}, "root", {}, 20).catch(
        (error) => String(error),
      );
      let finished = false;
      void pending.then(() => {
        finished = true;
      });
      await vi.advanceTimersByTimeAsync(20);
      expect(mock.terminate).toHaveBeenCalledTimes(1);
      expect(finished).toBe(false);
      release();
      expect(await pending).toMatch(/unsupported or unavailable/);
    } finally {
      vi.useRealTimers();
    }
  });
});
