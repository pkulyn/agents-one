import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  resolve: vi.fn(),
  open: vi.fn().mockResolvedValue(""),
  save: vi.fn(),
  copy: vi.fn(),
  clipboard: vi.fn(),
  menu: [] as Electron.MenuItemConstructorOptions[],
  popup: vi.fn(),
}));
vi.mock("../src/main/conversation-files", () => ({
  resolveConversationFile: mock.resolve,
}));
vi.mock("../src/main/ipc/local-file-actions", () => ({
  canOpenDocument: (path: string) => path.endsWith(".md"),
}));
vi.mock("../src/main/ipc/sender-scope", () => ({
  createScopedIpcMain: (ipc: unknown) => ipc,
}));
vi.mock("node:fs/promises", () => ({ copyFile: mock.copy }));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
  clipboard: { writeText: mock.clipboard },
  dialog: { showSaveDialog: mock.save },
  shell: { openPath: mock.open, showItemInFolder: vi.fn() },
  Menu: {
    buildFromTemplate: (template: Electron.MenuItemConstructorOptions[]) => {
      mock.menu = template;
      return { popup: mock.popup };
    },
  },
}));
import { registerConversationFileIpc } from "../src/main/ipc/conversation-files";
const ref = {
  conversationId: "c",
  messageId: "m",
  path: "D:/Desktop/report.md",
};
type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();
beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  mock.menu = [];
  mock.resolve.mockResolvedValue({
    path: ref.path,
    name: "report.md",
    relativePath: "../Desktop/report.md",
    size: 12,
    image: false,
  });
  registerConversationFileIpc(() => null, {
    handle: (name: string, fn: Handler) => handlers.set(name, fn),
  } as unknown as Electron.IpcMain);
});
const act = (action: string): Promise<unknown> =>
  handlers.get("conversation-file-action")!({ sender: {} }, ref, action);
describe("native document actions", () => {
  it("opens the exact verified document and rejects unavailable or executable targets", async () => {
    expect(await act("open")).toBe(true);
    expect(mock.open).toHaveBeenCalledWith(ref.path);
    mock.resolve.mockResolvedValue({ path: "D:/Desktop/run.exe" });
    expect(await act("open")).toBe(false);
    mock.resolve.mockResolvedValue(null);
    expect(await act("open")).toBe(false);
    expect(mock.open).toHaveBeenCalledTimes(1);
  });
  it("offers open-with, save and both path forms; actions revalidate after the menu opens", async () => {
    expect(await act("menu")).toBe(true);
    expect(mock.menu.map((item) => item.label).filter(Boolean)).toEqual([
      "Open",
      "Open with…",
      "Save as…",
      "Copy absolute path",
      "Copy relative path",
      "Show in folder",
    ]);
    mock.resolve.mockResolvedValue(null);
    await mock.menu[0].click!(
      {} as Electron.MenuItem,
      {} as Electron.BrowserWindow,
      {} as Electron.KeyboardEvent,
    );
    await Promise.resolve();
    expect(mock.open).not.toHaveBeenCalled();
  });
  it("copies real absolute and workspace-relative paths rather than renderer labels", async () => {
    await act("copy-path");
    expect(mock.clipboard).toHaveBeenLastCalledWith(ref.path);
    await act("copy-relative");
    expect(mock.clipboard).toHaveBeenLastCalledWith("../Desktop/report.md");
  });
  it("copies to the user-selected destination and respects cancellation or replacement", async () => {
    mock.save.mockResolvedValue({
      canceled: false,
      filePath: "D:/Downloads/copy.md",
    });
    expect(await act("save")).toBe(true);
    expect(mock.copy).toHaveBeenCalledWith(ref.path, "D:/Downloads/copy.md");
    mock.copy.mockClear();
    mock.save.mockResolvedValue({ canceled: true });
    expect(await act("save")).toBe(false);
    expect(mock.copy).not.toHaveBeenCalled();
    mock.save.mockResolvedValue({
      canceled: false,
      filePath: "D:/Downloads/copy.md",
    });
    mock.resolve
      .mockResolvedValueOnce({ path: ref.path, name: "report.md" })
      .mockResolvedValueOnce({ path: "D:/Desktop/replaced.md" });
    expect(await act("save")).toBe(false);
    expect(mock.copy).not.toHaveBeenCalled();
  });
});
