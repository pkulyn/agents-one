import type {
  WebAgentConversationRef,
  WebAgentResponseSnapshot,
  WebAgentStagedFile,
  WebAgentSubmissionReceipt,
} from "../../../shared/web-agent";
import {
  DoubaoProviderAdapter,
  type DoubaoLoginProbe,
  type DoubaoModeState,
  type DoubaoModeSelection,
  type WebAgentPage,
} from "./doubao";
import { isAllowedWebAgentNavigationUrl } from "../../../shared/web-agent";

/**
 * ChatGPT's web UI intentionally shares the same high-level composer contract
 * as Doubao (contenteditable/textarea, visible mode tabs and file inputs), so
 * the proven submission/response pipeline is reused.  This adapter only
 * overrides provider-specific navigation, mode detection and upload probes.
 */
export class ChatGPTProviderAdapter extends DoubaoProviderAdapter {
  override readonly provider = "chatgpt" as const;
  override readonly chatUrl = "https://chatgpt.com/";
  private retriedFullPageError = false;
  private fullPageRetryStartedAt = 0;

  override async readResponse(
    page: WebAgentPage,
  ): Promise<WebAgentResponseSnapshot> {
    const waitingSnapshot = (): WebAgentResponseSnapshot => ({
      text: "",
      hash: "",
      hasAssistantMessage: false,
      isGenerating: true,
      hasUploadInProgress: false,
      hasError: false,
      observedAt: Date.now(),
    });
    let errorPage: "none" | "retrying" | "failed";
    try {
      errorPage = await page.evaluate<typeof errorPage>(`
      (() => {
        const body = String(document.body?.innerText || document.body?.textContent || '').trim();
        if (!/^(?:ChatGPT 遇到了问题|ChatGPT has encountered a problem)/i.test(body) ||
            !/(?:出了点问题。请重试以继续|something went wrong)/i.test(body) ||
            document.querySelector('textarea, [contenteditable="true"]')) return 'none';
        const retry = [...document.querySelectorAll('button')].find((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && /^(?:重试|retry)$/i.test(String(button.innerText || button.textContent || '').trim());
        });
        if (!retry || ${this.retriedFullPageError}) return 'failed';
        retry.click();
        return 'retrying';
      })()
    `);
    } catch (error) {
      // A retry navigates the page and can briefly destroy its JS context.
      if (
        this.fullPageRetryStartedAt &&
        Date.now() - this.fullPageRetryStartedAt < 10_000
      )
        return waitingSnapshot();
      throw error;
    }
    if (errorPage === "retrying") {
      this.retriedFullPageError = true;
      this.fullPageRetryStartedAt = Date.now();
      // The retry reloads an existing conversation; never submit the prompt again.
      return waitingSnapshot();
    }
    if (errorPage === "failed") {
      if (
        this.fullPageRetryStartedAt &&
        Date.now() - this.fullPageRetryStartedAt < 10_000
      )
        return waitingSnapshot();
      return {
        text: "",
        hash: "",
        hasAssistantMessage: false,
        isGenerating: false,
        hasUploadInProgress: false,
        hasError: true,
        errorCode: "provider_error",
        observedAt: Date.now(),
      };
    }
    const snapshot = await super.readResponse(page);
    if (!snapshot.hasAssistantMessage || snapshot.hasError) return snapshot;
    const completion = await page.evaluate<{
      modernAnswer: boolean;
      completed: boolean;
    }>(`
      (() => {
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const modernAnswer = [...document.querySelectorAll('[data-markdown-text-style="assistant-message"]')].some(visible);
        const status = [...document.querySelectorAll('[role="status"][aria-live="polite"]')]
          .map((element) => String(element.textContent || '').trim())
          .filter(Boolean).at(-1) || '';
        return {
          modernAnswer,
          completed: /^(?:回答已完成|response completed?|answer completed?)$/i.test(status),
        };
      })()
    `);
    // Modern ChatGPT can pause after a provisional sentence while tools work.
    // Its accessibility status is the completion receipt, not text stability.
    return completion.modernAnswer && !completion.completed
      ? { ...snapshot, isGenerating: true }
      : snapshot;
  }

  override async probeLogin(page: WebAgentPage): Promise<DoubaoLoginProbe> {
    const snapshot = await page.evaluate<{
      hasComposer: boolean;
      hasLogin: boolean;
      hasVerification: boolean;
    }>(`
      (() => {
        const text = String(document.body?.innerText || document.body?.textContent || '').toLowerCase();
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const composer = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].find(visible);
        return {
          hasComposer: Boolean(composer),
          hasLogin: /log\\s*in|sign\\s*in|登录|登入|输入您的密码|使用.+账号/.test(text),
          hasVerification: /captcha|verification|验证码|安全验证|人机验证/.test(text),
        };
      })()
    `);
    if (snapshot.hasComposer) return { state: "ready" };
    if (snapshot.hasVerification) {
      return {
        state: "verification_required",
        message: "ChatGPT 要求完成验证码或安全验证。",
      };
    }
    if (snapshot.hasLogin) {
      return { state: "login_required", message: "请在应用内登录 ChatGPT。" };
    }
    return {
      state: "unsupported",
      message: "未能安全识别 ChatGPT 聊天输入框。",
    };
  }

  override async ensureChatReady(
    page: WebAgentPage,
  ): Promise<DoubaoLoginProbe> {
    // OAuth temporarily moves the same isolated window to auth.openai.com or
    // an identity provider. Preserve that page while the user is signing in;
    // navigating back to chatgpt.com here would reset the login form/spinner.
    if (!isAllowedWebAgentNavigationUrl("chatgpt", page.url())) {
      await page.navigate(this.chatUrl);
    }
    let result = await this.probeLogin(page);
    // Login redirects can finish before ChatGPT hydrates its composer. Keep
    // polling the same isolated page before declaring the UI unsupported.
    for (
      let attempt = 0;
      result.state === "unsupported" && attempt < 120;
      attempt += 1
    ) {
      await page.sleep(250);
      result = await this.probeLogin(page);
    }
    return result;
  }

  override async modeState(page: WebAgentPage): Promise<DoubaoModeState> {
    return page.evaluate<DoubaoModeState>(`
      (() => {
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const controlFor = (element) => element.closest('button, [role="tab"], [role="radio"], [role="button"], a, label') || element;
        const candidates = [...document.querySelectorAll('button, [role="tab"], [role="radio"], [role="button"], a, label, span')]
          .filter(visible)
          .map((element) => ({
            element,
            control: controlFor(element),
            label: normalize(element.getAttribute('aria-label') || element.textContent),
          }))
          .filter(({ label, control }) => /^(?:聊天|工作|对话|chat|work)$/i.test(label) &&
            control.matches('button, [role="tab"], [role="radio"], [role="button"], a, label') && visible(control));
        const modeOf = (label) => /^(?:工作|work)$/i.test(label) ? 'work' : 'chat';
        const groupFor = (control) => control.closest('[role="tablist"], [role="radiogroup"], [role="group"]') || control.parentElement;
        const labels = candidates.filter(({ control, label }) => candidates.some((other) =>
          groupFor(control) && groupFor(control) === groupFor(other.control) && modeOf(label) !== modeOf(other.label)
        ));
        const isActive = (element) => element && (
          element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-pressed') === 'true' ||
          element.getAttribute('aria-checked') === 'true' || /^(?:page|true)$/.test(element.getAttribute('aria-current') || '') ||
          /^(?:active|on|checked)$/.test(element.getAttribute('data-state') || '') ||
          element.getAttribute('data-active') === 'true' ||
          element.matches('input:checked') || Boolean(element.querySelector('input:checked')) ||
          /(?:^|[\\s_-])(?:selected|active)(?:$|[\\s_-])/i.test(String(element.className || ''))
        );
        const activeModes = [...new Set(labels
          .filter(({ element, control }) => isActive(element) || isActive(control))
          .map(({ label }) => modeOf(label)))];
        const body = normalize(document.body?.innerText || document.body?.textContent || '');
        const mode = activeModes.length === 1 ? activeModes[0] : 'unknown';
        const workUnavailable = /工作.{0,80}(?:额度|次数|上限|不可用|受限|限制)|(?:额度|次数|上限).{0,80}工作|work.{0,80}(?:quota|limit|unavailable|exhausted)|切换到聊天|switch to chat/i.test(body);
        return { mode, workUnavailable, ...(workUnavailable ? { reason: 'ChatGPT 工作模式额度或次数暂不可用。' } : {}) };
      })()
    `);
  }

  override async ensureMode(
    page: WebAgentPage,
    preferred: Exclude<"chat" | "work", never> = "work",
  ): Promise<DoubaoModeSelection> {
    let state = await this.modeState(page);
    for (
      let attempt = 0;
      state.mode === "unknown" && attempt < 12;
      attempt += 1
    ) {
      await page.sleep(250);
      state = await this.modeState(page);
    }
    if (preferred === "work" && state.mode === "work" && !state.workUnavailable)
      return { ...state, fallbackUsed: false };
    if (preferred === "chat" && state.mode === "chat")
      return { ...state, fallbackUsed: false };
    const clicked = await page.evaluate<boolean>(`((target) => {
      const visible = (element) => { const s = window.getComputedStyle(element); const r = element.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const controls = [...document.querySelectorAll('button, [role="tab"], [role="radio"], [role="button"], a, label, span')]
        .filter(visible)
        .map((element) => ({ element, control: element.closest('button, [role="tab"], [role="radio"], [role="button"], a, label'), label: normalize(element.getAttribute('aria-label') || element.textContent) }))
        .filter(({ control, label }) => control && visible(control) && /^(?:聊天|工作|对话|chat|work)$/i.test(label));
      const modeOf = (label) => /^(?:工作|work)$/i.test(label) ? 'work' : 'chat';
      const groupFor = (control) => control.closest('[role="tablist"], [role="radiogroup"], [role="group"]') || control.parentElement;
      const candidate = controls.find(({ control, label }) => modeOf(label) === target && controls.some((other) =>
        groupFor(control) && groupFor(control) === groupFor(other.control) && modeOf(label) !== modeOf(other.label)
      ));
      const targetElement = candidate?.control;
      if (!targetElement) return false;
      targetElement.click(); return true;
    })(${JSON.stringify(preferred)})`);
    if (clicked) {
      for (let attempt = 0; attempt < 16; attempt += 1) {
        await page.sleep(250);
        state = await this.modeState(page);
        if (
          preferred === "work" &&
          state.mode === "work" &&
          !state.workUnavailable
        )
          return { ...state, fallbackUsed: false };
        if (preferred === "chat" && state.mode === "chat")
          return { ...state, fallbackUsed: false };
        if (preferred === "work" && state.workUnavailable) break;
      }
    }
    if (preferred === "work" && state.workUnavailable) {
      const chat = await this.ensureMode(page, "chat");
      return { ...chat, fallbackUsed: true };
    }
    if (preferred === "work")
      throw new Error(
        "WEB_PAGE_UNSUPPORTED: 未能确认 ChatGPT 已切换到工作模式。",
      );
    throw new Error(
      "WEB_PAGE_UNSUPPORTED: 未能确认 ChatGPT 已切换到对话模式。",
    );
  }

  override async createConversation(
    page: WebAgentPage,
  ): Promise<WebAgentConversationRef> {
    // Navigating to the root is deterministic and preserves the isolated login
    // partition; ChatGPT creates a concrete /c/{id} URL after the first send.
    await page.navigate(this.chatUrl);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const ready = await this.probeLogin(page);
      if (ready.state === "ready") {
        // ChatGPT mounts the composer before the Work/Chat radio group. Wait
        // for the mode control as well so ensureMode does not click a
        // not-yet-hydrated placeholder and report a false unsupported state.
        const mode = await this.modeState(page);
        if (mode.mode !== "unknown") break;
      }
      await page.sleep(250);
    }
    return { url: page.url(), opaqueId: page.url() };
  }

  override async resumeConversation(
    page: WebAgentPage,
    ref: WebAgentConversationRef,
  ): Promise<void> {
    if (ref.url && page.url() !== ref.url) await page.navigate(ref.url);
    const probe = await this.probeLogin(page);
    if (probe.state !== "ready") throw new Error(probe.message);
  }

  override async uploadFiles(
    page: WebAgentPage,
    files: WebAgentStagedFile[],
  ): Promise<void> {
    if (!files.length) return;
    if (page.dropFiles) {
      await page.dropFiles(files.map((file) => file.path));
    } else {
      const found = await page.evaluate<boolean>(`
        (() => {
          const visible = (element) => { const s = window.getComputedStyle(element); const r = element.getBoundingClientRect(); return !element.disabled && s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
          const input = [...document.querySelectorAll('input[type="file"]')].find((element) => !element.disabled) || document.querySelector('input[type="file"]');
          if (!input) return false;
          input.setAttribute('data-agents-one-upload-target', 'true');
          return visible(input) || Boolean(input);
        })()
      `);
      if (!found)
        throw new Error("WEB_UPLOAD_REJECTED: 未找到 ChatGPT 文件上传入口。");
      await page.setInputFiles(
        'input[data-agents-one-upload-target="true"]',
        files.map((file) => file.path),
      );
    }
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const status = await page.evaluate<{
        uploading: boolean;
        error: boolean;
        evidence: boolean;
      }>(`
        (() => {
          const text = String(document.body?.innerText || document.body?.textContent || '');
          return { uploading: /uploading|上传中|正在上传/i.test(text), error: /upload failed|上传失败|无法上传|file too large/i.test(text), evidence: Boolean(document.querySelector('[data-testid*="file"], [data-testid*="attachment"], [data-file-name]')) };
        })()
      `);
      if (status.error)
        throw new Error("WEB_UPLOAD_REJECTED: ChatGPT 拒绝了附件上传。");
      if (status.evidence && !status.uploading) return;
      await page.sleep(300);
    }
    throw new Error("WEB_UPLOAD_REJECTED: 未能确认 ChatGPT 已接收附件。");
  }

  override async sendPrompt(
    page: WebAgentPage,
    prompt: string,
  ): Promise<WebAgentSubmissionReceipt> {
    try {
      return await super.sendPrompt(page, prompt);
    } catch (error) {
      // ChatGPT may reveal a Work quota notice only after the submit click.
      // Re-check the structured mode state so the controller can perform its
      // single Chat fallback instead of surfacing a misleading receipt error.
      const state = await this.modeState(page);
      if (state.workUnavailable) {
        throw new Error(
          "WEB_WORK_MODE_UNAVAILABLE: ChatGPT 工作模式额度或次数不可用。",
        );
      }
      throw error;
    }
  }
}
