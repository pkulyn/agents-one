import { app, BrowserWindow, session } from "electron";
import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, stat, unlink } from "fs/promises";
import { join } from "path";
import type { Attachment } from "../../shared/attachments";
import type {
  AgentRuntimeArtifact,
  RuntimeInputArtifact,
} from "../../shared/agent-runtimes";
import type {
  WebAgentConversationRef,
  WebAgentDownload,
  WebAgentErrorCode,
  WebAgentProvider,
  WebAgentResponseSnapshot,
  WebAgentRuntimeSettings,
  WebAgentStagedFile,
  WebAgentSubmissionReceipt,
  WebAgentUserActionRequired,
} from "../../shared/web-agent";
import {
  isAllowedWebAgentUrl,
  isAllowedWebAgentNavigationUrl,
  isWebAgentResponseComplete,
  normalizeWebAgentProfileId,
  webAgentErrorMessage,
  webAgentPartition,
  webAgentProviderLabel,
} from "../../shared/web-agent";
import { materializeBytesToTemp } from "../media";
import { prepareRuntimeInputs } from "../runtime-inputs";
import {
  getWebAgentConversation,
  removeWebAgentConversationsForRuntime,
  saveWebAgentConversation,
} from "./conversation-store";
import {
  DoubaoProviderAdapter,
  type DoubaoModeSelection,
  type WebAgentPage,
} from "./providers/doubao";
import { ChatGPTProviderAdapter } from "./providers/chatgpt";
import { GrokProviderAdapter } from "./providers/grok";

type ControllerEventType = "progress" | "tool_call" | "tool_result" | "error";

export interface WebAgentRunCallbacks {
  onEvent: (
    type: ControllerEventType,
    summary: string,
    options?: { code?: string; detail?: string },
  ) => void;
  onOutput: (output: string) => void;
  onUserAction: (action: WebAgentUserActionRequired | undefined) => void;
}

export interface StartWebAgentRunInput {
  runId: string;
  runtimeId: string;
  settings: WebAgentRuntimeSettings;
  profile?: string;
  sessionId?: string;
  prompt: string;
  attachments?: Attachment[];
  timeoutMs: number;
}

export interface WebAgentRunResult {
  output: string;
  sessionId: string;
  inputArtifacts: RuntimeInputArtifact[];
  artifacts: AgentRuntimeArtifact[];
}

export interface StartedWebAgentRun {
  completion: Promise<WebAgentRunResult>;
  cancel: () => Promise<boolean>;
}

interface ManagedPage {
  window: BrowserWindow;
  provider: WebAgentProvider;
  profileId: string;
  key: string;
}

interface ActiveRun {
  input: StartWebAgentRunInput;
  callbacks: WebAgentRunCallbacks;
  cancelled: boolean;
  resume?: () => void;
  rejectResume?: (error: Error) => void;
  failure?: Error;
  pageKey: string;
  downloads: WebAgentDownload[];
  pendingDownloads: number;
}

interface DownloadTarget {
  run: ActiveRun;
  directory: string;
}

const USER_ACTION_ERROR_CODES = new Set<WebAgentErrorCode>([
  "WEB_LOGIN_REQUIRED",
  "WEB_USER_VERIFICATION_REQUIRED",
  "WEB_PAGE_UNSUPPORTED",
]);

const DOWNLOAD_SETTLE_MS = 750;
const RESPONSE_POLL_MS = 350;

function grokCompatibleUserAgent(): string {
  const chromeVersion = process.versions.chrome || "150.0.0.0";
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

function hasStableConversationUrl(
  url: string | undefined,
  provider: WebAgentProvider,
): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    return provider === "chatgpt" || provider === "grok"
      ? /^\/c\/[^/?#]+$/i.test(path)
      : /^\/chat\/[^/?#]+$/i.test(path);
  } catch {
    return false;
  }
}

function safeFilename(value: string): string {
  const cleaned = value
    // eslint-disable-next-line no-control-regex -- filenames must not contain controls
    .replace(/[\x00-\x1F<>:"/\\|?*]/g, "")
    .replace(/\.{2,}/g, ".")
    .trim()
    .slice(0, 160);
  if (
    !cleaned ||
    cleaned === "." ||
    cleaned === ".." ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)
  ) {
    return "download";
  }
  return cleaned;
}

function controllerError(
  code: WebAgentErrorCode,
  detail?: string,
  provider: WebAgentProvider = "doubao",
): Error {
  return new Error(
    `${code}: ${detail || webAgentErrorMessage(code, provider)}`,
  );
}

function userActionFor(
  code: WebAgentErrorCode,
  provider: WebAgentProvider,
): WebAgentUserActionRequired {
  if (code === "WEB_LOGIN_REQUIRED") {
    return {
      kind: "login",
      code,
      message: webAgentErrorMessage(code, provider),
    };
  }
  if (code === "WEB_USER_VERIFICATION_REQUIRED") {
    return {
      kind: "verification",
      code,
      message: webAgentErrorMessage(code, provider),
    };
  }
  return {
    kind: "page_recovery",
    code,
    message: webAgentErrorMessage(code, provider),
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Electron-owned page controller. It owns the browser session and exposes a
 * deliberately narrow automation surface to the provider adapter; neither the
 * renderer nor provider page receives arbitrary IPC or workspace access.
 */
export class WebAgentController {
  private readonly pages = new Map<string, ManagedPage>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly activeRuntimeKeys = new Map<string, string>();
  private readonly downloadTargets = new Map<number, DownloadTarget>();
  private readonly downloadSessions = new Set<string>();

  async probe(settings: WebAgentRuntimeSettings): Promise<{
    state: "healthy" | "degraded" | "unsupported";
    message?: string;
  }> {
    const adapter = this.adapter(settings.provider);
    if (settings.adapterVersion !== adapter.adapterVersion) {
      return {
        state: "unsupported",
        message: `${webAgentProviderLabel(settings.provider)}适配器版本 ${settings.adapterVersion} 不受当前应用支持。`,
      };
    }
    const page = await this.getPage(settings);
    let result = await adapter.ensureChatReady(this.pageApi(page));
    if (result.state !== "ready") {
      const sibling = await this.findReadySiblingPage(settings, "probe", page);
      if (sibling)
        result = await adapter.ensureChatReady(this.pageApi(sibling));
    }
    if (result.state === "ready") return { state: "healthy" };
    if (result.state === "unsupported") {
      return { state: "unsupported", message: result.message };
    }
    return { state: "degraded", message: result.message };
  }

  async open(
    settings: WebAgentRuntimeSettings,
    runtimeId?: string,
  ): Promise<void> {
    const profileId = normalizeWebAgentProfileId(settings.profileId);
    const active = [...this.activeRuns.values()].find(
      (candidate) =>
        candidate.input.settings.provider === settings.provider &&
        normalizeWebAgentProfileId(candidate.input.settings.profileId) ===
          profileId,
    );
    // When a Run is waiting for login/verification, reveal its exact
    // WebContents. Falling back to the probe page is only for settings-page
    // login, and avoids creating a second page during an active Run.
    const page = await this.getPage(
      settings,
      runtimeId || active?.input.runtimeId || "probe",
    );
    if (page.window.isMinimized()) page.window.restore();
    page.window.show();
    page.window.focus();
    if (!page.window.webContents.getURL()) {
      await page.window.webContents.loadURL(
        this.adapter(settings.provider).chatUrl,
      );
    }
  }

  async clearLogin(settings: WebAgentRuntimeSettings): Promise<void> {
    const partition = webAgentPartition(settings.provider, settings.profileId);
    const browserSession = session.fromPartition(partition);
    await browserSession.clearStorageData();
    await browserSession.clearCache();
    const key = this.pageKey(settings);
    const page = this.pages.get(key);
    if (page && !page.window.isDestroyed()) {
      await page.window.webContents.loadURL(
        this.adapter(settings.provider).chatUrl,
      );
    }
  }

  async disposeRuntime(runtimeId: string): Promise<void> {
    for (const [key, page] of this.pages) {
      if (!key.startsWith(`${runtimeId}:`)) continue;
      if (!page.window.isDestroyed()) page.window.destroy();
      this.pages.delete(key);
    }
    for (const [runId, active] of this.activeRuns) {
      if (active.input.runtimeId !== runtimeId) continue;
      await this.cancel(runId);
    }
  }

  async resume(runId: string): Promise<boolean> {
    const active = this.activeRuns.get(runId);
    if (!active?.resume) return false;
    const resume = active.resume;
    active.resume = undefined;
    active.rejectResume = undefined;
    active.callbacks.onUserAction(undefined);
    resume();
    return true;
  }

  start(
    input: StartWebAgentRunInput,
    callbacks: WebAgentRunCallbacks,
  ): StartedWebAgentRun {
    // A profile is the actual Chromium session boundary. Two Runtime records
    // may point at the same profile, so serialize by provider/profile rather
    // than by Runtime id to prevent cross-window conversation races.
    const runtimeKey = `${input.settings.provider}:${normalizeWebAgentProfileId(input.settings.profileId)}`;
    if (this.activeRuntimeKeys.has(runtimeKey)) {
      throw new Error(
        `同一${webAgentProviderLabel(input.settings.provider)}网页账号当前已有任务在执行，请等待其完成或取消。`,
      );
    }
    const active: ActiveRun = {
      input,
      callbacks,
      cancelled: false,
      pageKey: this.pageKey(input.settings, input.runtimeId),
      downloads: [],
      pendingDownloads: 0,
    };
    this.activeRuns.set(input.runId, active);
    this.activeRuntimeKeys.set(runtimeKey, input.runId);
    const completion = this.execute(active).finally(() => {
      this.activeRuns.delete(input.runId);
      this.activeRuntimeKeys.delete(runtimeKey);
      this.downloadTargets.forEach((target, webContentsId) => {
        if (target.run === active) this.downloadTargets.delete(webContentsId);
      });
    });
    return { completion, cancel: () => this.cancel(input.runId) };
  }

  async cancel(runId: string): Promise<boolean> {
    const active = this.activeRuns.get(runId);
    if (!active || active.cancelled) return false;
    active.cancelled = true;
    active.rejectResume?.(
      controllerError("WEB_CANCEL_UNCONFIRMED", "任务已取消。"),
    );
    active.resume = undefined;
    active.rejectResume = undefined;
    const page = this.pages.get(active.pageKey);
    if (!page || page.window.isDestroyed()) return true;
    try {
      const cancelled = await this.adapter(
        active.input.settings.provider,
      ).cancel(this.pageApi(page));
      if (!cancelled) {
        const providerLabel = webAgentProviderLabel(
          active.input.settings.provider,
        );
        active.callbacks.onEvent(
          "progress",
          `未能确认${providerLabel}网页是否已停止生成。`,
          { code: "WEB_CANCEL_UNCONFIRMED" },
        );
      }
      return true;
    } catch {
      const providerLabel = webAgentProviderLabel(
        active.input.settings.provider,
      );
      active.callbacks.onEvent(
        "progress",
        `${providerLabel}取消请求尚未确认。`,
        {
          code: "WEB_CANCEL_UNCONFIRMED",
        },
      );
      return true;
    }
  }

  private adapter(provider: WebAgentProvider): DoubaoProviderAdapter {
    if (provider === "doubao") return new DoubaoProviderAdapter();
    if (provider === "chatgpt") return new ChatGPTProviderAdapter();
    if (provider === "grok") return new GrokProviderAdapter();
    throw new Error("WEB_PAGE_UNSUPPORTED: Provider adapter is unavailable.");
  }

  private pageKey(
    settings: WebAgentRuntimeSettings,
    runtimeId = "probe",
  ): string {
    return `${runtimeId}:${settings.provider}:${normalizeWebAgentProfileId(settings.profileId)}`;
  }

  private async getPage(
    settings: WebAgentRuntimeSettings,
    runtimeId = "probe",
  ): Promise<ManagedPage> {
    const key = this.pageKey(settings, runtimeId);
    const existing = this.pages.get(key);
    if (existing && this.pageIsAlive(existing)) return existing;
    if (existing) this.pages.delete(key);

    const partition = webAgentPartition(settings.provider, settings.profileId);
    const browserSession = session.fromPartition(partition);
    this.hardenSession(browserSession, settings.provider, partition);
    const win = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 720,
      minHeight: 560,
      title: `${webAgentProviderLabel(settings.provider)}网页版 - Agents One`,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Doubao streams the final answer through a hidden-page lifecycle
        // callback. Keep this provider page active while its window is hidden;
        // otherwise Chromium can leave the UI at “已完成思考” even after the
        // completion response has arrived, and observeResponse never sees it.
        backgroundThrottling: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
      },
    });
    // Keep the setting explicit on WebContents as well as in webPreferences;
    // this prevents a hidden provider page from being frozen after creation.
    win.webContents.setBackgroundThrottling(false);
    const managed: ManagedPage = {
      window: win,
      provider: settings.provider,
      profileId: normalizeWebAgentProfileId(settings.profileId),
      key,
    };
    this.hardenWindow(managed);
    this.pages.set(key, managed);
    await win.webContents.loadURL(this.adapter(settings.provider).chatUrl);
    return managed;
  }

  /**
   * OAuth providers can leave a login popup behind while the original
   * ChatGPT window has already returned to an authenticated /chat page. If
   * that happens, adopt the ready sibling instead of continuing to poll the
   * stale login document forever.
   */
  private async findReadySiblingPage(
    settings: WebAgentRuntimeSettings,
    runtimeId: string,
    excluded?: ManagedPage,
  ): Promise<ManagedPage | undefined> {
    const adapter = this.adapter(settings.provider);
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      if (excluded && win.webContents.id === excluded.window.webContents.id)
        continue;
      const url = win.webContents.getURL();
      if (!isAllowedWebAgentUrl(settings.provider, url)) continue;
      const candidate: ManagedPage = {
        window: win,
        provider: settings.provider,
        profileId: normalizeWebAgentProfileId(settings.profileId),
        key: this.pageKey(settings, runtimeId),
      };
      const probe = await adapter.probeLogin(this.pageApi(candidate));
      if (probe.state === "ready") {
        this.pages.set(candidate.key, candidate);
        return candidate;
      }
    }
    return undefined;
  }

  private pageIsAlive(page: ManagedPage): boolean {
    return !page.window.isDestroyed() && !page.window.webContents.isDestroyed();
  }

  /**
   * Chromium does not reliably deliver trusted pointer input to a fully hidden
   * BrowserWindow on Windows. Doubao's Radix upload menu ignores synthetic DOM
   * clicks, so briefly materialize the provider surface for the bounded CDP
   * interaction. Keep it fully transparent and non-activating: showing a
   * non-zero opacity window or activating the provider surface causes a
   * visible compositor/focus flash on Windows.
   */
  private async withInteractiveProviderWindow<T>(
    page: ManagedPage,
    operation: () => Promise<T>,
    options: { interceptFileChooser?: boolean } = {},
  ): Promise<T> {
    if (!this.pageIsAlive(page)) return operation();

    const win = page.window;
    const originalBounds = win.getBounds();
    const originalOpacity = win.getOpacity();
    const wasVisible = win.isVisible();
    const wasMinimized = win.isMinimized();
    const previouslyFocusedWindow = BrowserWindow.getFocusedWindow();
    let revealed = false;
    const debuggerClient = win.webContents.debugger;
    let debuggerAttachedHere = false;
    try {
      if (!wasVisible) {
        win.setSkipTaskbar(true);
        // Windows refuses Doubao's native file-chooser handoff when the window
        // is fully outside every display. Keep it on a valid display while
        // remaining completely transparent and non-activating instead. A
        // non-zero opacity or activation produces a one-frame flash on
        // Windows. `showInactive()` is enough to create the compositor
        // surface required by the CDP pointer bridge without stealing focus.
        win.setOpacity(0);
        win.showInactive();
        revealed = true;
        // Wait for Chromium to create an active compositor surface before CDP
        // dispatches the pointerdown that opens the Radix menu.
        await sleep(120);
      }
      if (options.interceptFileChooser) {
        try {
          if (!debuggerClient.isAttached()) {
            debuggerClient.attach("1.3");
            debuggerAttachedHere = true;
          }
          await debuggerClient.sendCommand(
            "Page.setInterceptFileChooserDialog",
            { enabled: true },
          );
        } catch {
          if (debuggerAttachedHere && debuggerClient.isAttached())
            debuggerClient.detach();
          debuggerAttachedHere = false;
        }
      }
      return await operation();
    } finally {
      if (debuggerAttachedHere && debuggerClient.isAttached())
        debuggerClient.detach();
      if (revealed && this.pageIsAlive(page)) {
        win.hide();
        win.setOpacity(originalOpacity);
        win.setBounds(originalBounds, false);
        win.setSkipTaskbar(false);
        if (wasMinimized) win.minimize();
        if (previouslyFocusedWindow && !previouslyFocusedWindow.isDestroyed())
          previouslyFocusedWindow.focus();
      }
    }
  }

  private hardenSession(
    browserSession: Electron.Session,
    provider: WebAgentProvider,
    partition: string,
  ): void {
    // accounts.x.ai rejects Electron's default UA (which includes both the app
    // product token and `Electron/...`) before the user can complete sign-in.
    // Keep the actual bundled Chromium version and only remove those wrapper
    // tokens. This is isolated to Grok's persistent partition; Doubao and
    // ChatGPT retain their existing browser identity and session behavior.
    if (provider === "grok") {
      browserSession.setUserAgent(grokCompatibleUserAgent(), "zh-CN,zh");
    }
    if (this.downloadSessions.has(partition)) return;
    this.downloadSessions.add(partition);
    browserSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.on("will-download", (event, item, contents) => {
      const target = this.downloadTargets.get(contents.id);
      if (!target) {
        event.preventDefault();
        return;
      }
      const filename = safeFilename(item.getFilename());
      const path = join(target.directory, `${randomUUID()}-${filename}`);
      item.setSavePath(path);
      target.run.pendingDownloads += 1;
      item.once("done", async (_doneEvent, state) => {
        target.run.pendingDownloads = Math.max(
          0,
          target.run.pendingDownloads - 1,
        );
        if (state !== "completed") {
          target.run.callbacks.onEvent(
            "error",
            `${webAgentProviderLabel(target.run.input.settings.provider)}下载文件未完成。`,
            { code: "WEB_DOWNLOAD_FAILED" },
          );
          return;
        }
        try {
          const info = await stat(path);
          if (!info.isFile() || info.size <= 0) {
            throw controllerError(
              "WEB_DOWNLOAD_FAILED",
              "下载文件为空或不可用。",
              target.run.input.settings.provider,
            );
          }
          const bytes = await readFile(path);
          const artifactPath = materializeBytesToTemp(
            bytes,
            filename,
            item.getMimeType(),
          );
          if (!artifactPath) {
            throw controllerError(
              "WEB_DOWNLOAD_FAILED",
              undefined,
              target.run.input.settings.provider,
            );
          }
          target.run.downloads.push({
            id: `web-download-${randomUUID()}`,
            label: filename,
            path: artifactPath,
            mime: item.getMimeType() || undefined,
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          });
          target.run.callbacks.onEvent(
            "tool_result",
            `已保存${webAgentProviderLabel(target.run.input.settings.provider)}下载文件：${filename}。`,
          );
        } catch (error) {
          target.run.callbacks.onEvent(
            "error",
            `${webAgentProviderLabel(target.run.input.settings.provider)}下载文件未能安全保存。`,
            {
              code: "WEB_DOWNLOAD_FAILED",
              detail: error instanceof Error ? error.message : String(error),
            },
          );
        } finally {
          void unlink(path).catch(() => undefined);
        }
      });
    });
    // Retain the Provider closure so future extension cannot accidentally
    // attach an unscoped session listener to a generic browser partition.
    void provider;
  }

  private hardenWindow(page: ManagedPage): void {
    const contents = page.window.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedWebAgentNavigationUrl(page.provider, url)) {
        void contents.loadURL(url).catch(() => undefined);
      }
      return { action: "deny" };
    });
    const guardNavigation = (event: Electron.Event, url: string): void => {
      if (!isAllowedWebAgentNavigationUrl(page.provider, url))
        event.preventDefault();
    };
    contents.on("will-navigate", guardNavigation);
    contents.on("will-redirect", guardNavigation);
    contents.on("render-process-gone", () => {
      for (const active of this.activeRuns.values()) {
        if (active.pageKey !== page.key) continue;
        active.failure = controllerError(
          "WEB_SESSION_CRASHED",
          undefined,
          page.provider,
        );
        active.callbacks.onEvent(
          "error",
          `${webAgentProviderLabel(page.provider)}网页会话意外退出。`,
          {
            code: "WEB_SESSION_CRASHED",
          },
        );
        active.rejectResume?.(active.failure);
        active.cancelled = true;
      }
    });
    page.window.on("closed", () => this.pages.delete(page.key));
  }

  private pageApi(page: ManagedPage): WebAgentPage {
    const contents = (): Electron.WebContents => {
      if (!this.pageIsAlive(page)) {
        throw controllerError(
          "WEB_SESSION_CRASHED",
          `${webAgentProviderLabel(page.provider)}网页窗口已关闭，请重试当前任务。`,
          page.provider,
        );
      }
      return page.window.webContents;
    };
    return {
      url: () => contents().getURL(),
      navigate: async (url) => {
        if (!isAllowedWebAgentUrl(page.provider, url)) {
          throw controllerError(
            "WEB_NAVIGATION_BLOCKED",
            undefined,
            page.provider,
          );
        }
        await contents().loadURL(url);
      },
      evaluate: async <T>(script: string): Promise<T> =>
        contents().executeJavaScript(script, true) as Promise<T>,
      click: async (selector: string) => {
        const point = (await contents().executeJavaScript(
          `(() => {
            const element = document.querySelector(${JSON.stringify(selector)});
            if (!element) return null;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0)
              return null;
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          })()`,
          true,
        )) as { x: number; y: number } | null;
        if (!point)
          throw controllerError(
            "WEB_UPLOAD_REJECTED",
            `无法定位${webAgentProviderLabel(page.provider)}上传控件。`,
            page.provider,
          );
        const debuggerClient = contents().debugger;
        let attachedHere = false;
        try {
          if (!debuggerClient.isAttached()) {
            debuggerClient.attach("1.3");
            attachedHere = true;
          }
          // The provider window is normally hidden. CDP input dispatch reaches
          // hidden renderers reliably and produces the pointer sequence Radix
          // controls expect, unlike a synthetic DOM `.click()`. File chooser
          // interception is enabled by withInteractiveProviderWindow for the
          // upload operation, not here: enabling it for every click can make
          // ChatGPT's send button appear enabled while swallowing its submit
          // action after an attachment is present.
          await debuggerClient.sendCommand("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: point.x,
            y: point.y,
          });
          await debuggerClient.sendCommand("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: point.x,
            y: point.y,
            button: "left",
            clickCount: 1,
          });
          await debuggerClient.sendCommand("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: point.x,
            y: point.y,
            button: "left",
            clickCount: 1,
          });
          // dispatchMouseEvent acknowledges before React/Radix has committed
          // the state update. Detaching immediately can discard the pending
          // pointer handler, leaving aria-expanded=false. Keep the session
          // alive through the next animation frame and portal mount.
          await sleep(180);
        } catch {
          // A user-opened DevTools session can already own the debugger. Keep
          // a best-effort Electron input fallback for that case.
          contents().sendInputEvent({
            type: "mouseMove",
            x: point.x,
            y: point.y,
          });
          contents().sendInputEvent({
            type: "mouseDown",
            x: point.x,
            y: point.y,
            button: "left",
            clickCount: 1,
          });
          contents().sendInputEvent({
            type: "mouseUp",
            x: point.x,
            y: point.y,
            button: "left",
            clickCount: 1,
          });
          await sleep(180);
        } finally {
          if (attachedHere && debuggerClient.isAttached())
            debuggerClient.detach();
        }
      },
      dropFiles: async (paths: string[]) => {
        const point = (await contents().executeJavaScript(
          `(() => {
            const visible = (element) => {
              const style = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
            };
            const editor = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
              .filter(visible)
              .filter((element) => !/搜索|search/i.test([
                element.getAttribute('aria-label'),
                element.getAttribute('placeholder'),
                element.getAttribute('data-testid'),
                typeof element.className === 'string' ? element.className : '',
              ].filter(Boolean).join(' ')))
              .sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0];
            if (!editor) return null;
            const rect = editor.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          })()`,
          true,
        )) as { x: number; y: number } | null;
        if (!point)
          throw controllerError(
            "WEB_UPLOAD_REJECTED",
            `无法定位${webAgentProviderLabel(page.provider)}附件拖放区域。`,
            page.provider,
          );
        const debuggerClient = contents().debugger;
        let attachedHere = false;
        try {
          if (!debuggerClient.isAttached()) {
            debuggerClient.attach("1.3");
            attachedHere = true;
          }
          const data = {
            items: [],
            files: paths,
            dragOperationsMask: 1,
          };
          for (const type of ["dragEnter", "dragOver", "drop"] as const) {
            await debuggerClient.sendCommand("Input.dispatchDragEvent", {
              type,
              x: point.x,
              y: point.y,
              data,
            });
          }
          await sleep(250);
        } finally {
          if (attachedHere && debuggerClient.isAttached())
            debuggerClient.detach();
        }
      },
      pressEnter: async () => {
        const debuggerClient = contents().debugger;
        let attachedHere = false;
        try {
          if (!debuggerClient.isAttached()) {
            debuggerClient.attach("1.3");
            attachedHere = true;
          }
          await debuggerClient.sendCommand("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
          });
          await debuggerClient.sendCommand("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
          });
          await sleep(180);
        } catch {
          contents().sendInputEvent({ type: "keyDown", keyCode: "Enter" });
          contents().sendInputEvent({ type: "keyUp", keyCode: "Enter" });
          await sleep(180);
        } finally {
          if (attachedHere && debuggerClient.isAttached())
            debuggerClient.detach();
        }
      },
      setInputFiles: async (selector: string, paths: string[]) => {
        const debuggerClient = contents().debugger;
        let attachedHere = false;
        try {
          if (!debuggerClient.isAttached()) {
            debuggerClient.attach("1.3");
            attachedHere = true;
          }
          const evaluated = (await debuggerClient.sendCommand(
            "Runtime.evaluate",
            {
              expression: `document.querySelector(${JSON.stringify(selector)})`,
              returnByValue: false,
            },
          )) as { result?: { objectId?: string; subtype?: string } };
          const objectId = evaluated.result?.objectId;
          if (!objectId)
            throw controllerError(
              "WEB_UPLOAD_REJECTED",
              "未找到文件输入框。",
              page.provider,
            );
          await debuggerClient.sendCommand("DOM.setFileInputFiles", {
            files: paths,
            // Runtime.evaluate already returned the exact input as a stable
            // remote object. DOM.requestNode can produce a frontend node id
            // that is invalid unless DOM.getDocument has first populated the
            // current debugger session, so address the input directly.
            objectId,
          });
        } finally {
          if (attachedHere && debuggerClient.isAttached())
            debuggerClient.detach();
        }
      },
      sleep,
    };
  }

  private async waitForUserAction(
    active: ActiveRun,
    action: WebAgentUserActionRequired,
  ): Promise<void> {
    const waitForResume = new Promise<void>((resolve, reject) => {
      active.resume = resolve;
      active.rejectResume = reject;
    });
    active.callbacks.onUserAction(action);
    const page = this.pages.get(active.pageKey);
    if (page && this.pageIsAlive(page)) {
      try {
        if (page.window.isMinimized()) page.window.restore();
        page.window.show();
        page.window.focus();
      } catch {
        this.pages.delete(active.pageKey);
        await this.open(active.input.settings, active.input.runtimeId);
      }
    } else {
      await this.open(active.input.settings, active.input.runtimeId);
    }
    await waitForResume;
    if (active.failure) throw active.failure;
    if (active.cancelled) {
      throw controllerError(
        "WEB_CANCEL_UNCONFIRMED",
        undefined,
        active.input.settings.provider,
      );
    }
  }

  private async ensureReady(
    active: ActiveRun,
    page: ManagedPage,
  ): Promise<ManagedPage> {
    const adapter = this.adapter(active.input.settings.provider);
    if (active.input.settings.adapterVersion !== adapter.adapterVersion) {
      throw controllerError(
        "WEB_PAGE_UNSUPPORTED",
        `${webAgentProviderLabel(active.input.settings.provider)}适配器版本 ${active.input.settings.adapterVersion} 不受当前应用支持。`,
        active.input.settings.provider,
      );
    }
    let currentPage = page;
    for (;;) {
      if (!this.pageIsAlive(currentPage)) {
        currentPage = await this.getPage(
          active.input.settings,
          active.input.runtimeId,
        );
      }
      const result = await adapter.ensureChatReady(this.pageApi(currentPage));
      if (result.state === "ready") {
        // Login/verification takeover uses the same WebContents. Once the
        // user has finished, return the page to hidden background operation.
        if (this.pageIsAlive(currentPage)) currentPage.window.hide();
        return currentPage;
      }
      const sibling = await this.findReadySiblingPage(
        active.input.settings,
        active.input.runtimeId,
        currentPage,
      );
      if (sibling) {
        currentPage = sibling;
        continue;
      }
      const code: WebAgentErrorCode =
        result.state === "login_required"
          ? "WEB_LOGIN_REQUIRED"
          : result.state === "verification_required"
            ? "WEB_USER_VERIFICATION_REQUIRED"
            : "WEB_PAGE_UNSUPPORTED";
      if (!USER_ACTION_ERROR_CODES.has(code))
        throw controllerError(
          code,
          result.message,
          active.input.settings.provider,
        );
      active.callbacks.onEvent("progress", result.message, { code });
      await this.waitForUserAction(
        active,
        userActionFor(code, active.input.settings.provider),
      );
      // The takeover window is user-closeable. If it was closed and recreated
      // while waiting, continue with the new ManagedPage rather than the stale
      // WebContents captured when the run started.
      currentPage = await this.getPage(
        active.input.settings,
        active.input.runtimeId,
      );
    }
  }

  private async observeResponse(
    active: ActiveRun,
    page: ManagedPage,
    before: WebAgentResponseSnapshot,
  ): Promise<string> {
    const adapter = this.adapter(active.input.settings.provider);
    const deadline = Date.now() + active.input.timeoutMs;
    let previous: WebAgentResponseSnapshot | undefined;
    let stableSince = 0;
    let output = "";
    while (Date.now() < deadline) {
      if (active.failure) throw active.failure;
      if (active.cancelled)
        throw controllerError("WEB_CANCEL_UNCONFIRMED", "任务已取消。");
      const snapshot = await adapter.readResponse(this.pageApi(page));
      if (snapshot.hasError) {
        throw controllerError(
          snapshot.errorCode === "rate_limited"
            ? "WEB_PROVIDER_RATE_LIMITED"
            : "WEB_PROVIDER_ERROR",
          undefined,
          active.input.settings.provider,
        );
      }
      const isNewResponse =
        snapshot.hasAssistantMessage && snapshot.hash !== before.hash;
      if (isNewResponse && snapshot.text !== output) {
        output = snapshot.text;
        active.callbacks.onOutput(output);
      }
      if (!previous || previous.hash !== snapshot.hash)
        stableSince = Date.now();
      if (
        isNewResponse &&
        isWebAgentResponseComplete(snapshot, previous, Date.now() - stableSince)
      ) {
        return output;
      }
      previous = snapshot;
      await sleep(RESPONSE_POLL_MS);
    }
    throw controllerError(
      "WEB_RESPONSE_TIMEOUT",
      undefined,
      active.input.settings.provider,
    );
  }

  private async waitForDownloads(active: ActiveRun): Promise<void> {
    const deadline = Date.now() + DOWNLOAD_SETTLE_MS;
    while (Date.now() < deadline || active.pendingDownloads > 0) {
      if (active.failure) throw active.failure;
      if (active.cancelled) return;
      await sleep(100);
    }
    if (active.failure) throw active.failure;
  }

  private async execute(active: ActiveRun): Promise<WebAgentRunResult> {
    const { input, callbacks } = active;
    const providerLabel = webAgentProviderLabel(input.settings.provider);
    let page = await this.getPage(input.settings, input.runtimeId);
    const downloadDirectory = join(
      app.getPath("temp"),
      "agents-one-web-downloads",
      normalizeWebAgentProfileId(input.settings.profileId),
      input.runId,
    );
    await mkdir(downloadDirectory, { recursive: true });
    callbacks.onEvent("progress", `正在检查${providerLabel}登录状态。`);
    page = await this.ensureReady(active, page);
    const runtimePage = this.pageApi(page);
    this.downloadTargets.set(page.window.webContents.id, {
      run: active,
      directory: downloadDirectory,
    });

    const adapter = this.adapter(input.settings.provider);
    let sessionId = input.sessionId;
    // A provider's new-conversation action returns to its landing composer and
    // may reset mode controls. Select that adapter's preferred mode only after
    // the reset; the remote conversation is created by the first submission.
    let modeSelection: DoubaoModeSelection = {
      mode: "unknown" as const,
      workUnavailable: false,
      fallbackUsed: false,
    };
    if (sessionId) {
      const mapping = getWebAgentConversation(
        input.profile,
        input.runtimeId,
        sessionId,
        input.settings.profileId,
      );
      if (!mapping) {
        throw controllerError(
          "WEB_PAGE_UNSUPPORTED",
          `原${providerLabel}网页会话映射不可恢复；请新建对话后继续。`,
          input.settings.provider,
        );
      }
      await adapter.resumeConversation(runtimePage, mapping.ref);
      modeSelection = {
        ...(await adapter.modeState(runtimePage)),
        fallbackUsed: false,
      };
    } else {
      sessionId = `web-${input.settings.provider}:${randomUUID()}`;
      // Do not persist the generic `/chat` landing route here. Doubao assigns
      // a concrete conversation URL only after the first prompt; persisting
      // the landing route would bind unrelated failed turns to one remote
      // conversation and make the next local conversation fail closed.
      await adapter.createConversation(runtimePage);
      modeSelection = await adapter.ensureMode(
        runtimePage,
        adapter.preferredMode,
      );
      if (modeSelection.fallbackUsed) {
        callbacks.onEvent(
          "progress",
          `${providerLabel}工作模式额度或次数不可用，已切换到对话模式。`,
        );
      }
    }

    const settleResponseBaseline = async (
      snapshot: WebAgentResponseSnapshot,
    ): Promise<WebAgentResponseSnapshot> => {
      // Resuming an existing conversation can report a ready composer before
      // the historical assistant rows have hydrated. If we snapshot that
      // transient blank state, the first hydrated historical answer after the
      // send is mistaken for the new response. Give the page a short bounded
      // settle window so the response baseline includes the existing answer.
      if (!sessionId || snapshot.hasAssistantMessage || snapshot.hasError)
        return snapshot;
      let settledSnapshot = snapshot;
      const baselineDeadline = Date.now() + 3_000;
      while (Date.now() < baselineDeadline) {
        await sleep(150);
        settledSnapshot = await adapter.readResponse(runtimePage);
        if (settledSnapshot.hasAssistantMessage || settledSnapshot.hasError) {
          if (!settledSnapshot.isGenerating) break;
        }
      }
      return settledSnapshot;
    };
    let before = await settleResponseBaseline(
      await adapter.readResponse(runtimePage),
    );
    const prepared = prepareRuntimeInputs(
      input.profile,
      input.attachments,
      `web-agent-${input.runId}`,
    );
    const files: WebAgentStagedFile[] = prepared.files.map((file) => ({
      path: file.path,
      name: file.artifact.name,
      mime: file.artifact.mime,
      size: file.artifact.size,
      sha256: file.artifact.sha256,
    }));
    const uploadPreparedFiles = async (retry = false): Promise<void> => {
      if (!files.length) return;
      callbacks.onEvent("tool_call", `正在上传附件到${providerLabel}。`, {
        detail: files.map((file) => file.name).join(", "),
      });
      await this.withInteractiveProviderWindow(
        page,
        () => adapter.uploadFiles(runtimePage, files),
        { interceptFileChooser: true },
      );
      callbacks.onEvent(
        "tool_result",
        retry
          ? `已在${providerLabel}对话模式重新接收本轮附件。`
          : `${providerLabel}已接收本轮附件。`,
        { detail: files.map((file) => file.name).join(", ") },
      );
    };

    const fallbackToChat = async (): Promise<void> => {
      callbacks.onEvent(
        "progress",
        `${providerLabel}工作模式不可用，正在切换到对话模式并重试本轮任务。`,
      );
      // A rejected Work submission can leave text or an error card in place.
      // Clear it first because opening a new conversation can reset Doubao's
      // segmented mode control.
      await adapter.createConversation(runtimePage);
      const selected = await adapter.ensureMode(runtimePage, "chat");
      if (selected.mode !== "chat") {
        throw controllerError(
          "WEB_PROVIDER_ERROR",
          `${providerLabel}工作模式不可用，且未能切换到对话模式。`,
        );
      }
      modeSelection = { ...selected, fallbackUsed: true };
      before = await settleResponseBaseline(
        await adapter.readResponse(runtimePage),
      );
      await uploadPreparedFiles(true);
    };

    if (
      modeSelection.mode === "work" &&
      (await adapter.modeState(runtimePage)).workUnavailable
    ) {
      await fallbackToChat();
    } else {
      try {
        await uploadPreparedFiles();
      } catch (error) {
        // Some Work-mode quota notices appear only after opening the
        // attachment action. Re-check the page before treating the upload as
        // an ordinary rejected file.
        if (
          modeSelection.mode !== "work" ||
          !(await adapter.modeState(runtimePage)).workUnavailable
        ) {
          throw error;
        }
        await fallbackToChat();
      }
    }
    callbacks.onEvent("progress", `${providerLabel}正在生成回复。`);
    let receipt: WebAgentSubmissionReceipt;
    try {
      receipt = await this.withInteractiveProviderWindow(page, () =>
        adapter.sendPrompt(runtimePage, input.prompt),
      );
    } catch (error) {
      if (
        modeSelection.mode !== "work" ||
        !adapter.isWorkModeUnavailableError(error)
      ) {
        throw error;
      }
      await fallbackToChat();
      callbacks.onEvent("progress", `${providerLabel}正在生成回复。`);
      receipt = await this.withInteractiveProviderWindow(page, () =>
        adapter.sendPrompt(runtimePage, input.prompt),
      );
    }
    void receipt;
    const output = await this.observeResponse(active, page, before);
    const requestedDownloads = await adapter.collectDownloads(runtimePage);
    if (requestedDownloads) {
      callbacks.onEvent(
        "tool_call",
        `正在保存${providerLabel}生成的下载文件。`,
      );
    }
    await this.waitForDownloads(active);
    const currentRef: WebAgentConversationRef = {
      url: runtimePage.url(),
      opaqueId: runtimePage.url(),
    };
    if (
      sessionId &&
      hasStableConversationUrl(currentRef.url, input.settings.provider)
    ) {
      saveWebAgentConversation(input.profile, {
        runtimeId: input.runtimeId,
        profileId: normalizeWebAgentProfileId(input.settings.profileId),
        localSessionId: sessionId,
        provider: input.settings.provider,
        ref: currentRef,
        lastVerifiedAt: Date.now(),
      });
    }
    return {
      output,
      sessionId,
      inputArtifacts: prepared.artifacts,
      artifacts: active.downloads.map((download) => ({
        kind: "file",
        id: download.id,
        label: download.label,
        path: download.path,
        mime: download.mime,
        size: download.size,
        sha256: download.sha256,
      })),
    };
  }
}

let singleton: WebAgentController | undefined;

export function webAgentController(): WebAgentController {
  singleton ||= new WebAgentController();
  return singleton;
}

export function forgetWebAgentRuntimeConversations(
  profile: string | undefined,
  runtimeId: string,
): void {
  removeWebAgentConversationsForRuntime(profile, runtimeId);
}
