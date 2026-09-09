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

describe("connection config (local-only — plan D5)", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-connection-config-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("exposes a local-only connection and never leaks stored secrets", async () => {
    const { getConnectionConfig, getPublicConnectionConfig } =
      await loadConnectionConfigModule();

    expect(getConnectionConfig()).toEqual({ mode: "local" });
    const publicConfig = getPublicConnectionConfig();
    expect(publicConfig).toEqual({ mode: "local" });
    // No secret fields may ever be exposed to the renderer.
    expect("apiKey" in publicConfig).toBe(false);
  });

  it("reads legacy remote/ssh desktop configs as local without leaking secrets", async () => {
    const { getConnectionConfig, getPublicConnectionConfig } =
      await loadConnectionConfigModule();

    writeFileSync(
      join(testHome, "desktop.json"),
      `\uFEFF${JSON.stringify({
        connectionMode: "remote",
        remoteUrl: "https://hermes.example",
        remoteApiKey: "remote-secret",
        sshConfig: {
          host: "example.internal",
          port: 22,
          username: "hermes",
          keyPath: "~/.ssh/id_rsa",
          remotePort: 8642,
          localPort: 18642,
        },
      })}`,
      "utf-8",
    );

    // The built-in Hermes connection is local-only: legacy remote/ssh fields
    // are ignored on read (plan D4/D5) — remote agents go through Gateway v1.
    expect(getConnectionConfig()).toEqual({ mode: "local" });
    const publicConfig = getPublicConnectionConfig();
    expect(publicConfig).toEqual({ mode: "local" });
    expect(JSON.stringify(publicConfig)).not.toContain("remote-secret");
  });

  it("uses the caller-supplied API key for main-process connection tests", async () => {
    const { testRemoteConnection } = await import("../src/main/hermes");
    const server = http.createServer((req, res) => {
      res.statusCode =
        req.headers.authorization === "Bearer remote-secret" ? 200 : 401;
      res.end();
    });

    const url = await listen(server);

    try {
      await expect(testRemoteConnection(url, "remote-secret")).resolves.toBe(
        true,
      );
      await expect(testRemoteConnection(url, "wrong-secret")).resolves.toBe(
        false,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
