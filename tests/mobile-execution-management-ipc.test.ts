import { beforeEach, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { registerMobileExecutionPolicyIpc } from "../src/main/mobile-control/execution-management-ipc";
const state = vi.hoisted(() => ({
  handle: vi.fn(),
  manage: vi.fn(() => ({ status: { revision: "0" } })),
  recover: vi.fn(() => ({ items: [], capacityExceeded: false })),
}));
vi.mock("electron", () => ({ ipcMain: { handle: state.handle } }));
vi.mock("../src/main/mobile-control/execution-management", () => ({
  prepareAndManageMobileExecutionPolicies: state.manage,
}));
vi.mock("../src/main/mobile-control/project-write-recovery", () => ({
  manageMobileWriteRecovery: state.recover,
}));
beforeEach(() => {
  state.handle.mockClear();
  state.manage.mockClear();
  state.recover.mockClear();
});
// @lat: [[mobile-data#Mobile data#Execution management trusted frame]]
it("accepts only the current desktop window main frame and never dispatches requests from children or another window", () => {
  const mainFrame = {},
    contents = { mainFrame };
  let window = { webContents: contents } as unknown as BrowserWindow | null;
  registerMobileExecutionPolicyIpc(() => window);
  expect(state.handle).toHaveBeenCalledWith(
    "mobile-execution-manage",
    expect.any(Function),
  );
  const handler = state.handle.mock.calls.find(
    (call) => call[0] === "mobile-execution-manage",
  )![1] as (
    event: IpcMainInvokeEvent,
    profile: string,
    command: unknown,
  ) => unknown;
  for (const event of [
    { sender: { mainFrame: {} }, senderFrame: mainFrame },
    { sender: contents, senderFrame: {} },
  ])
    expect(() =>
      handler(event as IpcMainInvokeEvent, "owner", { action: "status" }),
    ).toThrow("scope_denied");
  expect(state.manage).not.toHaveBeenCalled();
  handler(
    { sender: contents, senderFrame: mainFrame } as IpcMainInvokeEvent,
    "owner",
    { action: "status" },
  );
  expect(state.manage).toHaveBeenCalledWith(
    "owner",
    { action: "status" },
    expect.any(Function),
  );
  const assertCurrent = state.manage.mock.calls[0][2] as () => void;
  assertCurrent();
  window = null;
  expect(() => assertCurrent()).toThrow("scope_denied");
  expect(() =>
    handler(
      { sender: contents, senderFrame: mainFrame } as IpcMainInvokeEvent,
      "owner",
      { action: "approve" },
    ),
  ).toThrow("scope_denied");
  expect(state.manage).toHaveBeenCalledTimes(1);
});
// @lat: [[mobile-data#Mobile data#Recovery IPC trusted frame]]
it("allows recovery only from the current main frame and retains a current-frame guard across awaits", () => {
  const mainFrame = {},
    contents = { mainFrame };
  let window = { webContents: contents } as unknown as BrowserWindow | null;
  registerMobileExecutionPolicyIpc(() => window);
  const handler = state.handle.mock.calls.find(
    (call) => call[0] === "mobile-write-recovery",
  )![1];
  expect(() =>
    handler({ sender: contents, senderFrame: {} }, "owner", {
      action: "status",
    }),
  ).toThrow("scope_denied");
  expect(state.recover).not.toHaveBeenCalled();
  handler({ sender: contents, senderFrame: mainFrame }, "owner", {
    action: "status",
  });
  const guard = state.recover.mock.calls[0][2] as () => void;
  guard();
  window = null;
  expect(guard).toThrow("scope_denied");
});
