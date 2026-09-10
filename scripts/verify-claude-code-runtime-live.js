/** Live Claude Code Runtime smoke test for an ENABLE_CDP=1 dev instance. */

const fs = require("fs");
const path = require("path");
const { attach } = require("./e2e-attach");

const executable = process.env.CLAUDE_EXECUTABLE;
const workspace = process.env.CLAUDE_WORKSPACE || process.cwd();
const timeoutMs = 120_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(
    executable && fs.existsSync(executable),
    "Set CLAUDE_EXECUTABLE to an existing Claude Code executable.",
  );
  const { browser, page } = await attach({ cdpUrl: "http://127.0.0.1:9223" });
  try {
    await page.waitForFunction(() => Boolean(window.agentsOneAPI), { timeout: 30_000 });
    const started = await page.evaluate(async ({ executablePath, workspacePath, timeout }) => {
      await window.agentsOneAPI.saveAgentRuntime({
        id: "e2e-claude-code",
        name: "E2E Claude Code",
        kind: "claude-code",
        location: "local",
        enabled: true,
        config: {
          transport: "cli",
          executablePath,
          workspace: workspacePath,
          timeoutMs: timeout,
        },
      });
      const probe = await window.agentsOneAPI.probeAgentRuntime("e2e-claude-code");
      if (probe.state !== "healthy") throw new Error(probe.message || "Claude Code probe failed.");
      return window.agentsOneAPI.startAgentRuntimeTask("e2e-claude-code", {
        prompt: "Reply with one concise sentence confirming that this is a read-only Claude Code runtime acceptance test. Do not modify files.",
        mode: "analysis",
        workspace: workspacePath,
      });
    }, { executablePath: executable, workspacePath: workspace, timeout: timeoutMs });

    async function waitForRun(runId) {
      const deadline = Date.now() + timeoutMs + 30_000;
      let run;
      while (Date.now() < deadline) {
        run = await page.evaluate((id) => window.agentsOneAPI.getAgentRuntimeRun(id), runId);
        if (run && run.status !== "running") return run;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      return run;
    }

    const run = await waitForRun(started.id);
    assert(run, "Claude Code run disappeared.");
    assert(run.status === "succeeded", `Claude Code run ended as ${run.status}: ${String(run.error || "").slice(0, 300)}`);
    assert(String(run.output || "").trim(), "Claude Code returned no visible output.");

    const implementation = await page.evaluate((workspacePath) =>
      window.agentsOneAPI.startAgentRuntimeTask("e2e-claude-code", {
        prompt: "Do not modify any files. Inspect the repository and reply with one concise sentence confirming this implementation-mode acceptance run used an isolated worktree.",
        mode: "implementation",
        workspace: workspacePath,
      }), workspace);
    const implementationRun = await waitForRun(implementation.id);
    assert(implementationRun, "Claude Code implementation run disappeared.");
    assert(implementationRun.status === "succeeded", `Claude Code implementation ended as ${implementationRun.status}: ${String(implementationRun.error || "").slice(0, 300)}`);
    assert(implementationRun.worktreePath, "Claude Code implementation did not publish a worktree.");
    console.log(JSON.stringify({
      verdict: "passed",
      runtime: "claude-code",
      analysisStatus: run.status,
      implementationStatus: implementationRun.status,
      implementationWorktree: true,
      hasOutput: true,
      eventTypes: Array.from(new Set([
        ...(run.events || []).map((event) => event.type),
        ...(implementationRun.events || []).map((event) => event.type),
      ])).sort(),
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[claude-runtime FAILED]", error.stack || error.message);
  process.exit(1);
});
