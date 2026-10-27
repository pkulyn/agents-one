import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSettingsData } from "./useSettingsData";
const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("react-hot-toast", () => ({ default: { error: mocks.toastError } }));
vi.mock("../useI18n", () => ({ useI18n: () => ({ t: mocks.t }) }));
function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function api(
  getConfig: ReturnType<typeof vi.fn>,
  setConfig = vi.fn(async () => true),
): { setConfig: typeof setConfig } {
  const subscribe = (): (() => void) => () => {};
  Object.assign(window, {
    agentsOneAPI: {
      getAppVersion: async () => "test",
      getConnectionConfig: async () => ({ mode: "local" }),
      getApiServerKeyStatus: async () => ({ hasKey: true }),
      getDesktopUpdatePolicy: async () => ({
        enabled: false,
        reason: "development",
      }),
      getAutoUpgradeEnabled: async () => false,
      getHermesHome: async () => "fixture",
      getHermesVersion: async () => "fixture-v1",
      getConfig,
      setConfig,
      onConnectionConfigChanged: subscribe,
      onUpdateAvailable: subscribe,
      onUpdateDownloadProgress: subscribe,
      onUpdateDownloaded: subscribe,
      onUpdateError: subscribe,
    },
  });
  return { setConfig };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("ignores an old profile proxy response after the new profile has loaded", async () => {
  const old = deferred<string>();
  const read = vi.fn((key: string, profile: string) =>
    key === "network.proxy"
      ? profile === "a"
        ? old.promise
        : Promise.resolve("http://proxy-b.example:8080")
      : Promise.resolve("false"),
  );
  const { setConfig } = api(read);
  const hook = renderHook(({ profile }) => useSettingsData(profile), {
    initialProps: { profile: "a" },
  });
  await act(async () => {});
  hook.rerender({ profile: "b" });
  await act(async () => {});
  expect(hook.result.current.httpProxy).toBe("http://proxy-b.example:8080");
  await act(async () => old.resolve("http://old-profile-a.example:8080"));
  expect(hook.result.current.httpProxy).toBe("http://proxy-b.example:8080");
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(setConfig).not.toHaveBeenCalled();
  hook.unmount();
});
it("shows a failed proxy save without claiming success or leaving an unhandled rejection", async () => {
  const { setConfig } = api(
    vi.fn((key: string) =>
      Promise.resolve(
        key === "network.proxy"
          ? "http://__saved__:__saved__@proxy.example:8080/"
          : "false",
      ),
    ),
    vi.fn(async () => {
      throw Error("Retained markers cannot be saved");
    }),
  );
  const hook = renderHook(() => useSettingsData("a"));
  await act(async () => {});
  act(() =>
    hook.result.current.setHttpProxy(
      "http://__saved__:__saved__@changed.example:8080/",
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(setConfig).toHaveBeenCalledWith(
    "network.proxy",
    "http://__saved__:__saved__@changed.example:8080/",
    "a",
  );
  expect(hook.result.current.networkError).toContain("Retained markers");
  expect(hook.result.current.networkSaved).toBe(false);
  hook.unmount();
  await act(async () => {});
});
it("does not save an empty fallback after the profile's proxy load fails", async () => {
  const load = deferred<string>();
  const { setConfig } = api(
    vi.fn((key: string) =>
      key === "network.proxy" ? load.promise : Promise.resolve("false"),
    ),
  );
  const hook = renderHook(() => useSettingsData("a"));
  await act(async () => {});
  expect(hook.result.current.networkReady).toBe(false);
  await act(async () => load.reject(Error("fixture read failure")));
  expect(hook.result.current.networkError).toContain("fixture read failure");
  expect(hook.result.current.networkReady).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  hook.unmount();
  await act(async () => {});
  expect(setConfig).not.toHaveBeenCalled();
});
it("an old profile save acknowledgement cannot overwrite the new profile's saved baseline", async () => {
  const saved = deferred<boolean>();
  const setConfig = vi
    .fn()
    .mockImplementationOnce(() => saved.promise)
    .mockResolvedValue(true);
  api(
    vi.fn((key: string, profile: string) =>
      Promise.resolve(
        key === "network.proxy"
          ? "http://" + profile + ".example:8080"
          : "false",
      ),
    ),
    setConfig,
  );
  const hook = renderHook(({ profile }) => useSettingsData(profile), {
    initialProps: { profile: "a" },
  });
  await act(async () => {});
  act(() => hook.result.current.setHttpProxy("http://edited-a.example:8080"));
  await act(async () => vi.advanceTimersByTimeAsync(600));
  hook.rerender({ profile: "b" });
  await act(async () => {});
  await act(async () => saved.resolve(true));
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(setConfig.mock.calls.some((call) => call[2] === "b")).toBe(false);
  expect(hook.result.current.httpProxy).toBe("http://b.example:8080");
  expect(hook.result.current.networkSaved).toBe(false);
  hook.unmount();
});

it.each(["0.1.1", null, "failure"])(
  "checks versions with automatic updates disabled: %s",
  async (version) => {
    api(vi.fn(async () => "false"));
    const checkForUpdates = vi.fn(async () => {
      if (version === "failure") throw Error("network unavailable");
      return version;
    });
    const downloadUpdate = vi.fn(),
      installUpdate = vi.fn();
    Object.assign(window.agentsOneAPI, {
      checkForUpdates,
      downloadUpdate,
      installUpdate,
    });
    const hook = renderHook(() => useSettingsData());
    await act(async () => {});
    await act(async () => hook.result.current.checkDesktopUpdate());
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(hook.result.current.desktopUpdateState).toBe(
      version === "failure" ? "error" : version ? "available" : "uptodate",
    );
    if (version === "failure")
      expect(hook.result.current.desktopUpdateError).toContain(
        "network unavailable",
      );
    await act(async () => hook.result.current.handleDesktopUpdate());
    expect(downloadUpdate).not.toHaveBeenCalled();
    expect(installUpdate).not.toHaveBeenCalled();
    hook.unmount();
  },
);
