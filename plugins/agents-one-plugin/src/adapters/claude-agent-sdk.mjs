import { randomUUID } from "node:crypto";
import { basename, extname, isAbsolute } from "node:path";
import { sanitizeEventText } from "../event-stream.mjs";
import {
  readWorkspaceArtifact,
  resolveHostWorkspace,
  resolveWorkspaceToolPath,
} from "./remote-workspace.mjs";

const manifest = {
  adapterId: "claude-agent-sdk",
  vendorId: "anthropic",
  version: "0.1.0",
  displayName: "Claude Code",
  protocol: "claude-agent-sdk",
};
const readTools = ["Read", "Glob", "Grep"];
const writeTools = ["Write", "Edit"];
const modes = ["analysis", "safe_write"];
const capabilities = {
  eventStream: {
    toolEvents: true,
    modelMetadata: true,
    reasoningSummaries: true,
    usageMetadata: true,
  },
  tasks: { start: true, get: true, cancel: true },
  permissions: { interactive: false, modes },
  sessions: { create: true, resume: true },
  artifacts: { publish: true, download: true },
};
const MAX_OUTPUT = 512 * 1024;
const MAX_TOOL_CALLS = 128;

function usageFromResult(result) {
  const usage = result?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const input = Number(usage.input_tokens);
  const output = Number(usage.output_tokens);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  return {
    inputTokens: Math.max(0, Math.floor(input)),
    outputTokens: Math.max(0, Math.floor(output)),
    totalTokens: Math.max(0, Math.floor(input + output)),
  };
}

function summarizeToolInput(value) {
  if (value === undefined || value === null) return undefined;
  try {
    return sanitizeEventText(JSON.stringify(value), 4_000);
  } catch {
    return undefined;
  }
}

function summarizeToolResult(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return sanitizeEventText(value, 4_000);
  try {
    return sanitizeEventText(JSON.stringify(value), 4_000);
  } catch {
    return undefined;
  }
}

function localEnvironment(options) {
  const env = {};
  const publicKeys = [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "XDG_CONFIG_HOME",
    "LANG",
  ];
  for (const key of [...publicKeys, ...(options.allowedEnv || [])]) {
    if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      continue;
    const value = options.env?.[key] ?? process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function toolPath(cwd, supported, name, args = {}) {
  if (
    !supported.has(name) ||
    !args ||
    typeof args !== "object" ||
    Array.isArray(args)
  )
    return undefined;
  if (name === "Grep" || name === "Glob") {
    const pattern = name === "Glob" ? args.pattern : args.glob;
    if (
      pattern !== undefined &&
      (typeof pattern !== "string" ||
        pattern.includes("..") ||
        isAbsolute(pattern) ||
        /^[A-Za-z]:|^\\\\/.test(pattern))
    )
      return undefined;
    return resolveWorkspaceToolPath(cwd, args.path ?? ".", false);
  }
  return resolveWorkspaceToolPath(cwd, args.file_path, name === "Write");
}

function emit(run, context, type, data) {
  context.emit({ id: `${run.id}:${++run.sequence}`, type, data });
}

async function execute(run, input, context, options) {
  let timer;
  let status = "failed";
  try {
    const text = input.input?.text || "";
    if (/^\s*\/[A-Za-z0-9_-]+(?:\s|$)/.test(text))
      throw new Error(
        "Native slash commands are not enabled for this Host Runtime.",
      );
    const mode =
      input.execution?.permissionMode ||
      input.input?.permissionMode ||
      (input.execution?.permission === "write" ? undefined : "analysis");
    if (!modes.includes(mode))
      throw new Error("Claude Host supports only analysis and safe_write.");
    const cwd = resolveHostWorkspace(
      options.workspaceRoot,
      input.workspace || input.input?.workspace,
    );
    const tools = new Set(
      mode === "safe_write" ? [...readTools, ...writeTools] : readTools,
    );
    const writes = new Map();
    const savedOutput = new Set();
    const session = input.sessionId || input.input?.sessionId;
    const query =
      options.query || (await import("@anthropic-ai/claude-agent-sdk")).query;
    if (run.abort.signal.aborted) return;
    const env = localEnvironment(options);
    const matchesSession = (value) =>
      Boolean(run.sessionId && value === run.sessionId);
    const preTool = async (request, id) => {
      const path =
        !run.abort.signal.aborted && matchesSession(request.session_id)
          ? toolPath(cwd, tools, request.tool_name, request.tool_input)
          : undefined;
      if (!path)
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason:
              "Tool or path is outside this Runtime's workspace authority.",
          },
        };
      if (
        id &&
        writeTools.includes(request.tool_name) &&
        writes.size < MAX_TOOL_CALLS
      )
        writes.set(id, path);
      return {};
    };
    const postTool = async (request, id) => {
      const path = matchesSession(request.session_id)
        ? writes.get(id)
        : undefined;
      if (path && savedOutput.size < MAX_TOOL_CALLS) savedOutput.add(path);
      writes.delete(id);
      return {};
    };
    let releasePrompt;
    const ready = new Promise((resolve) => {
      releasePrompt = resolve;
    });
    const prompt = (async function* () {
      if (await ready)
        yield {
          type: "user",
          message: { role: "user", content: text },
          parent_tool_use_id: null,
        };
    })();
    run.query = query({
      prompt,
      options: {
        cwd,
        env,
        abortController: run.abort,
        permissionMode: "default",
        tools: [...tools],
        allowedTools: [...tools],
        settingSources: [],
        persistSession: true,
        includePartialMessages: true,
        strictMcpConfig: true,
        mcpServers: {},
        hooks: {
          PreToolUse: [{ hooks: [preTool] }],
          PostToolUse: [{ hooks: [postTool] }],
        },
        ...(session ? { resume: session } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.executablePath
          ? { pathToClaudeCodeExecutable: options.executablePath }
          : {}),
      },
    });
    const configuredTimeout = Number(options.promptTimeoutMs);
    timer = setTimeout(
      () => {
        run.timedOut = true;
        run.abort.abort();
      },
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? Math.min(configuredTimeout, 3_600_000)
        : 300_000,
    );
    const initialize = run.query.initializationResult;
    try {
      if (
        typeof initialize !== "function" ||
        (await initialize.call(run.query)).hooks_applied !== true ||
        run.abort.signal.aborted
      )
        throw new Error(
          "Claude did not confirm Host tool-policy registration.",
        );
      releasePrompt(true);
    } finally {
      releasePrompt(false);
    }
    let result;
    for await (const frame of run.query) {
      if (run.abort.signal.aborted) break;
      if (frame.type === "system" && frame.subtype === "init") {
        if (
          typeof frame.session_id !== "string" ||
          !frame.session_id ||
          (session && frame.session_id !== session)
        )
          throw new Error("Claude did not return the expected native session.");
        if (
          !frame.cwd ||
          resolveHostWorkspace(options.workspaceRoot, frame.cwd) !== cwd
        )
          throw new Error(
            "Claude native session belongs to a different workspace.",
          );
        run.sessionId = frame.session_id;
        if (typeof frame.model === "string") run.model = { id: frame.model };
        continue;
      }
      if (!run.sessionId || frame.session_id !== run.sessionId) continue;
      if (
        frame.type === "stream_event" &&
        frame.event?.type === "content_block_delta" &&
        frame.event.delta?.type === "text_delta" &&
        typeof frame.event.delta.text === "string"
      ) {
        run.output = (run.output + frame.event.delta.text).slice(-MAX_OUTPUT);
        emit(run, context, "assistant.delta", { text: frame.event.delta.text });
      }
      if (
        frame.type === "stream_event" &&
        frame.event?.type === "content_block_delta" &&
        frame.event.delta?.type === "thinking_delta" &&
        typeof frame.event.delta.thinking === "string"
      ) {
        // Claude exposes reasoning the same way OpenCode does; presenting it
        // keeps the desktop trace consistent across remote runtimes.
        emit(run, context, "reasoning.summary", {
          reasoningSummary: frame.event.delta.thinking,
        });
      }
      if (frame.type === "assistant") {
        for (const tool of frame.message?.content || []) {
          if (
            tool.type === "tool_use" &&
            typeof tool.id === "string" &&
            tools.has(tool.name)
          ) {
            emit(run, context, "tool.started", {
              tool: {
                callId: tool.id,
                name: tool.name,
                kind: "workspace",
                ...(summarizeToolInput(tool.input)
                  ? { inputSummary: summarizeToolInput(tool.input) }
                  : {}),
              },
            });
            run.toolNames.set(tool.id, tool.name);
          }
        }
      }
      if (frame.type === "user") {
        for (const toolResult of frame.message?.content || []) {
          if (
            toolResult.type === "tool_result" &&
            typeof toolResult.tool_use_id === "string" &&
            // Only settle tool calls this adapter announced, so every
            // completion in the trace has a matching started step.
            run.toolNames.has(toolResult.tool_use_id) &&
            run.toolResults.has(toolResult.tool_use_id) === false
          ) {
            run.toolResults.add(toolResult.tool_use_id);
            emit(
              run,
              context,
              toolResult.is_error ? "tool.failed" : "tool.completed",
              {
                tool: {
                  callId: toolResult.tool_use_id,
                  name: run.toolNames.get(toolResult.tool_use_id) || "工具",
                  kind: "workspace",
                  ...(summarizeToolResult(toolResult.content)
                    ? { outputSummary: summarizeToolResult(toolResult.content) }
                    : {}),
                },
              },
            );
          }
        }
      }
      if (frame.type === "result") result = frame;
    }
    if (run.timedOut) throw new Error("Claude Host run timed out.");
    if (run.cancelled) return;
    if (!result || result.subtype !== "success" || result.is_error)
      throw new Error("Claude SDK ended without a successful result.");
    if (typeof result.result === "string")
      run.output = result.result.slice(-MAX_OUTPUT);
    run.usage = usageFromResult(result);
    if (run.output)
      emit(run, context, "assistant.completed", {
        text: run.output,
        model: run.model,
        ...(run.usage ? { usage: run.usage } : {}),
      });
    if (typeof context.publishArtifact === "function") {
      for (const path of savedOutput) {
        const bytes = readWorkspaceArtifact(cwd, path);
        if (bytes && !run.abort.signal.aborted)
          await context.publishArtifact({
            name: basename(path),
            mime:
              extname(path).toLowerCase() === ".json"
                ? "application/json"
                : "text/plain",
            bytes,
          });
      }
    }
    status = "succeeded";
  } catch (cause) {
    if (!run.cancelled)
      run.error = sanitizeEventText(
        cause instanceof Error ? cause.message : String(cause),
      );
  } finally {
    clearTimeout(timer);
    try {
      await run.query?.close?.();
    } catch {
      run.error = "Claude SDK shutdown could not be confirmed.";
      status = "failed";
    }
    run.status = run.cancelled && !run.error ? "cancelled" : status;
  }
}

async function probeClaude(options) {
  let sdk;
  let timer;
  const abort = new AbortController();
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  try {
    const cwd = resolveHostWorkspace(options.workspaceRoot);
    const query =
      options.query || (await import("@anthropic-ai/claude-agent-sdk")).query;
    const prompt = (async function* () {
      await waiting;
      yield* [];
    })();
    sdk = query({
      prompt,
      options: {
        cwd,
        env: localEnvironment(options),
        abortController: abort,
        tools: [],
        settingSources: [],
        strictMcpConfig: true,
        mcpServers: {},
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async () => ({
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason: "Probe does not execute tools.",
                  },
                }),
              ],
            },
          ],
        },
        ...(options.executablePath
          ? { pathToClaudeCodeExecutable: options.executablePath }
          : {}),
      },
    });
    const initialized = await Promise.race([
      sdk.initializationResult(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Claude SDK handshake timed out.")),
          5_000,
        );
      }),
    ]);
    if (initialized.hooks_applied !== true)
      throw new Error("Claude did not confirm Host tool-policy registration.");
    return { healthy: true, capabilities, manifest };
  } catch (error) {
    return {
      healthy: false,
      capabilities: {},
      message: sanitizeEventText(
        error instanceof Error ? error.message : String(error),
      ),
    };
  } finally {
    clearTimeout(timer);
    abort.abort();
    release();
    await sdk?.close?.();
  }
}

export function createClaudeAgentSdkAdapter(options = {}) {
  const runs = new Map();
  return {
    manifest,
    capabilities,
    probe: () => probeClaude(options),
    async startRun(input, context) {
      const id = `claude_${randomUUID()}`;
      const run = {
        id,
        status: "running",
        output: "",
        sequence: 0,
        abort: new AbortController(),
        toolResults: new Set(),
        toolNames: new Map(),
      };
      runs.set(id, run);
      run.completion = execute(run, input, context, options);
      return { vendorRunId: id, status: "running" };
    },
    async getRun(id) {
      const run = runs.get(id);
      if (!run)
        return { status: "failed", error: "Claude run is unavailable." };
      const { status, sessionId, model, output, error } = run;
      return { status, sessionId, model, output, error };
    },
    async cancelRun(id) {
      const run = runs.get(id);
      if (!run || run.status !== "running") return false;
      run.cancelled = true;
      run.abort.abort();
      // Abort acceptance is independent of asynchronous SDK iterator cleanup.
      // The Host tracks the cancelling state and publishes the terminal result
      // when execute() finishes closing the SDK query.
      return true;
    },
  };
}
