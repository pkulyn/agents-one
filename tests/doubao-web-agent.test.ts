import { readFileSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  DoubaoProviderAdapter,
  type WebAgentPage,
} from "../src/main/web-agent/providers/doubao";

function fixture(name: string): string {
  return readFileSync(
    join(__dirname, "fixtures", "web-agent", "doubao", name),
    "utf8",
  );
}

class FixturePage implements WebAgentPage {
  readonly dom: JSDOM;
  private currentUrl = "https://www.doubao.com/chat/";
  readonly uploads: string[][] = [];
  dropFiles?: (paths: string[]) => Promise<void>;

  constructor(html: string) {
    this.dom = new JSDOM(html, {
      runScripts: "dangerously",
      url: this.currentUrl,
    });
    Object.defineProperty(
      this.dom.window.HTMLElement.prototype,
      "getBoundingClientRect",
      {
        value: () => ({
          width: 1,
          height: 1,
          left: 0,
          top: 0,
          right: 1,
          bottom: 1,
        }),
      },
    );
  }

  url = (): string => this.currentUrl;

  async navigate(url: string): Promise<void> {
    this.currentUrl = url;
  }

  async evaluate<T>(script: string): Promise<T> {
    return this.dom.window.eval(script) as T;
  }

  async pressEnter(): Promise<void> {
    this.dom.window.document.activeElement?.dispatchEvent(
      new this.dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
        code: "Enter",
      }),
    );
  }

  async setInputFiles(_selector: string, paths: string[]): Promise<void> {
    this.uploads.push(paths);
    const target = this.dom.window.document.querySelector(".attachments");
    if (target)
      target.textContent = paths
        .map((path) => path.split(/[\\/]/).at(-1))
        .join(" ");
  }

  async sleep(): Promise<void> {
    return;
  }
}

// @lat: [[web-agent-runtime#Provider isolation]]
describe("Doubao web adapter fixtures", () => {
  it("detects a ready chat and a login-required page without credentials", async () => {
    const adapter = new DoubaoProviderAdapter();
    await expect(
      adapter.probeLogin(new FixturePage(fixture("ready.html"))),
    ).resolves.toEqual({
      state: "ready",
    });
    await expect(
      adapter.probeLogin(new FixturePage(fixture("login.html"))),
    ).resolves.toMatchObject({
      state: "login_required",
    });
  });

  it("waits for the Doubao composer to hydrate after navigation", async () => {
    const page = new FixturePage(`<main>豆包正在加载</main>`);
    let sleeps = 0;
    page.sleep = async () => {
      sleeps += 1;
      if (sleeps === 2) {
        page.dom.window.document.body.insertAdjacentHTML(
          "beforeend",
          `<div class="tiptap ProseMirror" contenteditable="true" role="textbox"></div>`,
        );
      }
    };

    const adapter = new DoubaoProviderAdapter();
    await expect(adapter.ensureChatReady(page)).resolves.toEqual({
      state: "ready",
    });
    expect(sleeps).toBe(2);
  });

  it("uses the file input and only accepts a visible upload acknowledgement", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(fixture("ready.html"));
    await adapter.uploadFiles(page, [
      {
        path: "C:\\staged\\report.pdf",
        name: "report.pdf",
        mime: "application/pdf",
        size: 10,
        sha256: "a".repeat(64),
      },
    ]);
    expect(page.uploads).toEqual([["C:\\staged\\report.pdf"]]);
  });

  it("finds icon-only Doubao upload controls by metadata", async () => {
    const page = new FixturePage(`
      <button class="semi-upload-button" aria-label=""><svg></svg></button>
      <div class="attachments"></div>
      <textarea aria-label="消息输入框"></textarea>
    `);
    page.dom.window.document
      .querySelector("button.semi-upload-button")
      ?.addEventListener("click", () => {
        const input = page.dom.window.document.createElement("input");
        input.type = "file";
        page.dom.window.document.body.appendChild(input);
      });

    const adapter = new DoubaoProviderAdapter();
    await adapter.uploadFiles(page, [
      {
        path: "C:\\staged\\report.pdf",
        name: "report.pdf",
        mime: "application/pdf",
        size: 10,
        sha256: "a".repeat(64),
      },
    ]);
    expect(page.uploads).toEqual([["C:\\staged\\report.pdf"]]);
  });

  it("clicks an interactive parent when upload semantics live on an icon", async () => {
    const page = new FixturePage(`
      <button class="semi-button" aria-label=""><svg><use href="#icon_upload_file"></use></svg></button>
      <div class="attachments"></div>
      <textarea aria-label="消息输入框"></textarea>
    `);
    page.dom.window.document
      .querySelector("button.semi-button")
      ?.addEventListener("click", () => {
        const input = page.dom.window.document.createElement("input");
        input.type = "file";
        page.dom.window.document.body.appendChild(input);
      });

    const adapter = new DoubaoProviderAdapter();
    await adapter.uploadFiles(page, [
      {
        path: "C:\\staged\\speech.docx",
        name: "speech.docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 10,
        sha256: "b".repeat(64),
      },
    ]);
    expect(page.uploads).toEqual([["C:\\staged\\speech.docx"]]);
  });

  it("uses the work-mode plus menu instead of the chat-mode upload control", async () => {
    const page = new FixturePage(`
      <button data-active="true">工作</button>
      <button>对话</button>
      <section data-mode="chat">
        <button aria-label="添加文件">添加文件</button>
        <input type="file" data-testid="chat-upload-input" />
      </section>
      <section data-mode="work">
        <button class="work-plus"><svg><path d="M12.0005 2.25C12.5528 2.25 13.0005 2.69772"></path></svg></button>
        <div contenteditable="true" role="textbox"></div>
      </section>
      <div class="attachments"></div>
    `);
    let chatClicks = 0;
    page.dom.window.document
      .querySelector('section[data-mode="chat"] button')
      ?.addEventListener("click", () => {
        chatClicks += 1;
      });
    page.dom.window.document
      .querySelector("button.work-plus")
      ?.addEventListener("click", () => {
        const menuItem = page.dom.window.document.createElement("div");
        menuItem.setAttribute("data-mode", "work");
        menuItem.textContent = "上传文件或图片";
        menuItem.addEventListener("click", () => {
          const input = page.dom.window.document.createElement("input");
          input.type = "file";
          input.setAttribute("data-mode", "work");
          page.dom.window.document.body.appendChild(input);
        });
        page.dom.window.document.body.appendChild(menuItem);
      });

    const adapter = new DoubaoProviderAdapter();
    await adapter.uploadFiles(page, [
      {
        path: "C:\\staged\\work-plan.docx",
        name: "work-plan.docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 10,
        sha256: "c".repeat(64),
      },
    ]);

    expect(chatClicks).toBe(0);
    expect(page.uploads).toEqual([["C:\\staged\\work-plan.docx"]]);
  });

  it("waits for Doubao Work mode to mount its file menu in a portal", async () => {
    const page = new FixturePage(`
      <button data-active="true">工作</button>
      <section data-mode="work">
        <button class="work-plus"><svg><path d="M12.0005 2.25C12.5528 2.25 13.0005 2.69772"></path></svg></button>
        <div contenteditable="true" role="textbox"></div>
      </section>
      <div class="attachments"></div>
    `);
    const document = page.dom.window.document;
    document
      .querySelector("button.work-plus")
      ?.addEventListener("click", () => {
        // The real Work composer renders this menu in a portal after the click.
      });
    let sleeps = 0;
    page.sleep = async () => {
      sleeps += 1;
      if (sleeps !== 3) return;
      const menuItem = document.createElement("div");
      menuItem.setAttribute("data-scene", "chat");
      menuItem.setAttribute("data-testid", "upload_file_button");
      menuItem.setAttribute("aria-label", "上传文件或图片");
      menuItem.textContent = "上传文件或图片";
      menuItem.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        document.body.appendChild(input);
      });
      document.body.appendChild(menuItem);
    };

    const adapter = new DoubaoProviderAdapter();
    await adapter.uploadFiles(page, [
      {
        path: "C:\\staged\\delayed-work-plan.docx",
        name: "delayed-work-plan.docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 10,
        sha256: "f".repeat(64),
      },
    ]);

    expect(sleeps).toBeGreaterThanOrEqual(3);
    expect(page.uploads).toEqual([["C:\\staged\\delayed-work-plan.docx"]]);
  });

  it("uses the native click bridge for Radix-style pointer menu triggers", async () => {
    const page = new FixturePage(`
      <button data-active="true">工作</button>
      <section data-mode="work">
        <button class="work-plus"><svg><path d="M12.0005 2.25C12.5528 2.25 13.0005 2.69772"></path></svg></button>
        <div contenteditable="true" role="textbox"></div>
      </section>
      <div class="attachments"></div>
    `);
    const document = page.dom.window.document;
    const nativeClicks: string[] = [];
    page.click = async (selector: string) => {
      nativeClicks.push(selector);
      const target = document.querySelector(selector);
      if (!target) throw new Error(`missing click target: ${selector}`);
      for (const type of ["pointerdown", "pointerup", "click"])
        target.dispatchEvent(
          new page.dom.window.MouseEvent(type, { bubbles: true }),
        );
    };
    document
      .querySelector("button.work-plus")
      ?.addEventListener("pointerdown", () => {
        const menuItem = document.createElement("div");
        menuItem.setAttribute("role", "menuitem");
        menuItem.textContent = "上传文件或图片";
        menuItem.addEventListener("pointerdown", () => {
          const input = document.createElement("input");
          input.type = "file";
          document.body.appendChild(input);
        });
        document.body.appendChild(menuItem);
      });

    const adapter = new DoubaoProviderAdapter();
    await adapter.uploadFiles(page, [
      {
        path: "C:\\staged\\native-click.pdf",
        name: "native-click.pdf",
        mime: "application/pdf",
        size: 10,
        sha256: "n".repeat(64),
      },
    ]);

    expect(nativeClicks).toHaveLength(2);
    expect(page.uploads).toEqual([["C:\\staged\\native-click.pdf"]]);
  });

  it("prefers the trusted drag bridge over Doubao's transient file chooser", async () => {
    const page = new FixturePage(`
      <button data-active="true">工作</button>
      <section data-mode="work">
        <button class="work-plus"><svg><path d="M12.0005 2.25C12.5528 2.25 13.0005 2.69772"></path></svg></button>
        <div contenteditable="true" role="textbox"></div>
      </section>
      <div class="attachments"></div>
    `);
    const document = page.dom.window.document;
    let plusClicks = 0;
    const dropped: string[][] = [];
    document
      .querySelector("button.work-plus")
      ?.addEventListener("click", () => plusClicks++);
    page.dropFiles = async (paths: string[]) => {
      dropped.push(paths);
      const target = document.querySelector(".attachments");
      if (target)
        target.textContent = paths
          .map((path) => path.split(/[\\/]/).at(-1))
          .join(" ");
    };

    const adapter = new DoubaoProviderAdapter();
    await adapter.uploadFiles(page, [
      {
        path: "C:\\staged\\trusted-drop.docx",
        name: "trusted-drop.docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 10,
        sha256: "e".repeat(64),
      },
    ]);

    expect(dropped).toEqual([["C:\\staged\\trusted-drop.docx"]]);
    expect(plusClicks).toBe(0);
  });

  it("finds a Work mode plus rendered as a generic icon container", async () => {
    const page = new FixturePage(`
      <button data-active="true">工作</button>
      <div class="composer-actions">
        <div class="cursor-pointer composer-add"><svg><path d="M1 2L3 4"></path></svg></div>
        <div class="cursor-pointer" aria-label="语音"><svg><path d="M4 5L6 7"></path></svg></div>
      </div>
      <div contenteditable="true" role="textbox"></div>
      <div class="attachments"></div>
    `);
    const document = page.dom.window.document;
    document.querySelector(".composer-add")?.addEventListener("click", () => {
      const menuItem = document.createElement("div");
      menuItem.textContent = "上传文件或图片";
      menuItem.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        document.body.appendChild(input);
      });
      document.body.appendChild(menuItem);
    });

    const adapter = new DoubaoProviderAdapter();
    await adapter.uploadFiles(page, [
      {
        path: "C:\\staged\\generic-plus.pdf",
        name: "generic-plus.pdf",
        mime: "application/pdf",
        size: 10,
        sha256: "e".repeat(64),
      },
    ]);

    expect(page.uploads).toEqual([["C:\\staged\\generic-plus.pdf"]]);
  });

  it("prefers the conversation-mode input when both mode controls exist", async () => {
    const page = new FixturePage(`
      <button data-active="true">对话</button>
      <button>工作</button>
      <section data-mode="work">
        <button class="work-plus"><svg><path d="M12.0005 2.25C12.5528 2.25 13.0005 2.69772"></path></svg></button>
        <div contenteditable="true" role="textbox"></div>
      </section>
      <section data-mode="chat">
        <button data-testid="upload_file_button" aria-label="上传文件">上传文件</button>
        <input type="file" data-mode="chat" />
      </section>
      <div class="attachments"></div>
    `);
    let workClicks = 0;
    page.dom.window.document
      .querySelector("button.work-plus")
      ?.addEventListener("click", () => {
        workClicks += 1;
      });

    const adapter = new DoubaoProviderAdapter();
    await adapter.uploadFiles(page, [
      {
        path: "C:\\staged\\chat-note.txt",
        name: "chat-note.txt",
        mime: "text/plain",
        size: 10,
        sha256: "d".repeat(64),
      },
    ]);

    expect(workClicks).toBe(0);
    expect(page.uploads).toEqual([["C:\\staged\\chat-note.txt"]]);
  });

  it("selects Work mode for a new task when the mode tabs are available", async () => {
    const page = new FixturePage(`
      <button data-active="true">对话</button>
      <button>工作</button>
      <textarea aria-label="消息输入框"></textarea>
      <div>有什么我能帮你的吗？</div>
    `);
    const chat = page.dom.window.document.querySelector("button");
    const work = page.dom.window.document.querySelectorAll("button")[1];
    work?.addEventListener("click", () => {
      chat?.removeAttribute("data-active");
      work.setAttribute("data-active", "true");
    });

    const adapter = new DoubaoProviderAdapter();
    await expect(adapter.ensureMode(page, "work")).resolves.toMatchObject({
      mode: "work",
      fallbackUsed: false,
    });
  });

  it("recognizes Doubao landing-page tabs that expose active state only in CSS", async () => {
    const page = new FixturePage(`
      <div class="group relative flex h-full cursor-pointer text-dbx-text-primary">对话</div>
      <div class="group relative flex h-full cursor-pointer text-dbx-text-secondary">工作</div>
      <textarea aria-label="消息输入框"></textarea>
    `);
    const tabs = page.dom.window.document.querySelectorAll("div");
    tabs[0]?.addEventListener("click", () => {
      tabs[0].className =
        "group relative flex h-full cursor-pointer text-dbx-text-secondary";
      tabs[1].className =
        "group relative flex h-full cursor-pointer text-dbx-text-primary";
    });
    tabs[1]?.addEventListener("click", () => {
      tabs[0].className =
        "group relative flex h-full cursor-pointer text-dbx-text-secondary";
      tabs[1].className =
        "group relative flex h-full cursor-pointer text-dbx-text-primary";
    });

    const adapter = new DoubaoProviderAdapter();
    await expect(adapter.ensureMode(page, "work")).resolves.toMatchObject({
      mode: "work",
      fallbackUsed: false,
    });
  });

  it("clicks the interactive mode-tab parent when the label is nested", async () => {
    const page = new FixturePage(`
      <div class="mode-tab cursor-pointer text-dbx-text-primary"><span>对话</span></div>
      <div class="mode-tab cursor-pointer text-dbx-text-secondary"><span>工作</span></div>
      <textarea aria-label="消息输入框"></textarea>
    `);
    const tabs = page.dom.window.document.querySelectorAll(".mode-tab");
    tabs[1]?.addEventListener("click", () => {
      tabs[0].className = "mode-tab cursor-pointer text-dbx-text-secondary";
      tabs[1].className = "mode-tab cursor-pointer text-dbx-text-primary";
    });

    const adapter = new DoubaoProviderAdapter();
    await expect(adapter.ensureMode(page, "work")).resolves.toMatchObject({
      mode: "work",
      fallbackUsed: false,
    });
  });

  it("does not silently downgrade to Chat when Work selection is unconfirmed", async () => {
    const page = new FixturePage(`
      <button data-active="true">对话</button>
      <button>工作</button>
      <textarea aria-label="消息输入框"></textarea>
    `);

    const adapter = new DoubaoProviderAdapter();
    await expect(adapter.ensureMode(page, "work")).rejects.toThrow(
      "未能确认豆包已切换到工作模式",
    );
  });

  it("falls back to Chat when Work mode reports an exhausted quota", async () => {
    const page = new FixturePage(`
      <button data-active="true">工作</button>
      <button>对话</button>
      <textarea aria-label="消息输入框"></textarea>
      <div>工作模式今日使用次数已达上限，请切换到对话模式。</div>
    `);
    const work = page.dom.window.document.querySelector("button");
    const chat = page.dom.window.document.querySelectorAll("button")[1];
    chat?.addEventListener("click", () => {
      work?.removeAttribute("data-active");
      chat.setAttribute("data-active", "true");
    });

    const adapter = new DoubaoProviderAdapter();
    await expect(adapter.ensureMode(page, "work")).resolves.toMatchObject({
      mode: "chat",
      fallbackUsed: true,
    });
  });

  it("surfaces a Work quota rejection so the controller can retry in Chat", async () => {
    const page = new FixturePage(`
      <textarea aria-label="消息输入框"></textarea>
      <button aria-label="发送">发送</button>
    `);
    page.dom.window.document
      .querySelector("button[aria-label='发送']")
      ?.addEventListener("click", () => {
        page.dom.window.document.body.insertAdjacentText(
          "beforeend",
          "工作模式今日使用次数已达上限，请切换到对话模式。",
        );
      });

    const adapter = new DoubaoProviderAdapter();
    await expect(adapter.sendPrompt(page, "继续处理")).rejects.toThrow(
      "WEB_WORK_MODE_UNAVAILABLE",
    );
  });

  it("submits through the composer and extracts only the assistant message", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(fixture("ready.html"));
    const document = page.dom.window.document;
    const input = document.querySelector("textarea") as HTMLTextAreaElement;
    document
      .querySelector("button[aria-label='发送']")
      ?.addEventListener("click", () => {
        input.value = "";
        const response = document.querySelector(".assistant-message");
        if (response) response.textContent = "新的豆包答复\n\n包含列表";
      });

    const receipt = await adapter.sendPrompt(page, "请总结附件");
    const response = await adapter.readResponse(page);
    expect(receipt.promptHash).toHaveLength(8);
    expect(response.text).toBe("新的豆包答复\n\n包含列表");
    expect(response.hasAssistantMessage).toBe(true);
  });

  it("supports Doubao's TipTap editor and explicit flow send control", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div contenteditable="true" role="textbox"><p><br></p></div>
      <button id="flow-end-msg-send" aria-label="" aria-disabled="false"></button>
    `);
    const document = page.dom.window.document;
    const editor = document.querySelector(
      '[contenteditable="true"]',
    ) as HTMLElement;
    const send = document.querySelector(
      "#flow-end-msg-send",
    ) as HTMLButtonElement;
    let clicked = false;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (_command: string, _showUi: boolean, value: string) => {
        editor.innerHTML = `<p>${value}</p>`;
        return true;
      },
    });
    send.addEventListener("click", () => {
      clicked = true;
      editor.innerHTML = "<p><br></p>";
    });

    const receipt = await adapter.sendPrompt(page, "请回复连接成功");

    expect(receipt.promptHash).toHaveLength(8);
    expect(clicked).toBe(true);
  });

  it("uses the native click bridge for Doubao's flow send control", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div contenteditable="true" role="textbox"><p><br></p></div>
      <button id="flow-end-msg-send" aria-label="" aria-disabled="false"></button>
    `);
    const document = page.dom.window.document;
    const editor = document.querySelector(
      '[contenteditable="true"]',
    ) as HTMLElement;
    const send = document.querySelector(
      "#flow-end-msg-send",
    ) as HTMLButtonElement;
    let nativeClicks = 0;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (_command: string, _showUi: boolean, value: string) => {
        editor.innerHTML = `<p>${value}</p>`;
        return true;
      },
    });
    page.click = async (selector: string) => {
      nativeClicks += 1;
      const target = document.querySelector(selector) as HTMLElement | null;
      target?.dispatchEvent(
        new page.dom.window.MouseEvent("pointerdown", { bubbles: true }),
      );
      target?.click();
    };
    send.addEventListener("click", () => {
      editor.innerHTML = "<p><br></p>";
    });

    await expect(
      adapter.sendPrompt(page, "请回复连接成功"),
    ).resolves.toBeDefined();
    expect(nativeClicks).toBe(1);
  });

  it("waits for an existing Work conversation to mount its send control", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <input role="textbox" aria-label="搜索历史会话" />
      <div contenteditable="true" role="textbox" aria-label="发送消息或创建任务"><p><br></p></div>
    `);
    const document = page.dom.window.document;
    const editor = document.querySelector(
      '[contenteditable="true"]',
    ) as HTMLElement;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (_command: string, _showUi: boolean, value: string) => {
        editor.innerHTML = `<p>${value}</p>`;
        return true;
      },
    });
    let sleeps = 0;
    page.sleep = async () => {
      sleeps += 1;
      if (sleeps !== 1) return;
      const send = document.createElement("button");
      send.setAttribute("data-testid", "message-send");
      send.addEventListener("click", () => {
        editor.innerHTML = "<p><br></p>";
      });
      document.body.appendChild(send);
    };

    await expect(adapter.sendPrompt(page, "继续追问")).resolves.toBeDefined();
    expect(sleeps).toBeGreaterThan(0);
    expect(
      (
        document.querySelector(
          'input[aria-label="搜索历史会话"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("");
  });

  it("uses native Enter when a completed Work task has no named send control", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div contenteditable="true" role="textbox" aria-label="发送消息或创建任务"><p><br></p></div>
    `);
    const document = page.dom.window.document;
    const editor = document.querySelector(
      '[contenteditable="true"]',
    ) as HTMLElement;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (_command: string, _showUi: boolean, value: string) => {
        editor.innerHTML = `<p>${value}</p>`;
        return true;
      },
    });
    editor.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key !== "Enter") return;
      const bubble = document.createElement("div");
      bubble.setAttribute("data-message-author-role", "user");
      bubble.textContent = "继续追问";
      document.body.appendChild(bubble);
      editor.innerHTML = "<p><br></p>";
    });

    await expect(adapter.sendPrompt(page, "继续追问")).resolves.toBeDefined();
    expect(
      document.querySelector('[data-message-author-role="user"]'),
    ).not.toBeNull();
  });

  it("accepts the visible user bubble when TipTap keeps text briefly", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div contenteditable="true" role="textbox"><p><br></p></div>
      <button id="flow-end-msg-send" aria-label="" aria-disabled="false"></button>
    `);
    const document = page.dom.window.document;
    const editor = document.querySelector(
      '[contenteditable="true"]',
    ) as HTMLElement;
    const send = document.querySelector(
      "#flow-end-msg-send",
    ) as HTMLButtonElement;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (_command: string, _showUi: boolean, value: string) => {
        editor.innerHTML = `<p>${value}</p>`;
        return true;
      },
    });
    send.addEventListener("click", () => {
      const bubble = document.createElement("div");
      bubble.className = "bg-g-send-msg-bubble-bg";
      bubble.textContent = "请回复连接成功";
      document.body.appendChild(bubble);
      // The real page can clear TipTap asynchronously; deliberately leave it
      // populated here to cover the false-negative path.
    });

    await expect(
      adapter.sendPrompt(page, "请回复连接成功"),
    ).resolves.toBeDefined();
  });

  it("accepts a generic Doubao message row as the submission receipt", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <textarea aria-label="消息输入框"></textarea>
      <button aria-label="发送">发送</button>
    `);
    page.dom.window.document
      .querySelector("button[aria-label='发送']")
      ?.addEventListener("click", () => {
        const row = page.dom.window.document.createElement("div");
        row.setAttribute("data-message-id", "user-1");
        row.textContent = "你好，介绍一下你都能做啥？";
        page.dom.window.document.body.appendChild(row);
      });

    await expect(
      adapter.sendPrompt(page, "你好，介绍一下你都能做啥？"),
    ).resolves.toBeDefined();
  });

  it("accepts a reformatted Work message after React replaces the composer", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div contenteditable="true" role="textbox" aria-label="发送消息或创建任务"><p><br></p></div>
      <button id="flow-end-msg-send" aria-disabled="false"></button>
    `);
    const document = page.dom.window.document;
    const editor = document.querySelector(
      '[contenteditable="true"]',
    ) as HTMLElement;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (_command: string, _showUi: boolean, value: string) => {
        editor.innerHTML = `<p>${value}</p>`;
        return true;
      },
    });
    document
      .querySelector("#flow-end-msg-send")
      ?.addEventListener("click", () => {
        editor.remove();
        const replacement = document.createElement("div");
        replacement.setAttribute("contenteditable", "true");
        replacement.setAttribute("role", "textbox");
        replacement.setAttribute("aria-label", "发送消息或创建任务");
        replacement.innerHTML = "<p><br></p>";
        document.body.appendChild(replacement);

        const row = document.createElement("div");
        row.setAttribute("data-observe-row", "block_54091406916931586");
        row.setAttribute("data-message-id", "54091406916931586");
        row.textContent =
          "请检查庆祝中国共产党成立 105 周年大会发言稿，时间不超 10 分钟。";
        document.body.appendChild(row);
      });

    await expect(
      adapter.sendPrompt(
        page,
        "请检查庆祝中国共产党成立105周年大会发言稿，时间不超10分钟。",
      ),
    ).resolves.toBeDefined();
  });

  it("reads current Doubao data-message-id assistant rows", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div data-message-id="user-1" class="flex-row flex w-full justify-end">
        <div class="bg-g-send-msg-bubble-bg">用户问题</div>
      </div>
      <div data-message-id="assistant-1" class="relative grid w-full">
        <div data-plugin-identifier="block_type:10000">
          <div data-streaming="false">当前豆包答复</div>
        </div>
      </div>
    `);

    await expect(adapter.readResponse(page)).resolves.toMatchObject({
      text: "当前豆包答复",
      hasAssistantMessage: true,
      isGenerating: false,
    });
  });

  it("keeps an untyped modern message row in progress until an answer block mounts", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div data-message-id="user-1" class="flex-row flex w-full justify-end">
        <div class="bg-g-send-msg-bubble-bg">你好，介绍一下你自己</div>
      </div>
      <div data-message-id="assistant-1" class="relative grid w-full">
        <p>用户要求介绍自己，我会先明确身份并说明能力。</p>
      </div>
    `);

    await expect(adapter.readResponse(page)).resolves.toMatchObject({
      text: "",
      hasAssistantMessage: false,
      isGenerating: true,
    });
  });

  it("does not treat a right-aligned modern user row as an assistant answer", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div data-message-id="user-1" class="flex-row flex w-full justify-end">
        <div data-plugin-identifier="block_type:10000">你好，介绍一下你自己</div>
      </div>
    `);

    await expect(adapter.readResponse(page)).resolves.toMatchObject({
      text: "",
      hasAssistantMessage: false,
    });
  });

  it("does not treat a thinking-only block as the final answer", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div data-message-id="user-1" class="flex-row flex w-full justify-end">
        <div class="bg-g-send-msg-bubble-bg">用户问题</div>
      </div>
      <div data-message-id="assistant-1" class="relative grid w-full">
        <div data-plugin-identifier="block_type:10040 | thinking_block.scene:undefined">
          <div class="group/thinking-box-root"><div>已思考</div></div>
        </div>
      </div>
    `);

    await expect(adapter.readResponse(page)).resolves.toMatchObject({
      text: "",
      hasAssistantMessage: false,
      isGenerating: true,
    });
  });

  it("keeps answer text in a legacy semantic assistant container", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div class="assistant-message relative grid w-full">
        <div data-plugin-identifier="block_type:10040 | thinking_block.scene:undefined">
          <div class="group/thinking-box-root"><div>已思考</div></div>
        </div>
        <div data-plugin-identifier="block_type:10001"><p>最终答复内容</p></div>
      </div>
    `);

    await expect(adapter.readResponse(page)).resolves.toMatchObject({
      text: "最终答复内容",
      hasAssistantMessage: true,
      isGenerating: false,
    });
  });

  it("prefers Doubao's explicit block_type:10000 answer over thinking text", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div data-message-id="assistant-1" class="relative grid w-full">
        <div data-render-engine="node" data-plugin-identifier="block_type:10040 | thinking_block.scene:undefined">
          <div class="group/thinking-box-root"><p>用户询问能提供的帮助，我会先友好回应。</p></div>
        </div>
        <div data-render-engine="node" data-plugin-identifier="block_type:10000">
          <div data-streaming="false"><p>你好呀～我是豆包，能帮你完成很多任务。</p></div>
        </div>
      </div>
    `);

    await expect(adapter.readResponse(page)).resolves.toMatchObject({
      text: "你好呀～我是豆包，能帮你完成很多任务。",
      hasAssistantMessage: true,
      isGenerating: false,
    });
  });

  it("waits for the Work-mode answer block after an initial progress block", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div data-message-id="assistant-1" class="relative grid w-full">
        <div data-plugin-identifier="block_type:10000">
          <div data-streaming="false"><p>我先读取这份讲话原文，然后为你提炼要点。</p></div>
        </div>
        <div data-plugin-identifier="block_type:10040 | thinking_block.scene:undefined">
          <div class="group/thinking-box-root"><p>正在提炼讲话要点。</p></div>
        </div>
      </div>
    `);

    await expect(adapter.readResponse(page)).resolves.toMatchObject({
      text: "",
      hasAssistantMessage: false,
      isGenerating: true,
    });
  });

  it("returns only the Work-mode answer after the final thinking block", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div data-message-id="assistant-1" class="relative grid w-full">
        <div data-plugin-identifier="block_type:10000">
          <div data-streaming="false"><p>我先读取这份讲话原文，然后为你提炼要点。</p></div>
        </div>
        <div data-plugin-identifier="block_type:10040 | thinking_block.scene:undefined">
          <div class="group/thinking-box-root"><p>已完成分析。</p></div>
        </div>
        <div data-plugin-identifier="block_type:10000">
          <div data-streaming="false"><p>已通读全文，以下是讲话核心要点。</p><h2>讲话基调与主题</h2></div>
        </div>
      </div>
    `);

    await expect(adapter.readResponse(page)).resolves.toMatchObject({
      text: ["已通读全文，以下是讲话核心要点。", "", "## 讲话基调与主题"].join(
        "\n",
      ),
      hasAssistantMessage: true,
      isGenerating: false,
    });
  });

  it("removes leaked Work-mode think markup from the final answer", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div data-message-id="assistant-1" class="relative grid w-full">
        <div data-plugin-identifier="block_type:10040 | thinking_block.scene:undefined">
          <div class="group/thinking-box-root"><p>已完成分析。</p></div>
        </div>
        <div data-plugin-identifier="block_type:10000">
          <div data-streaming="false">
            <p>主体答复内容。</p>
            <p>&lt;think&gt;This is internal planning text and must not be shown.&lt;/think&gt;</p>
            <p>答复结尾。</p>
          </div>
        </div>
      </div>
    `);

    await expect(adapter.readResponse(page)).resolves.toMatchObject({
      text: "主体答复内容。\n\n答复结尾。",
      hasAssistantMessage: true,
      isGenerating: false,
    });
  });

  it("preserves Doubao headings, paragraphs, and lists as Markdown", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div data-message-id="assistant-1" class="relative grid w-full">
        <div data-plugin-identifier="block_type:10000">
          <p>你好！我是你的 AI 助手，可以帮你完成以下几类事情：</p>
          <h2>信息检索与分析</h2>
          <ul>
            <li>联网搜索新闻、政策和行业动态</li>
            <li><strong>金融数据</strong>查询与分析</li>
          </ul>
          <h2>文档与办公</h2>
          <ol>
            <li>撰写、润色和翻译文稿</li>
            <li>处理 Word、Excel、PPT 和 PDF 文件</li>
          </ol>
        </div>
      </div>
    `);

    await expect(adapter.readResponse(page)).resolves.toMatchObject({
      text: [
        "你好！我是你的 AI 助手，可以帮你完成以下几类事情：",
        "",
        "## 信息检索与分析",
        "",
        "- 联网搜索新闻、政策和行业动态",
        "- **金融数据**查询与分析",
        "",
        "## 文档与办公",
        "",
        "1. 撰写、润色和翻译文稿",
        "2. 处理 Word、Excel、PPT 和 PDF 文件",
      ].join("\n"),
      hasAssistantMessage: true,
      isGenerating: false,
    });
  });

  it("preserves the start number of split ordered-list segments", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div data-message-id="assistant-1" class="relative grid w-full">
        <div data-plugin-identifier="block_type:10000">
          <ol>
            <li>核心主旨</li>
            <li>百余年奋斗的五方面成就</li>
          </ol>
          <ol start="3">
            <li>中国共产党长期成功的“关键密码”</li>
          </ol>
          <ol start="4">
            <li>新征程的五项总体要求</li>
          </ol>
        </div>
      </div>
    `);

    await expect(adapter.readResponse(page)).resolves.toMatchObject({
      text: [
        "1. 核心主旨\n2. 百余年奋斗的五方面成就",
        "3. 中国共产党长期成功的“关键密码”",
        "4. 新征程的五项总体要求",
      ].join("\n\n"),
      hasAssistantMessage: true,
      isGenerating: false,
    });
  });

  it("only activates explicit download controls from the newest assistant reply", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(fixture("ready.html"));
    let downloads = 0;
    page.dom.window.document
      .querySelector(".assistant-message a[download]")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        downloads += 1;
      });
    expect(await adapter.collectDownloads(page)).toBe(1);
    expect(downloads).toBe(1);
  });

  it("fails closed instead of silently reusing a nested conversation", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(fixture("ready.html"));
    await page.navigate("https://www.doubao.com/chat/existing-conversation");
    await expect(adapter.createConversation(page)).rejects.toThrow(
      "未能确认豆包已创建新的网页会话",
    );
  });

  it("recognizes the current sidebar div as the new-chat control", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div class="nav-link-current"><span>新对话</span><span>Ctrl Shift K</span></div>
      <button data-active="true">对话</button>
      <button>工作</button>
      <div contenteditable="true" role="textbox"></div>
    `);
    const candidate =
      page.dom.window.document.querySelector(".nav-link-current");
    let clicked = false;
    candidate?.addEventListener("click", () => {
      clicked = true;
    });

    await adapter.createConversation(page);

    expect(clicked).toBe(true);
  });

  it("reloads the generic landing route to clear a stale upload draft", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div class="nav-link-current"><span>新对话</span><span>Ctrl Shift K</span></div>
      <button data-active="true">对话</button>
      <button>工作</button>
      <div contenteditable="true" role="textbox"></div>
      <div class="stale-upload" data-available="false">旧附件.md 上传中... 0%</div>
    `);
    const originalNavigate = page.navigate.bind(page);
    let landingReloads = 0;
    page.navigate = async (url: string) => {
      landingReloads += 1;
      await originalNavigate(url);
      page.dom.window.document.querySelector(".stale-upload")?.remove();
    };

    await adapter.createConversation(page);

    expect(landingReloads).toBe(1);
    expect(page.dom.window.document.querySelector(".stale-upload")).toBeNull();
  });

  it("waits for a cold Doubao landing page to finish delayed hydration", async () => {
    const adapter = new DoubaoProviderAdapter();
    const page = new FixturePage(`
      <div class="nav-link-current"><span>新对话</span></div>
    `);
    const originalNavigate = page.navigate.bind(page);
    let sleeps = 0;
    page.navigate = async (url: string) => {
      await originalNavigate(url);
      page.dom.window.document.body.innerHTML = "";
    };
    page.sleep = async () => {
      sleeps += 1;
      if (sleeps === 24) {
        page.dom.window.document.body.innerHTML = `
          <button data-active="true">对话</button>
          <button>工作</button>
          <div contenteditable="true" role="textbox"></div>
        `;
      }
    };

    await adapter.createConversation(page);

    expect(sleeps).toBeGreaterThanOrEqual(24);
    await expect(adapter.modeState(page)).resolves.toMatchObject({
      mode: "chat",
    });
  });

  it("uses one safe DOM submit fallback when the trusted click leaves an unchanged draft", async () => {
    vi.useFakeTimers();
    try {
      const adapter = new DoubaoProviderAdapter();
      const page = new FixturePage(`
        <div contenteditable="true" role="textbox"><p><br></p></div>
        <button id="flow-end-msg-send" aria-disabled="false"></button>
      `);
      const document = page.dom.window.document;
      const editor = document.querySelector(
        '[contenteditable="true"]',
      ) as HTMLElement;
      const send = document.querySelector(
        "#flow-end-msg-send",
      ) as HTMLButtonElement;
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: (_command: string, _showUi: boolean, value: string) => {
          editor.innerHTML = `<p>${value}</p>`;
          return true;
        },
      });
      page.click = async () => {
        // Chromium can acknowledge the coordinate click while the transparent
        // provider surface still leaves the React composer unchanged.
      };
      page.sleep = async (milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
      send.addEventListener("click", () => {
        editor.innerHTML = "<p><br></p>";
        const row = document.createElement("div");
        row.setAttribute("data-message-id", "user-safe-fallback");
        row.textContent = "请回复安全回退成功";
        document.body.appendChild(row);
      });

      const receipt = adapter.sendPrompt(page, "请回复安全回退成功");
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(receipt).resolves.toBeDefined();
      expect(
        document.querySelector("[data-message-id='user-safe-fallback']"),
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
