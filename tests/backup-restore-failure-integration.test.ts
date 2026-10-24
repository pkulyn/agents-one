import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  showErrorBox: vi.fn(),
}));
vi.mock("electron", () => ({
  dialog: native,
  app: { getPath: () => process.env.AGENTS_ONE_USER_DATA_DIR || process.cwd() },
}));
import { restoreAgentsOneBackupFrom } from "../src/main/agents-one-backup";
import { completeBackupRestore } from "../src/main/ipc/backup-restore-completion";
it("reports a real archive-validation failure natively and preserves original data before restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agents-one-restore-failure-"));
  let acknowledge!: () => void;
  native.showMessageBox.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  const restart = vi.fn();
  try {
    const target = join(directory, "target");
    mkdirSync(target);
    const original = join(target, "original.txt");
    writeFileSync(original, "preserved user data");
    const archive = join(directory, "broken.agents-one-backup");
    writeFileSync(archive, "not a valid archive");
    const pending = completeBackupRestore(
      () => restoreAgentsOneBackupFrom(archive, { targetHome: target }),
      "en-US",
      restart,
    );
    await vi.waitFor(() =>
      expect(native.showMessageBox).toHaveBeenCalledOnce(),
    );
    expect(native.showMessageBox.mock.calls[0]).toHaveLength(1);
    expect(restart).not.toHaveBeenCalled();
    expect(readFileSync(original, "utf8")).toBe("preserved user data");
    acknowledge();
    expect((await pending).success).toBe(false);
    expect(restart).toHaveBeenCalledOnce();
    expect(readFileSync(original, "utf8")).toBe("preserved user data");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
