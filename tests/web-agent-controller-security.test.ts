import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebAgentRuntimeSettings } from "../src/shared/web-agent";

const electronMocks = vi.hoisted(() => ({
  clearStorageData: vi.fn(async () => undefined),
  clearCache: vi.fn(async () => undefined),
  fromPartition: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "C:\\temp") },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    getFocusedWindow: vi.fn(() => null),
  },
  session: { fromPartition: electronMocks.fromPartition },
}));

import { WebAgentController } from "../src/main/web-agent/controller";

const settings: WebAgentRuntimeSettings = {
  provider: "chatgpt",
  profileId: "Work/Account",
  adapterVersion: "1.0.0",
  enabled: true,
};

// @lat: [[web-agent-runtime#Provider isolation]]
describe("Web Agent controller security boundary", () => {
  beforeEach(() => {
    electronMocks.clearStorageData.mockClear();
    electronMocks.clearCache.mockClear();
    electronMocks.fromPartition.mockReset();
    electronMocks.fromPartition.mockReturnValue({
      clearStorageData: electronMocks.clearStorageData,
      clearCache: electronMocks.clearCache,
    });
  });

  it("clears only the normalized provider/profile partition on logout", async () => {
    const controller = new WebAgentController();

    await controller.clearLogin(settings);

    expect(electronMocks.fromPartition).toHaveBeenCalledWith(
      "persist:agents-one-web-chatgpt:work-account",
    );
    expect(electronMocks.clearStorageData).toHaveBeenCalledTimes(1);
    expect(electronMocks.clearCache).toHaveBeenCalledTimes(1);
  });

  it("cancels every active run and destroys provider windows on disable", async () => {
    const controller = new WebAgentController();
    const destroy = vi.fn();
    const secured = controller as unknown as {
      activeRuns: Map<string, unknown>;
      pages: Map<
        string,
        { window: { isDestroyed: () => boolean; destroy: () => void } }
      >;
    };
    secured.activeRuns.set("run-1", {});
    secured.pages.set("page-1", {
      window: { isDestroyed: () => false, destroy },
    });
    const cancel = vi.spyOn(controller, "cancel").mockResolvedValue(true);

    await controller.disableAll();

    expect(cancel).toHaveBeenCalledWith("run-1");
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(secured.pages.size).toBe(0);
  });

  it("denies browser permissions and unscoped downloads", () => {
    let permissionRequest:
      | ((
          contents: unknown,
          permission: string,
          callback: (allowed: boolean) => void,
        ) => void)
      | undefined;
    let permissionCheck: (() => boolean) | undefined;
    let downloadHandler:
      | ((
          event: { preventDefault: () => void },
          item: unknown,
          contents: { id: number },
        ) => void)
      | undefined;
    const browserSession = {
      setPermissionRequestHandler: vi.fn((handler) => {
        permissionRequest = handler;
      }),
      setPermissionCheckHandler: vi.fn((handler) => {
        permissionCheck = handler;
      }),
      on: vi.fn((event, handler) => {
        if (event === "will-download") downloadHandler = handler;
      }),
    };
    const controller = new WebAgentController();
    const secured = controller as unknown as {
      hardenSession: (
        session: typeof browserSession,
        provider: "chatgpt",
        partition: string,
      ) => void;
    };

    secured.hardenSession(
      browserSession,
      "chatgpt",
      "persist:agents-one-web-chatgpt:work-account",
    );

    const permissionResult = vi.fn();
    permissionRequest?.({}, "camera", permissionResult);
    expect(permissionResult).toHaveBeenCalledWith(false);
    expect(permissionCheck?.()).toBe(false);
    const preventDefault = vi.fn();
    downloadHandler?.({ preventDefault }, {}, { id: 999 });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("keeps popups in the same guarded window and blocks off-list navigation", () => {
    let openHandler:
      | ((details: { url: string }) => { action: string })
      | undefined;
    const navigationHandlers = new Map<
      string,
      (event: { preventDefault: () => void }, url: string) => void
    >();
    const contents = {
      setWindowOpenHandler: vi.fn((handler) => {
        openHandler = handler;
      }),
      loadURL: vi.fn(async () => undefined),
      on: vi.fn((event, handler) => {
        if (event === "will-navigate" || event === "will-redirect") {
          navigationHandlers.set(event, handler);
        }
      }),
    };
    const controller = new WebAgentController();
    const secured = controller as unknown as {
      hardenWindow: (page: {
        window: { webContents: typeof contents; on: ReturnType<typeof vi.fn> };
        provider: "chatgpt";
        profileId: string;
        key: string;
      }) => void;
    };

    secured.hardenWindow({
      window: { webContents: contents, on: vi.fn() },
      provider: "chatgpt",
      profileId: "work-account",
      key: "runtime:chatgpt:work-account",
    });

    expect(openHandler?.({ url: "https://auth.openai.com/log-in" })).toEqual({
      action: "deny",
    });
    expect(contents.loadURL).toHaveBeenCalledWith(
      "https://auth.openai.com/log-in",
    );
    expect(openHandler?.({ url: "https://evil.example/" })).toEqual({
      action: "deny",
    });
    expect(contents.loadURL).toHaveBeenCalledTimes(1);

    const allowedEvent = { preventDefault: vi.fn() };
    navigationHandlers.get("will-navigate")?.(
      allowedEvent,
      "https://chatgpt.com/",
    );
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();
    const blockedEvent = { preventDefault: vi.fn() };
    navigationHandlers.get("will-redirect")?.(
      blockedEvent,
      "https://evil.example/",
    );
    expect(blockedEvent.preventDefault).toHaveBeenCalledTimes(1);
  });
});
