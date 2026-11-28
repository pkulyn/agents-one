import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  AcpClient,
  contentText,
  model,
  record,
  toolEvent,
  usage as normalizeUsage,
} from "./opencode-acp.mjs";
import { sanitizeEventText } from "../event-stream.mjs";
import { resolveHostWorkspace } from "./remote-workspace.mjs";

const BASE_ENV_KEYS = [
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "LANG",
  "LC_ALL",
];
const MANIFEST = {
  adapterId: "antigravity-acp",
  vendorId: "google",
  version: "0.1.0",
  displayName: "Antigravity",
  protocol: "antigravity-acp",
};
const CAPABILITIES = {
  eventStream: { toolEvents: true, modelMetadata: true },
  tasks: { start: true, get: true, cancel: true },
  permissions: { interactive: true, modes: ["analysis", "safe_write"] },
  sessions: { create: true, resume: true },
  artifacts: { publish: false, download: false },
};
const MAX_OUTPUT_CHARS = 512 * 1024;
// T3 Code (MIT) ships the same isolation for the 1.5 CLI: it keeps Google
// sign-ins in one OS keyring entry unless it believes it runs over SSH, so a
// nominal SSH_CONNECTION forces the file-stored token under the default CLI
// home that service sessions can read like interactive ones.
const REMOVED_ENVIRONMENT_KEYS = new Set(
  [
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
    "GOOGLE_CLOUD_QUOTA_PROJECT",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GCLOUD_PROJECT",
    "CLOUDSDK_CORE_PROJECT",
    "AGY_ACP_CCPA_PROJECT",
    "AGY_ACP_ENABLE_OAUTH",
    "GEMINI_HOME",
    "AGY_ACP_FORCE_FILE_STORAGE",
    "AGY_CLI_DISABLE_AUTO_UPDATE",
    "BROWSER",
    "ELECTRON_RUN_AS_NODE",
    "CHROME_CRASHPAD_PIPE_NAME",
  ].map((key) => key.toUpperCase()),
);

function localEnvironment(options) {
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (!REMOVED_ENVIRONMENT_KEYS.has(key.toUpperCase()))
      env[key] = process.env[key];
  }
  const explicitlyAllowed = Array.isArray(options.allowedEnv)
    ? options.allowedEnv.filter(
        (key) =>
          typeof key === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key),
      )
    : [];
  for (const key of [...BASE_ENV_KEYS, ...explicitlyAllowed]) {
    const value = options.env?.[key] ?? process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  // The 1.5 CLI keeps Google sign-ins in the OS keyring unless it believes
  // it runs over SSH (T3 Code, MIT), so a nominal SSH_CONNECTION forces the
  // file-stored token under the default CLI home, readable from service and
  // interactive sessions alike.
  env.SSH_CONNECTION = env.SSH_CONNECTION || "127.0.0.1 0 127.0.0.1 0";
  env.AGY_ACP_FORCE_FILE_STORAGE = "1";
  env.AGY_CLI_DISABLE_AUTO_UPDATE = "true";
  env.PYTHONUNBUFFERED = "1";
  return env;
}

function requestedMode(input) {
  return (
    input.execution?.permissionMode ||
    input.input?.permissionMode ||
    (input.execution?.permission === "write" ? "safe_write" : "analysis")
  );
}

function emit(run, context, type, data) {
  context.emit({ id: `${run.id}:${++run.sequence}`, type, data });
}

function antigravityLaunchArgs() {
  // The CLI's ACP server takes no launch mode flag; session modes come from
  // the session's own advertisement and the Host's permission policy gates
  // every tool call regardless.
  return ["acp"];
}

async function execute(run, input, context, options) {
  let terminalStatus = "failed";
  // The AcpClient gates tool calls through the Host permission policy for
  // this mode; the CLI session itself stays on its own advertised mode.
  const mode = requestedMode(input);
  const text = input.input?.text || input.text || "";
  try {
    const cwd = resolveHostWorkspace(options.workspaceRoot);
    const command =
      typeof options.executablePath === "string" &&
      options.executablePath.trim()
        ? options.executablePath.trim()
        : "agy";
    if (/\.(cmd|bat|ps1)$/i.test(command))
      throw new Error(
        "Antigravity Host requires a native executable or a directly executable command.",
      );
    const child = spawn(
      command,
      [
        ...(Array.isArray(options.executableArgs)
          ? options.executableArgs
          : []),
        ...antigravityLaunchArgs(),
      ],
      {
        cwd,
        env: localEnvironment(options),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    run.child = child;
    const requestedSessionId =
      input.sessionId || input.input?.sessionId || undefined;
    if (
      requestedSessionId &&
      !/^[A-Za-z0-9][A-Za-z0-9._-]{2,160}$/.test(requestedSessionId)
    )
      throw new Error("Antigravity native session ID is invalid.");

    const maxOutput = MAX_OUTPUT_CHARS;
    const promptTimeoutMs = Number(options.promptTimeoutMs);
    run.client = new AcpClient(child, {
      mode,
      authorizeTool: context.authorizeTool,
      onPermissionDenied: (reason) => {
        run.permissionDenied = reason;
        emit(run, context, "run.status", {
          summary: reason,
          code: "permission_denied",
        });
      },
      onUpdate: (params) => {
        const update = record(params.update || params);
        const answer =
          update.sessionUpdate === "agent_message_chunk"
            ? contentText(update)
            : undefined;
        if (answer) {
          run.output = `${run.output}${answer}`.slice(-maxOutput);
          emit(run, context, "assistant.delta", {
            text: answer,
            ...(run.model ? { model: run.model } : {}),
          });
        }
        const thought =
          update.sessionUpdate === "agent_thought_chunk"
            ? contentText(update)
            : undefined;
        if (thought)
          emit(run, context, "reasoning.summary", {
            reasoningSummary: thought,
          });
        const tool = toolEvent(update);
        if (tool) {
          const callId = tool.data?.tool?.callId;
          const previous = callId ? run.toolStates.get(callId) : undefined;
          if (!callId || previous !== tool.type) {
            emit(run, context, tool.type, tool.data);
            if (callId) run.toolStates.set(callId, tool.type);
          }
        }
        const updateModel = model(update.model);
        if (updateModel) run.model = { ...(run.model || {}), ...updateModel };
        const updateUsage = normalizeUsage(update.usage || update);
        if (updateUsage) run.usage = { ...(run.usage || {}), ...updateUsage };
      },
      onNonJsonLine: (line) => {
        // The ACP server prints the one-time OAuth URL on stdout when the
        // operator still has to sign in; surface it instead of swallowing it.
        if (
          typeof line === "string" &&
          line.includes("authenticate the ACP server")
        ) {
          run.authPrompt = sanitizeEventText(line, 2048);
        }
      },
    });
    // The prompt RPC carries its own bounded timeout; no extra watchdog is
    // needed for the turn lifecycle.
    const session = await run.client.newSession(cwd, requestedSessionId);
    run.sessionId = session.sessionId;
    run.model = run.model || model(session.init?.model);
    const result = record(
      await run.client.prompt(
        text,
        Number.isFinite(promptTimeoutMs) && promptTimeoutMs > 0
          ? Math.min(promptTimeoutMs, 3_600_000)
          : 300_000,
      ),
    );
    run.model = run.model || model(result.model);
    run.usage = run.usage || normalizeUsage(result);
    if (run.cancelRequested) return;
    if (run.output)
      emit(run, context, "assistant.completed", {
        text: run.output,
        ...(run.model ? { model: run.model } : {}),
        ...(run.usage ? { usage: run.usage } : {}),
      });
    terminalStatus = "succeeded";
  } catch (cause) {
    if (run.cancelRequested) {
      terminalStatus = "cancelled";
    } else {
      run.error = sanitizeEventText(
        cause instanceof Error ? cause.message : String(cause),
      );
      if (run.authPrompt)
        run.error = `${run.error} ${run.authPrompt}`.slice(0, 2000);
    }
  } finally {
    if (run.cancelRequested) terminalStatus = "cancelled";
    try {
      await run.client?.close();
    } catch {
      if (terminalStatus === "succeeded") {
        terminalStatus = "failed";
        run.error = "Antigravity shutdown could not be confirmed.";
      }
    }
    run.status = terminalStatus;
  }
}

/**
 * Google Antigravity adapter over the CLI's ACP server (`agy acp`). Sessions,
 * permissions and tool events follow the shared ACP machinery; the
 * environment forces the 1.5 CLI onto file-stored tokens (nominal
 * SSH_CONNECTION) so a service session reads them like an interactive one.
 * Auth debt surfaces as a sign-in-required error with the one-time URL.
 */
export function createAntigravityAcpAdapter(options = {}) {
  const runs = new Map();
  const capabilities =
    options.allowWorkspaceWrites === true
      ? {
          ...CAPABILITIES,
          permissions: { interactive: true, modes: ["analysis", "safe_write"] },
        }
      : CAPABILITIES;
  return {
    manifest: MANIFEST,
    capabilities,
    async probe() {
      // Passive ACP handshake probe: initialize only — no session, no login
      // flow, no tool execution (the T3 Code health-check boundary).
      let client;
      let child;
      try {
        const cwd = resolveHostWorkspace(options.workspaceRoot);
        const command =
          typeof options.executablePath === "string" &&
          options.executablePath.trim()
            ? options.executablePath.trim()
            : "agy";
        if (/\.(cmd|bat|ps1)$/i.test(command))
          throw new Error(
            "Antigravity Host requires a native executable or a directly executable command.",
          );
        child = spawn(
          command,
          [
            ...(Array.isArray(options.executableArgs)
              ? options.executableArgs
              : []),
            ...antigravityLaunchArgs(),
          ],
          {
            cwd,
            env: localEnvironment(options),
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          },
        );
        client = new AcpClient(child, {});
        const init = await client.initialize();
        const agentInfo = record(init?.agentInfo);
        const version = agentInfo.version
          ? sanitizeEventText(String(agentInfo.version), 128)
          : undefined;
        return {
          healthy: true,
          capabilities,
          manifest: MANIFEST,
          ...(version ? { runtimeVersion: version } : {}),
        };
      } catch (cause) {
        return {
          healthy: false,
          capabilities: {},
          message: sanitizeEventText(
            cause instanceof Error ? cause.message : String(cause),
          ),
        };
      } finally {
        await client?.close().catch(() => undefined);
        child?.kill();
      }
    },
    async startRun(input, context) {
      const id = `antigravity_${randomUUID()}`;
      const run = {
        id,
        status: "running",
        output: "",
        sequence: 0,
        toolStates: new Map(),
      };
      runs.set(id, run);
      run.completion = execute(run, input, context, options);
      return { vendorRunId: id, status: "running" };
    },
    async getRun(id) {
      const run = runs.get(id);
      if (!run)
        return { status: "failed", error: "Antigravity run is unavailable." };
      const { status, output, sessionId, model, error, usage } = run;
      return { status, output, sessionId, model, error, usage };
    },
    async cancelRun(id) {
      const run = runs.get(id);
      if (!run || run.status !== "running") return false;
      run.cancelRequested = true;
      run.client?.cancel();
      await run.completion;
      return run.status === "cancelled";
    },
  };
}
