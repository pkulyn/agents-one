import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  request: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.1.0" },
  ipcMain: {},
  net: { fetch: mocks.request },
}));
vi.mock("../ipc/sender-scope", () => ({
  createScopedIpcMain: () => ({
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(name, handler),
  }),
}));

vi.mock("../updater-log", () => ({
  updaterLogger: {},
}));

import { setupUpdater, resolveDesktopUpdatePolicy } from "./updater";

describe("resolveDesktopUpdatePolicy", () => {
  it("disables auto-update for the unsigned public Alpha build", () => {
    expect(
      resolveDesktopUpdatePolicy({
        isPackaged: true,
        isPortable: false,
        signedBuild: false,
      }),
    ).toEqual({ enabled: false, reason: "unsigned-build" });
  });

  it("keeps portable builds disabled even when a signed build opts in", () => {
    expect(
      resolveDesktopUpdatePolicy({
        isPackaged: true,
        isPortable: true,
        signedBuild: true,
      }),
    ).toEqual({ enabled: false, reason: "portable" });
  });

  it("allows only a packaged, non-portable, signed build", () => {
    expect(
      resolveDesktopUpdatePolicy({
        isPackaged: true,
        isPortable: false,
        signedBuild: true,
      }),
    ).toEqual({ enabled: true, reason: null });
  });
});

// @lat: [[desktop-updates#Manual update IPC acceptance]]
it("lets an unsigned packaged app query GitHub while download/install stay inert", async () => {
  mocks.handlers.clear();
  mocks.request.mockResolvedValue(
    new Response(
      JSON.stringify({ tag_name: "v0.1.1", draft: false, prerelease: false }),
    ),
  );
  setupUpdater({ getMainWindow: () => null });
  expect(await mocks.handlers.get("check-for-updates")!()).toBe("0.1.1");
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(mocks.handlers.get("download-update")!()).toBe(false);
  expect(mocks.handlers.get("install-update")!()).toBeUndefined();
  expect(mocks.handlers.get("set-auto-upgrade-enabled")!(null, true)).toBe(
    false,
  );
});
