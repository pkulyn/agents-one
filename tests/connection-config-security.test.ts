import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import http from "http";
import type { AddressInfo } from "net";

let testHome: string;

async function loadConnectionConfigModule(): Promise<
  typeof import("../src/main/config")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("../src/main/config");
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe("connection config secret exposure", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-connection-config-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("keeps the remote API key out of the public renderer config", async () => {
    const {
      getConnectionConfig,
      getPublicConnectionConfig,
      resolveConnectionApiKeyUpdate,
      setConnectionConfig,
    } = await loadConnectionConfigModule();

    setConnectionConfig({
      mode: "remote",
      remoteUrl: "https://hermes.example",
      apiKey: "remote-secret",
      remoteChatTransport: "dashboard",
    });

    expect(getConnectionConfig().apiKey).toBe("remote-secret");

    const publicConfig = getPublicConnectionConfig();
    expect(publicConfig).toMatchObject({
      mode: "remote",
      remoteUrl: "https://hermes.example",
      remoteChatTransport: "dashboard",
      hasApiKey: true,
      // Length is intentionally exposed so the renderer can render a
      // mask that matches the stored key's width. The secret itself
      // must NOT be present — covered by the assertions below.
      apiKeyLength: "remote-secret".length,
    });
    expect("apiKey" in publicConfig).toBe(false);
    expect(JSON.stringify(publicConfig)).not.toContain("remote-secret");

    const existing = getConnectionConfig();
    expect(
      resolveConnectionApiKeyUpdate(
        existing,
        "remote",
        "https://hermes.example",
      ),
    ).toBe("remote-secret");
    expect(
      resolveConnectionApiKeyUpdate(
        existing,
        "remote",
        "https://attacker.example",
      ),
    ).toBe("");
  });

  it("reads desktop config files written with a UTF-8 BOM", async () => {
    const { getConnectionConfig } = await loadConnectionConfigModule();

    writeFileSync(
      join(testHome, "desktop.json"),
      `\uFEFF${JSON.stringify({
        connectionMode: "remote",
        remoteUrl: "https://hermes.example",
        remoteApiKey: "remote-secret",
        remoteChatTransport: "dashboard",
      })}`,
      "utf-8",
    );

    expect(getConnectionConfig()).toMatchObject({
      mode: "remote",
      remoteUrl: "https://hermes.example",
      apiKey: "remote-secret",
      remoteChatTransport: "dashboard",
    });
  });

  it("uses the gateway API key as a dashboard fallback only for the same origin", async () => {
    const { getConnectionConfig, getRemoteDashboardSessionConfig, setConnectionConfig } =
      await loadConnectionConfigModule();

    setConnectionConfig({
      mode: "remote",
      remoteUrl: "https://hermes.example/hermes-api",
      apiKey: "gateway-secret",
      remoteDashboardUrl: "https://hermes.example/hermes-dashboard",
      remoteDashboardToken: "dashboard-secret",
      remoteChatTransport: "auto",
    });

    expect(getRemoteDashboardSessionConfig(getConnectionConfig())).toMatchObject({
      apiKey: "dashboard-secret",
      fallbackApiKey: "gateway-secret",
    });

    setConnectionConfig({
      ...getConnectionConfig(),
      remoteDashboardUrl: "https://other.example/hermes-dashboard",
    });

    expect(
      getRemoteDashboardSessionConfig(getConnectionConfig()).fallbackApiKey,
    ).toBeUndefined();
  });

  it("allows self-signed certificates only for configured remote Hermes origins", async () => {
    const { getConnectionConfig, setConnectionConfig } =
      await loadConnectionConfigModule();
    const { configuredRemoteTlsOptions } = await import("../src/main/remote-tls");

    setConnectionConfig({
      mode: "remote",
      remoteUrl: "https://hermes.example/hermes-api",
      apiKey: "remote-secret",
      remoteDashboardUrl: "https://hermes.example/hermes-dashboard",
      remoteDashboardToken: "dashboard-secret",
      remoteChatTransport: "auto",
    });

    expect(
      configuredRemoteTlsOptions(
        "https://hermes.example/hermes-api/v1/chat/completions",
      ),
    ).toEqual({ rejectUnauthorized: false });
    expect(
      configuredRemoteTlsOptions("https://hermes.example/hermes-dashboard/api/status"),
    ).toEqual({ rejectUnauthorized: false });
    expect(
      configuredRemoteTlsOptions("https://attacker.example/hermes-api/health"),
    ).toEqual({});
  });

  it("uses the stored remote API key for main-process connection tests", async () => {
    const { setConnectionConfig } = await loadConnectionConfigModule();
    const { testRemoteConnection } = await import("../src/main/hermes");
    const server = http.createServer((req, res) => {
      res.statusCode =
        req.headers.authorization === "Bearer remote-secret" ? 200 : 401;
      res.end();
    });

    const url = await listen(server);

    try {
      setConnectionConfig({
        mode: "remote",
        remoteUrl: url,
        apiKey: "remote-secret",
        remoteChatTransport: "auto",
      });

      await expect(testRemoteConnection(url)).resolves.toBe(true);
      await expect(testRemoteConnection(url, "wrong-secret")).resolves.toBe(
        false,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("preserves remote settings when switching away from remote mode", async () => {
    const {
      getConnectionConfig,
      resolveConnectionApiKeyUpdate,
      setConnectionConfig,
    } = await loadConnectionConfigModule();

    setConnectionConfig({
      mode: "remote",
      remoteUrl: "https://hermes.example",
      apiKey: "remote-secret",
      remoteChatTransport: "dashboard",
    });

    setConnectionConfig({
      ...getConnectionConfig(),
      mode: "local",
      remoteUrl: "",
      apiKey: "",
    });

    expect(getConnectionConfig()).toMatchObject({
      mode: "local",
      remoteUrl: "https://hermes.example",
      apiKey: "remote-secret",
      remoteChatTransport: "dashboard",
    });

    const localConfig = getConnectionConfig();
    const restoredApiKey = resolveConnectionApiKeyUpdate(
      localConfig,
      "remote",
      "https://hermes.example",
      undefined,
    );
    setConnectionConfig({
      ...localConfig,
      mode: "remote",
      remoteUrl: "https://hermes.example",
      apiKey: restoredApiKey,
    });

    expect(getConnectionConfig()).toMatchObject({
      mode: "remote",
      remoteUrl: "https://hermes.example",
      apiKey: "remote-secret",
      remoteChatTransport: "dashboard",
    });
  });

  it("read-only migrates a persisted SSH connection to remote without leaking the API key", async () => {
    const { getConnectionConfig, getPublicConnectionConfig, writeDesktopConfig } =
      await loadConnectionConfigModule();

    // Simulate a legacy SSH connection persisted before SSH mode was removed.
    writeDesktopConfig({
      connectionMode: "ssh",
      sshConfig: {
        host: "example.internal",
        port: 22,
        username: "hermes",
        keyPath: "~/.ssh/id_rsa",
        remotePort: 8642,
        localPort: 18642,
      },
      remoteApiKey: "remote-secret",
    });

    const config = getConnectionConfig();
    expect(config.mode).toBe("remote");
    expect(config.migratedFromSsh).toBe(true);

    const publicConfig = getPublicConnectionConfig();
    expect(publicConfig.mode).toBe("remote");
    expect(publicConfig.migratedFromSsh).toBe(true);
    expect("apiKey" in publicConfig).toBe(false);
    expect(JSON.stringify(publicConfig)).not.toContain("remote-secret");
  });
});
