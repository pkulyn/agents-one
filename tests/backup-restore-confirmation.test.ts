import { createHash } from "node:crypto";
import { withFrozenBackupArchive } from "../src/main/ipc/frozen-backup-archive";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { beforeEach, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
const show = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({ dialog: { showMessageBox: show } }));
import { runConfirmedBackupRestore } from "../src/main/ipc/backup-restore-confirmation";
const window = { isDestroyed: () => false, webContents: { mainFrame: {} } };
const event = {
  sender: window.webContents,
  senderFrame: window.webContents.mainFrame,
} as unknown as IpcMainInvokeEvent;
const getWindow = (): BrowserWindow => window as unknown as BrowserWindow;
let directory: string;
let archive: string;
afterEach(() => rmSync(directory, { recursive: true, force: true }));
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "restore-confirm-test-"));
  archive = join(directory, "backup.archive");
  writeFileSync(archive, "approved bytes");
  show.mockReset();
  show.mockResolvedValue({ response: 1 });
});
// @lat: [[backup-recovery#Native restore confirmation]]
it("defaults to native cancel without invoking any restore lifecycle", async () => {
  const restore = vi.fn();
  const result = await runConfirmedBackupRestore(
    event,
    getWindow,
    archive,
    "zh-CN",
    restore,
  );
  expect(result.success).toBe(false);
  expect(restore).not.toHaveBeenCalled();
  expect(show.mock.calls[0][1]).toMatchObject({
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
});
it("rejects another frame before displaying a privileged dialog", async () => {
  const restore = vi.fn();
  await runConfirmedBackupRestore(
    { ...event, senderFrame: {} } as IpcMainInvokeEvent,
    getWindow,
    archive,
    "en-US",
    restore,
  );
  expect(show).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
});
it("runs restoration only after explicit confirmation", async () => {
  show.mockResolvedValue({ response: 0 });
  const restore = vi.fn(async () => ({ success: true }));
  expect(
    await runConfirmedBackupRestore(
      event,
      getWindow,
      archive,
      "en-US",
      restore,
    ),
  ).toEqual({ success: true });
  expect(restore).toHaveBeenCalledOnce();
});
it("rechecks the current window after asynchronous confirmation", async () => {
  let current: BrowserWindow | null = getWindow();
  show.mockImplementation(async () => {
    current = null;
    return { response: 0 };
  });
  const restore = vi.fn();
  await runConfirmedBackupRestore(
    event,
    () => current,
    archive,
    "en-US",
    restore,
  );
  expect(restore).not.toHaveBeenCalled();
});
it("serializes the entire operation, not just the confirmation", async () => {
  show.mockResolvedValue({ response: 0 });
  let release!: () => void;
  const operation = new Promise<void>((r) => {
    release = r;
  });
  const first = runConfirmedBackupRestore(
    event,
    getWindow,
    archive,
    "en-US",
    async () => {
      await operation;
      return { success: true };
    },
  );
  await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
  const second = vi.fn();
  expect(
    await runConfirmedBackupRestore(event, getWindow, archive, "en-US", second),
  ).toMatchObject({ error: "restore_in_progress" });
  expect(second).not.toHaveBeenCalled();
  release();
  await first;
});
it("fails closed on native dialog failure and releases the gate", async () => {
  show.mockRejectedValueOnce(Error("native failure"));
  const restore = vi.fn(async () => ({ success: true }));
  expect(
    await runConfirmedBackupRestore(
      event,
      getWindow,
      archive,
      "en-US",
      restore,
    ),
  ).toMatchObject({ error: "restore_confirmation_failed" });
  expect(restore).not.toHaveBeenCalled();
  show.mockResolvedValue({ response: 0 });
  expect(
    (
      await runConfirmedBackupRestore(
        event,
        getWindow,
        archive,
        "en-US",
        restore,
      )
    ).success,
  ).toBe(true);
});

it("distinguishes a restore callback failure from a failed confirmation", async () => {
  show.mockResolvedValue({ response: 0 });
  expect(
    await runConfirmedBackupRestore(
      event,
      getWindow,
      archive,
      "en-US",
      async () => {
        throw Error("restore failed");
      },
    ),
  ).toMatchObject({ error: "restore_failed" });
});

it("restores the frozen approved bytes when the original is replaced during confirmation", async () => {
  let snapshotPath = "";
  show.mockImplementation(async () => {
    writeFileSync(archive, "replacement bytes");
    return { response: 0 };
  });
  const result = await runConfirmedBackupRestore(
    event,
    getWindow,
    archive,
    "en-US",
    async (snapshot) => {
      snapshotPath = snapshot;
      expect(readFileSync(snapshot, "utf8")).toBe("approved bytes");
      return { success: true };
    },
  );
  expect(result.success).toBe(true);
  expect(existsSync(snapshotPath)).toBe(false);
  expect(readFileSync(archive, "utf8")).toBe("replacement bytes");
  expect(show.mock.calls[0][1].detail).toContain(
    createHash("sha256").update("approved bytes").digest("hex"),
  );
});

it("does not show a confirmation or enter restoration when snapshot creation fails", async () => {
  const restore = vi.fn();
  const result = await runConfirmedBackupRestore(
    event,
    getWindow,
    join(directory, "missing"),
    "en-US",
    restore,
  );
  expect(result.error).toBe("backup_snapshot_failed");
  expect(show).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
});

it("cleans its snapshot after a consumer rejects while preserving the original", async () => {
  let target = "";
  await expect(
    withFrozenBackupArchive(archive, async (snapshot) => {
      target = snapshot.path;
      expect(readFileSync(target, "utf8")).toBe("approved bytes");
      throw Error("consumer failure");
    }),
  ).rejects.toThrow("consumer failure");
  expect(existsSync(target)).toBe(false);
  expect(readFileSync(archive, "utf8")).toBe("approved bytes");
});
