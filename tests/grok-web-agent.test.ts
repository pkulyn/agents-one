import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { GrokProviderAdapter } from "../src/main/web-agent/providers/grok";
import type { WebAgentPage } from "../src/main/web-agent/providers/doubao";

class GrokFixturePage implements WebAgentPage {
  readonly dom: JSDOM;
  private currentUrl: string;
  readonly navigations: string[] = [];

  constructor(html: string, url = "https://grok.com/") {
    this.currentUrl = url;
    this.dom = new JSDOM(html, {
      runScripts: "dangerously",
      url: this.currentUrl,
    });
    Object.defineProperty(
      this.dom.window.HTMLElement.prototype,
      "getBoundingClientRect",
      {
        value: () => ({
          width: 100,
          height: 30,
          left: 0,
          top: 0,
          right: 100,
          bottom: 30,
        }),
      },
    );
  }

  url = (): string => this.currentUrl;
  async navigate(url: string): Promise<void> {
    this.currentUrl = url;
    this.navigations.push(url);
  }
  async evaluate<T>(script: string): Promise<T> {
    return this.dom.window.eval(script) as T;
  }
  async pressEnter(): Promise<void> {
    this.dom.window.document
      .querySelector("textarea[aria-label='Ask Grok anything']")
      ?.dispatchEvent(
        new this.dom.window.KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
        }),
      );
  }
  async setInputFiles(): Promise<void> {
    return;
  }
  async sleep(): Promise<void> {
    return;
  }
}

function readyPage(extra = ""): GrokFixturePage {
  const fixture = new GrokFixturePage(`
    <main>
      <textarea aria-label="Ask Grok anything"></textarea>
      <button type="submit" data-testid="chat-submit" aria-label="Submit">Send</button>
      ${extra}
    </main>
  `);
  const submit = (): void => {
    const textarea = fixture.dom.window.document.querySelector(
      "textarea[aria-label='Ask Grok anything']",
    ) as HTMLTextAreaElement | null;
    const prompt = textarea?.value || "";
    if (textarea) textarea.value = "";
    fixture.dom.window.document.body.insertAdjacentHTML(
      "beforeend",
      `<div role="article" aria-label="You" data-testid="user-message">${prompt}</div>`,
    );
  };
  fixture.dom.window.document
    .querySelector("[data-testid='chat-submit']")
    ?.addEventListener("click", submit);
  return fixture;
}

// @lat: [[web-agent-runtime#Grok adapter]]
describe("Grok web adapter", () => {
  it("requires sign-in even though the logged-out landing page has a composer", async () => {
    const adapter = new GrokProviderAdapter();
    const fixture = new GrokFixturePage(`
      <button>Sign in</button>
      <button>Sign up</button>
      <textarea aria-label="Ask Grok anything"></textarea>
    `);

    await expect(adapter.probeLogin(fixture)).resolves.toMatchObject({
      state: "login_required",
    });
  });

  it("preserves the xAI login page while the user signs in", async () => {
    const adapter = new GrokProviderAdapter();
    const fixture = new GrokFixturePage(
      "<p>Sign in to xAI</p>",
      "https://accounts.x.ai/check-login?redirect=grok-com",
    );

    await expect(adapter.ensureChatReady(fixture)).resolves.toMatchObject({
      state: "login_required",
    });
    expect(fixture.navigations).toEqual([]);
  });

  it("explains the Google OAuth embedded-browser rejection", async () => {
    const adapter = new GrokProviderAdapter();
    const fixture = new GrokFixturePage(
      "<h1>无法登录</h1><p>此浏览器或应用可能不安全。</p>",
      "https://accounts.google.com/v3/signin/rejected",
    );

    await expect(adapter.probeLogin(fixture)).resolves.toEqual({
      state: "login_required",
      message:
        "Google 登录不支持在当前内嵌窗口完成，请返回 Grok 选择邮箱或 X 登录。",
    });
  });

  it("surfaces a failed Cloudflare email-login challenge as verification", async () => {
    const adapter = new GrokProviderAdapter();
    const fixture = new GrokFixturePage(
      "<p>验证失败。请刷新页面并重试。</p>",
      "https://accounts.x.ai/sign-in?redirect=grok-com&email=true",
    );

    await expect(adapter.probeLogin(fixture)).resolves.toEqual({
      state: "verification_required",
      message: "Grok 要求完成验证码或安全验证。",
    });
  });

  it("uses Grok's chat-only mode without pretending Work mode exists", async () => {
    const adapter = new GrokProviderAdapter();
    const fixture = readyPage();

    expect(adapter.preferredMode).toBe("chat");
    await expect(adapter.modeState(fixture)).resolves.toMatchObject({
      mode: "chat",
      workUnavailable: false,
    });
    await expect(adapter.ensureMode(fixture, "chat")).resolves.toMatchObject({
      mode: "chat",
      fallbackUsed: false,
    });
  });

  it("submits through Grok's stable composer and submit test IDs", async () => {
    const adapter = new GrokProviderAdapter();
    const fixture = readyPage();

    await expect(
      adapter.sendPrompt(fixture, "你好 Grok"),
    ).resolves.toMatchObject({
      promptHash: expect.any(String),
    });
    expect(
      fixture.dom.window.document.querySelector("[data-testid='user-message']")
        ?.textContent,
    ).toBe("你好 Grok");
  });

  it("reads the newest Grok assistant response as Markdown", async () => {
    const adapter = new GrokProviderAdapter();
    const fixture = readyPage(`
      <div data-testid="assistant-message">
        <div class="response-content-markdown">
          <h2>结论</h2><p>Grok 已完成。</p>
        </div>
      </div>
    `);

    await expect(adapter.readResponse(fixture)).resolves.toMatchObject({
      text: ["## 结论", "", "Grok 已完成。"].join("\n"),
      hasAssistantMessage: true,
      isGenerating: false,
    });
  });

  it("cancels a generation through Grok's current Stop control", async () => {
    const adapter = new GrokProviderAdapter();
    const fixture = readyPage('<button aria-label="Stop">Stop</button>');
    let stopped = false;
    fixture.dom.window.document
      .querySelector("button[aria-label='Stop']")
      ?.addEventListener("click", () => {
        stopped = true;
      });

    await expect(adapter.cancel(fixture)).resolves.toBe(true);
    expect(stopped).toBe(true);
  });
});
