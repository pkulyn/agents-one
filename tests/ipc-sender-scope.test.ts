import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
type MockListener = (...args: unknown[]) => unknown;
type FakeContents = {
  mainFrame: { url: string };
  isDestroyed(): boolean;
  once: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};
type FakeWindow = { webContents: FakeContents; isDestroyed(): boolean };
type NativeMenuEntry = { label?: string; click?: () => void | Promise<void> };
type FakeRaw = {
  handle(channel: string, listener: MockListener): void;
  on(channel: string, listener: MockListener): FakeRaw;
  removeListener: ReturnType<typeof vi.fn>;
  removeHandler: ReturnType<typeof vi.fn>;
};
const mocks = vi.hoisted(() => {
  const handlers = new Map<string, MockListener>();
  const listeners = new Map<string, MockListener>();
  const raw: FakeRaw = {
    handle: vi.fn((channel, listener) => handlers.set(channel, listener)),
    on: vi.fn((channel, listener) => {
      listeners.set(channel, listener);
      return raw;
    }),
    removeListener: vi.fn(),
    removeHandler: vi.fn(),
  };
  return {
    handlers,
    listeners,
    raw,
    setEnvValue: vi.fn(),
    packaged: false,
    nativeWindow: null as FakeWindow | null,
    mediaTarget: "",
    nativeMenu: [] as NativeMenuEntry[],
    openPath: vi.fn(async () => ""),
  };
});
vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return mocks.packaged;
    },
    getVersion: () => "test-version",
    getPath: () => process.env.AGENTS_ONE_USER_DATA_DIR,
  },
  ipcMain: mocks.raw,
  BrowserWindow: class {
    static fromWebContents(): FakeWindow | null {
      return mocks.nativeWindow;
    }
  },
  dialog: {},
  Menu: {
    buildFromTemplate: (template: NativeMenuEntry[]) => {
      mocks.nativeMenu = template;
      return { popup: vi.fn() };
    },
  },
  clipboard: {},
  shell: { openPath: mocks.openPath },
}));
vi.mock("../src/main/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/config")>()),
  setEnvValue: mocks.setEnvValue,
}));
vi.mock("../src/main/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/media")>()),
  materializeDataUrlToTemp: () => mocks.mediaTarget,
  isAuthorizedMediaPath: (path: string) => path === mocks.mediaTarget,
}));
const rendererHtmlPath = join(process.cwd(), "src/main/renderer/index.html");
function contents(url = pathToFileURL(rendererHtmlPath).href): FakeContents {
  return {
    mainFrame: { url },
    isDestroyed: () => false,
    once: vi.fn(),
    send: vi.fn(),
  };
}
function event(sender: FakeContents): Electron.IpcMainEvent {
  return {
    sender,
    senderFrame: sender.mainFrame,
  } as unknown as Electron.IpcMainEvent;
}
afterEach(() => {
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.stubEnv("ELECTRON_RENDERER_URL", "");
  vi.stubEnv(
    "HERMES_HOME",
    join(process.env.AGENTS_ONE_USER_DATA_DIR!, "scope-fixture-hermes"),
  );
  mocks.packaged = false;
  mocks.handlers.clear();
  mocks.listeners.clear();
  mocks.setEnvValue.mockClear();
});

describe("actual registration sender boundary", () => {
  beforeAll(async () => {
    // Load the full Main registration graph before individual boundary assertions.
    await import("../src/main/ipc/register");
  }, 15000);
  it("rejects unowned same-URL contents before a configuration write", async () => {
    const main = { webContents: contents(), isDestroyed: () => false };
    const { registerIpcHandlers } = await import("../src/main/ipc/register");
    registerIpcHandlers({
      activeRuns: new Map(),
      getMainWindow: () => main,
      notifyConnectionConfigChanged: vi.fn(),
      notifyModelLibraryChanged: vi.fn(),
      openExternalUrl: vi.fn(),
    } as never);
    const invoke = mocks.handlers.get("set-env")!;
    expect(invoke).toBeTypeOf("function");
    expect(() =>
      invoke(event(contents()), "FIXTURE_TEST_SETTING", "fixture-value"),
    ).toThrow("scope_denied");
    expect(mocks.setEnvValue).not.toHaveBeenCalled();
    await invoke(
      event(main.webContents),
      "FIXTURE_TEST_SETTING",
      "fixture-value",
    );
    expect(mocks.setEnvValue).toHaveBeenCalledOnce();
  });
  it("rejects a child frame and navigated Main before a configuration write", async () => {
    const main = { webContents: contents(), isDestroyed: () => false };
    const { registerIpcHandlers } = await import("../src/main/ipc/register");
    registerIpcHandlers({
      activeRuns: new Map(),
      getMainWindow: () => main,
      notifyConnectionConfigChanged: vi.fn(),
      notifyModelLibraryChanged: vi.fn(),
      openExternalUrl: vi.fn(),
    } as never);
    const invoke = mocks.handlers.get("set-env")!;
    expect(() =>
      invoke(
        {
          sender: main.webContents,
          senderFrame: { url: main.webContents.mainFrame.url },
        },
        "FIXTURE_TEST_SETTING",
        "fixture-value",
      ),
    ).toThrow("scope_denied");
    main.webContents.mainFrame.url = "https://untrusted.invalid/";
    expect(() =>
      invoke(event(main.webContents), "FIXTURE_TEST_SETTING", "fixture-value"),
    ).toThrow("scope_denied");
    expect(mocks.setEnvValue).not.toHaveBeenCalled();
  });
});

describe("native auxiliary roles", () => {
  it("allows only enrolled role channels, including common locale and composer dependencies", async () => {
    const { registerAuxiliaryIpcWindow, isAuthorizedIpcSender } =
      await import("../src/main/ipc/sender-scope");
    for (const [role, query, allowed] of [
      [
        "tray-menu",
        "trayMenu",
        ["tray-menu-data", "tray-menu-action", "tray-menu-resize"],
      ],
      [
        "tray-completion",
        "trayCompletion",
        [
          "tray-completion-data",
          "tray-completion-open",
          "tray-completion-close",
        ],
      ],
      [
        "quick-composer",
        "tray",
        [
          "list-agent-runtimes",
          "send-message",
          "select-folder",
          "register-project-workspace",
          "stage-attachment",
          "show-file-menu",
          "save-media-file",
          "get-voice-input-config",
          "transcribe-audio",
          "start-streaming-transcription",
          "send-streaming-audio",
          "stop-streaming-transcription",
        ],
      ],
    ] as const) {
      const url = new URL(pathToFileURL(rendererHtmlPath).href);
      url.searchParams.set(query, "1");
      const sender = contents(url.href);
      expect(
        isAuthorizedIpcSender(event(sender), "get-locale", () => null),
      ).toBe(false);
      registerAuxiliaryIpcWindow(sender, role, rendererHtmlPath);
      for (const channel of [...allowed, "get-locale", "set-locale"])
        expect(
          isAuthorizedIpcSender(event(sender), channel, () => null),
          role + channel,
        ).toBe(true);
      for (const channel of [
        "set-env",
        "set-config",
        "restore-agents-one-backup",
        "save-agent-runtime",
        "mobile-execution-manage",
        "unknown-future-channel",
      ])
        expect(
          isAuthorizedIpcSender(event(sender), channel, () => null),
          role + channel,
        ).toBe(false);
      expect(
        isAuthorizedIpcSender(
          { sender, senderFrame: { url: url.href } } as never,
          "get-locale",
          () => null,
        ),
      ).toBe(false);
      sender.mainFrame.url = pathToFileURL(rendererHtmlPath).href;
      expect(
        isAuthorizedIpcSender(event(sender), "get-locale", () => null),
      ).toBe(false);
    }
  });
  it("revokes destroyed native identities and never adopts a same-URL replacement", async () => {
    const { registerAuxiliaryIpcWindow, isAuthorizedIpcSender } =
      await import("../src/main/ipc/sender-scope");
    const url = pathToFileURL(rendererHtmlPath).href + "?tray=1";
    const sender = contents(url);
    registerAuxiliaryIpcWindow(sender, "quick-composer", rendererHtmlPath);
    expect(
      isAuthorizedIpcSender(event(sender), "send-message", () => null),
    ).toBe(true);
    expect(
      isAuthorizedIpcSender(event(contents(url)), "send-message", () => null),
    ).toBe(false);
    sender.once.mock.calls[0][1]();
    expect(
      isAuthorizedIpcSender(event(sender), "send-message", () => null),
    ).toBe(false);
  });
  it("guards send listeners before effects and removes their actual wrapped identity", async () => {
    const { createScopedIpcMain } =
      await import("../src/main/ipc/sender-scope");
    const main = { webContents: contents(), isDestroyed: () => false };
    const scoped = createScopedIpcMain(mocks.raw as never, () => main as never);
    const effect = vi.fn();
    scoped.on("show-media-menu", effect);
    const guarded = mocks.listeners.get("show-media-menu")!;
    guarded(event(contents()), "payload");
    expect(effect).not.toHaveBeenCalled();
    guarded(event(main.webContents), "payload");
    expect(effect).toHaveBeenCalledWith(event(main.webContents), "payload");
    scoped.removeListener("show-media-menu", effect);
    expect(mocks.raw.removeListener).toHaveBeenCalledWith(
      "show-media-menu",
      guarded,
    );
  });
  it("keeps QuickComposer locale functional through the actual registration while denying configuration mutation", async () => {
    const { registerAuxiliaryIpcWindow } =
      await import("../src/main/ipc/sender-scope");
    const main = { webContents: contents(), isDestroyed: () => false };
    const sender = contents(pathToFileURL(rendererHtmlPath).href + "?tray=1");
    registerAuxiliaryIpcWindow(sender, "quick-composer", rendererHtmlPath);
    const { registerIpcHandlers } = await import("../src/main/ipc/register");
    registerIpcHandlers({
      activeRuns: new Map(),
      getMainWindow: () => main,
      notifyConnectionConfigChanged: vi.fn(),
      notifyModelLibraryChanged: vi.fn(),
      openExternalUrl: vi.fn(),
    } as never);
    expect(mocks.handlers.get("get-locale")!(event(sender))).toBeTypeOf(
      "string",
    );
    expect(() =>
      mocks.handlers.get("set-env")!(
        event(sender),
        "FIXTURE_TEST_SETTING",
        "value",
      ),
    ).toThrow("scope_denied");
    expect(mocks.setEnvValue).not.toHaveBeenCalled();
  });
});

describe("independent updater and native media boundaries", () => {
  it("protects updater handlers using the same owned Main sender", async () => {
    const { setupUpdater } = await import("../src/main/app/updater");
    const main = { webContents: contents(), isDestroyed: () => false };
    setupUpdater({ getMainWindow: () => main as never });
    expect(
      mocks.handlers.get("get-app-version")!(event(main.webContents)),
    ).toBe("test-version");
    for (const channel of [
      "get-app-version",
      "set-auto-upgrade-enabled",
      "install-update",
    ])
      expect(() =>
        mocks.handlers.get(channel)!(event(contents()), true),
      ).toThrow("scope_denied");
  });
  it.each(["html", "pdf"])(
    "applies document association policy to media data materialized as %s",
    async (extension) => {
      const main = { webContents: contents(), isDestroyed: () => false };
      mocks.nativeWindow = main;
      mocks.openPath.mockClear();
      mocks.mediaTarget = join(
        process.env.AGENTS_ONE_USER_DATA_DIR!,
        "fixture-media." + extension,
      );
      writeFileSync(mocks.mediaTarget, "fixture only");
      const { registerIpcHandlers } = await import("../src/main/ipc/register");
      registerIpcHandlers({
        activeRuns: new Map(),
        getMainWindow: () => main,
        notifyConnectionConfigChanged: vi.fn(),
        notifyModelLibraryChanged: vi.fn(),
        openExternalUrl: vi.fn(),
      } as never);
      mocks.listeners.get("show-media-menu")!(
        event(main.webContents),
        "data:text/plain;base64,Zml4dHVyZQ==",
        "fixture." + extension,
        { open: "Open", saveAs: "Save" },
      );
      expect(mocks.nativeMenu[0].label).toBe("Open");
      await mocks.nativeMenu[0].click!();
      if (extension === "pdf")
        await vi.waitFor(() =>
          expect(mocks.openPath).toHaveBeenCalledWith(mocks.mediaTarget),
        );
      else expect(mocks.openPath).not.toHaveBeenCalled();
    },
  );
});

it("retains invoke/send capabilities used by auxiliary pages and their shared composer/locale components", async () => {
  const { registerAuxiliaryIpcWindow, isAuthorizedIpcSender } =
    await import("../src/main/ipc/sender-scope");
  const parse = (file: string): ts.SourceFile =>
    ts.createSourceFile(
      file,
      readFileSync(join(process.cwd(), file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
  const methodChannels = new Map<string, Set<string>>();
  const preload = parse("src/preload/index.ts");
  const scanMethod = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const channels = new Set<string>();
      const walk = (child: ts.Node): void => {
        if (
          ts.isCallExpression(child) &&
          ts.isPropertyAccessExpression(child.expression) &&
          child.expression.expression.getText(preload) === "ipcRenderer" &&
          ["invoke", "send"].includes(child.expression.name.text) &&
          child.arguments[0] &&
          ts.isStringLiteral(child.arguments[0])
        )
          channels.add(child.arguments[0].text);
        ts.forEachChild(child, walk);
      };
      walk(node.initializer);
      if (channels.size) methodChannels.set(node.name.text, channels);
    }
    ts.forEachChild(node, scanMethod);
  };
  scanMethod(preload);
  const shared = ["src/renderer/src/components/I18nProvider.tsx"];
  const composer = [
    "src/renderer/src/screens/QuickComposer/QuickComposer.tsx",
    "src/renderer/src/screens/Chat/ChatInput.tsx",
    "src/renderer/src/screens/Chat/attachmentUtils.ts",
    "src/renderer/src/screens/Chat/hooks/useVoiceInput.ts",
    "src/renderer/src/components/AttachmentChip.tsx",
    "src/renderer/src/components/ThemeProvider.tsx",
    "src/renderer/src/components/FontProvider.tsx",
  ];
  for (const [role, query, files] of [
    ["quick-composer", "tray", composer],
    [
      "tray-menu",
      "trayMenu",
      ["src/renderer/src/screens/TrayMenu/TrayMenu.tsx"],
    ],
    [
      "tray-completion",
      "trayCompletion",
      ["src/renderer/src/screens/TrayCompletionToast/TrayCompletionToast.tsx"],
    ],
  ] as const) {
    const sender = contents(
      pathToFileURL(rendererHtmlPath).href + "?" + query + "=1",
    );
    registerAuxiliaryIpcWindow(sender as never, role, rendererHtmlPath);
    let covered = 0;
    for (const file of [...shared, ...files]) {
      const source = parse(file);
      const walk = (node: ts.Node): void => {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "agentsOneAPI" &&
          node.expression.expression.getText(source) === "window"
        ) {
          for (const channel of methodChannels.get(node.name.text) || []) {
            expect(
              isAuthorizedIpcSender(event(sender), channel, () => null),
              file + ":" + node.name.text + " -> " + channel,
            ).toBe(true);
            covered++;
          }
        }
        ts.forEachChild(node, walk);
      };
      walk(source);
    }
    expect(covered).toBeGreaterThan(3);
  }
});

it("uses only the configured development HTTP origin and ignores it for packaged Main", async () => {
  const { isAuthorizedIpcSender } =
    await import("../src/main/ipc/sender-scope");
  const main = {
    webContents: contents("http://127.0.0.1:45678/"),
    isDestroyed: () => false,
  };
  vi.stubEnv("ELECTRON_RENDERER_URL", "http://127.0.0.1:45678/");
  expect(
    isAuthorizedIpcSender(
      event(main.webContents),
      "set-env",
      () => main as never,
    ),
  ).toBe(true);
  main.webContents.mainFrame.url = "http://127.0.0.1:45679/";
  expect(
    isAuthorizedIpcSender(
      event(main.webContents),
      "set-env",
      () => main as never,
    ),
  ).toBe(false);
  mocks.packaged = true;
  main.webContents.mainFrame.url = "http://127.0.0.1:45678/";
  expect(
    isAuthorizedIpcSender(
      event(main.webContents),
      "set-env",
      () => main as never,
    ),
  ).toBe(false);
  main.webContents.mainFrame.url = pathToFileURL(rendererHtmlPath).href;
  expect(
    isAuthorizedIpcSender(
      event(main.webContents),
      "set-env",
      () => main as never,
    ),
  ).toBe(true);
  mocks.packaged = false;
  vi.stubEnv("ELECTRON_RENDERER_URL", "file:///fixture/dev.html");
  main.webContents.mainFrame.url = "file:///untrusted/other.html";
  expect(
    isAuthorizedIpcSender(
      event(main.webContents),
      "set-env",
      () => main as never,
    ),
  ).toBe(false);
});

it("revokes a former Main immediately when native ownership changes", async () => {
  const { isAuthorizedIpcSender } =
    await import("../src/main/ipc/sender-scope");
  const oldWindow = { webContents: contents(), isDestroyed: () => false };
  const newWindow = { webContents: contents(), isDestroyed: () => false };
  let current: FakeWindow | null = oldWindow;
  const getMainWindow = (): Electron.BrowserWindow | null =>
    current as unknown as Electron.BrowserWindow | null;
  expect(
    isAuthorizedIpcSender(
      event(oldWindow.webContents),
      "set-env",
      getMainWindow,
    ),
  ).toBe(true);
  current = newWindow;
  expect(
    isAuthorizedIpcSender(
      event(oldWindow.webContents),
      "set-env",
      getMainWindow,
    ),
  ).toBe(false);
  expect(
    isAuthorizedIpcSender(
      event(newWindow.webContents),
      "set-env",
      getMainWindow,
    ),
  ).toBe(true);
  current = null;
  expect(
    isAuthorizedIpcSender(
      event(newWindow.webContents),
      "set-env",
      getMainWindow,
    ),
  ).toBe(false);
});
