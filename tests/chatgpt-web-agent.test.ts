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

  it("confirms a nested Work toggle through aria-pressed instead of sidebar text", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = new ChatGPTFixturePage(`
      <nav><span>消息</span></nav>
      <main>
        <div role="group" aria-label="模式">
          <button aria-pressed="true" onclick="this.setAttribute('aria-pressed','true'); this.nextElementSibling?.setAttribute('aria-pressed','false')"><span>Chat</span></button>
          <button aria-pressed="false" onclick="this.setAttribute('aria-pressed','true'); this.previousElementSibling?.setAttribute('aria-pressed','false')"><span>Work</span></button>
        </div>
        <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
      </main>
    `);

    await expect(
      adapter.ensureMode(fixturePage, "work"),
    ).resolves.toMatchObject({
      mode: "work",
      fallbackUsed: false,
    });
  });

  it("does not treat unrelated page text as proof of Chat mode", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = new ChatGPTFixturePage(`
      <nav><span>消息</span><a class="active" href="/work">Work</a></nav>
      <main><div id="prompt-textarea" contenteditable="true"></div></main>
    `);

    await expect(adapter.modeState(fixturePage)).resolves.toMatchObject({
      mode: "unknown",
    });
    await expect(adapter.ensureMode(fixturePage, "work")).rejects.toThrow(
      "WEB_PAGE_UNSUPPORTED",
    );
  });

  it("falls back to Chat when Work quota is unavailable", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = page("<p>工作模式额度已用完，请切换到聊天模式</p>");
    await expect(
      adapter.ensureMode(fixturePage, "work"),
    ).resolves.toMatchObject({ mode: "chat", fallbackUsed: true });
  });

  it("does not submit through an unconfirmed Chat fallback", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = new ChatGPTFixturePage(`
      <main>
        <p>工作模式额度已用完，请切换到聊天模式</p>
        <div id="prompt-textarea" contenteditable="true"></div>
      </main>
    `);

    await expect(adapter.ensureMode(fixturePage, "work")).rejects.toThrow(
      "WEB_PAGE_UNSUPPORTED",
    );
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

  it("waits for the composer to hydrate after a slow login redirect", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = new ChatGPTFixturePage(
      "<main><p>正在加载 ChatGPT</p></main>",
    );
    let polls = 0;
    fixturePage.sleep = async () => {
      polls += 1;
      if (polls === 25) {
        fixturePage.dom.window.document
          .querySelector("main")
          ?.insertAdjacentHTML(
            "beforeend",
            '<div id="prompt-textarea" contenteditable="true" role="textbox"></div>',
          );
      }
    };

    await expect(adapter.ensureChatReady(fixturePage)).resolves.toMatchObject({
      state: "ready",
    });
    expect(polls).toBe(25);
  });

  it("submits a prompt through the shared composer pipeline", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = page();
    await expect(
      adapter.sendPrompt(fixturePage, "你好 ChatGPT"),
    ).resolves.toMatchObject({ promptHash: expect.any(String) });
  });

  // @lat: [[web-agent-runtime#ChatGPT submit receipt]]
  it("uses the current Work form send button when hidden-window Enter is ignored", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = new ChatGPTFixturePage(`
      <main>
        <form>
          <div class="ProseMirror" contenteditable="true" role="textbox" aria-label="使用 ChatGPT Work"></div>
          <button type="submit" aria-label="发送"></button>
        </form>
      </main>
    `);
    fixturePage.dom.window.document
      .querySelector("form")
      ?.addEventListener("submit", (event) => event.preventDefault());
    fixturePage.pressEnter = async () => undefined;
    fixturePage.click = async (selector) => {
      const button = fixturePage.dom.window.document.querySelector(selector);
      if (!button) throw new Error("send control not found");
      (button as HTMLElement).click();
    };

    await expect(
      adapter.sendPrompt(fixturePage, "你好 ChatGPT"),
    ).resolves.toBeDefined();
    expect(
      fixturePage.dom.window.document.querySelector(
        '[data-message-author-role="user"]',
      ),
    ).not.toBeNull();
  });

  it("confirms a multiline Work draft from rendered paragraph text", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = new ChatGPTFixturePage(`
      <main>
        <form>
          <div class="ProseMirror" contenteditable="true" role="textbox" aria-label="使用 ChatGPT Work"></div>
          <button type="submit" aria-label="发送"></button>
        </form>
      </main>
    `);
    const document = fixturePage.dom.window.document;
    const editor = document.querySelector(".ProseMirror") as HTMLElement;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (_command: string, _showUi: boolean, value: string) => {
        editor.innerHTML = value
          .split("\n\n")
          .map((part) => `<p>${part}</p>`)
          .join("");
        return true;
      },
    });
    Object.defineProperty(editor, "innerText", {
      configurable: true,
      get: () =>
        [...editor.querySelectorAll("p")]
          .map((part) => part.textContent)
          .join("\n\n"),
    });
    document
      .querySelector("form")
      ?.addEventListener("submit", (event) => event.preventDefault());
    fixturePage.pressEnter = async () => undefined;
    fixturePage.click = async (selector) => {
      const button = document.querySelector(selector);
      if (!button) throw new Error("send control not found");
      (button as HTMLElement).click();
    };

    await expect(
      adapter.sendPrompt(fixturePage, "第一段\n\n第二段"),
    ).resolves.toBeDefined();
    expect(
      document.querySelector('[data-message-author-role="user"]'),
    ).not.toBeNull();
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

  // @lat: [[web-agent-runtime#ChatGPT response container]]
  it("reads the current ChatGPT Work assistant markdown container", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = page(
      '<div data-markdown-text-style="assistant-message"><p>CHATGPT-SUBMIT-OK</p></div><span role="status" aria-live="polite">回答已完成</span>',
    );

    await expect(adapter.readResponse(fixturePage)).resolves.toMatchObject({
      text: "CHATGPT-SUBMIT-OK",
      hasAssistantMessage: true,
      isGenerating: false,
    });
  });

  // @lat: [[web-agent-runtime#ChatGPT completion evidence]]
  it("keeps a provisional Work reply open until ChatGPT announces completion", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = page(
      '<div data-markdown-text-style="assistant-message"><p>我会整理简报。</p></div><span role="status" aria-live="polite">ChatGPT 正在回应</span>',
    );

    await expect(adapter.readResponse(fixturePage)).resolves.toMatchObject({
      text: "我会整理简报。",
      hasAssistantMessage: true,
      isGenerating: true,
    });
    fixturePage.dom.window.document.querySelector(
      '[role="status"]',
    )!.textContent = "回答已完成";
    fixturePage.dom.window.document.querySelector(
      '[data-markdown-text-style="assistant-message"]',
    )!.innerHTML = "<h1>AI 行业一周简报</h1><p>完整正文。</p>";
    await expect(adapter.readResponse(fixturePage)).resolves.toMatchObject({
      text: "# AI 行业一周简报\n\n完整正文。",
      isGenerating: false,
    });
  });

  it("does not finalize a modern ChatGPT reply without a completion signal", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = page(
      '<div data-markdown-text-style="assistant-message"><p>我会整理简报。</p></div>',
    );

    await expect(adapter.readResponse(fixturePage)).resolves.toMatchObject({
      hasAssistantMessage: true,
      isGenerating: true,
    });
  });

  // @lat: [[web-agent-runtime#ChatGPT full-page retry]]
  it("reloads a failed conversation page once without resubmitting the prompt", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = new ChatGPTFixturePage(`
      <main><h1>ChatGPT 遇到了问题</h1><p>出了点问题。请重试以继续</p><button>重试</button></main>
    `);
    let retries = 0;
    fixturePage.dom.window.document
      .querySelector("button")
      ?.addEventListener("click", () => {
        retries += 1;
        fixturePage.dom.window.document.body.innerHTML =
          '<div data-markdown-text-style="assistant-message"><p>CHATGPT-REPLY-OK</p></div>';
      });

    await expect(adapter.readResponse(fixturePage)).resolves.toMatchObject({
      hasAssistantMessage: false,
      hasError: false,
    });
    await expect(adapter.readResponse(fixturePage)).resolves.toMatchObject({
      text: "CHATGPT-REPLY-OK",
      hasAssistantMessage: true,
    });
    expect(retries).toBe(1);
  });

  it("reports a repeated full-page error after its single safe retry", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = new ChatGPTFixturePage(`
      <main><h1>ChatGPT 遇到了问题</h1><p>出了点问题。请重试以继续</p><button>重试</button></main>
    `);
    let retries = 0;
    fixturePage.dom.window.document
      .querySelector("button")
      ?.addEventListener("click", () => {
        retries += 1;
      });

    await adapter.readResponse(fixturePage);
    await expect(adapter.readResponse(fixturePage)).resolves.toMatchObject({
      hasError: false,
      isGenerating: true,
    });
    (
      adapter as unknown as { fullPageRetryStartedAt: number }
    ).fullPageRetryStartedAt = Date.now() - 10_001;
    await expect(adapter.readResponse(fixturePage)).resolves.toMatchObject({
      hasError: true,
      errorCode: "provider_error",
    });
    expect(retries).toBe(1);
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

  it("preserves ChatGPT answer tables as Markdown rows and columns", async () => {
    const adapter = new ChatGPTProviderAdapter();
    const fixturePage = page(`
      <article data-message-author-role="assistant">
        <h2>一周简报</h2>
        <table>
          <thead><tr><th>公司</th><th>日期</th><th>主要进展</th></tr></thead>
          <tbody>
            <tr><td>OpenAI</td><td>9 月 22 日</td><td>发布 <strong>GPT-6 Sol</strong>，见 <a href="https://openai.com/news">OpenAI</a></td></tr>
            <tr><td>Anthropic</td><td>9 月 23 日</td><td>披露 A | B 研究</td></tr>
          </tbody>
        </table>
        <p><strong>趋势观察：</strong>两家公司均有新进展。</p>
      </article>
    `);

    await expect(adapter.readResponse(fixturePage)).resolves.toMatchObject({
      text: [
        "## 一周简报",
        "",
        "| 公司 | 日期 | 主要进展 |",
        "| --- | --- | --- |",
        "| OpenAI | 9 月 22 日 | 发布 **GPT-6 Sol**，见 [OpenAI](https://openai.com/news) |",
        "| Anthropic | 9 月 23 日 | 披露 A \\| B 研究 |",
        "",
        "**趋势观察：**两家公司均有新进展。",
      ].join("\n"),
    });
  });
});
