import http from "http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteSessionConfig } from "../src/main/remote-sessions";

describe("remote session cache recovery", () => {
  let server: http.Server;
  let baseUrl = "";
  let testHome = "";

  beforeEach(async () => {
    vi.resetModules();
    testHome = mkdtempSync(join(tmpdir(), "agents-one-remote-cache-"));
    vi.stubEnv("HERMES_HOME", testHome);

    server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/sessions/recovered-hermes/messages") {
        res.end(
          JSON.stringify({
            messages: [
              {
                id: 1,
                role: "user",
                content: "昨天跟 Hermes 的连接测试",
                timestamp: 1784700000,
              },
              {
                id: 2,
                role: "assistant",
                content: "Hermes 连接正常。",
                timestamp: 1784700002,
              },
            ],
          }),
        );
        return;
      }
      if (req.url === "/api/sessions/remote-with-local-user/messages") {
        res.end(
          JSON.stringify({
            messages: [
              {
                id: 2,
                role: "assistant",
                content: "Hermes U5 第一轮通过。",
                timestamp: 1784700102,
              },
            ],
          }),
        );
        return;
      }
      if (req.url?.startsWith("/api/profiles/sessions")) {
        res.end(JSON.stringify({ sessions: [] }));
        return;
      }
      if (req.url?.startsWith("/api/sessions?")) {
        res.end(JSON.stringify({ sessions: [] }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address === "object" && address) {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  function config(): RemoteSessionConfig {
    return { remoteUrl: `${baseUrl}/api`, apiKey: "test-token" };
  }

  it("rebuilds the sidebar cache from saved histories when the remote list is empty", async () => {
    const { remoteGetSessionMessages, remoteListCachedSessions } =
      await import("../src/main/remote-sessions");

    await remoteGetSessionMessages(config(), "recovered-hermes");
    const sessions = await remoteListCachedSessions(config(), 50, 0);

    expect(sessions).toEqual([
      expect.objectContaining({
        id: "recovered-hermes",
        title: "昨天跟 Hermes 的连接测试",
        source: "remote-cache",
        messageCount: 2,
      }),
    ]);
  }, 15_000);

  it("merges local user continuations into remote histories before caching", async () => {
    const desktopDir = join(testHome, "desktop");
    mkdirSync(desktopDir, { recursive: true });
    writeFileSync(
      join(desktopDir, "session-overlays.json"),
      JSON.stringify({
        sessions: {
          "remote-with-local-user": [
            {
              kind: "user",
              content: "Hermes U5 第一轮测试，请只回复通过。",
            },
          ],
        },
      }),
    );

    const { remoteGetSessionMessages, remoteListCachedSessions } =
      await import("../src/main/remote-sessions");

    const items = await remoteGetSessionMessages(
      config(),
      "remote-with-local-user",
    );

    expect(items.map((item) => item.kind)).toEqual(["user", "assistant"]);
    expect(items[0]).toMatchObject({
      kind: "user",
      content: "Hermes U5 第一轮测试，请只回复通过。",
    });

    const sessions = await remoteListCachedSessions(config(), 50, 0);
    expect(sessions).toContainEqual(
      expect.objectContaining({
        id: "remote-with-local-user",
        title: "Hermes U5 第一轮测试，请只回复通过。",
        messageCount: 2,
      }),
    );
  }, 15_000);
});
