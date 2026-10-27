import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  showErrorBox: vi.fn(),
}));
vi.mock("electron", () => ({ dialog: native }));
import { completeBackupRestore } from "../src/main/ipc/backup-restore-completion";
beforeEach(() => {
  vi.resetAllMocks();
  native.showMessageBox.mockResolvedValue({ response: 0 });
});
// @lat: [[backup-recovery#Restore failure after window destruction]]
it("keeps restart pending until the parentless native failure message is acknowledged", async () => {
  let acknowledge!: () => void;
  native.showMessageBox.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  const restart = vi.fn();
  const result = { success: false, error: "Runtime did not stop" };
  const operation = vi.fn(async () => result);
  const pending = completeBackupRestore(operation, "en-US", restart);
  await vi.waitFor(() => expect(native.showMessageBox).toHaveBeenCalledOnce());
  expect(native.showMessageBox.mock.calls[0]).toHaveLength(1);
  expect(restart).not.toHaveBeenCalled();
  acknowledge();
  expect(await pending).toEqual(result);
  expect(restart).toHaveBeenCalledOnce();
});
it("restarts after success without showing a failure", async () => {
  const restart = vi.fn();
  expect(
    await completeBackupRestore(
      async () => ({ success: true }),
      "en-US",
      restart,
    ),
  ).toEqual({ success: true });
  expect(native.showMessageBox).not.toHaveBeenCalled();
  expect(restart).toHaveBeenCalledOnce();
});
it("reports a thrown restore failure without leaking exception credentials", async () => {
  const restart = vi.fn();
  const result = await completeBackupRestore(
    async () => {
      throw Error("api_key=private-value");
    },
    "zh-CN",
    restart,
  );
  expect(result.success).toBe(false);
  expect(JSON.stringify(native.showMessageBox.mock.calls)).not.toContain(
    "private-value",
  );
  expect(restart).toHaveBeenCalledOnce();
});
it("redacts returned credential errors in the native dialog", async () => {
  await completeBackupRestore(
    async () => ({ success: false, error: "Bearer private-token-value" }),
    "en-US",
    vi.fn(),
  );
  expect(JSON.stringify(native.showMessageBox.mock.calls)).not.toContain(
    "private-token-value",
  );
});
it("falls back to a synchronous native error before scheduling restart", async () => {
  native.showMessageBox.mockRejectedValue(Error("unavailable"));
  const restart = vi.fn();
  native.showErrorBox.mockImplementation(() => {
    expect(restart).not.toHaveBeenCalled();
  });
  await completeBackupRestore(
    async () => ({ success: false, error: "failed" }),
    "en-US",
    restart,
  );
  expect(native.showErrorBox).toHaveBeenCalledOnce();
  expect(restart).toHaveBeenCalledOnce();
});
it("still schedules recovery when both native notification APIs fail", async () => {
  native.showMessageBox.mockRejectedValue(Error("unavailable"));
  native.showErrorBox.mockImplementation(() => {
    throw Error("unavailable");
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const restart = vi.fn();
  try {
    await completeBackupRestore(
      async () => ({ success: false }),
      "en-US",
      restart,
    );
    expect(restart).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "[backup] native_restore_failure_notification_unavailable",
    );
  } finally {
    log.mockRestore();
  }
});
