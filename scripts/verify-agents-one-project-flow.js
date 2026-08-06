/**
 * Live Agents One project-flow verifier.
 *
 * Start a disposable dev instance before running:
 *   $env:HERMES_HOME = "$PWD\.sandbox\agents-one-project-flow"
 *   $env:ENABLE_CDP = "1"; $env:CDP_PORT = "9223"; npm run dev
 *
 * The script reads existing local connection credentials only to configure the
 * disposable profile. It never prints credentials or remote response bodies.
 */

const fs = require("fs");
const path = require("path");
const { attach } = require("./e2e-attach");

const TIMEOUT_MS = 180_000;
const SOURCE_HOME = path.join(process.env.LOCALAPPDATA, "hermes");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readEnvValue(file, key) {
  const prefix = `${key}=`;
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((item) => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : "";
}

async function eventually(page, predicate, label, argument) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await page.evaluate(predicate, argument);
    if (result && result.done) return result;
    if (result && result.failed) throw new Error(`${label}: ${result.failed}`);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`${label} timed out after ${TIMEOUT_MS}ms.`);
}

async function main() {
  const desktop = JSON.parse(fs.readFileSync(path.join(SOURCE_HOME, "desktop.json"), "utf8"));
  const codex = (desktop.agentRuntimes || []).find((runtime) => runtime.kind === "codex");
  const openclaw = (desktop.agentRuntimes || []).find((runtime) => runtime.kind === "openclaw");
  const openclawToken = openclaw
    ? readEnvValue(
      path.join(SOURCE_HOME, ".env"),
      `HERMES_OPENCLAW_RUNTIME_${openclaw.id.replace(/-/g, "_").toUpperCase()}_BEARER_TOKEN`,
    )
    : "";

  assert(desktop.remoteUrl && desktop.remoteApiKey, "A remote Hermes connection is required.");
  assert(codex?.config?.executablePath, "A configured Codex runtime is required.");
  assert(codex?.config?.workspace, "A Codex workspace is required.");
  assert(openclaw?.config?.endpoint && openclawToken, "A configured OpenClaw runtime is required.");

  const { browser, page } = await attach({ cdpUrl: "http://127.0.0.1:9223" });
  try {
    await page.waitForFunction(() => Boolean(window.hermesAPI), { timeout: 30_000 });
    const setup = await page.evaluate(async (input) => {
      await window.hermesAPI.setConnectionConfig(
        "remote",
        input.remoteUrl,
        input.remoteApiKey,
        input.remoteDashboardUrl,
        input.remoteDashboardToken,
      );
      await window.hermesAPI.saveAgentRuntime({
        id: "e2e-codex",
        name: "E2E Codex",
        kind: "codex",
        location: "local",
        enabled: true,
        config: {
          transport: "cli",
          executablePath: input.codexExecutable,
          workspace: input.workspace,
          timeoutMs: 120_000,
        },
      });
      await window.hermesAPI.saveAgentRuntime({
        id: "e2e-openclaw",
        name: "E2E OpenClaw",
        kind: "openclaw",
        location: "remote",
        enabled: true,
        config: { endpoint: input.openclawEndpoint, transport: "http", timeoutMs: 120_000 },
      });
      await window.hermesAPI.setAgentRuntimeBearerToken("e2e-openclaw", input.openclawToken);

      const runtimes = await window.hermesAPI.listAgentRuntimes();
      const project = await window.hermesAPI.createProjectControlProject({
        title: "E2E project flow",
        objective: "Verify coordinator planning, dependency release, isolated implementation, and acceptance.",
        coordinator: { kind: "runtime", runtimeId: "hermes-remote" },
        workspace: input.workspace,
      });
      await window.hermesAPI.updateProjectControlCollaborators({
        projectId: project.id,
        collaborators: [
          { role: "manager", kind: "runtime", runtimeId: "hermes-remote" },
          { role: "implementer", kind: "runtime", runtimeId: "e2e-codex" },
          { role: "tester", kind: "runtime", runtimeId: "e2e-openclaw" },
          { role: "reviewer", kind: "runtime", runtimeId: "e2e-openclaw" },
          { role: "acceptor", kind: "human" },
        ],
      });
      const planTask = await window.hermesAPI.startProjectCoordinatorPlan(project.id);
      return {
        projectId: project.id,
        planTaskId: planTask.id,
        runtimeIds: runtimes.map((runtime) => runtime.id),
      };
    }, {
      remoteUrl: desktop.remoteUrl,
      remoteApiKey: desktop.remoteApiKey,
      remoteDashboardUrl: desktop.remoteDashboardUrl || "",
      remoteDashboardToken: desktop.remoteDashboardToken || "",
      codexExecutable: codex.config.executablePath,
      workspace: codex.config.workspace,
      openclawEndpoint: openclaw.config.endpoint,
      openclawToken,
    });

    assert(setup.runtimeIds.includes("hermes-remote"), "Built-in remote Hermes runtime was unavailable.");
    assert(setup.runtimeIds.includes("e2e-codex"), "Codex runtime was not saved.");
    assert(setup.runtimeIds.includes("e2e-openclaw"), "OpenClaw runtime was not saved.");

    const planRun = await eventually(page, async ({ projectId, planTaskId }) => {
      const tasks = await window.hermesAPI.listProjectControlTasks(projectId);
      const task = tasks.find((item) => item.id === planTaskId);
      if (!task) return { failed: "Coordinator task disappeared." };
      if (["failed", "cancelled", "timed_out"].includes(task.status)) return { failed: `Coordinator status: ${task.status}` };
      return { done: task.status === "review_required", status: task.status };
    }, "Hermes coordinator plan", {
      projectId: setup.projectId,
      planTaskId: setup.planTaskId,
    });
    assert(planRun.status === "review_required", "Coordinator plan did not reach review.");

    const prepared = await page.evaluate(async ({ projectId, planTaskId, workspace }) => {
      const draft = await window.hermesAPI.previewProjectPlanTasks(projectId, planTaskId);
      const prerequisite = await window.hermesAPI.createProjectControlTask({
        projectId,
        title: "E2E prerequisite",
        requirement: "Record that the planning result is ready for implementation.",
        acceptanceCriteria: "A human reviewer accepts this prerequisite.",
      });
      const implementation = await window.hermesAPI.createProjectControlTask({
        projectId,
        title: "E2E isolated Codex implementation",
        requirement: "Do not modify files. Inspect the repository and reply with a concise confirmation that the task ran in an isolated worktree.",
        acceptanceCriteria: "The task completes, has a managed worktree reference, and leaves the source workspace unchanged.",
        dependencies: [prerequisite.id],
      });
      await window.hermesAPI.setProjectControlTaskStatus(prerequisite.id, "queued", "Manual prerequisite review queued.");
      await window.hermesAPI.setProjectControlTaskStatus(prerequisite.id, "running", "Manual prerequisite review started.");
      await window.hermesAPI.setProjectControlTaskStatus(prerequisite.id, "review_required", "Planning review completed.");
      await window.hermesAPI.reviewProjectControlTask(prerequisite.id, "accepted", "Prerequisite accepted by E2E verifier.");
      const released = (await window.hermesAPI.listProjectControlTasks(projectId)).find((item) => item.id === implementation.id);
      if (!released || released.status !== "ready") throw new Error("Dependency did not release implementation task.");
      await window.hermesAPI.assignProjectControlTask({
        taskId: released.id,
        runtimeId: "e2e-codex",
        role: "implementer",
        mode: "implementation",
        workspace,
      });
      const dispatched = await window.hermesAPI.dispatchProjectControlTask(released.id);
      return {
        draftTaskCount: draft.tasks.length,
        implementationTaskId: dispatched.id,
        blockedBeforeRelease: implementation.status,
        releasedStatus: released.status,
      };
    }, { projectId: setup.projectId, planTaskId: setup.planTaskId, workspace: codex.config.workspace });

    assert(prepared.draftTaskCount > 0, "Coordinator output did not produce a reviewable task draft.");
    assert(prepared.blockedBeforeRelease === "blocked", "Dependent task was not initially blocked.");
    assert(prepared.releasedStatus === "ready", "Dependent task was not released after acceptance.");

    const codexRun = await eventually(page, async ({ projectId, taskId }) => {
      const tasks = await window.hermesAPI.listProjectControlTasks(projectId);
      const task = tasks.find((item) => item.id === taskId);
      if (!task) return { failed: "Implementation task disappeared." };
      if (["failed", "cancelled", "timed_out"].includes(task.status)) return { failed: `Codex status: ${task.status}` };
      return { done: task.status === "review_required", status: task.status, directTaskCenterTaskId: task.directTaskCenterTaskId };
    }, "Codex implementation", {
      projectId: setup.projectId,
      taskId: prepared.implementationTaskId,
    });
    assert(codexRun.status === "review_required", "Codex implementation did not reach review.");

    const final = await page.evaluate(async ({ projectId, taskId, directTaskCenterTaskId }) => {
      const context = await window.hermesAPI.createProjectControlContext(taskId);
      await window.hermesAPI.reviewProjectControlTask(taskId, "accepted", "Codex worktree and final output accepted by E2E verifier.");
      const direct = (await window.hermesAPI.listTaskCenterTasks()).find((item) => item.id === directTaskCenterTaskId);
      const task = (await window.hermesAPI.listProjectControlTasks(projectId)).find((item) => item.id === taskId);
      const events = await window.hermesAPI.listProjectControlEvents(projectId);
      return {
        projectTaskStatus: task?.status,
        directTaskStatus: direct?.status,
        directTaskAcceptance: direct?.acceptance,
        worktreePath: direct?.worktreePath || "",
        contextArtifactCount: context.artifacts.length,
        eventTypes: Array.from(new Set(events.map((event) => event.type))).sort(),
      };
    }, { projectId: setup.projectId, taskId: prepared.implementationTaskId, directTaskCenterTaskId: codexRun.directTaskCenterTaskId });

    assert(final.projectTaskStatus === "accepted", "Project implementation was not accepted.");
    assert(
      final.directTaskStatus === "review_required" && final.directTaskAcceptance === "accepted",
      "Task Center run did not retain the accepted review state.",
    );
    assert(final.worktreePath, "Codex implementation did not publish a worktree reference.");
    assert(final.eventTypes.includes("handoff") && final.eventTypes.includes("acceptance"), "Project handoff or acceptance event was missing.");

    await page.getByRole("button", { name: "项目" }).click().catch(() => {});
    const screenshotCaptured = await page.screenshot({
      path: path.join(process.cwd(), ".sandbox", "agents-one-project-flow.png"),
      timeout: 10_000,
    }).then(() => true).catch(() => false);
    console.log(JSON.stringify({
      verdict: "passed",
      coordinator: "hermes-remote",
      implementer: "e2e-codex",
      reviewer: "e2e-openclaw",
      coordinatorDraftTasks: prepared.draftTaskCount,
      dependency: "blocked -> ready",
      implementation: "review_required -> accepted",
      worktreePublished: true,
      contextArtifactCount: final.contextArtifactCount,
      projectEvents: final.eventTypes,
      screenshotCaptured,
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[project-flow FAILED]", error.stack || error.message);
  process.exit(1);
});
