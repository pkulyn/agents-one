/**
 * Scheduled-task bilingual UI acceptance check.
 *
 * Start an isolated development instance with CDP enabled, then run:
 *   node scripts/verify-schedules-i18n.js --cdp-port=19233
 */

const fs = require("fs");
const path = require("path");
const { attach } = require("./e2e-attach");

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const cdpPort = option("cdp-port", process.env.CDP_PORT || "9222");
const outputDir = path.resolve(
  option("output-dir", ".sandbox/u5-final/schedules-i18n"),
);

const locales = {
  en: {
    nav: "Scheduled tasks",
    source: "Agent scheduled tasks",
    create: "New Task",
    runtime: "Agent",
    timeout: "Maximum Run Time",
    concurrency: "Concurrency Policy",
    cancel: "Cancel",
    agentsNav: "Agents",
    agentsTitle: "Agents",
    addAgent: "Add Agent",
  },
  "zh-CN": {
    nav: "定时任务",
    source: "智能体定时任务",
    create: "新建定时任务",
    runtime: "执行智能体",
    timeout: "最长执行时长",
    concurrency: "并发策略",
    cancel: "取消",
    agentsNav: "智能体",
    agentsTitle: "智能体",
    addAgent: "新增智能体",
  },
};

async function assertNoOverflow(page, locale, viewport) {
  const metrics = await page.evaluate(() =>
    ["html", "body", ".content", ".schedules-container", ".agents-container"]
      .map((selector) => {
        const element = document.querySelector(selector);
        return element
          ? {
              selector,
              width: element.clientWidth,
              scrollWidth: element.scrollWidth,
            }
          : null;
      })
      .filter(Boolean),
  );
  for (const metric of metrics) {
    assert(
      metric.scrollWidth <= metric.width + 1,
      `${locale} ${viewport.width}x${viewport.height}: ${metric.selector} has horizontal overflow (${metric.scrollWidth} > ${metric.width})`,
    );
  }
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { browser, page } = await attach({
    cdpUrl: `http://127.0.0.1:${cdpPort}`,
  });
  page.setDefaultTimeout(10_000);

  try {
    for (const [locale, labels] of Object.entries(locales)) {
      await page.evaluate(async (nextLocale) => {
        await window.agentsOneAPI.setLocale(nextLocale);
      }, locale);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".sidebar-nav-pinned").waitFor();
      assert(
        (await page.locator("html").getAttribute("lang")) === locale,
        `${locale}: document language was not applied`,
      );

      await page
        .locator(".sidebar-nav-pinned")
        .getByRole("button", { name: labels.nav, exact: true })
        .click();
      await page.getByLabel(labels.source).waitFor();

      for (const viewport of [
        { width: 1024, height: 768 },
        { width: 768, height: 800 },
      ]) {
        await page.setViewportSize(viewport);
        await assertNoOverflow(page, locale, viewport);
        await page.screenshot({
          path: path.join(
            outputDir,
            `${locale}-${viewport.width}x${viewport.height}.png`,
          ),
        });
      }

      await page
        .locator(".schedules-container")
        .getByRole("button", { name: labels.create, exact: true })
        .click();
      const modal = page.locator(".schedules-modal");
      await modal.waitFor();
      assert(
        (await modal.getByLabel(labels.runtime).count()) === 1,
        `${locale}: runtime field is missing or ambiguous`,
      );
      assert(
        (await modal.getByLabel(labels.timeout).count()) === 1,
        `${locale}: timeout field is missing or ambiguous`,
      );
      assert(
        (await modal.getByLabel(labels.concurrency).count()) === 1,
        `${locale}: concurrency field is missing or ambiguous`,
      );
      await assertNoOverflow(page, locale, { width: 768, height: 800 });
      await page.screenshot({
        path: path.join(outputDir, `${locale}-create-768x800.png`),
      });
      await modal
        .getByRole("button", { name: labels.cancel, exact: true })
        .click();

      await page
        .locator(".sidebar-nav-pinned")
        .getByRole("button", { name: labels.agentsNav, exact: true })
        .click();
      await page
        .locator(".agents-container")
        .getByRole("heading", { name: labels.agentsTitle, exact: true })
        .waitFor();
      assert(
        (await page
          .locator(".agents-container")
          .getByRole("button", { name: labels.addAgent, exact: true })
          .count()) === 1,
        `${locale}: add-agent action is missing or ambiguous`,
      );
      await assertNoOverflow(page, locale, { width: 768, height: 800 });
      await page.screenshot({
        path: path.join(outputDir, `${locale}-agents-768x800.png`),
      });
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
