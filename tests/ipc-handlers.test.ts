import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
// After the app/ refactor, ipcMain.handle registrations live in the dedicated
// IPC registration module plus the updater module, not in index.ts.
const indexSrc = ["src/main/ipc/register.ts", "src/main/app/updater.ts"]
  .map((p) => readFileSync(join(ROOT, p), "utf-8"))
  .join("\n");
const preloadSrc = readFileSync(join(ROOT, "src/preload/index.ts"), "utf-8");
const appStartSrc = readFileSync(join(ROOT, "src/main/app/start.ts"), "utf-8");
const mainBootstrapSrc = readFileSync(join(ROOT, "src/main/index.ts"), "utf-8");
const profileMetaSrc = readFileSync(
  join(ROOT, "src/main/profile-meta.ts"),
  "utf-8",
);

/**
 * Extract all IPC channel names registered in main/index.ts.
 */
function extractIpcHandleChannels(src: string): string[] {
  const channels: string[] = [];
  const re = /ipcMain\.handle\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    channels.push(m[1]);
  }
  return [...new Set(channels)];
}

/**
 * Extract all ipcRenderer.invoke channel names from preload.
 */
function extractPreloadInvokeChannels(src: string): string[] {
  const channels: string[] = [];
  const re = /ipcRenderer\.invoke\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    channels.push(m[1]);
  }
  return [...new Set(channels)];
}

const mainChannels = extractIpcHandleChannels(indexSrc);
const preloadChannels = extractPreloadInvokeChannels(preloadSrc);

describe("IPC Handler ↔ Preload Consistency", () => {
  it("main process registers IPC handlers", () => {
    expect(mainChannels.length).toBeGreaterThan(30);
  });

  it("preload invokes IPC channels", () => {
    expect(preloadChannels.length).toBeGreaterThan(30);
  });

  it("every preload invoke has a matching main handler", () => {
    const missing = preloadChannels.filter((ch) => !mainChannels.includes(ch));
    expect(missing).toEqual([]);
  });

  it("every main handler has a matching preload invoke", () => {
    const missing = mainChannels.filter((ch) => !preloadChannels.includes(ch));
    expect(missing).toEqual([]);
  });
});

// ─── New feature handlers registered ────────────────────

describe("New IPC handlers from v0.8/v0.9 features", () => {
  const newChannels = [
    "export-agents-one-backup",
    "inspect-agents-one-backup",
    "restore-agents-one-backup",
    "list-quick-chats",
    "save-quick-chats",
    "read-agents-one-diagnostics",
    "run-hermes-dump",
    "list-mcp-servers",
    "add-mcp-server",
    "remove-mcp-server",
    "set-mcp-server-enabled",
    "test-mcp-server",
    "list-mcp-catalog",
    "install-mcp-catalog-entry",
    "discover-memory-providers",
    "update-task-schedule",
  ];

  for (const ch of newChannels) {
    it(`main has handler: ${ch}`, () => {
      expect(mainChannels).toContain(ch);
    });

    it(`preload invokes: ${ch}`, () => {
      expect(preloadChannels).toContain(ch);
    });
  }
});

describe("Agents One backup IPC boundary", () => {
  it("does not expose the legacy Hermes CLI backup/import channels", () => {
    expect(mainChannels).not.toContain("run-hermes-backup");
    expect(mainChannels).not.toContain("run-hermes-import");
    expect(preloadChannels).not.toContain("run-hermes-backup");
    expect(preloadChannels).not.toContain("run-hermes-import");
  });

  it("freezes the old renderer and recovers a durable journal before startup", () => {
    expect(indexSrc).toContain("beginAgentsOneRestoreWriteLock()");
    expect(indexSrc).toContain("window.destroy()");
    expect(appStartSrc).toContain("recoverInterruptedAgentsOneRestore()");
    expect(appStartSrc).toContain("isAgentsOneRestoreWriteLocked()");
  });

  it("prevents a second process and keeps profile metadata behind the write gate", () => {
    expect(mainBootstrapSrc).toContain("app.requestSingleInstanceLock()");
    expect(mainBootstrapSrc).toContain("if (!hasSingleInstanceLock)");
    expect(appStartSrc).toContain('app.on("second-instance"');
    expect(profileMetaSrc).toContain("safeWriteFile(metaPath(name)");
    expect(profileMetaSrc).not.toContain("await fs.writeFile(metaPath(name)");
  });
});

// ─── Legacy handlers still present ──────────────────────

describe("Legacy IPC handlers preserved", () => {
  const legacyChannels = [
    "check-install",
    "start-install",
    "get-hermes-version",
    "run-hermes-doctor",
    "run-hermes-update",
    "get-env",
    "set-env",
    "get-config",
    "set-config",
    "get-model-config",
    "set-model-config",
    "send-message",
    "abort-chat",
    "start-gateway",
    "stop-gateway",
    "restart-gateway",
    "gateway-status",
    "get-platform-enabled",
    "set-platform-enabled",
    "list-sessions",
    "get-session-messages",
    "list-profiles",
    "create-profile",
    "list-cron-jobs",
    "create-cron-job",
    "open-external",
    "open-terminal",
  ];

  for (const ch of legacyChannels) {
    it(`${ch} handler still registered`, () => {
      expect(mainChannels).toContain(ch);
    });
  }
});
