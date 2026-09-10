import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {},
  ipcMain: {},
}));

vi.mock("../updater-log", () => ({
  updaterLogger: {},
}));

import { resolveDesktopUpdatePolicy } from "./updater";

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
