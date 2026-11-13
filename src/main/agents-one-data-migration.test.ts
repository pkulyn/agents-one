import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve, sep } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "./sqlite";
import { migrateLegacyAgentsOneData } from "./agents-one-data-migration";

vi.mock("electron", () => ({ app: { getPath: () => "" } }));

let fixtureRoot = "";
beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "agents-one-data-migration-"));
});
afterEach(() => {
  const expectedParent = resolve(tmpdir()) + sep;
  if (resolve(fixtureRoot).startsWith(expectedParent)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe("Agents One data migration", () => {
  it("initializes portable data without importing old configs, chats, profiles or credentials", () => {
    const legacy = join(fixtureRoot, "old-hermes");
    const userData = join(fixtureRoot, "portable");
    mkdirSync(join(legacy, "desktop"), { recursive: true });
    writeFileSync(
      join(legacy, "desktop.json"),
      JSON.stringify({
        agentRuntimes: [{ id: "old-test" }],
        futureKey: "keep",
      }),
    );
    writeFileSync(
      join(legacy, "desktop", "runtime-conversations.json"),
      '{"conversations":[{"id":"old-chat"}]}',
    );
    writeFileSync(join(legacy, ".env"), "FIXTURE_KEY=not-a-real-key\n");
    const original = readFileSync(join(legacy, "desktop.json"), "utf8");
    expect(
      migrateLegacyAgentsOneData({
        legacyHermesHome: legacy,
        userDataDirectory: userData,
        importLegacy: false,
      }),
    ).toBe(true);
    const data = join(userData, "data");
    expect(existsSync(join(data, "desktop.json"))).toBe(false);
    expect(
      existsSync(
        join(data, "profiles/default/desktop/runtime-conversations.json"),
      ),
    ).toBe(false);
    expect(
      JSON.parse(readFileSync(join(data, "migration-v1.json"), "utf8")),
    ).toMatchObject({ sourceRoot: null, sourceFiles: [], files: [] });
    expect(readFileSync(join(legacy, "desktop.json"), "utf8")).toBe(original);
    // A portable profile which already exists is never reset by this policy.
    writeFileSync(join(data, "desktop.json"), '{"userSetting":true}');
    expect(
      migrateLegacyAgentsOneData({
        legacyHermesHome: legacy,
        userDataDirectory: userData,
        importLegacy: false,
      }),
    ).toBe(false);
    expect(readFileSync(join(data, "desktop.json"), "utf8")).toBe(
      '{"userSetting":true}',
    );
  });
  it("copies app-owned data and desktop tables without modifying Hermes state", () => {
    const legacy = join(fixtureRoot, "hermes");
    const userData = join(fixtureRoot, "user-data");
    mkdirSync(join(legacy, "desktop", "pi-sessions"), { recursive: true });
    mkdirSync(join(legacy, "desktop-staging", "old-chat"), { recursive: true });
    mkdirSync(join(legacy, "profiles", "writer", "desktop"), {
      recursive: true,
    });
    writeFileSync(
      join(legacy, "desktop.json"),
      JSON.stringify({
        agentRuntimes: [{ id: "pi-local" }],
        futureSetting: true,
      }),
    );
    const oldAttachment = join(
      legacy,
      "desktop-staging",
      "old-chat",
      "image.png",
    );
    writeFileSync(oldAttachment, "test-image");
    writeFileSync(
      join(legacy, "desktop", "runtime-conversations.json"),
      JSON.stringify({
        conversations: [
          { id: "old-chat", attachments: [{ path: oldAttachment }] },
        ],
      }),
    );
    writeFileSync(join(legacy, "desktop", "pi-sessions", "session.json"), "{}");
    writeFileSync(
      join(legacy, "profiles", "writer", "desktop", "task-schedules.json"),
      JSON.stringify({ schedules: [1] }),
    );
    writeFileSync(join(legacy, "active_profile"), "writer\n");
    const nativeDb = new Database(join(legacy, "state.db"));
    nativeDb.exec(
      "CREATE TABLE sessions (id TEXT PRIMARY KEY); INSERT INTO sessions VALUES ('hermes-chat'); CREATE TABLE desktop_session_continuations (session_id TEXT PRIMARY KEY, prefix_json TEXT NOT NULL); INSERT INTO desktop_session_continuations VALUES ('hermes-chat', '[]')",
    );
    nativeDb.close();

    expect(
      migrateLegacyAgentsOneData({
        legacyHermesHome: legacy,
        userDataDirectory: userData,
      }),
    ).toBe(true);
    const data = join(userData, "data");
    expect(
      JSON.parse(readFileSync(join(data, "desktop.json"), "utf8")),
    ).toEqual({ agentRuntimes: [{ id: "pi-local" }], futureSetting: true });
    expect(
      existsSync(
        join(
          data,
          "profiles",
          "default",
          "desktop",
          "runtime-conversations.json",
        ),
      ),
    ).toBe(true);
    expect(
      JSON.parse(
        readFileSync(
          join(
            data,
            "profiles",
            "default",
            "desktop",
            "runtime-conversations.json",
          ),
          "utf8",
        ),
      ).conversations[0].attachments[0].path,
    ).toBe(join(data, "desktop-staging", "old-chat", "image.png"));
    expect(
      existsSync(
        join(
          data,
          "profiles",
          "default",
          "desktop",
          "pi-sessions",
          "session.json",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(data, "profiles", "writer", "desktop", "task-schedules.json"),
      ),
    ).toBe(true);
    expect(readFileSync(join(data, "active_profile"), "utf8")).toBe("writer\n");
    const desktopDb = new Database(
      join(data, "profiles", "default", "desktop.db"),
      { readonly: true },
    );
    expect(
      desktopDb
        .prepare("SELECT session_id FROM desktop_session_continuations")
        .get(),
    ).toEqual({ session_id: "hermes-chat" });
    expect(
      desktopDb
        .prepare("SELECT name FROM sqlite_master WHERE name='sessions'")
        .get(),
    ).toBeUndefined();
    desktopDb.close();
    const retained = new Database(join(legacy, "state.db"), { readonly: true });
    expect(retained.prepare("SELECT id FROM sessions").get()).toEqual({
      id: "hermes-chat",
    });
    retained.close();
    expect(
      migrateLegacyAgentsOneData({
        legacyHermesHome: legacy,
        userDataDirectory: userData,
      }),
    ).toBe(false);
  });

  it("refuses a destination with unrelated data", () => {
    const legacy = join(fixtureRoot, "hermes");
    const userData = join(fixtureRoot, "user-data");
    mkdirSync(legacy);
    mkdirSync(join(userData, "data"), { recursive: true });
    writeFileSync(join(userData, "data", "desktop.json"), "{}");
    expect(() =>
      migrateLegacyAgentsOneData({
        legacyHermesHome: legacy,
        userDataDirectory: userData,
      }),
    ).toThrow(/already exists/);
    expect(readFileSync(join(userData, "data", "desktop.json"), "utf8")).toBe(
      "{}",
    );
  });

  it("removes only its staging directory when unsafe source data aborts the copy", () => {
    const legacy = join(fixtureRoot, "hermes");
    const userData = join(fixtureRoot, "user-data");
    mkdirSync(join(legacy, "desktop"), { recursive: true });
    const source = join(legacy, "desktop", "shared.json");
    writeFileSync(source, "{}");
    linkSync(source, join(legacy, "desktop", "hard-link.json"));

    expect(() =>
      migrateLegacyAgentsOneData({
        legacyHermesHome: legacy,
        userDataDirectory: userData,
      }),
    ).toThrow(/Unsafe legacy data file/);
    expect(readdirSync(userData)).toEqual([]);
  });
});
