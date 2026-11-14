import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
const state = vi.hoisted(() => ({ home: "" }));
vi.mock("./utils", () => ({
  agentsOneProfileHome: (p: string) => join(state.home, "data/profiles", p),
  getActiveProfileNameSync: () => "default",
  safeWriteFile: (file: string, value: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, value);
  },
}));
import {
  configureDesktopSecretStore,
  DesktopSecretStore,
} from "./desktop-secret-store";
import {
  portableVoiceApiKey,
  readPortableVoiceEnvironment,
  savePortableVoiceSettings,
} from "./portable-voice-settings";
let store: DesktopSecretStore;
beforeEach(() => {
  state.home = mkdtempSync(join(tmpdir(), "agents-one-portable-voice-"));
  store = new DesktopSecretStore(join(state.home, "protected-secrets.json"), {
    available: true,
    backend: "test",
    encrypt: (s) => Buffer.from(s),
    decrypt: (b) => b.toString(),
  });
  configureDesktopSecretStore(store);
});
afterEach(() => rmSync(state.home, { recursive: true, force: true }));

// @lat: [[voice-input#Portable voice isolation]]
it("starts disabled and persists explicit settings and protected keys separately for each profile", () => {
  expect(readPortableVoiceEnvironment()).toEqual({
    AGENTS_ONE_VOICE_ENABLED: "0",
    AGENTS_ONE_VOICE_API_URL: "",
  });
  expect(portableVoiceApiKey()).toBe("");
  savePortableVoiceSettings({
    enabled: true,
    url: "https://selected.example.test",
    replacementKey: "portable-fixture-secret",
  });
  expect(readPortableVoiceEnvironment()).toMatchObject({
    AGENTS_ONE_VOICE_ENABLED: "1",
    AGENTS_ONE_VOICE_API_URL: "https://selected.example.test",
  });
  expect(portableVoiceApiKey()).toBe("portable-fixture-secret");
  expect(readPortableVoiceEnvironment("other").AGENTS_ONE_VOICE_ENABLED).toBe(
    "0",
  );
  expect(portableVoiceApiKey("other")).toBe("");
  configureDesktopSecretStore(
    new DesktopSecretStore(store.filePath, store.protector),
  );
  expect(portableVoiceApiKey()).toBe("portable-fixture-secret");
  const settings = join(
    state.home,
    "data/profiles/default/desktop/voice-input.json",
  );
  expect(readFileSync(settings, "utf8")).not.toContain(
    "portable-fixture-secret",
  );
  expect(readFileSync(store.filePath, "utf8")).not.toContain(
    "portable-fixture-secret",
  );
  writeFileSync(
    settings,
    JSON.stringify({
      ...JSON.parse(readFileSync(settings, "utf8")),
      futureField: { keep: true },
    }),
  );
  savePortableVoiceSettings({
    enabled: false,
    url: "https://selected.example.test",
    clearApiKey: true,
  });
  expect(portableVoiceApiKey()).toBe("");
  expect(JSON.parse(readFileSync(settings, "utf8")).futureField).toEqual({
    keep: true,
  });
});

it("preserves damaged settings and refuses credential saves without OS protection", () => {
  store.protector.available = false;
  expect(() =>
    savePortableVoiceSettings({
      enabled: true,
      url: "https://selected.example.test",
      replacementKey: "fixture-key",
    }),
  ).toThrow("Secure credential storage is unavailable");
  const file = join(
    state.home,
    "data/profiles/default/desktop/voice-input.json",
  );
  expect(existsSync(file)).toBe(false);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "invalid fixture");
  expect(() => readPortableVoiceEnvironment()).toThrow(
    "original data was preserved",
  );
  expect(() =>
    savePortableVoiceSettings({ enabled: false, url: "" }),
  ).toThrow();
  expect(readFileSync(file, "utf8")).toBe("invalid fixture");
});
