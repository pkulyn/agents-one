import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
function file(profile?: string): string {
  return profile
    ? join(home, "profiles", profile, "config.yaml")
    : join(home, "config.yaml");
}
function seed(proxy: string, profile?: string): void {
  mkdirSync(join(file(profile), ".."), { recursive: true });
  writeFileSync(
    file(profile),
    "network:\n  proxy: " +
      JSON.stringify(proxy) +
      "\n  force_ipv4: false\nfuture:\n  keep: retained\n",
  );
}
async function read(profile?: string): Promise<string | null> {
  return (await state.handlers.get("get-config")!(
    event,
    "network.proxy",
    profile,
  )) as string | null;
}
async function write(value: string, profile?: string): Promise<unknown> {
  return state.handlers.get("set-config")!(
    event,
    "network.proxy",
    value,
    profile,
  );
}
beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "proxy-projection-"));
  vi.stubEnv("HERMES_HOME", home);
  config = await import("../src/main/config");
  const { registerIpcHandlers } = await import("../src/main/ipc/register");
  registerIpcHandlers({
    activeRuns: new Map(),
    getMainWindow: () => main,
    notifyConnectionConfigChanged: vi.fn(),
    notifyModelLibraryChanged: vi.fn(),
    openExternalUrl: vi.fn(),
  } as never);
}, 15000);
beforeEach(() => seed("http://alice:fixture-password@proxy.example:8080"));
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

it.each([
  [
    "http://alice:fixture-password@proxy.example:8080",
    ["alice", "fixture-password"],
  ],
  [
    "socks5://user%40example:encoded%3Apassword@proxy.example:1080",
    ["user%40example", "encoded%3Apassword"],
  ],
  [
    "https://proxy.example/private-path?unrecognized=private-query#private-fragment",
    ["private-path", "private-query", "private-fragment"],
  ],
  ["invalid value fixture-private", ["fixture-private"]],
] as const)(
  "never sends stored URL components through the real IPC: %s",
  async (raw, secrets) => {
    seed(raw);
    const visible = await read();
    for (const secret of secrets) expect(visible).not.toContain(secret);
    expect(config.getConfigValue("network.proxy")).toBe(raw);
    await write(visible!);
    expect(config.getConfigValue("network.proxy")).toBe(raw);
  },
);
it("preserves a non-credential proxy exactly", async () => {
  const raw = "http://127.0.0.1:8080";
  seed(raw);
  expect(await read()).toBe(raw);
});
it("rejects edited retained markers instead of storing them or carrying old secrets to another host", async () => {
  const raw = config.getConfigValue("network.proxy");
  const visible = (await read())!;
  expect(visible).not.toContain("fixture-password");
  const before = readFileSync(file(), "utf8");
  await expect(
    write(visible.replace("proxy.example", "another.example")),
  ).rejects.toThrow();
  expect(readFileSync(file(), "utf8")).toBe(before);
  expect(config.getConfigValue("network.proxy")).toBe(raw);
});
it("allows explicit replacement and clearing while retaining unrelated YAML", async () => {
  await write("https://new-user:new-fixture-secret@new.example:8443");
  expect(config.getConfigValue("network.proxy")).toBe(
    "https://new-user:new-fixture-secret@new.example:8443",
  );
  expect(await read()).not.toContain("new-fixture-secret");
  expect(config.getConfigValue("future.keep")).toBe("retained");
  await write("https://new.example:8443");
  expect(config.getConfigValue("network.proxy")).toBe(
    "https://new.example:8443",
  );
  await write("");
  expect(config.getConfigValue("network.proxy")).toBe("");
});
it("binds unchanged projections to the target profile's own current value", async () => {
  seed("http://a:secret-a@proxy.example:8080", "a");
  seed("http://b:secret-b@proxy.example:8080", "b");
  const visible = (await read("a"))!;
  await write(visible, "b");
  expect(config.getConfigValue("network.proxy", "a")).toBe(
    "http://a:secret-a@proxy.example:8080",
  );
  expect(config.getConfigValue("network.proxy", "b")).toBe(
    "http://b:secret-b@proxy.example:8080",
  );
  await expect(
    write(visible.replace("proxy.example", "another.example"), "b"),
  ).rejects.toThrow();
});

it.each(["__SAVED__", "%5f%5fsaved%5f%5f", "%255f%255fsaved%255f%255f"])(
  "rejects edited encoded retained marker %s",
  async (marker) => {
    const before = readFileSync(file(), "utf8");
    await expect(
      write("http://" + marker + "@different.example:8080"),
    ).rejects.toThrow();
    expect(readFileSync(file(), "utf8")).toBe(before);
  },
);
it("keeps freshly rotated native credentials when an old projection is returned unchanged", async () => {
  const visible = (await read())!;
  seed("http://rotated-user:rotated-secret@proxy.example:8080");
  await write(visible);
  expect(config.getConfigValue("network.proxy")).toBe(
    "http://rotated-user:rotated-secret@proxy.example:8080",
  );
});
