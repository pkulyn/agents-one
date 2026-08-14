import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import type { ConnectionConfig } from "../src/main/config";
import {
  probeDashboardWebSocket,
  remoteDashboardConnectionFromConfig,
} from "../src/main/dashboard";

let server: http.Server | null = null;

function startServer(
  handler: http.RequestListener,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      if (!address || typeof address === "string") {
        throw new Error("Unexpected server address");
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server!.close(() => done())),
      });
    });
  });
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

function remoteConnection(
  overrides: Partial<ConnectionConfig>,
): ConnectionConfig {
  return {
    mode: "remote",
    remoteUrl: "https://hermes.example/v1/",
    apiKey: "dashboard-token",
    remoteChatTransport: "auto",
    ...overrides,
  };
}

describe("remoteDashboardConnectionFromConfig", () => {
  it("builds an upstream dashboard websocket URL from remote settings", () => {
    const connection = remoteDashboardConnectionFromConfig(
      remoteConnection({}),
    );

    expect(connection).toMatchObject({
      baseUrl: "https://hermes.example",
      mode: "remote",
      token: "dashboard-token",
      wsUrl: "wss://hermes.example/api/ws?token=dashboard-token",
    });
  });

  it("preserves a remote dashboard path prefix in the websocket URL", () => {
    const connection = remoteDashboardConnectionFromConfig(
      remoteConnection({
        remoteDashboardUrl: "https://hermes.example/hermes-dashboard/",
      }),
    );

    expect(connection).toMatchObject({
      baseUrl: "https://hermes.example/hermes-dashboard",
      mode: "remote",
      token: "dashboard-token",
      wsUrl:
        "wss://hermes.example/hermes-dashboard/api/ws?token=dashboard-token",
    });
  });

  it("returns null when remote dashboard settings are incomplete", () => {
    expect(
      remoteDashboardConnectionFromConfig(
        remoteConnection({ remoteUrl: "", apiKey: "dashboard-token" }),
      ),
    ).toBeNull();
    expect(
      remoteDashboardConnectionFromConfig(
        remoteConnection({ remoteUrl: "https://hermes.example", apiKey: "" }),
      ),
    ).toBeNull();
  });

  it("ignores non-remote modes", () => {
    expect(
      remoteDashboardConnectionFromConfig(
        remoteConnection({ mode: "local", remoteUrl: "https://hermes.example" }),
      ),
    ).toBeNull();
  });
});

describe("probeDashboardWebSocket", () => {
  it("accepts dashboards that support the embedded chat websocket", async () => {
    const { url } = await startServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    server!.on("upgrade", (_req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n",
      );
      socket.destroy();
    });

    await expect(
      probeDashboardWebSocket({
        baseUrl: url,
        wsUrl: url.replace("http:", "ws:") + "/api/ws?token=token",
        token: "token",
        mode: "remote",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects dashboards where REST works but embedded chat is disabled", async () => {
    const { url } = await startServer((_req, res) => {
      res.statusCode = 403;
      res.end("embedded chat disabled");
    });

    await expect(
      probeDashboardWebSocket({
        baseUrl: url,
        wsUrl: url.replace("http:", "ws:") + "/api/ws?token=token",
        token: "token",
        mode: "remote",
      }),
    ).rejects.toThrow(
      /WebSocket is unavailable \(403: embedded chat disabled\)/,
    );
  });

  it("keeps the successful fallback credential for the renderer websocket", async () => {
    const { url } = await startServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    server!.on("upgrade", (req, socket) => {
      if (req.headers.authorization !== "Bearer gateway-key") {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n",
      );
      socket.destroy();
    });

    const connection = {
      baseUrl: url,
      wsUrl: url.replace("http:", "ws:") + "/api/ws?token=stale-token",
      token: "stale-token",
      fallbackToken: "gateway-key",
      mode: "remote" as const,
    };

    await expect(probeDashboardWebSocket(connection)).resolves.toBeUndefined();
    expect(connection.token).toBe("gateway-key");
    expect(connection.wsUrl).toContain("token=gateway-key");
  });
});
