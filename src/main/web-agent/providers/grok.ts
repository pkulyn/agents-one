import type {
  WebAgentConversationRef,
  WebAgentResponseSnapshot,
  WebAgentStagedFile,
} from "../../../shared/web-agent";
import {
  isAllowedWebAgentNavigationUrl,
  isAllowedWebAgentUrl,
} from "../../../shared/web-agent";
import {
  DoubaoProviderAdapter,
  type DoubaoLoginProbe,
  type DoubaoModeSelection,
  type DoubaoModeState,
  type WebAgentPage,
} from "./doubao";

/**
 * Grok exposes stable composer/message test IDs but has no ChatGPT-style
 * Work/Chat switch. The shared browser pipeline remains responsible for
 * verified submission receipts, Markdown extraction and safe downloads.
 *
 * @lat: [[web-agent-runtime#Grok adapter]]
 */
export class GrokProviderAdapter extends DoubaoProviderAdapter {
  override readonly provider = "grok" as const;
  override readonly chatUrl = "https://grok.com/";
  override readonly preferredMode = "chat" as const;

  override async probeLogin(page: WebAgentPage): Promise<DoubaoLoginProbe> {
    const currentUrl = page.url();
    const snapshot = await page.evaluate<{
      hasComposer: boolean;
      hasLogin: boolean;
      hasVerification: boolean;
      googleOAuthBlocked: boolean;
    }>(`
      (() => {
        const text = String(document.body?.innerText || document.body?.textContent || '');
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const controls = [...document.querySelectorAll('button, a, [role="button"]')]
          .filter(visible)
          .map((element) => String(element.textContent || element.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim());
        const hasLoginControl = controls.some((label) => /^(?:sign in|sign up|log in|登录|注册)$/i.test(label));
        const googleOAuthBlocked = /accounts\\.google\\.com\\//i.test(location.href) &&
          /无法登录|浏览器或应用可能不安全|this browser or app may not be secure|try using a different browser/i.test(text);
        const composer = [...document.querySelectorAll('textarea[aria-label="Ask Grok anything"], textarea, [contenteditable="true"], [role="textbox"]')]
          .find((element) => visible(element) && !/search|搜索/i.test([
            element.getAttribute('aria-label'),
            element.getAttribute('placeholder'),
          ].filter(Boolean).join(' ')));
        return {
          hasComposer: Boolean(composer),
          // The anonymous landing page intentionally exposes a composer, but
          // submitting there ends at a sign-up wall instead of an assistant
          // response. Login controls therefore take precedence over it.
          hasLogin: hasLoginControl || /sign in to (?:xai|grok)|登录.+grok|登录.+xai/i.test(text),
          hasVerification: /captcha|turnstile|verification|verify you are human|security check|验证码|验证失败|安全验证|人机验证|sorry, you have been blocked|cloudflare ray id/i.test(text),
          googleOAuthBlocked,
        };
      })()
    `);
    if (snapshot.hasVerification) {
      return {
        state: "verification_required",
        message: "Grok 要求完成验证码或安全验证。",
      };
    }
    if (snapshot.googleOAuthBlocked) {
      return {
        state: "login_required",
        message:
          "Google 登录不支持在当前内嵌窗口完成，请返回 Grok 选择邮箱或 X 登录。",
      };
    }
    if (
      snapshot.hasLogin ||
      /^https:\/\/accounts\.x\.ai(?:\/|$)/i.test(currentUrl)
    ) {
      return { state: "login_required", message: "请在应用内登录 Grok。" };
    }
    if (snapshot.hasComposer) return { state: "ready" };
    return {
      state: "unsupported",
      message: "未能安全识别 Grok 聊天输入框。",
    };
  }

  override async ensureChatReady(
    page: WebAgentPage,
  ): Promise<DoubaoLoginProbe> {
    if (!isAllowedWebAgentNavigationUrl("grok", page.url())) {
      await page.navigate(this.chatUrl);
    }
    let result = await this.probeLogin(page);
    for (
      let attempt = 0;
      result.state === "unsupported" && attempt < 24;
      attempt += 1
    ) {
      await page.sleep(250);
      result = await this.probeLogin(page);
    }
    return result;
  }

  override async modeState(page: WebAgentPage): Promise<DoubaoModeState> {
    const ready = await page.evaluate<boolean>(`
      (() => {
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        return [...document.querySelectorAll('textarea[aria-label="Ask Grok anything"], textarea, [contenteditable="true"], [role="textbox"]')]
          .some((element) => visible(element) && !/search|搜索/i.test([
            element.getAttribute('aria-label'),
            element.getAttribute('placeholder'),
          ].filter(Boolean).join(' ')));
      })()
    `);
    return {
      mode: ready ? "chat" : "unknown",
      workUnavailable: false,
    };
  }

  override async ensureMode(
    page: WebAgentPage,
    preferred: "chat" | "work" = "chat",
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
    if (state.mode !== "chat") {
      throw new Error("WEB_PAGE_UNSUPPORTED: 未能确认 Grok 对话模式可用。");
    }
    return { ...state, fallbackUsed: preferred === "work" };
  }

  override async createConversation(
    page: WebAgentPage,
  ): Promise<WebAgentConversationRef> {
    await page.navigate(this.chatUrl);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const result = await this.probeLogin(page);
      if (result.state === "ready") {
        return { url: page.url(), opaqueId: page.url() };
      }
      if (
        result.state === "login_required" ||
        result.state === "verification_required"
      ) {
        throw new Error(result.message);
      }
      await page.sleep(250);
    }
    throw new Error("WEB_PAGE_UNSUPPORTED: 未能确认 Grok 已创建新的网页会话。");
  }

  override async resumeConversation(
    page: WebAgentPage,
    ref: WebAgentConversationRef,
  ): Promise<void> {
    if (!ref.url || !isAllowedWebAgentUrl("grok", ref.url)) {
      throw new Error("WEB_PAGE_UNSUPPORTED: Grok 会话地址无效。");
    }
    if (page.url() !== ref.url) await page.navigate(ref.url);
    const probe = await this.probeLogin(page);
    if (probe.state !== "ready") throw new Error(probe.message);
  }

  override async uploadFiles(
    page: WebAgentPage,
    files: WebAgentStagedFile[],
  ): Promise<void> {
    if (!files.length) return;
    const found = await page.evaluate<boolean>(`
      (() => {
        const input = [...document.querySelectorAll('input[type="file"]')]
          .find((element) => !element.disabled);
        if (!input) return false;
        input.setAttribute('data-agents-one-upload-target', 'true');
        return true;
      })()
    `);
    if (!found) {
      throw new Error("WEB_UPLOAD_REJECTED: 未找到 Grok 文件上传入口。");
    }
    await page.setInputFiles(
      'input[data-agents-one-upload-target="true"]',
      files.map((file) => file.path),
    );
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const status = await page.evaluate<{
        uploading: boolean;
        error: boolean;
        evidence: boolean;
      }>(`
        (() => {
          const text = String(document.body?.innerText || document.body?.textContent || '');
          return {
            uploading: /uploading|processing file|上传中|正在上传|正在处理/i.test(text),
            error: /upload failed|could not upload|unsupported file|file too large|上传失败|无法上传/i.test(text),
            evidence: Boolean(document.querySelector(
              '[data-testid*="attachment"], [data-testid*="file"], [data-file-name], [aria-label*="Remove attachment"], [aria-label*="移除附件"]'
            )),
          };
        })()
      `);
      if (status.error) {
        throw new Error("WEB_UPLOAD_REJECTED: Grok 拒绝了附件上传。");
      }
      if (status.evidence && !status.uploading) return;
      await page.sleep(300);
    }
    throw new Error("WEB_UPLOAD_REJECTED: 未能确认 Grok 已接收附件。");
  }

  override async readResponse(
    page: WebAgentPage,
  ): Promise<WebAgentResponseSnapshot> {
    const snapshot = await super.readResponse(page);
    const state = await page.evaluate<{
      isGenerating: boolean;
      hasError: boolean;
      rateLimited: boolean;
    }>(`
      (() => {
        const text = String(document.body?.innerText || document.body?.textContent || '');
        const stop = [...document.querySelectorAll('button, [role="button"]')]
          .some((element) => /^(?:stop|停止)$/i.test(String(
            element.getAttribute('aria-label') || element.textContent || ''
          ).trim()));
        const rateLimited = /rate limit|too many requests|usage limit|请求过于频繁|请求受限|达到.*上限/i.test(text);
        const hasError = rateLimited || /something went wrong|response failed|try again later|生成失败|网络异常|稍后重试/i.test(text);
        return { isGenerating: stop, hasError, rateLimited };
      })()
    `);
    return {
      ...snapshot,
      isGenerating: snapshot.isGenerating || state.isGenerating,
      hasError: snapshot.hasError || state.hasError,
      errorCode: state.rateLimited
        ? "rate_limited"
        : state.hasError
          ? "provider_error"
          : snapshot.errorCode,
    };
  }

  override async cancel(page: WebAgentPage): Promise<boolean> {
    const marked = await page.evaluate<boolean>(`
      (() => {
        const visible = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const stop = [...document.querySelectorAll('button, [role="button"]')]
          .find((element) => visible(element) && /^(?:stop|停止|stop generating|停止生成)$/i.test(String(
            element.getAttribute('aria-label') || element.textContent || ''
          ).trim()));
        if (!stop) return false;
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
}
