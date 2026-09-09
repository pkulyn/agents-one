import type {
  WebAgentConversationRef,
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
      return { state: "verification_required", message: "ChatGPT 要求完成验证码或安全验证。" };
    }
    if (snapshot.hasLogin) {
      return { state: "login_required", message: "请在应用内登录 ChatGPT。" };
    }
    return { state: "unsupported", message: "未能安全识别 ChatGPT 聊天输入框。" };
  }

  override async ensureChatReady(page: WebAgentPage): Promise<DoubaoLoginProbe> {
    // OAuth temporarily moves the same isolated window to auth.openai.com or
    // an identity provider. Preserve that page while the user is signing in;
    // navigating back to chatgpt.com here would reset the login form/spinner.
    if (!isAllowedWebAgentNavigationUrl("chatgpt", page.url())) {
      await page.navigate(this.chatUrl);
    }
    let result = await this.probeLogin(page);
    for (let attempt = 0; result.state === "unsupported" && attempt < 24; attempt += 1) {
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
        const labels = [...document.querySelectorAll('button, [role="tab"], [role="button"], div, span')]
          .filter(visible)
          .map((element) => ({ element, label: normalize(element.textContent || element.getAttribute('aria-label')) }))
          .filter(({ label }) => /^(?:聊天|工作|对话|chat|work)$/i.test(label));
        const active = labels.find(({ element }) =>
          element.getAttribute('aria-selected') === 'true' || element.getAttribute('data-state') === 'active' ||
          element.getAttribute('data-state') === 'on' ||
          element.getAttribute('aria-checked') === 'true' ||
          element.getAttribute('data-active') === 'true' || /selected|active/i.test(String(element.className || ''))
        );
        const activeLabel = active?.label || '';
        const body = normalize(document.body?.innerText || document.body?.textContent || '');
        const mode = /^(?:工作|work)$/i.test(activeLabel) ? 'work' :
          /^(?:聊天|对话|chat)$/i.test(activeLabel) ? 'chat' :
          /处理任何事务|chatgpt work|工作模式/i.test(body) ? 'work' :
          /消息|ask anything|有什么可以帮忙/i.test(body) ? 'chat' : 'unknown';
        const workUnavailable = /工作.{0,80}(?:额度|次数|上限|不可用|受限|限制)|(?:额度|次数|上限).{0,80}工作|work.{0,80}(?:quota|limit|unavailable|exhausted)|切换到聊天|switch to chat/i.test(body);
        return { mode, workUnavailable, ...(workUnavailable ? { reason: 'ChatGPT 工作模式额度或次数暂不可用。' } : {}) };
      })()
    `);
  }

  override async ensureMode(page: WebAgentPage, preferred: Exclude<"chat" | "work", never> = "work"): Promise<DoubaoModeSelection> {
    let state = await this.modeState(page);
    for (let attempt = 0; state.mode === "unknown" && attempt < 12; attempt += 1) {
      await page.sleep(250);
      state = await this.modeState(page);
    }
    if (preferred === "work" && state.mode === "work" && !state.workUnavailable) return { ...state, fallbackUsed: false };
    if (preferred === "chat" && state.mode === "chat") return { ...state, fallbackUsed: false };
    const clicked = await page.evaluate<boolean>(`((target) => {
      const visible = (element) => { const s = window.getComputedStyle(element); const r = element.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
      const labels = [...document.querySelectorAll('button, [role="tab"], [role="button"], div, span')].filter(visible);
      const label = labels.find((element) => new RegExp(target === 'work' ? '^(?:工作|work)$' : '^(?:聊天|对话|chat)$', 'i').test(String(element.textContent || element.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim()));
      const targetElement = label?.closest('button, [role="tab"], [role="button"], a') || label;
      if (!targetElement) return false;
      targetElement.click(); return true;
    })(${JSON.stringify(preferred)})`);
    if (clicked) {
      for (let attempt = 0; attempt < 16; attempt += 1) {
        await page.sleep(250);
        state = await this.modeState(page);
        if (preferred === "work" && state.mode === "work" && !state.workUnavailable) return { ...state, fallbackUsed: false };
        if (preferred === "chat" && state.mode === "chat") return { ...state, fallbackUsed: false };
        if (preferred === "work" && state.workUnavailable) break;
      }
    }
    if (preferred === "work" && state.workUnavailable) {
      const chat = await this.ensureMode(page, "chat");
      return { ...chat, fallbackUsed: true };
    }
    if (preferred === "work") throw new Error("WEB_PAGE_UNSUPPORTED: 未能确认 ChatGPT 已切换到工作模式。");
    return { ...state, fallbackUsed: false };
  }

  override async createConversation(page: WebAgentPage): Promise<WebAgentConversationRef> {
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

  override async resumeConversation(page: WebAgentPage, ref: WebAgentConversationRef): Promise<void> {
    if (ref.url && page.url() !== ref.url) await page.navigate(ref.url);
    const probe = await this.probeLogin(page);
    if (probe.state !== "ready") throw new Error(probe.message);
  }

  override async uploadFiles(page: WebAgentPage, files: WebAgentStagedFile[]): Promise<void> {
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
      if (!found) throw new Error("WEB_UPLOAD_REJECTED: 未找到 ChatGPT 文件上传入口。");
      await page.setInputFiles('input[data-agents-one-upload-target="true"]', files.map((file) => file.path));
    }
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const status = await page.evaluate<{ uploading: boolean; error: boolean; evidence: boolean }>(`
        (() => {
          const text = String(document.body?.innerText || document.body?.textContent || '');
          return { uploading: /uploading|上传中|正在上传/i.test(text), error: /upload failed|上传失败|无法上传|file too large/i.test(text), evidence: Boolean(document.querySelector('[data-testid*="file"], [data-testid*="attachment"], [data-file-name]')) };
        })()
      `);
      if (status.error) throw new Error("WEB_UPLOAD_REJECTED: ChatGPT 拒绝了附件上传。");
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
        throw new Error("WEB_WORK_MODE_UNAVAILABLE: ChatGPT 工作模式额度或次数不可用。");
      }
      throw error;
    }
  }
}
