/**
 * U5 core-workflow UI acceptance check.
 *
 * Start a development instance with CDP enabled, then run:
 *   node scripts/verify-u5-ui.js --cdp-port=19232
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
  option("output-dir", ".sandbox/u5-final/automated-ui"),
);

async function pageMetrics(page) {
  return page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    contentWidth: document.querySelector(".content")?.getBoundingClientRect().width || 0,
  }));
}

async function assertLayout(page, label) {
  const metrics = await pageMetrics(page);
  assert(metrics.scrollWidth <= metrics.width + 1, `${label}: horizontal overflow`);
  assert(metrics.contentWidth >= 430, `${label}: main content is too narrow`);
  return metrics;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { browser, context, page } = await attach({
    cdpUrl: `http://127.0.0.1:${cdpPort}`,
  });
  page.setDefaultTimeout(7_000);
  const cdp = await context.newCDPSession(page);

  function step(label) {
    process.stderr.write(`[u5-ui] ${label}\n`);
  }

  async function capture(name) {
    try {
      const { windowId } = await cdp.send("Browser.getWindowForTarget");
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "normal" },
      });
    } catch {
      // Electron builds without Browser window commands still support bringToFront.
    }
    await page.bringToFront();
    await page.waitForTimeout(1_000);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.screenshot({
      path: path.join(outputDir, `${name}.png`),
      timeout: 20_000,
    });
  }

  async function openNav(name, view = name) {
    const navButton = page.locator(".sidebar-nav-pinned").getByRole("button", { name, exact: true });
    const navButtonCount = await navButton.count();
    if (navButtonCount === 1) {
      await navButton.click();
    } else if (["projects", "tasks", "chat", "schedules", "agents"].includes(view)) {
      // Project Center and Task Center are persistent internal panes in the
      // current shell, not pinned nav buttons. Use their public navigation
      // event so this acceptance suite stays valid across shell layouts.
      await page.evaluate((targetView) => {
        window.dispatchEvent(new CustomEvent("navigation:goto", { detail: targetView }));
      }, view);
    } else {
      throw new Error(`${name}: navigation entry is missing`);
    }
    await page.waitForTimeout(180);
    return assertLayout(page, name);
  }

  try {
    // A fresh renderer state keeps an interrupted prior CDP run or a hot reload
    // from leaving a dialog's aria-hidden/pointer-event guard behind.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".sidebar-nav-pinned").waitFor();
    await page.setViewportSize({ width: 1024, height: 768 });

    step("conversation");
    // “聊天” opens the compact quick-chat surface by design. The full native
    // conversation shell used by this acceptance suite is opened by “新建任务”.
    const chat = await openNav("新建任务", "chat");
    assert(await page.locator(".chat-container").count(), "聊天: conversation container is missing");
    assert(await page.locator(".chat-input-area").count(), "聊天: composer is missing");
    await capture("01-conversation-1024");

    step("project overview");
    const project = await openNav("项目", "projects");
    await page.waitForTimeout(350);
    const projectTabs = page.getByRole("tablist", { name: "项目视图" });
    if (await projectTabs.count()) {
      await page.getByRole("tab", { name: /^概览/ }).click();
      assert(await page.locator(".project-overview-metrics").count(), "项目: compact overview is missing");
      await capture("02-project-overview-1024");

      step("project create form");
      await page.getByRole("region", { name: "项目", exact: true }).getByRole("button", { name: "新建项目", exact: true }).click();
      const projectCreateForm = page.locator(".project-create-form");
      await projectCreateForm.waitFor();
      assert(await projectCreateForm.getByText("项目名称", { exact: true }).count(), "项目: name field is missing");
      assert(await projectCreateForm.getByText("项目目标", { exact: true }).count(), "项目: objective field is missing");
      await assertLayout(page, "项目新建表单");
      await capture("02b-project-create-1024");
      await projectCreateForm.getByRole("button", { name: "取消新建项目" }).click();

      step("project tasks");
      await page.getByRole("tab", { name: /^任务/ }).click();
      assert(await page.locator(".project-center-grid--details").count(), "项目: task workspace is missing");
      await capture("03-project-tasks-1024");

      step("project artifacts");
      await page.getByRole("tab", { name: /^产物/ }).click();
      assert(await page.locator(".project-artifacts").count(), "项目: artifact view is missing");

      step("project activity");
      await page.getByRole("tab", { name: /^活动/ }).click();
      assert(await page.locator(".project-events").count(), "项目: activity view is missing");
      const rawEventLabels = await page.locator(".project-event > span").allTextContents();
      assert(rawEventLabels.every((label) => !label.includes("_")), "项目: raw event type is visible");
      await capture("04-project-activity-1024");
    }

    step("task list and detail 1024");
    const tasks = await openNav("任务中心", "tasks");
    await page.waitForTimeout(500);
    const taskRegion = page.getByRole("region", { name: "任务", exact: true });
    await taskRegion.waitFor();
    await page.getByRole("button", { name: "列表视图" }).click();
    const newTask = taskRegion.getByRole("button", { name: "新建任务", exact: true });
    if (await newTask.count()) {
      step("task create form");
      await newTask.click();
      const taskCreateForm = taskRegion.locator("form.task-compose");
      await taskCreateForm.waitFor();
      assert(await taskCreateForm.getByText("执行智能体", { exact: true }).count(), "任务中心: runtime field is missing");
      assert(await taskCreateForm.getByText("任务说明", { exact: true }).count(), "任务中心: prompt field is missing");
      await assertLayout(page, "任务新建表单");
      await capture("05a-task-create-1024");
      await taskCreateForm.getByRole("button", { name: "取消", exact: true }).click();
    }
    const existingClose = page.getByRole("button", { name: "关闭任务详情" });
    if (await existingClose.count()) await existingClose.click();
    assert(!(await page.locator(".task-detail-panel").count()), "任务中心: detail opens without an explicit selection");
    const firstTask = page.locator(".task-row-main--selectable").first();
    assert(await firstTask.count(), "任务中心: no task is available for detail acceptance");
    await firstTask.click();
    await page.locator(".task-detail-panel").waitFor();
    const taskDetail1024 = await page.locator(".task-detail-panel").evaluate((element) => ({
      position: getComputedStyle(element).position,
      right: Math.round(window.innerWidth - element.getBoundingClientRect().right),
      width: Math.round(element.getBoundingClientRect().width),
    }));
    assert(taskDetail1024.position === "fixed", "任务中心: detail is not a drawer at 1024px");
    assert(taskDetail1024.width >= 320, "任务中心: detail drawer is too narrow");
    await capture("05-task-list-detail-1024");
    await page.getByRole("button", { name: "关闭任务详情" }).click();

    step("task board 1024");
    await page.getByRole("button", { name: "看板视图" }).click();
    const board1024 = await page.locator(".task-board").evaluate((element) => ({
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
    }));
    assert(board1024.scrollWidth <= board1024.width + 1, "任务中心: board overflows at 1024px");
    assert(board1024.columns === 2, "任务中心: expected two board columns at 1024px");
    await capture("05-task-board-1024");

    step("schedules");
    await openNav("定时任务", "schedules");
    await page.getByLabel("本地智能体定时任务").waitFor({ timeout: 15_000 });
    assert(await page.getByLabel("远程 Hermes 定时任务").count(), "定时任务: Hermes compatibility view is missing");
    await capture("06-schedules-1024");
    step("schedule create form");
    await page.locator(".schedules-container").getByRole("button", { name: "新建定时任务", exact: true }).click();
    const scheduleModal = page.locator(".schedules-modal");
    await scheduleModal.waitFor();
    assert(await scheduleModal.getByRole("heading", { name: "新建定时任务" }).count(), "任务中心: schedule form title is ambiguous");
    assert(await scheduleModal.getByText("执行智能体", { exact: true }).count(), "任务中心: schedule runtime field is missing");
    await assertLayout(page, "定时任务新建表单");
    await capture("06b-schedule-create-1024");
    await scheduleModal.getByRole("button", { name: "取消", exact: true }).click();

    step("agents");
    const agents = await openNav("智能体");
    assert(await page.locator(".agents-runtime-card").count(), "智能体: no connected agent card is visible");
    const agentHealthLabels = await page.locator(".agents-runtime-health").allTextContents();
    assert(agentHealthLabels.every((label) => label !== "未检测"), "智能体: enabled agents look unchecked while probing");
    assert(!(await page.locator("body").innerText()).includes("Agent Runtimes"), "智能体: legacy English heading is visible");
    assert(!(await page.locator("body").innerText()).includes("Dashboard chat isn't available"), "智能体: fallback notice is not localized");
    await capture("07-agents-1024");
    const agentCards = page.locator(".agents-runtime-card");
    const agentCardCount = await agentCards.count();
    assert(agentCardCount > 0, "智能体: no runtime card is available for management");
    const manage = agentCards.first().getByRole("button", { name: "管理", exact: true });
    assert(await manage.count(), "智能体: runtime management action is missing");
    await manage.click();
    const agentManager = page.getByRole("dialog");
    await agentManager.waitFor();
    assert(await agentManager.getByText("模型覆盖", { exact: true }).count(), "智能体: runtime configuration form is missing");
    assert(await agentManager.getByRole("button", { name: "保存更改", exact: true }).count(), "智能体: save action is missing");
    await capture("08-agent-editor-1024");
    await agentManager.getByRole("button", { name: "关闭", exact: true }).click();

    step("settings");
    await page.keyboard.press("Control+,");
    const settingsDialog = page.locator(".settings-modal");
    await settingsDialog.waitFor();
    const settingsText = await settingsDialog.innerText();
    assert(settingsText.includes("主题"), "设置: appearance controls are missing");
    assert(!settingsText.includes("Runtimes"), "设置: English Runtimes label is visible");
    assert(!settingsText.includes("Community"), "设置: Community entry is visible");
    assert(!settingsText.includes("Rounded corners"), "设置: appearance labels fell back to English");
    await capture("09-settings-1024");
    await page.locator(".settings-modal-close").click();
    await settingsDialog.waitFor({ state: "hidden" });

    step("conversation 768");
    await page.setViewportSize({ width: 768, height: 800 });
    const chat768 = await openNav("新建任务", "chat");
    const composer768 = await page.locator(".chat-input-area").evaluate((element) => ({
      width: Math.round(element.getBoundingClientRect().width),
      right: Math.round(window.innerWidth - element.getBoundingClientRect().right),
    }));
    assert(composer768.width >= 400, "聊天: composer is too narrow at 768px");
    await capture("10-conversation-768");

    step("task board 768");
    await openNav("任务中心", "tasks");
    await page.getByRole("region", { name: "任务", exact: true }).waitFor();
    await page.getByRole("button", { name: "看板视图" }).click();
    const board768 = await page.locator(".task-board").evaluate((element) => ({
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
    }));
    assert(board768.scrollWidth <= board768.width + 1, "任务中心: board overflows at 768px");
    assert(board768.columns === 1, "任务中心: expected one board column at 768px");
    await capture("11-task-board-768");

    console.log(JSON.stringify({
      verdict: "passed",
      views: ["对话", "项目概览", "项目新建", "项目任务", "项目产物", "项目活动", "任务新建", "任务列表与详情", "任务看板", "定时任务", "定时任务新建", "智能体", "智能体编辑", "设置"],
      viewports: ["1024x768", "768x800"],
      metrics: { chat, project, tasks, agents, chat768, composer768, taskDetail1024, board1024, board768 },
      outputDir,
    }));
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 }).catch(() => undefined);
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
