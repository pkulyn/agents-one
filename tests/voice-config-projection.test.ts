import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
type Handler = (...args: unknown[]) => unknown;
const state = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }));
vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getPath: () => process.env.AGENTS_ONE_USER_DATA_DIR,
  },
  ipcMain: {
    handle: (channel: string, handler: Handler) =>
      state.handlers.set(channel, handler),
    on: vi.fn(),
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {},
  Menu: {},
  clipboard: {},
  shell: {},
}));
let home: string;
let config: typeof import("../src/main/config");
const frame = {
  url: pathToFileURL(join(process.cwd(), "src/main/renderer/index.html")).href,
};
const contents = { mainFrame: frame, isDestroyed: () => false, send: vi.fn() };
const main = { webContents: contents, isDestroyed: () => false };
const event = { sender: contents, senderFrame: frame };

import { createServer } from "node:http";
let hermes: typeof import("../src/main/hermes");
function seedVoice(url: string, key = "fixture-bearer"): void {
  writeFileSync(
    join(home, ".env"),
    "AGENTS_ONE_VOICE_ENABLED=1\nAGENTS_ONE_VOICE_API_URL=" +
      url +
      "\nAGENTS_ONE_VOICE_API_KEY=" +
      key +
      "\nFUTURE_KEEP=retained\n",
  );
}
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return state.handlers.get(channel)!(event, ...args);
}
beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "voice-projection-"));
  vi.stubEnv("HERMES_HOME", home);
  vi.stubEnv("AGENTS_ONE_VOICE_API_KEY", "");
  delete process.env.AGENTS_ONE_VOICE_API_KEY;
  config = await import("../src/main/config");
  hermes = await import("../src/main/hermes");
  const { registerIpcHandlers } = await import("../src/main/ipc/register");
  registerIpcHandlers({
    activeRuns: new Map(),
    getMainWindow: () => main,
    notifyConnectionConfigChanged: vi.fn(),
    notifyModelLibraryChanged: vi.fn(),
    openExternalUrl: vi.fn(),
  } as never);
}, 15000);
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});
it("keeps path and key private through registered read/save/test handlers while real health uses native values", async () => {
  const received: {
    url: string | undefined;
    authorization: string | undefined;
  }[] = [];
  const server = createServer((req, res) => {
    received.push({ url: req.url, authorization: req.headers.authorization });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: "fixture" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Missing fixture port");
    const raw = "http://127.0.0.1:" + address.port + "/private-service-route";
    seedVoice(raw);
    const visible = (await invoke("get-voice-input-config")) as {
      url: string;
      hasApiKey: boolean;
    };
    expect(visible.url).not.toContain("private-service-route");
    expect(JSON.stringify(visible)).not.toContain("fixture-bearer");
    expect(visible.hasApiKey).toBe(true);
    const response = await invoke("save-voice-input-config", {
      enabled: true,
      url: visible.url,
    });
    expect(JSON.stringify(response)).not.toContain("private-service-route");
    expect(config.readEnv().FUTURE_KEEP).toBe("retained");
    expect(config.readEnv().AGENTS_ONE_VOICE_API_URL).toBe(raw);
    expect(config.readEnv().AGENTS_ONE_VOICE_API_KEY).toBe("fixture-bearer");
    expect(hermes.getVoiceTranscriptionConfig().url).toBe(
      raw + "/v1/audio/transcriptions",
    );
    await expect(
      invoke("test-voice-input-service", { url: visible.url }),
    ).resolves.toMatchObject({ ok: true });
    expect(received).toEqual([
      {
        url: "/private-service-route/health",
        authorization: "Bearer fixture-bearer",
      },
    ]);
    const before = readFileSync(join(home, ".env"), "utf8");
    const changed = visible.url.replace("127.0.0.1", "localhost");
    await expect(
      invoke("save-voice-input-config", { enabled: true, url: changed }),
    ).rejects.toThrow();
    await expect(
      invoke("test-voice-input-service", { url: changed }),
    ).rejects.toThrow();
    expect(readFileSync(join(home, ".env"), "utf8")).toBe(before);
    expect(received).toHaveLength(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
