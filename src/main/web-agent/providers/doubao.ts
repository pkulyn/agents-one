import type {
  WebAgentConversationRef,
  WebAgentResponseSnapshot,
  WebAgentStagedFile,
  WebAgentSubmissionReceipt,
  WebAgentProvider,
} from "../../../shared/web-agent";
import {
  normalizeWebAgentResponseText,
  webAgentTextHash,
} from "../../../shared/web-agent";

export interface WebAgentPage {
  readonly url: () => string;
  navigate: (url: string) => Promise<void>;
  evaluate: <T>(script: string) => Promise<T>;
  /**
   * Dispatch a trusted mouse click to an element selected in the renderer.
   * Radix menus (used by Doubao's composer) listen to pointer down/up rather
   * than a synthetic DOM click, so the Electron page implementation provides
   * this method while fixture pages may omit it.
   */
  click?: (selector: string) => Promise<void>;
  /** Trusted CDP drag/drop bridge for staged files. */
  dropFiles?: (paths: string[]) => Promise<void>;
  pressEnter: () => Promise<void>;
  setInputFiles: (selector: string, paths: string[]) => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
}

export type DoubaoLoginProbe =
  | { state: "ready" }
  | { state: "login_required"; message: string }
  | { state: "verification_required"; message: string }
  | { state: "unsupported"; message: string };

export type DoubaoMode = "chat" | "work" | "unknown";

export interface DoubaoModeState {
  mode: DoubaoMode;
  workUnavailable: boolean;
  reason?: string;
}

export interface DoubaoModeSelection extends DoubaoModeState {
  fallbackUsed: boolean;
}

/**
 * Work mode is quota/entitlement controlled by Doubao and its wording can
 * change independently of Agents One. Keep this matcher deliberately narrow:
 * generic provider failures must not cause an automatic duplicate submission.
 */
const WORK_MODE_UNAVAILABLE_PATTERN =
  /(?:工作模式|工作任务|work\s*mode)[^。\n]{0,48}(?:次数|额度|配额|上限|用完|耗尽|不可用|无法使用|暂不可用|受限|限制|quota|limit|exhausted|unavailable|exceeded)|(?:次数|额度|配额|上限)[^。\n]{0,48}(?:工作模式|工作任务|work\s*mode)|请切换(?:到)?对话模式|switch\s+to\s+(?:chat|conversation)\s+mode/i;

function isWorkModeUnavailableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^WEB_WORK_MODE_UNAVAILABLE(?::|$)/.test(error.message)
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class DoubaoProviderAdapter {
  readonly provider: WebAgentProvider = "doubao";
  readonly adapterVersion = "1.0.0";
  readonly chatUrl: string = "https://www.doubao.com/chat/";
  readonly preferredMode: Exclude<DoubaoMode, "unknown"> = "work";

  async probeLogin(page: WebAgentPage): Promise<DoubaoLoginProbe> {
    const snapshot = await page.evaluate<{
      hasComposer: boolean;
      hasLogin: boolean;
      hasVerification: boolean;
    }>(`
      (() => {
        const text = (document.body?.innerText || document.body?.textContent || '').toLowerCase();
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const composer = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
          .find(visible);
        return {
          hasComposer: Boolean(composer),
          hasLogin: /登录|登入|log\\s*in|sign\\s*in/.test(text),
          hasVerification: /验证码|安全验证|人机验证|验证后继续|verification/.test(text),
        };
      })()
    `);
    if (snapshot.hasComposer) return { state: "ready" };
    if (snapshot.hasVerification) {
      return {
        state: "verification_required",
        message: "豆包要求完成验证码或安全验证。",
      };
    }
    if (snapshot.hasLogin) {
      return { state: "login_required", message: "请在应用内登录豆包。" };
    }
    return { state: "unsupported", message: "未能安全识别豆包聊天输入框。" };
  }

  async ensureChatReady(page: WebAgentPage): Promise<DoubaoLoginProbe> {
    if (!page.url().startsWith("https://www.doubao.com/")) {
      await page.navigate(this.chatUrl);
    }
    // loadURL resolves before Doubao's React tree always mounts the TipTap
    // composer. Treat a temporarily empty landing page as hydration, while
    // still returning login/verification states immediately.
    let result = await this.probeLogin(page);
    for (
      let attempt = 0;
      result.state === "unsupported" && attempt < 20;
      attempt += 1
    ) {
      await page.sleep(250);
      result = await this.probeLogin(page);
    }
    return result;
  }

  /** Read the visible mode tab and detect an explicit Work-mode quota notice. */
  async modeState(page: WebAgentPage): Promise<DoubaoModeState> {
    const state = await page.evaluate<DoubaoModeState>(`
      (() => {
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const controlFor = (element) => element.closest(
          'button, [role="tab"], [role="button"], a, [class*="cursor-pointer"]'
        ) || element;
        const buttons = [...document.querySelectorAll('button, [role="tab"], [role="button"], div, span')]
          .filter(visible)
          .map((element) => ({
            labelElement: element,
            element: controlFor(element),
            label: normalize(element.textContent || element.getAttribute('aria-label')),
          }))
          .filter(({ label }) => /^(?:对话|工作(?:任务)?|chat|work)$/i.test(label));
        const isActive = (element) => element && (
          element.getAttribute('data-active') === 'true' ||
          element.getAttribute('aria-selected') === 'true' ||
          element.getAttribute('data-state') === 'active' ||
          (/(?:^|\\s)text-dbx-text-primary(?:\\s|$)/.test(element.className || '') &&
            !/(?:^|\\s)text-dbx-text-secondary(?:\\s|$)/.test(element.className || ''))
        );
        const active = buttons.find(({ element, labelElement }) =>
          isActive(labelElement) || isActive(element) || isActive(element.parentElement)
        );
        const pageText = normalize(document.body?.innerText || document.body?.textContent || '');
        const mode = /^(?:工作(?:任务)?|work)$/i.test(active?.label || '')
          ? 'work'
          : /^(?:对话|chat)$/i.test(active?.label || '')
            ? 'chat'
            : /今天有什么工作要处理|工作任务|new_office|taskassistant/i.test(pageText)
              ? 'work'
              : /有什么我能帮你的吗|new_chat/i.test(pageText)
                ? 'chat'
                : 'unknown';
        const unavailable = ${JSON.stringify(WORK_MODE_UNAVAILABLE_PATTERN.source)};
        const workUnavailable = mode === 'work' && new RegExp(unavailable, 'i').test(pageText) ||
          new RegExp(unavailable, 'i').test(pageText) && /工作|work/i.test(pageText);
        return {
          mode,
          workUnavailable,
          ...(workUnavailable ? { reason: '豆包工作模式额度或次数暂不可用。' } : {}),
        };
      })()
    `);
    return state;
  }

  /**
   * Select a Doubao mode by its visible top-level tab. The method verifies the
   * resulting state and falls back to Chat only for an explicit Work quota or
   * unavailable signal.
   */
  async ensureMode(
    page: WebAgentPage,
    preferred: Exclude<DoubaoMode, "unknown"> = "work",
  ): Promise<DoubaoModeSelection> {
    let state = await this.modeState(page);
    const initialWorkUnavailable = state.workUnavailable;
    if (
      preferred === "work" &&
      state.mode === "work" &&
      !state.workUnavailable
    ) {
      return { ...state, fallbackUsed: false };
    }
    if (preferred === "chat" && state.mode === "chat") {
      return { ...state, fallbackUsed: false };
    }

    const clicked = await page.evaluate<boolean>(
      `((target) => {
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const label = [...document.querySelectorAll('button, [role="tab"], [role="button"], div, span')]
          .find((element) => visible(element) && !element.disabled &&
            new RegExp(target === 'work' ? '^(?:工作(?:任务)?|work)$' : '^(?:对话|chat)$', 'i')
              .test(normalize(element.textContent || element.getAttribute('aria-label'))));
        const candidate = label?.closest(
          'button, [role="tab"], [role="button"], a, [class*="cursor-pointer"]'
        ) || label;
        if (!candidate) return false;
        candidate.click();
        return true;
      })(${JSON.stringify(preferred)})`,
    );
    if (clicked) {
      // Current Doubao builds update the segmented control asynchronously.
      // Verify the actual selected state instead of treating a slow switch as
      // permission to silently fall back to Chat.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await page.sleep(250);
        state = await this.modeState(page);
        if (
          preferred === "work" &&
          state.mode === "work" &&
          !state.workUnavailable
        ) {
          return { ...state, fallbackUsed: false };
        }
        if (preferred === "chat" && state.mode === "chat") {
          return { ...state, fallbackUsed: false };
        }
        if (preferred === "work" && state.workUnavailable) break;
      }
    }

    // Chat fallback is allowed only after an explicit Work quota/unavailable
    // signal. Missing controls or an unconfirmed click are integration errors.
    if (
      preferred === "work" &&
      (initialWorkUnavailable || state.workUnavailable)
    ) {
      const chatClicked = await page.evaluate<boolean>(`
        (() => {
          const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
          };
          const label = [...document.querySelectorAll('button, [role="tab"], [role="button"], div, span')]
            .find((element) => visible(element) && !element.disabled &&
              /^(?:对话|chat)$/i.test(normalize(element.textContent || element.getAttribute('aria-label'))));
          const candidate = label?.closest(
            'button, [role="tab"], [role="button"], a, [class*="cursor-pointer"]'
          ) || label;
          if (!candidate) return false;
          candidate.click();
          return true;
        })()
      `);
      if (chatClicked) {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await page.sleep(250);
          state = await this.modeState(page);
          if (state.mode === "chat") break;
        }
        return {
          ...state,
          mode: state.mode === "unknown" ? "chat" : state.mode,
          fallbackUsed: true,
          reason:
            state.reason || "豆包工作模式额度或次数不可用，已切换到对话模式。",
        };
      }
    }
    if (preferred === "work") {
      throw new Error(
        "WEB_PAGE_UNSUPPORTED: 未能确认豆包已切换到工作模式；未自动降级为对话模式。",
      );
    }
    return { ...state, fallbackUsed: false };
  }

  isWorkModeUnavailableError(error: unknown): boolean {
    return isWorkModeUnavailableError(error);
  }

  async createConversation(
    page: WebAgentPage,
  ): Promise<WebAgentConversationRef> {
    const created = await page.evaluate<boolean>(`
      (() => {
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const candidate = [...document.querySelectorAll('button, a, [role="button"], [class*="nav-link"], [data-testid*="new-chat"]')]
          .find((element) => visible(element) && /新对话|新建对话|new\\s*chat/i.test((element.getAttribute('aria-label') || element.textContent || '').trim()));
        if (!candidate) return false;
        candidate.click();
        return true;
      })()
    `);
    if (created) await page.sleep(250);
    const url = page.url();
    if (
      !created &&
      !/^https:\/\/(?:www\.)?doubao\.com\/chat\/?(?:[?#].*)?$/i.test(url)
    ) {
      throw new Error("WEB_PAGE_UNSUPPORTED: 未能确认豆包已创建新的网页会话。");
    }

    // Clicking “new chat” while Doubao is already on the generic landing
    // route can be a React no-op. In that case an attachment left at
    // “uploading 0%” by a failed run remains in the shared Provider composer
    // and poisons the next upload confirmation. A full navigation resets the
    // draft while retaining the isolated login partition and conversation
    // history.
    await page.navigate("https://www.doubao.com/chat/");
    let landingReady = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      landingReady = await page.evaluate<boolean>(`
        (() => {
          const visible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
          };
          const editor = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
            .some((element) => visible(element));
          const mode = [...document.querySelectorAll('button, [role="tab"], [role="button"], div, span')]
            .some((element) => visible(element) && /^(?:对话|工作|chat|work)$/i.test(
              String(element.textContent || element.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim()
            ));
          return editor && mode;
        })()
      `);
      if (landingReady) break;
      await page.sleep(250);
    }
    if (!landingReady) {
      throw new Error(
        "WEB_PAGE_UNSUPPORTED: 豆包新会话页面加载超时，未找到输入框或模式控件。",
      );
    }
    const cleanUrl = page.url();
    return { url: cleanUrl, opaqueId: cleanUrl };
  }

  async resumeConversation(
    page: WebAgentPage,
    ref: WebAgentConversationRef,
  ): Promise<void> {
    if (ref.url && page.url() !== ref.url) await page.navigate(ref.url);
    const probe = await this.probeLogin(page);
    if (probe.state !== "ready") throw new Error(probe.message);
  }

  async uploadFiles(
    page: WebAgentPage,
    files: WebAgentStagedFile[],
  ): Promise<void> {
    if (!files.length) return;
    const filenamePattern = files
      .map((file) => escapeRegex(file.name))
      .join("|");
    if (page.dropFiles) {
      await page.dropFiles(files.map((file) => file.path));
    } else {
      const activation = await page.evaluate<{
        mode: "chat" | "work" | "unknown";
        inputReady: boolean;
        menuTriggerClicked: boolean;
        directTriggerClicked: boolean;
      }>(`
      (() => {
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const elementLabel = (element) => normalize([
          element.getAttribute('aria-label'),
          element.getAttribute('title'),
          element.getAttribute('data-testid'),
          element.getAttribute('data-e2e'),
          element.getAttribute('data-action'),
          typeof element.className === 'string' ? element.className : '',
          element.textContent,
        ].filter(Boolean).join(' '));
        const modeMarker = (element) => {
          let node = element;
          const values = [];
          for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
            values.push(
              node.getAttribute?.('data-mode'),
              node.getAttribute?.('data-scene'),
              node.getAttribute?.('data-testid'),
              node.getAttribute?.('data-e2e'),
              typeof node.className === 'string' ? node.className : '',
            );
          }
          return normalize(values.filter(Boolean).join(' ')).toLowerCase();
        };
        const modeButtons = [...document.querySelectorAll('button, [role="tab"]')]
          .filter((element) => visible(element))
          .map((element) => ({ element, label: normalize(element.textContent || element.getAttribute('aria-label')) }))
          .filter(({ label }) => /^(?:对话|工作|chat|work)$/i.test(label));
        const activeModeButton = modeButtons.find(({ element }) =>
          element.getAttribute('data-active') === 'true' ||
          element.getAttribute('aria-selected') === 'true' ||
          element.getAttribute('data-state') === 'active'
        );
        const activeModeLabel = activeModeButton?.label || '';
        const pageText = normalize(document.body?.innerText || document.body?.textContent || '');
        const mode = /^(?:工作|work)$/i.test(activeModeLabel) ||
          (!activeModeLabel && /今天有什么工作要处理|工作任务|new_office|taskassistant/i.test(pageText))
          ? 'work'
          : /^(?:对话|chat)$/i.test(activeModeLabel) ||
            (!activeModeLabel && /有什么我能帮你的吗|new_chat/i.test(pageText))
            ? 'chat'
            : 'unknown';
        const editor = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
          .find(visible);
        const editorRect = editor?.getBoundingClientRect?.();
        const affinity = (element) => {
          const marker = modeMarker(element);
          if (!marker || mode === 'unknown') return 0;
          const isWork = /work|office|task|moa|工作|任务/.test(marker);
          const isChat = /chat|conversation|dialog|对话/.test(marker);
          if (mode === 'work') return isWork ? 6 : isChat ? -6 : 0;
          return isChat ? 6 : isWork ? -6 : 0;
        };
        const distance = (element) => {
          if (!editorRect) return 0;
          const rect = element.getBoundingClientRect();
          return Math.abs((rect.left + rect.width / 2) - (editorRect.left + editorRect.width / 2)) +
            Math.abs((rect.top + rect.height / 2) - (editorRect.top + editorRect.height / 2));
        };
        const inputCandidates = [...document.querySelectorAll('input[type="file"]')]
          .filter((element) => !element.disabled)
          .filter((element) => mode === 'unknown' || affinity(element) >= 0)
          .sort((left, right) => affinity(right) - affinity(left) || distance(left) - distance(right));
        const markInput = (input) => {
          if (!input) return false;
          document.querySelectorAll('input[data-agents-one-upload-target="true"]').forEach((element) =>
            element.removeAttribute('data-agents-one-upload-target')
          );
          input.setAttribute('data-agents-one-upload-target', 'true');
          return true;
        };
        if (markInput(inputCandidates[0])) {
          return { mode, inputReady: true, menuTriggerClicked: false, directTriggerClicked: false };
        }
        const clickSelector = '[data-agents-one-web-click-target="true"]';
        const markClickTarget = (element) => {
          const target = element.querySelector?.('button[data-dbx-name="button"], [role="button"]') ||
            element.closest('button, [role="button"], label') || element;
          document.querySelectorAll(clickSelector).forEach((previous) =>
            previous.removeAttribute('data-agents-one-web-click-target')
          );
          target.setAttribute('data-agents-one-web-click-target', 'true');
          return true;
        };
        const candidates = [...document.querySelectorAll(
          'button, [role="button"], label, [aria-label], [title], [data-testid], [data-e2e], [data-action], [class*="upload"], [class*="attach"], [class*="cursor-pointer"], [class*="add"], [class*="plus"], div, span'
        )]
          .filter((element) => {
            const explicit = [
              element.getAttribute('aria-label'),
              element.getAttribute('title'),
              element.getAttribute('data-testid'),
              element.getAttribute('data-e2e'),
              element.getAttribute('data-action'),
            ].some(Boolean);
            const interactive = element.matches('button, [role="button"], label, input, a[href], [tabindex]');
            const rect = element.getBoundingClientRect();
            const iconOnly = !normalize(element.textContent) &&
              element.querySelector('svg, img') && rect.width <= 64 && rect.height <= 64;
            const nearComposerLeft = mode === 'work' && editorRect &&
              rect.left < editorRect.left + editorRect.width * 0.7;
            return visible(element) && !element.disabled &&
              (interactive || explicit || (iconOnly && nearComposerLeft)) &&
              (mode === 'unknown' || affinity(element) >= 0);
          })
          .map((element) => {
            const iconMetadata = [...element.querySelectorAll(
              'svg, use, img, path, [data-icon], [data-icon-name], [aria-label], [title]'
            )].map((icon) => [
              icon.getAttribute('data-icon'),
              icon.getAttribute('data-icon-name'),
              icon.getAttribute('aria-label'),
              icon.getAttribute('title'),
              icon.getAttribute('href'),
              icon.getAttribute('xlink:href'),
              icon.getAttribute('src'),
              icon.getAttribute('d'),
              typeof icon.className === 'string' ? icon.className : '',
            ].filter(Boolean).join(' ')).join(' ');
            const metadata = elementLabel(element) + ' ' + iconMetadata;
            const structural = [
              element.getAttribute('data-testid'),
              element.getAttribute('data-e2e'),
              element.getAttribute('data-action'),
              typeof element.className === 'string' ? element.className : '',
            ].filter(Boolean).join(' ');
            const uploadSemantics = /上传|添加文件|添加附件|附件|文件|upload|attach/i.test(metadata) ||
              /(?:file[-_ ]?(?:upload|attach)|upload[-_ ]?file)/i.test(structural);
            const roundIconOnly = !normalize(element.textContent) &&
              element.querySelector('svg, img') &&
              element.getBoundingClientRect().width <= 64 &&
              element.getBoundingClientRect().height <= 64;
            const plusIcon = /M12\\.0005 2\\.25|M12 2\\.25|(?:^|[\\s_-])(?:icon[-_]?)?(?:plus|add)(?:$|[\\s_-])/i.test(
              iconMetadata + ' ' + elementLabel(element),
            );
            const genericWorkPlus = mode === 'work' && roundIconOnly && editorRect &&
              element.getBoundingClientRect().left < editorRect.left + editorRect.width * 0.7 &&
              !/microphone|voice|send|stop|record|emoji|表情|语音|发送|停止/i.test(metadata);
            return {
              element,
              score: affinity(element) + (uploadSemantics ? 30 : 0) +
                (plusIcon || genericWorkPlus ? 18 : 0) - distance(element),
              uploadSemantics,
              plusIcon: plusIcon || genericWorkPlus,
            };
          })
          .filter(({ uploadSemantics, plusIcon }) => uploadSemantics || (mode === 'work' && plusIcon))
          .sort((left, right) => right.score - left.score);
        const direct = candidates.find(({ uploadSemantics }) => uploadSemantics);
        if (direct) {
          return { mode, inputReady: false, menuTriggerClicked: false, directTriggerClicked: markClickTarget(direct.element) };
        }
        const menuTrigger = candidates.find(({ plusIcon }) => plusIcon);
        if (menuTrigger) {
          return { mode, inputReady: false, menuTriggerClicked: markClickTarget(menuTrigger.element), directTriggerClicked: false };
        }
        return { mode, inputReady: false, menuTriggerClicked: false, directTriggerClicked: false };
      })()
    `);
      const clickMarkedTarget = async (): Promise<void> => {
        const selector = '[data-agents-one-web-click-target="true"]';
        if (page.click) {
          await page.click(selector);
        } else {
          await page.evaluate<boolean>(
            `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`,
          );
        }
        await page.evaluate<boolean>(
          `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.removeAttribute('data-agents-one-web-click-target'); return true; })()`,
        );
      };
      if (activation.directTriggerClicked || activation.menuTriggerClicked)
        await clickMarkedTarget();
      if (activation.menuTriggerClicked) {
        // Work mode mounts its “+” popover asynchronously. A single 200ms
        // inspection frequently races the portal render even though the user
        // can already see the menu moments later.
        let menuActionClicked = false;
        for (
          let attempt = 0;
          attempt < 30 && !menuActionClicked;
          attempt += 1
        ) {
          menuActionClicked = await page.evaluate<boolean>(`
          (() => {
          const visible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
          };
          const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
          const activeMode = [...document.querySelectorAll('button, [role="tab"]')]
            .filter((element) => visible(element))
            .find((element) =>
              /^(?:对话|工作|chat|work)$/i.test(normalize(element.textContent || element.getAttribute('aria-label'))) &&
              (element.getAttribute('data-active') === 'true' ||
                element.getAttribute('aria-selected') === 'true' ||
                element.getAttribute('data-state') === 'active')
            );
          const modeLabel = normalize(activeMode?.textContent || activeMode?.getAttribute('aria-label'));
          const pageText = normalize(document.body?.innerText || document.body?.textContent || '');
          const mode = /^(?:工作|work)$/i.test(modeLabel) ||
            (!modeLabel && /今天有什么工作要处理|工作任务|new_office|taskassistant/i.test(pageText))
            ? 'work'
            : /^(?:对话|chat)$/i.test(modeLabel) ||
              (!modeLabel && /有什么我能帮你的吗|new_chat/i.test(pageText))
              ? 'chat'
              : 'unknown';
          const affinity = (element) => {
            if (mode === 'unknown') return 0;
            let node = element;
            let marker = '';
            for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
              marker += ' ' + [
                node.getAttribute?.('data-mode'),
                node.getAttribute?.('data-scene'),
                node.getAttribute?.('data-testid'),
                node.getAttribute?.('data-e2e'),
                typeof node.className === 'string' ? node.className : '',
              ].filter(Boolean).join(' ');
            }
            const isWork = /work|office|task|moa|工作|任务/i.test(marker);
            const isChat = /chat|conversation|dialog|对话/i.test(marker);
            return mode === 'work' ? (isWork ? 1 : isChat ? -1 : 0) : (isChat ? 1 : isWork ? -1 : 0);
          };
          const isUploadMenuLabel = (label) => /^(?:上传文件或图片|上传文件|添加文件|添加附件|附件|文件|upload(?: file)?|attach(?: file)?)$/i.test(label);
          const action = [...document.querySelectorAll(
            '[role="menuitem"], [role="option"], button, [data-testid], [data-e2e], [data-action], [class*="cursor-pointer"], [class*="menu-item"], div, span'
          )]
            // The Work popover is rendered by the shared chat composer and can
            // inherit a chat/conversation marker from its portal ancestor.
            // The exact upload label is unambiguous, so do not reject it solely
            // because that inherited marker disagrees with the active mode.
            .filter((element) => visible(element))
            .map((element) => ({
              element,
              labels: [
                element.getAttribute('aria-label'),
                element.getAttribute('title'),
                element.getAttribute('data-testid'),
                element.getAttribute('data-e2e'),
                element.getAttribute('data-action'),
                element.textContent,
              ].map(normalize).filter(Boolean),
            }))
            .map(({ element, labels }) => ({
              element,
              modeAffinity: affinity(element),
              label: labels.find((label) => label.length <= 40 && isUploadMenuLabel(label)) || '',
            }))
            .filter(({ label }) => Boolean(label))
            .sort((left, right) => right.modeAffinity - left.modeAffinity || left.label.length - right.label.length)[0]?.element;
          if (!action) return false;
          document.querySelectorAll('[data-agents-one-web-click-target="true"]').forEach((previous) =>
            previous.removeAttribute('data-agents-one-web-click-target')
          );
          const target = action.closest('[role="menuitem"], [role="option"], button, [role="button"], [class*="cursor-pointer"], [class*="menu-item"]') || action;
          target.setAttribute('data-agents-one-web-click-target', 'true');
          return true;
          })()
        `);
          if (menuActionClicked) await clickMarkedTarget();
          if (!menuActionClicked) await page.sleep(100);
        }
        if (!menuActionClicked)
          throw new Error(
            "WEB_UPLOAD_REJECTED: 未找到当前豆包模式的文件上传菜单项。",
          );
      }
      if (
        !activation.inputReady &&
        !activation.directTriggerClicked &&
        !activation.menuTriggerClicked
      )
        throw new Error("WEB_UPLOAD_REJECTED: 未找到豆包文件上传入口。");
      const inputDeadline = Date.now() + 5_000;
      while (Date.now() < inputDeadline) {
        const inputReady = await page.evaluate<boolean>(
          `(() => {
          const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
          };
          const activeMode = [...document.querySelectorAll('button, [role="tab"]')]
            .filter((element) => visible(element))
            .find((element) =>
              /^(?:对话|工作|chat|work)$/i.test(normalize(element.textContent || element.getAttribute('aria-label'))) &&
              (element.getAttribute('data-active') === 'true' ||
                element.getAttribute('aria-selected') === 'true' ||
                element.getAttribute('data-state') === 'active')
            );
          const modeLabel = normalize(activeMode?.textContent || activeMode?.getAttribute('aria-label'));
          const pageText = normalize(document.body?.innerText || document.body?.textContent || '');
          const mode = /^(?:工作|work)$/i.test(modeLabel) ||
            (!modeLabel && /今天有什么工作要处理|工作任务|new_office|taskassistant/i.test(pageText))
            ? 'work'
            : /^(?:对话|chat)$/i.test(modeLabel) ||
              (!modeLabel && /有什么我能帮你的吗|new_chat/i.test(pageText))
              ? 'chat'
              : 'unknown';
          const affinity = (element) => {
            if (mode === 'unknown') return 0;
            let node = element;
            let marker = '';
            for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
              marker += ' ' + [
                node.getAttribute?.('data-mode'),
                node.getAttribute?.('data-scene'),
                node.getAttribute?.('data-testid'),
                node.getAttribute?.('data-e2e'),
                typeof node.className === 'string' ? node.className : '',
              ].filter(Boolean).join(' ');
            }
            const isWork = /work|office|task|moa|工作|任务/i.test(marker);
            const isChat = /chat|conversation|dialog|对话/i.test(marker);
            return mode === 'work' ? (isWork ? 1 : isChat ? -1 : 0) : (isChat ? 1 : isWork ? -1 : 0);
          };
          const input = [...document.querySelectorAll('input[type="file"]')]
            .filter((element) => !element.disabled && (mode === 'unknown' || affinity(element) >= 0))
            .sort((left, right) => affinity(right) - affinity(left))[0];
          if (!input) return false;
          document.querySelectorAll('input[data-agents-one-upload-target="true"]').forEach((element) =>
            element.removeAttribute('data-agents-one-upload-target')
          );
          input.setAttribute('data-agents-one-upload-target', 'true');
          return true;
        })()`,
        );
        if (inputReady) break;
        await page.sleep(100);
      }
      const hasTargetInput = await page.evaluate<boolean>(
        `Boolean(document.querySelector('input[data-agents-one-upload-target="true"]'))`,
      );
      if (!hasTargetInput)
        throw new Error(
          "WEB_UPLOAD_REJECTED: 豆包未创建当前模式的文件选择器。",
        );
      await page.setInputFiles(
        'input[data-agents-one-upload-target="true"]',
        files.map((file) => file.path),
      );
    }

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const status = await page.evaluate<{
        hasError: boolean;
        uploading: boolean;
        hasAttachmentEvidence: boolean;
        hasInputFile: boolean;
      }>(`
        (() => {
          const text = document.body?.innerText || document.body?.textContent || '';
          return {
            hasError: /上传失败|文件不支持|无法上传|upload failed/i.test(text),
            uploading: /上传中|正在上传|uploading/i.test(text),
            hasAttachmentEvidence: new RegExp(${JSON.stringify(filenamePattern)}).test(text),
            hasInputFile: [...document.querySelectorAll('input[type="file"]')]
              .some((element) => Boolean(element.files?.length)),
          };
        })()
      `);
      if (status.hasError)
        throw new Error("WEB_UPLOAD_REJECTED: 豆包拒绝了附件上传。");
      if (
        (status.hasAttachmentEvidence || status.hasInputFile) &&
        !status.uploading
      )
        return;
      await page.sleep(300);
    }
    throw new Error("WEB_UPLOAD_REJECTED: 未能确认豆包已接收附件。");
  }

  async sendPrompt(
    page: WebAgentPage,
    prompt: string,
  ): Promise<WebAgentSubmissionReceipt> {
    const escapedPrompt = JSON.stringify(prompt);
    const prepared = await page.evaluate<boolean>(`
      (() => {
        const prompt = ${escapedPrompt};
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const editor = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
          .filter(visible)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const marker = normalize([
              element.getAttribute('aria-label'),
              element.getAttribute('placeholder'),
              element.getAttribute('data-testid'),
              element.getAttribute('data-e2e'),
              typeof element.className === 'string' ? element.className : '',
            ].filter(Boolean).join(' '));
            return {
              element,
              marker,
              score: (/消息|发送消息|创建任务|提问|ask grok|composer|prompt|tiptap|prosemirror|chat[-_ ]?input/i.test(marker) ? 100000 : 0) +
                (element.getAttribute('contenteditable') === 'true' ? 10000 : 0) +
                Math.min(rect.width * rect.height, 100000) / 100 + rect.top,
            };
          })
          .filter(({ marker }) => !/搜索|search/i.test(marker))
          .sort((left, right) => right.score - left.score)[0]?.element;
        if (!editor) return false;
        document.querySelectorAll('[data-agents-one-composer-target="true"]').forEach((element) =>
          element.removeAttribute('data-agents-one-composer-target')
        );
        editor.setAttribute('data-agents-one-composer-target', 'true');
        if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
          const prototype = editor instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
          setter?.call(editor, prompt);
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
        } else {
          // Doubao currently uses a TipTap/ProseMirror contenteditable. Directly
          // assigning textContent changes only the DOM and leaves the editor's
          // internal document empty, so the send control never appears. Use
          // the browser editing command first; it updates both the DOM and the
          // editor state and emits the input event TipTap expects.
          editor.focus();
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editor);
          selection?.removeAllRanges();
          selection?.addRange(range);
          const inserted = typeof document.execCommand === 'function' &&
            document.execCommand('insertText', false, prompt);
          if (!inserted) {
            editor.textContent = prompt;
            editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
          }
        }
        const currentText = editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
          ? editor.value
          : editor.textContent;
        return normalize(currentText).includes(normalize(prompt));
      })()
    `);
    if (!prepared) {
      throw new Error("WEB_SUBMISSION_UNCONFIRMED: 未能安全确认提示词发送。");
    }
    // An existing Work conversation replaces its microphone with the send
    // control asynchronously after TipTap updates. Poll for that control
    // instead of querying it in the same JavaScript turn as the input.
    let submitted = false;
    // ChatGPT's ProseMirror composer reliably submits on a trusted Enter
    // keypress, including when a file chip is present. Its send button can
    // remain aria-disabled=false while the attachment hand-off is still
    // transitioning, so a coordinate click may be accepted visually but not
    // reach the submit handler. Prefer the same keyboard path a user uses.
    if (this.provider === "chatgpt") {
      const hasComposerAttachment = await page.evaluate<boolean>(`
        (() => Boolean(document.querySelector(
          '[aria-label*="移除文件"], [aria-label*="Remove file"], [data-testid*="file-chip"], [data-testid*="attachment"]'
        )))()
      `);
      if (hasComposerAttachment) {
        // ChatGPT renders the file chip before its upload/indexing hand-off is
        // ready to accept a submit key.  A short bounded grace period avoids
        // racing that hand-off; ordinary text turns take the fast path.
        // The first visible chip can precede ChatGPT's server-side document
        // hand-off by several seconds (especially for Work mode). Waiting
        // here keeps the subsequent trusted click/Enter inside that same
        // composer instead of leaving an unsent draft behind.
        await page.sleep(8_000);
      }
      const focusComposer = async (): Promise<void> => {
        await page.evaluate<boolean>(`
        (() => {
          const editor = [...document.querySelectorAll(
            'textarea, [contenteditable="true"], [role="textbox"]'
          )].filter((element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' &&
              rect.width > 0 && rect.height > 0 &&
              !/搜索|search/i.test([
                element.getAttribute('aria-label'),
                element.getAttribute('placeholder'),
                element.getAttribute('data-testid'),
              ].filter(Boolean).join(' '));
          }).sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0];
          editor?.focus();
          return Boolean(editor);
        })()
        `);
      };
      const composerStillHasPrompt = async (): Promise<boolean> =>
        page.evaluate<boolean>(`
          (() => {
            const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
            const prompt = ${escapedPrompt};
            const editor = [...document.querySelectorAll(
              'textarea, [contenteditable="true"], [role="textbox"]'
            )].filter((element) => !/搜索|search/i.test([
              element.getAttribute('aria-label'),
              element.getAttribute('placeholder'),
            ].filter(Boolean).join(' '))).sort((left, right) =>
              right.getBoundingClientRect().top - left.getBoundingClientRect().top
            )[0];
            const value = editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
              ? editor.value
              : editor?.textContent || '';
            return normalize(value).includes(normalize(prompt));
          })()
        `);
      await focusComposer();
      let clicked = false;
      if (page.click) {
        try {
          await page.click(
            'button[aria-label="发送提示"], button[data-testid="send-button"]',
          );
          clicked = true;
        } catch {
          // Fall through to the keyboard path below. The provider may replace
          // the button between the coordinate probe and the pointer event.
        }
      }
      if (clicked) {
        await page.sleep(500);
        const editorStillHasPrompt = await composerStillHasPrompt();
        if (editorStillHasPrompt) await page.pressEnter();
      } else {
        await page.pressEnter();
      }
      // A trusted pointer click moves focus to the send button. If ChatGPT's
      // React handler ignores that click while a Work composer is settling,
      // refocus the editor before the keyboard fallback; dispatching Enter to
      // the still-focused button does not submit a ProseMirror draft.
      if (await composerStillHasPrompt()) {
        await focusComposer();
        await page.pressEnter();
        await page.sleep(500);
      }
      // A transparent, non-activating BrowserWindow can still reject the
      // trusted pointer/key sequence on some Chromium builds when a file chip
      // is present. ChatGPT's React submit button accepts a same-document
      // click as a safe last resort; keep this fallback narrowly scoped to
      // ChatGPT and only use it while the original draft is still present.
      if (await composerStillHasPrompt()) {
        const domSubmitted = await page.evaluate<boolean>(`
          (() => {
            const send = document.querySelector(
              'button[aria-label="发送提示"], button[data-testid="send-button"]'
            );
            if (!send || send.hasAttribute('disabled') || send.getAttribute('aria-disabled') === 'true') return false;
            send.click();
            return true;
          })()
        `);
        if (domSubmitted) await page.sleep(500);
      }
      submitted = true;
    }
    for (let attempt = 0; attempt < 30 && !submitted; attempt += 1) {
      const sendReady = await page.evaluate<boolean>(`
        (() => {
          const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
          };
          const editor = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
            .filter(visible)
            .filter((element) => !/搜索|search/i.test(normalize([
              element.getAttribute('aria-label'),
              element.getAttribute('placeholder'),
              element.getAttribute('data-testid'),
              typeof element.className === 'string' ? element.className : '',
            ].filter(Boolean).join(' '))))
            .sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0];
          const editorRect = editor?.getBoundingClientRect?.();
          const controls = [...document.querySelectorAll(
            '#flow-end-msg-send, [data-testid="flow-end-msg-send"], button[type="submit"], button, [role="button"], [role="submit"], [aria-label], [title], [data-testid], [data-e2e], [data-action], [class*="send"]'
          )]
            .map((element) => element.closest('button, [role="button"], [role="submit"]') || element)
            .filter((element, index, all) => all.indexOf(element) === index)
            .filter((element) => !element.matches('textarea, [contenteditable="true"], [role="textbox"]'))
            .filter((element) => visible(element) && !element.hasAttribute('disabled') &&
              element.getAttribute('aria-disabled') !== 'true')
            .map((element) => {
              const rect = element.getBoundingClientRect();
              const iconMarker = [...element.querySelectorAll('svg, use, img, [data-icon], [data-icon-name]')]
                .map((icon) => [
                  icon.getAttribute('data-icon'),
                  icon.getAttribute('data-icon-name'),
                  icon.getAttribute('aria-label'),
                  icon.getAttribute('title'),
                  icon.getAttribute('href'),
                  icon.getAttribute('xlink:href'),
                  typeof icon.className === 'string' ? icon.className : '',
                ].filter(Boolean).join(' ')).join(' ');
              const marker = normalize([
                element.id,
                element.getAttribute('aria-label'),
                element.getAttribute('title'),
                element.getAttribute('data-testid'),
                element.getAttribute('data-e2e'),
                element.getAttribute('data-action'),
                element.getAttribute('type'),
                typeof element.className === 'string' ? element.className : '',
                element.textContent,
                iconMarker,
              ].filter(Boolean).join(' '));
              const distance = editorRect
                ? Math.abs(rect.left + rect.width / 2 - (editorRect.left + editorRect.width / 2)) +
                  Math.abs(rect.top + rect.height / 2 - (editorRect.top + editorRect.height / 2))
                : 0;
              return { element, marker, distance };
            })
            .filter(({ marker }) => /发送|send|submit|flow[-_ ]?end[-_ ]?msg[-_ ]?send|msg[-_ ]?send/i.test(marker))
            .sort((left, right) => left.distance - right.distance);
          const send = controls[0]?.element;
          if (!send) return false;
          document.querySelectorAll('[data-agents-one-submit-target="true"]').forEach((element) =>
            element.removeAttribute('data-agents-one-submit-target')
          );
          send.setAttribute('data-agents-one-submit-target', 'true');
          return true;
        })()
      `);
      if (sendReady) {
        if (page.click) {
          await page.click('[data-agents-one-submit-target="true"]');
        } else {
          await page.evaluate<boolean>(`
            (() => {
              const send = document.querySelector('[data-agents-one-submit-target="true"]');
              if (!send) return false;
              send.click();
              return true;
            })()
          `);
        }
        submitted = true;
        await page.evaluate<boolean>(`
          (() => {
            const send = document.querySelector('[data-agents-one-submit-target="true"]');
            if (!send) return false;
            send.removeAttribute('data-agents-one-submit-target');
            return true;
          })()
        `);
      }
      if (!submitted) await page.sleep(100);
    }
    if (!submitted) {
      // Some completed Work-task composers expose no stable send metadata.
      // The editor is focused and its value was verified above, so native
      // Enter is a narrowly scoped fallback with no guessed click target.
      await page.pressEnter();
      submitted = true;
    }
    // Doubao may keep the TipTap text in the composer for a short period after
    // the click.  A fixed 250ms check therefore reports a false negative even
    // though the user bubble is already visible (and the request is running).
    // Poll a bounded set of explicit receipt signals instead.
    // The provider may create a new conversation and mount the user row only
    // after the attachment chip has finished its asynchronous hand-off.  In
    // particular, ChatGPT can take several seconds to route a Work prompt
    // with a file even though the eventual send succeeds.  Keep the receipt
    // check bounded, but allow enough time for that navigation/commit phase.
    const confirmationStartedAt = Date.now();
    const confirmationDeadline = confirmationStartedAt + 15_000;
    const submissionUrlBefore = page.url();
    let safeSubmitFallbackUsed = false;
    let evidence = false;
    while (Date.now() < confirmationDeadline) {
      const workUnavailable = await page.evaluate<boolean>(`
        (() => {
          const text = document.body?.innerText || document.body?.textContent || '';
          const pattern = new RegExp(${JSON.stringify(WORK_MODE_UNAVAILABLE_PATTERN.source)}, 'i');
          return pattern.test(text) && /工作|work/i.test(text);
        })()
      `);
      if (workUnavailable) {
        throw new Error(
          "WEB_WORK_MODE_UNAVAILABLE: 豆包工作模式额度或次数不可用。",
        );
      }
      const currentUrl = page.url();
      evidence =
        currentUrl !== submissionUrlBefore &&
        /\/chat\/[^/?#]+/i.test(currentUrl);
      if (!evidence)
        evidence = await page.evaluate<boolean>(`
        (() => {
          const prompt = ${escapedPrompt}.trim();
          const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
          // Doubao may reformat a submitted message when it renders the user
          // bubble (for example, "105周年" becomes "105 周年"). Receipt
          // matching must therefore ignore presentation-only whitespace and
          // Unicode width differences while still comparing the full prompt.
          const canonicalizeReceiptText = (value) => normalize(value)
            .normalize('NFKC')
            .replace(/\\s+/g, '');
          const visible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
          };
          let pageText = '';
          if (document.body) pageText = document.body.innerText || document.body.textContent || '';
          const hasStop = /停止生成|停止回答|stop generating/i.test(pageText);
          const hasStreamingMarker = Boolean(document.querySelector('[data-streaming="true"]'));
          const markedComposer = document.querySelector('[data-agents-one-composer-target="true"]');
          // React can replace the TipTap root as soon as the message is
          // submitted, taking our marker with the old node. Fall back to the
          // current visible, bottom-most non-search composer.
          const liveComposer = markedComposer || [...document.querySelectorAll(
            'textarea, [contenteditable="true"], [role="textbox"]'
          )]
            .filter(visible)
            .filter((element) => !/搜索|search/i.test(normalize([
              element.getAttribute('aria-label'),
              element.getAttribute('placeholder'),
              element.getAttribute('data-testid'),
              typeof element.className === 'string' ? element.className : '',
            ].filter(Boolean).join(' '))))
            .sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0];
          const composerText = liveComposer instanceof HTMLTextAreaElement || liveComposer instanceof HTMLInputElement
            ? liveComposer.value
            : liveComposer?.textContent || '';
          const empty = Boolean(liveComposer) && !normalize(composerText);
          const sentPrompt = canonicalizeReceiptText(prompt);
          const userBubbles = [...document.querySelectorAll(
            '.bg-g-send-msg-bubble-bg, [data-message-author-role="user"], [data-role="user"]'
          )].filter(visible);
          const hasUserBubble = Boolean(sentPrompt) && userBubbles.some((element) => canonicalizeReceiptText(element.innerText || element.textContent).includes(sentPrompt));
          // Doubao occasionally changes the user-bubble class while keeping
          // the stable message row or visible prompt text. Accept either as
          // a submission receipt so a successful send is not reported as an
          // unconfirmed submission merely because a CSS class changed.
          const messageRows = [...document.querySelectorAll('[data-message-id], [data-observe-row^="block_"]')].filter(visible);
          const hasPromptMessageRow = Boolean(sentPrompt) && messageRows.some((element) => canonicalizeReceiptText(element.innerText || element.textContent).includes(sentPrompt));
          const bodyClone = document.body?.cloneNode(true);
          bodyClone?.querySelectorAll?.('textarea, [contenteditable="true"], [role="textbox"]').forEach((element) => element.remove());
          const conversationText = canonicalizeReceiptText(bodyClone?.innerText || bodyClone?.textContent || '');
          const hasPromptText = Boolean(sentPrompt) && conversationText.includes(sentPrompt);
          return hasStop || hasStreamingMarker || empty || hasUserBubble || hasPromptMessageRow || hasPromptText;
        })()
      `);
      if (evidence) break;
      if (
        this.provider === "doubao" &&
        !safeSubmitFallbackUsed &&
        Date.now() - confirmationStartedAt >= 2_000
      ) {
        // A transparent, non-activating provider surface can acknowledge the
        // CDP pointer sequence without Doubao's React handler consuming it.
        // Retry exactly once, and only after the page proves that the full
        // draft is still present, no matching user message exists, generation
        // has not started, and the exact Doubao send control remains enabled.
        // Those conditions distinguish an ignored click from a slow receipt
        // and preserve the single-delivery contract.
        safeSubmitFallbackUsed = await page.evaluate<boolean>(`
          (() => {
            const prompt = ${escapedPrompt}.trim();
            const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
            const canonicalizeReceiptText = (value) => normalize(value)
              .normalize('NFKC')
              .replace(/\\s+/g, '');
            const visible = (element) => {
              const style = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
            };
            const liveComposer = [...document.querySelectorAll(
              'textarea, [contenteditable="true"], [role="textbox"]'
            )]
              .filter(visible)
              .filter((element) => !/搜索|search/i.test(normalize([
                element.getAttribute('aria-label'),
                element.getAttribute('placeholder'),
                element.getAttribute('data-testid'),
                typeof element.className === 'string' ? element.className : '',
              ].filter(Boolean).join(' '))))
              .sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0];
            const composerText = liveComposer instanceof HTMLTextAreaElement || liveComposer instanceof HTMLInputElement
              ? liveComposer.value
              : liveComposer?.textContent || '';
            const sentPrompt = canonicalizeReceiptText(prompt);
            const draftStillPresent = Boolean(sentPrompt) &&
              canonicalizeReceiptText(composerText).includes(sentPrompt);
            if (!draftStillPresent) return false;

            const pageText = document.body?.innerText || document.body?.textContent || '';
            if (/停止生成|停止回答|stop generating/i.test(pageText)) return false;
            if (document.querySelector('[data-streaming="true"]')) return false;

            const receiptRows = [...document.querySelectorAll(
              '.bg-g-send-msg-bubble-bg, [data-message-author-role="user"], [data-role="user"], [data-message-id], [data-observe-row^="block_"]'
            )].filter(visible);
            if (receiptRows.some((element) =>
              canonicalizeReceiptText(element.innerText || element.textContent).includes(sentPrompt)
            )) return false;

            const bodyClone = document.body?.cloneNode(true);
            bodyClone?.querySelectorAll?.('textarea, [contenteditable="true"], [role="textbox"]').forEach((element) => element.remove());
            if (canonicalizeReceiptText(bodyClone?.innerText || bodyClone?.textContent || '').includes(sentPrompt)) return false;

            const send = document.querySelector(
              '[data-agents-one-submit-target="true"], #flow-end-msg-send, [data-testid="flow-end-msg-send"], [data-testid="message-send"]'
            );
            if (!send || !visible(send) || send.hasAttribute('disabled') || send.getAttribute('aria-disabled') === 'true') return false;
            liveComposer?.focus();
            send.click();
            return true;
          })()
        `);
        if (safeSubmitFallbackUsed) {
          await page.sleep(300);
          continue;
        }
      }
      await page.sleep(150);
    }
    if (!evidence) {
      const workUnavailable = await page.evaluate<boolean>(`
        (() => {
          const text = document.body?.innerText || document.body?.textContent || '';
          const pattern = new RegExp(${JSON.stringify(WORK_MODE_UNAVAILABLE_PATTERN.source)}, 'i');
          return pattern.test(text) && /工作|work/i.test(text);
        })()
      `);
      if (workUnavailable) {
        throw new Error(
          "WEB_WORK_MODE_UNAVAILABLE: 豆包工作模式额度或次数不可用。",
        );
      }
      throw new Error(
        "WEB_SUBMISSION_UNCONFIRMED: 网页没有提供可验证的提交回执。",
      );
    }
    return {
      id: `submission-${Date.now()}-${webAgentTextHash(prompt)}`,
      createdAt: Date.now(),
      promptHash: webAgentTextHash(prompt),
    };
  }

  async readResponse(page: WebAgentPage): Promise<WebAgentResponseSnapshot> {
    const raw = await page.evaluate<{
      text: string;
      hasAssistantMessage: boolean;
      isGenerating: boolean;
      hasUploadInProgress: boolean;
      hasError: boolean;
      errorCode: "rate_limited" | "provider_error" | null;
    }>(`
      (() => {
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const candidates = [
          ...document.querySelectorAll('[data-message-author-role="assistant"], [data-role="assistant"], [data-testid*="assistant"], .assistant-message'),
          // Current Doubao chat messages expose only a data-message-id. User
          // bubbles carry the stable send-bubble class, while assistant rows
          // contain the generated answer and thinking blocks.
          ...[...document.querySelectorAll('[data-message-id]')]
            .filter((element) =>
              !element.querySelector('.bg-g-send-msg-bubble-bg') &&
              !element.matches?.('[data-message-author-role="user"], [data-role="user"]') &&
              !/(?:^|\\s)justify-end(?:\\s|$)/.test(String(element.className || ''))
            ),
        ]
          .filter((element, index, all) => all.indexOf(element) === index)
          .filter(visible);
        const thinkingSelector = [
          '[data-plugin-identifier*="block_type:10040"]',
          '[data-plugin-identifier*="thinking_block"]',
          '[class*="thinking-box-root"]',
        ].join(',');
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const markdownText = (root) => {
          const renderChildren = (node, context) =>
            [...(node.childNodes || [])]
              .map((child) => renderNode(child, context))
              .join('');
          const inline = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
          const renderList = (element, ordered, context) => {
            const depth = context.listDepth || 0;
            const items = [...element.children].filter(
              (child) => String(child.tagName || '').toLowerCase() === 'li'
            );
            // ChatGPT splits long ordered lists into multiple <ol> nodes and
            // annotates continuation segments with the HTML start attribute
            // (for example, start="3", start="4", ...). Respect that
            // attribute instead of restarting every segment at 1. Do not use
            // data-start here: ChatGPT uses it as a character offset, not a
            // list ordinal.
            const parsedStart = ordered
              ? Number.parseInt(String(element.getAttribute?.('start') || ''), 10)
              : NaN;
            const start = Number.isFinite(parsedStart) && parsedStart > 0
              ? parsedStart
              : 1;
            return '\\n\\n' + items.map((item, index) => {
              const nested = [];
              const own = [...item.childNodes].map((child) => {
                const tag = child.nodeType === 1
                  ? String(child.tagName || '').toLowerCase()
                  : '';
                if (tag === 'ul' || tag === 'ol') {
                  nested.push(renderNode(child, { listDepth: depth + 1 }));
                  return '';
                }
                return renderNode(child, { listDepth: depth });
              }).join('');
              const prefix = ordered ? String(start + index) + '. ' : '- ';
              const line = '  '.repeat(depth) + prefix + inline(own);
              return line + (nested.length ? '\\n' + nested.join('').trim() : '');
            }).join('\\n') + '\\n\\n';
          };
          const renderNode = (node, context = { listDepth: 0 }) => {
            if (!node) return '';
            if (node.nodeType === 3) {
              return String(node.nodeValue || '')
                .replace(/\\r\\n?/g, '\\n')
                .replace(/[\\t \\u00a0]+/g, ' ');
            }
            if (node.nodeType !== 1) return '';
            const element = node;
            const tag = String(element.tagName || '').toLowerCase();
            const style = window.getComputedStyle?.(element);
            if (
              ['script', 'style', 'noscript', 'template', 'svg', 'button'].includes(tag) ||
              element.hidden ||
              element.getAttribute?.('aria-hidden') === 'true' ||
              style?.display === 'none' ||
              style?.visibility === 'hidden'
            ) return '';
            if (tag === 'br') return '\\n';
            if (/^h[1-6]$/.test(tag)) {
              return '\\n\\n' + '#'.repeat(Number(tag.slice(1))) + ' ' +
                inline(renderChildren(element, context)) + '\\n\\n';
            }
            if (tag === 'p') {
              return '\\n\\n' + inline(renderChildren(element, context)) + '\\n\\n';
            }
            if (tag === 'ul') return renderList(element, false, context);
            if (tag === 'ol') return renderList(element, true, context);
            if (tag === 'strong' || tag === 'b') {
              const value = inline(renderChildren(element, context));
              return value ? '**' + value + '**' : '';
            }
            if (tag === 'em' || tag === 'i') {
              const value = inline(renderChildren(element, context));
              return value ? '*' + value + '*' : '';
            }
            if (tag === 'del' || tag === 's') {
              const value = inline(renderChildren(element, context));
              return value ? '~~' + value + '~~' : '';
            }
            if (tag === 'pre') {
              const value = String(element.innerText || element.textContent || '').trim();
              return value ? '\\n\\n~~~\\n' + value + '\\n~~~\\n\\n' : '';
            }
            if (tag === 'code') {
              const value = inline(element.innerText || element.textContent || '');
              const tick = String.fromCharCode(96);
              return value ? tick + value + tick : '';
            }
            if (tag === 'blockquote') {
              const value = inline(renderChildren(element, context));
              return value
                ? '\\n\\n' + value.split('\\n').map((line) => '> ' + line).join('\\n') + '\\n\\n'
                : '';
            }
            if (tag === 'a') {
              const label = inline(renderChildren(element, context));
              const href = String(element.getAttribute?.('href') || '').trim();
              return label && /^(?:https?:|mailto:)/i.test(href)
                ? '[' + label + '](' + href.replace(/\\s/g, '%20') + ')'
                : label;
            }
            if (['div', 'section', 'article', 'main'].includes(tag)) {
              const value = renderChildren(element, context);
              return value ? '\\n' + value + '\\n' : '';
            }
            return renderChildren(element, context);
          };
          return renderNode(root)
            .replace(/\\r/g, '')
            .replace(/[ \\t]+\\n/g, '\\n')
            .replace(/\\n[ \\t]+/g, '\\n')
            .replace(/\\n{3,}/g, '\\n\\n')
            .trim();
        };
        const responseText = (element) => {
          if (!element) return '';
          // Doubao currently renders the final Markdown answer as a sibling
          // block_type:10000 node next to the block_type:10040 thinking
          // node. Prefer that explicit answer block so a transient thinking
          // fragment can never be published as the task output.
          const answerBlocks = [...element.querySelectorAll(
            '[data-plugin-identifier*="block_type:10000"]'
          )];
          if (answerBlocks.length) {
            const thinkingBlocks = [...element.querySelectorAll(thinkingSelector)];
            // Work mode may first mount a short 10000 progress/status block
            // (for example, “我先读取……”) before its thinking block and the
            // actual answer. Until a 10000 block appears after the latest
            // thinking block, the row is still in progress. Once it does,
            // return only those post-thinking answer blocks so the status
            // sentence is not mistaken for the task's final response.
            const latestThinking = thinkingBlocks.at(-1);
            const finalAnswerBlocks = latestThinking
              ? answerBlocks.filter((block) => Boolean(
                latestThinking.compareDocumentPosition(block) &
                Node.DOCUMENT_POSITION_FOLLOWING,
              ))
              : answerBlocks;
            if (latestThinking && !finalAnswerBlocks.length) return '';
            return finalAnswerBlocks
              .map((node) => markdownText(node))
              .join('\\n');
          }
          // Current Doubao rows may briefly expose raw reasoning text before
          // React assigns the thinking/answer plugin identifiers. Treat an
          // untyped data-message-id row as progress, never as a completed
          // reply. Legacy semantic assistant containers keep the fallback.
          // A few providers (notably ChatGPT) expose both the semantic
          // assistant role and a data-message-id on the same row.  The
          // data-message-id-only guard is intended for Doubao's untyped
          // transient rows; never discard a row whose role is explicit.
          const hasSemanticAssistantRole = Boolean(element.matches?.(
            '[data-message-author-role="assistant"], [data-role="assistant"], [data-testid*="assistant"], .assistant-message'
          ));
          if (element.hasAttribute?.('data-message-id') && !hasSemanticAssistantRole) return '';
          const clone = element.cloneNode(true);
          clone.querySelectorAll?.(thinkingSelector).forEach((node) => node.remove());
          return markdownText(clone);
        };
        // Keep the newest row even when it is a thinking-only row. Otherwise
        // a prior answer would be mistaken for the response to the new prompt.
        const last = candidates.at(-1);
        const text = responseText(last);
        const hasThinkingBlock = Boolean(last?.querySelector?.(thinkingSelector));
        const isModernMessageRow = Boolean(last?.hasAttribute?.('data-message-id'));
        const hasSemanticAssistantRole = Boolean(last?.matches?.(
          '[data-message-author-role="assistant"], [data-role="assistant"], [data-testid*="assistant"], .assistant-message'
        ));
        const hasExplicitAnswerBlock = Boolean(last?.querySelector?.(
          '[data-plugin-identifier*="block_type:10000"]'
        ));
        const answerBlocks = last
          ? [...last.querySelectorAll('[data-plugin-identifier*="block_type:10000"]')]
          : [];
        const thinkingBlocks = last
          ? [...last.querySelectorAll(thinkingSelector)]
          : [];
        const latestThinking = thinkingBlocks.at(-1);
        const hasAnswerAfterThinking = Boolean(latestThinking) && answerBlocks.some((block) =>
          Boolean(latestThinking.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
        const hasConcreteAnswer = Boolean(normalize(text));
        const pageText = document.body?.innerText || document.body?.textContent || '';
        const hasStreamingMarker = Boolean(document.querySelector('[data-streaming="true"]'));
        return {
          text,
          // A collapsed “已思考” block is progress, not a final assistant
          // answer. Wait until Doubao mounts concrete answer content.
          hasAssistantMessage: Boolean(last) && hasConcreteAnswer,
          isGenerating: hasStreamingMarker ||
            /停止生成|停止回答|生成中|正在思考|stop generating/i.test(pageText) ||
            (hasThinkingBlock && !hasConcreteAnswer) ||
            (isModernMessageRow && !hasSemanticAssistantRole &&
              (!hasExplicitAnswerBlock || (hasThinkingBlock && !hasAnswerAfterThinking))),
          hasUploadInProgress: /上传中|正在上传|uploading/i.test(pageText),
          hasError: /请求失败|生成失败|网络异常|稍后重试|rate limit|too many requests/i.test(pageText),
          errorCode: /rate limit|too many requests|请求过于频繁|请求受限/i.test(pageText)
            ? 'rate_limited'
            : /请求失败|生成失败|网络异常|稍后重试/i.test(pageText)
              ? 'provider_error'
              : null,
        };
      })()
    `);
    // A few Work-mode responses have leaked an internal planning fragment
    // into the rendered 10000 block (usually wrapped in <think>...</think>).
    // Never expose that provider-internal text to Agents One users. Handle an
    // unterminated opening tag as well because streamed DOM can be observed
    // between the tag and its closing counterpart.
    const text = normalizeWebAgentResponseText(raw.text)
      .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
      .replace(/<think\b[^>]*>[\s\S]*$/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return {
      ...raw,
      text,
      hash: webAgentTextHash(text),
      observedAt: Date.now(),
    };
  }

  async cancel(page: WebAgentPage): Promise<boolean> {
    const marked = await page.evaluate<boolean>(`
      (() => {
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const stop = [...document.querySelectorAll('button, [role="button"]')]
          .find((element) => visible(element) && /停止生成|停止回答|stop generating/i.test((element.getAttribute('aria-label') || element.textContent || '').trim()));
        if (!stop) return false;
        document.querySelectorAll('[data-agents-one-stop-target="true"]').forEach((element) =>
          element.removeAttribute('data-agents-one-stop-target')
        );
        stop.setAttribute('data-agents-one-stop-target', 'true');
        return true;
      })()
    `);
    if (!marked) return false;
    if (page.click) {
      try {
        await page.click('[data-agents-one-stop-target="true"]');
      } catch {
        return false;
      }
    } else {
      await page.evaluate<boolean>(`
        (() => {
          const stop = document.querySelector('[data-agents-one-stop-target="true"]');
          if (!stop) return false;
          stop.click();
          return true;
        })()
      `);
    }
    return true;
  }

  /**
   * Only activate explicit download controls inside the newest assistant
   * message. This never follows generic links or navigates the page.
   */
  async collectDownloads(page: WebAgentPage): Promise<number> {
    return page.evaluate<number>(`
      (() => {
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const container = [
          ...document.querySelectorAll('[data-message-author-role="assistant"], [data-role="assistant"], [data-testid*="assistant"], .assistant-message'),
          ...[...document.querySelectorAll('[data-message-id]')]
            .filter((element) =>
              !element.querySelector('.bg-g-send-msg-bubble-bg') &&
              !element.matches?.('[data-message-author-role="user"], [data-role="user"]') &&
              !/(?:^|\\s)justify-end(?:\\s|$)/.test(String(element.className || ''))
            ),
        ]
          .filter((element, index, all) => all.indexOf(element) === index)
          .filter(visible)
          .at(-1);
        if (!container) return 0;
        const controls = [...container.querySelectorAll('a[download], button, [role="button"]')]
          .filter((element) => {
            if (!visible(element)) return false;
            if (element instanceof HTMLAnchorElement && element.hasAttribute('download')) return true;
            const label = (element.getAttribute('aria-label') || element.textContent || '').trim();
            return /^(?:下载|下载文件|download)$/i.test(label);
          });
        for (const control of controls) control.click();
        return controls.length;
      })()
    `);
  }
}
