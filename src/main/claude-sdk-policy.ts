import { assertClaudeWorkspaceBoundary } from "./claude-workspace-policy";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  claudeCodeInvocation,
  configuredExecutable,
} from "./claude-code-runtime";
import { assertClaudeNonExecutingUserConfig } from "./claude-config-policy";
import { verifyClaudeStrictCapabilities } from "./claude-capabilities";
import { claudeChildEnvironment } from "./claude-environment";
import { prepareClaudeQueryEnvironment } from "./claude-query-context";
import { agentsOneProfileHome } from "./utils";

export interface ClaudeSdkStartupConfig {
  executablePath?: string;
  model?: string;
  workspace?: string;
  profile?: string;
  runtimeId?: string;
  assertCurrent?: () => void;
  nativeContext?: { cwd: string; assertCurrent: () => void };
}
export interface PreparedClaudeSdkPolicy {
  options: Options;
  key: string;
  fingerprint: string;
  native: boolean;
  assertCurrent: () => void;
}
// @lat: [[runtime-chat#Claude SDK startup authority]]
export async function prepareClaudeSdkPolicy(
  config: ClaudeSdkStartupConfig,
  canStart: () => boolean = () => true,
  native = false,
): Promise<PreparedClaudeSdkPolicy> {
  const assertCurrent = (): void => {
    if (!canStart())
      throw Error("Claude Code task was cancelled before process launch.");
    config.assertCurrent?.();
    if (native) {
      if (!config.nativeContext)
        throw Error(
          "[Agents One 权限不足] Claude 原生命令需要当前完全访问会话与项目授权。 / Claude native commands require current full-access conversation authority.",
        );
      config.nativeContext.assertCurrent();
    }
  };
  assertCurrent();
  const selected = native
    ? config.nativeContext!.cwd
    : config.workspace?.trim();
  const cwd = resolve(
    selected ||
      join(
        agentsOneProfileHome(config.profile),
        "desktop",
        "runtime-chat",
        "claude-code",
      ),
  );
  if (!native) assertClaudeWorkspaceBoundary(cwd, config.profile, !selected);
  const credentials = native ? {} : assertClaudeNonExecutingUserConfig(cwd);
  const verified = native
    ? undefined
    : await verifyClaudeStrictCapabilities(
        claudeCodeInvocation(configuredExecutable(config)),
        canStart,
      );
  assertCurrent();
  verified?.assertUnchanged();
  if (!selected) mkdirSync(cwd, { recursive: true });
  const env = native
    ? { ...process.env }
    : await prepareClaudeQueryEnvironment(
        claudeChildEnvironment(process.env, "analysis", credentials),
        cwd,
        canStart,
      );
  assertCurrent();
  verified?.assertUnchanged();
  const executable =
    verified?.invocation.command ||
    (config.executablePath?.trim()
      ? claudeCodeInvocation(config.executablePath.trim()).command
      : undefined);
  const key = JSON.stringify([
    config.profile || "",
    config.runtimeId || "",
    cwd,
    executable || "bundled",
  ]);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        native,
        Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
      ]),
    )
    .digest("hex");
  const options: Options = {
    cwd,
    env,
    ...(config.model?.trim() ? { model: config.model.trim() } : {}),
    ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
    ...(native
      ? { settingSources: ["user", "project", "local"] as const }
      : {
          permissionMode: "plan" as const,
          tools: ["Read", "Glob", "Grep"],
          settingSources: [],
          strictMcpConfig: true,
          mcpServers: {},
          extraArgs: {
            restricted: null,
            "safe-mode": null,
            "permission-prompts": "none",
            "mcp-config": JSON.stringify({ mcpServers: {} }),
          },
        }),
    spawnClaudeCodeProcess: (requested) => {
      assertCurrent();
      verified?.assertUnchanged();
      if (!native)
        assertClaudeWorkspaceBoundary(cwd, config.profile, !selected);
      if (
        verified &&
        (requested.command !== executable || requested.cwd !== cwd)
      )
        throw Error(
          "[Agents One 权限不足] Claude SDK 启动入口发生变化，本轮未执行。 / Claude SDK launch context changed.",
        );
      const child = spawn(requested.command, requested.args, {
        cwd,
        env: requested.env,
        signal: requested.signal,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      // The SDK custom-spawn contract consumes stdout; drain native diagnostics.
      child.stderr.resume();
      return child;
    },
  };
  return {
    options,
    key,
    fingerprint,
    native,
    assertCurrent: () => {
      assertCurrent();
      verified?.assertUnchanged();
    },
  };
}
