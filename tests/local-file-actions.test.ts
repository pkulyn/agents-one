import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type TestEvent = { sender: object; senderFrame: object };
type MenuAction = {
  label?: string;
  enabled?: boolean;
  click?: () => void | Promise<void>;
};
type TestLabels = Record<
  "open" | "copyPath" | "copyContent" | "reveal",
  string
>;
type MenuHandler = (
  event: TestEvent,
  file: unknown,
  labels: TestLabels,
) => Promise<void>;

const state = vi.hoisted(() => ({
  handler: undefined as undefined | MenuHandler,
  template: [] as MenuAction[],
  projects: [] as { path: string }[],
  window: { webContents: { mainFrame: {} } },
  popup: vi.fn(),
  openPath: vi.fn(async () => ""),
  reveal: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => state.window },
  ipcMain: {
    on: (_channel: string, callback: typeof state.handler) => {
      state.handler = callback;
    },
  },
  Menu: {
    buildFromTemplate: (template: MenuAction[]) => {
      state.template = template;
      return { popup: state.popup };
    },
  },
  shell: { openPath: state.openPath, showItemInFolder: state.reveal },
  clipboard: { writeText: state.copy },
}));
vi.mock("../src/main/project-folders", () => ({
  listProjectFolders: () => state.projects,
  resolveProjectFolderPath: () => null,
}));
import {
  registerArtifactFileMenuIpc,
  openAuthorizedLocalFile,
} from "../src/main/ipc/local-file-actions";

let directory: string;
let project: string;
const labels = {
  open: "Open",
  copyPath: "Copy path",
  copyContent: "Copy content",
  reveal: "Reveal",
};
const event = (): TestEvent => ({
  sender: state.window.webContents,
  senderFrame: state.window.webContents.mainFrame,
});
const invoke = (file: unknown, source = event()): Promise<void> =>
  state.handler!(source, file, labels);
const item = (
  label: string,
): MenuAction & { click: () => void | Promise<void> } => {
  const found = state.template.find((entry) => entry.label === label);
  if (!found?.click) throw Error("missing native menu action");
  return { ...found, click: found.click };
};

beforeEach(() => {
  vi.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), "agents-one-file-menu-"));
  project = join(directory, "project");
  mkdirSync(project);
  state.projects = [{ path: project }];
  state.template = [];
  registerArtifactFileMenuIpc(() => state.window as unknown as BrowserWindow);
});
afterEach(() => {
  state.projects = [];
  rmSync(directory, { recursive: true, force: true });
});

describe("native artifact file actions", () => {
  // @lat: [[main-process#Native file action authority#Outside path rejection]]
  it("does not expose a menu or clipboard content for an unregistered outside file", async () => {
    const outside = join(directory, "private.txt");
    writeFileSync(outside, "private secret");
    await invoke(outside);
    expect(state.popup).not.toHaveBeenCalled();
    expect(state.copy).not.toHaveBeenCalled();
    expect(state.openPath).not.toHaveBeenCalled();
  });
  // @lat: [[main-process#Native file action authority#Linked path rejection]]
  it("rejects a junction under a registered project that targets an outside file", async () => {
    const outside = join(directory, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(project, "linked"), "junction");
    await invoke(join(project, "linked", "secret.txt"));
    expect(state.popup).not.toHaveBeenCalled();
  });
  // @lat: [[main-process#Native file action authority#Registered document actions]]
  it("opens and copies a registered document through the actual native-menu callbacks", async () => {
    const file = join(project, "report.txt");
    writeFileSync(file, "user document");
    await invoke(file);
    expect(state.popup).toHaveBeenCalledOnce();
    await item(labels.open).click();
    expect(state.openPath).toHaveBeenCalledWith(resolve(file));
    await item(labels.copyContent).click();
    await vi.waitFor(() =>
      expect(state.copy).toHaveBeenCalledWith("user document"),
    );
    item(labels.reveal).click();
    expect(state.reveal).toHaveBeenCalledWith(resolve(file));
  });
  // @lat: [[main-process#Native file action authority#Document association limits]]
  it.each([
    "run.exe",
    "run.CMD",
    "run.js",
    "report.txt.lnk",
    "active.svg",
    "index.html",
    "macro.docm",
    "unknown.bin",
  ])("does not launch executable or unapproved type %s", async (name) => {
    const file = join(project, name);
    writeFileSync(file, "fixture");
    await invoke(file);
    expect(state.popup).toHaveBeenCalledOnce();
    expect(item(labels.open).enabled).toBe(false);
    await item(labels.open).click();
    expect(state.openPath).not.toHaveBeenCalled();
    item(labels.reveal).click();
    expect(state.reveal).toHaveBeenCalledOnce();
  });
  // @lat: [[main-process#Native file action authority#Deferred action authority]]
  it("rechecks project authority for every callback after a menu is already open", async () => {
    const file = join(project, "report.txt");
    writeFileSync(file, "private");
    await invoke(file);
    state.projects = [];
    await item(labels.open).click();
    await item(labels.copyContent).click();
    item(labels.copyPath).click();
    item(labels.reveal).click();
    expect(state.openPath).not.toHaveBeenCalled();
    expect(state.copy).not.toHaveBeenCalled();
    expect(state.reveal).not.toHaveBeenCalled();
  });
  // @lat: [[main-process#Native file action authority#Bounded clipboard reads]]
  it("does not read a file that grew past the content bound while the menu was open", async () => {
    const file = join(project, "growing.txt");
    writeFileSync(file, "small");
    await invoke(file);
    expect(item(labels.copyContent).enabled).toBe(true);
    writeFileSync(file, Buffer.alloc(5 * 1024 * 1024 + 1, 65));
    await item(labels.copyContent).click();
    expect(state.copy).not.toHaveBeenCalled();
  });
  // @lat: [[main-process#Native file action authority#Main window admission]]
  it("rejects a sender frame other than the current main window", async () => {
    const file = join(project, "report.txt");
    writeFileSync(file, "document");
    await invoke(file, { ...event(), senderFrame: {} });
    expect(state.popup).not.toHaveBeenCalled();
  });
  it("returns false on a native open error and rejects malformed or directory inputs", async () => {
    const file = join(project, "report.PDF");
    writeFileSync(file, "document");
    state.openPath.mockResolvedValueOnce("no association");
    await expect(openAuthorizedLocalFile(file)).resolves.toBe(false);
    state.openPath.mockClear();
    for (const input of [null, {}, "", "report.PDF", file + "\0", project]) {
      await expect(openAuthorizedLocalFile(input)).resolves.toBe(false);
    }
    expect(state.openPath).not.toHaveBeenCalled();
  });
});
