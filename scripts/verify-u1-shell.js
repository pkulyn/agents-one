/**
 * U1 application-shell visual regression check.
 *
 * Start an isolated development app first:
 *   $env:ENABLE_CDP = '1'; $env:CDP_PORT = '19231'; npm run dev
 *
 * Then run:
 *   node scripts/verify-u1-shell.js --cdp-port=19231
 */

const fs = require("fs");
const path = require("path");
const { attach } = require("./e2e-attach");

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const cdpPort = option("cdp-port", process.env.CDP_PORT || "9222");
const outputDir = path.resolve(
  option("output-dir", ".sandbox/u1-shell/visual-regression"),
);

async function inspect(page, name) {
  await page
    .locator(".sidebar-nav-pinned")
    .getByRole("button", { name, exact: true })
    .click();
  await page.waitForTimeout(250);
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    sidebarWidth: document.querySelector(".sidebar")?.getBoundingClientRect()
      .width ?? 0,
    contentWidth: document.querySelector(".content")?.getBoundingClientRect()
      .width ?? 0,
    activeSessionsBars: document.querySelectorAll(".active-sessions-bar")
      .length,
    chatSections: document.querySelectorAll(".sidebar-chat-section").length,
  }));
  await page.screenshot({ path: path.join(outputDir, `${name}-1024.png`) });
  assert(metrics.width === 1024, `${name}: expected 1024px viewport`);
  assert(metrics.scrollWidth <= metrics.width, `${name}: horizontal overflow`);
  assert(metrics.sidebarWidth >= 200, `${name}: sidebar unexpectedly collapsed`);
  assert(metrics.contentWidth >= 640, `${name}: main content is too narrow`);
  assert(metrics.activeSessionsBars === 0, `${name}: legacy session bar is visible`);
  assert(metrics.chatSections === 0, `${name}: chat list is visible`);
  return metrics;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { browser, page } = await attach({
    cdpUrl: `http://127.0.0.1:${cdpPort}`,
  });

  try {
    await page.setViewportSize({ width: 1024, height: 768 });
    const nonChat = {};
    for (const name of ["项目", "任务中心", "智能体"]) {
      nonChat[name] = await inspect(page, name);
    }

    await page
      .locator(".sidebar-nav-pinned")
      .getByRole("button", { name: "对话", exact: true })
      .click();
    await page.waitForTimeout(250);
    const chat = await page.evaluate(() => ({
      activeSessionsBars: document.querySelectorAll(".active-sessions-bar")
        .length,
      chatSections: document.querySelectorAll(".sidebar-chat-section").length,
      scrollWidth: document.documentElement.scrollWidth,
      width: window.innerWidth,
    }));
    await page.screenshot({ path: path.join(outputDir, "对话-1024.png") });
    assert(chat.scrollWidth <= chat.width, "对话: horizontal overflow");
    assert(chat.activeSessionsBars === 1, "对话: session bar is missing");
    assert(chat.chatSections === 1, "对话: recent conversation list is missing");

    console.log(
      JSON.stringify({
        verdict: "passed",
        viewport: "1024x768",
        nonChat,
        chat,
        outputDir,
      }),
    );
  } finally {
    await page.setViewportSize({ width: 1600, height: 1080 });
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
