import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ChatGPTProviderAdapter } from "../src/main/web-agent/providers/chatgpt";
import type { WebAgentPage } from "../src/main/web-agent/providers/doubao";

class ChatGPTFixturePage implements WebAgentPage {
  readonly dom: JSDOM;
  private currentUrl = "https://chatgpt.com/";
  readonly uploads: string[][] = [];
  constructor(html: string, url = "https://chatgpt.com/") {
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
    const submit = (): void => {
      this.dom.window.document.body.insertAdjacentHTML(
        "beforeend",
        "<div data-message-author-role='user'>你好 ChatGPT</div>",
      );
      const editor = this.dom.window.document.querySelector(
        "[contenteditable='true']",
      );
      if (editor) editor.textContent = "";
    };
    const send = this.dom.window.document.querySelector(
      "button[aria-label='发送']",
    );
    send?.addEventListener("click", submit);
    this.dom.window.document
      .querySelector("[contenteditable='true']")
      ?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) submit();
      });
  }
  url = (): string => this.currentUrl;
  async navigate(url: string): Promise<void> {
    this.currentUrl = url;
  }
  async evaluate<T>(script: string): Promise<T> {
    return this.dom.window.eval(script) as T;
  }
  async pressEnter(): Promise<void> {
    this.dom.window.document
      .querySelector("[contenteditable='true']")
      ?.dispatchEvent(
        new this.dom.window.KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
        }),
      );
  }
  async setInputFiles(_selector: string, paths: string[]): Promise<void> {
    this.uploads.push(paths);
    const a = this.dom.window.document.querySelector(
      "[data-testid='file-chip']",
    );
    if (a) a.textContent = paths.join(" ");
  }
  async sleep(): Promise<void> {
    return;
  }
}

const page = (extra = ""): ChatGPTFixturePage =>
  new ChatGPTFixturePage(`
  <main>
    <button role="tab" aria-selected="true" onclick="this.setAttribute('aria-selected','true'); this.nextElementSibling?.setAttribute('aria-selected','false')">工作</button><button role="tab" onclick="this.setAttribute('aria-selected','true'); this.previousElementSibling?.setAttribute('aria-selected','false')">聊天</button>
    <div contenteditable="true" aria-label="处理任何事务"></div>
    <button aria-label="发送">发送</button>
    <input type="file" />
    ${extra}
  </main>`);

describe("ChatGPT web adapter", () => {
  it("uses ChatGPT origin and detects Work mode", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = page();
    await expect(adapter.probeLogin(fixturePage)).resolves.toMatchObject({
      state: "ready",
    });
    await expect(adapter.modeState(fixturePage)).resolves.toMatchObject({
      mode: "work",
      workUnavailable: false,
    });
  });

  it("falls back to Chat when Work quota is unavailable", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = page("<p>工作模式额度已用完，请切换到聊天模式</p>");
    await expect(
      adapter.ensureMode(fixturePage, "work"),
    ).resolves.toMatchObject({ mode: "chat", fallbackUsed: true });
  });

  it("does not reset an in-progress OAuth page during readiness probing", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = new ChatGPTFixturePage(
      "<p>输入您的密码</p>",
      "https://accounts.google.com/signin/challenge/pwd",
    );
    await expect(adapter.ensureChatReady(fixturePage)).resolves.toMatchObject({
      state: "login_required",
    });
    expect(fixturePage.url()).toContain("accounts.google.com");
  });

  it("submits a prompt through the shared composer pipeline", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = page();
    await expect(
      adapter.sendPrompt(fixturePage, "你好 ChatGPT"),
    ).resolves.toMatchObject({ promptHash: expect.any(String) });
  });

  it("refocuses the composer when a trusted send click leaves the draft intact", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = page();
    const document = fixturePage.dom.window.document;
    const enterTargets: string[] = [];
    fixturePage.click = async () => {
      // Model Chromium's trusted pointer click moving focus to the submit
      // button without invoking ChatGPT's React submit handler.
      (
        document.querySelector("button[aria-label='发送']") as HTMLElement
      )?.focus();
    };
    fixturePage.pressEnter = async () => {
      const target = document.activeElement as HTMLElement | null;
      enterTargets.push(target?.tagName || "none");
      target?.dispatchEvent(
        new fixturePage.dom.window.KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
          code: "Enter",
        }),
      );
    };

    await expect(
      adapter.sendPrompt(fixturePage, "你好 ChatGPT"),
    ).resolves.toBeDefined();
    expect(enterTargets).toEqual(["BUTTON", "DIV"]);
  });

  it("falls back to ChatGPT's same-document submit when trusted input is ignored", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = page();
    const document = fixturePage.dom.window.document;
    const send = document.querySelector("button[aria-label='发送']");
    send?.setAttribute("aria-label", "发送提示");
    send?.setAttribute("data-testid", "send-button");
    fixturePage.click = async () => undefined;
    fixturePage.pressEnter = async () => undefined;

    await expect(
      adapter.sendPrompt(fixturePage, "你好 ChatGPT"),
    ).resolves.toBeDefined();
    expect(
      document.querySelector("[data-message-author-role='user']"),
    ).not.toBeNull();
  });

  it("reads the newest ChatGPT assistant answer instead of historical text", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = page(`
      <article data-message-author-role="assistant"><p>旧的智能体简介</p></article>
      <article data-message-author-role="assistant">
        <h2>附件要点</h2>
        <ol start="3"><li>第三项</li></ol>
      </article>
    `);

    await expect(adapter.readResponse(fixturePage)).resolves.toMatchObject({
      text: ["## 附件要点", "", "3. 第三项"].join("\n"),
      hasAssistantMessage: true,
      isGenerating: false,
    });
  });
});
