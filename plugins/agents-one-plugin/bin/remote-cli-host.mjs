#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createRemoteCliHost } from "../src/remote-cli-host.mjs";
import { createOpenCodeAcpAdapter } from "../src/adapters/opencode-acp.mjs";
import { createCodexAppServerAdapter } from "../src/adapters/codex-app-server.mjs";
import { createClaudeAgentSdkAdapter } from "../src/adapters/claude-agent-sdk.mjs";
import { createPiRpcAdapter } from "../src/adapters/pi-rpc.mjs";
import { createAntigravityAcpAdapter } from "../src/adapters/antigravity-acp.mjs";

const factories = new Map([
  ["opencode", createOpenCodeAcpAdapter],
  ["codex", createCodexAppServerAdapter],
  ["claude-code", createClaudeAgentSdkAdapter],
  ["pi", createPiRpcAdapter],
  ["antigravity", createAntigravityAcpAdapter],
]);

function record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function configuredHost(config, token) {
  if (
    !record(config) ||
    config.version !== 1 ||
    typeof config.statePath !== "string" ||
    !isAbsolute(config.statePath) ||
    !Array.isArray(config.runtimes) ||
    !config.runtimes.length
  ) {
    throw new Error(
      "Host configuration requires version 1, an absolute statePath, and runtimes.",
    );
  }
  const port = config.port ?? 8787;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Host port must be an integer between 0 and 65535.");
  const runtimes = config.runtimes.map((runtime) => {
    const create = record(runtime) && factories.get(runtime.kind);
    if (!create)
      throw new Error(
        "Host Runtime kind must be opencode, codex, claude-code, pi or antigravity.",
      );
    const { options, ...descriptor } = runtime;
    if (
      !record(options) ||
      typeof options.workspaceRoot !== "string" ||
      !isAbsolute(options.workspaceRoot) ||
      options.env !== undefined
    ) {
      throw new Error(
        "Each Host Runtime needs an absolute workspaceRoot. Supply credentials through the process environment.",
      );
    }
    const reserved =
      /^(?:AGENTS_ONE_(?:HOST|GATEWAY)_TOKEN|HERMES_GATEWAY_TOKEN)$/i;
    if (
      options.allowedEnv &&
      (!Array.isArray(options.allowedEnv) ||
        options.allowedEnv.some(
          (key) => typeof key !== "string" || reserved.test(key),
        ))
    )
      throw new Error(
        "allowedEnv may contain only provider environment variable names.",
      );
    if (
      runtime.kind === "pi" &&
      (typeof options.sessionDirectory !== "string" ||
        !isAbsolute(options.sessionDirectory))
    )
      throw new Error("Pi requires an absolute sessionDirectory.");
    return { ...descriptor, adapter: create(options) };
  });
  const trustedAdapterIds = [
    ...new Set(runtimes.map(({ adapter }) => adapter.manifest.adapterId)),
  ];
  const host = createRemoteCliHost({
    token,
    statePath: config.statePath,
    limits: config.limits,
    runtimes,
    trustedAdapterIds,
    requireAdapterManifest: true,
  });
  return { host, port };
}

async function main() {
  const [command, configPath, runtimeId, ...rest] = process.argv.slice(2);
  if (!command || command === "--help") {
    console.log(
      "Usage: remote-cli-host.mjs serve <config.json> | probe <config.json> <runtime-id>",
    );
    return;
  }
  if (
    (command !== "serve" && command !== "probe") ||
    !configPath ||
    rest.length ||
    (command === "probe" ? !runtimeId : runtimeId !== undefined)
  )
    throw new Error(
      "Expected serve <config.json> or probe <config.json> <runtime-id>.",
    );
  const token = process.env.AGENTS_ONE_HOST_TOKEN?.trim();
  if (command === "serve" && !token)
    throw new Error(
      "Set AGENTS_ONE_HOST_TOKEN in the local Host process environment.",
    );
  const configuration = JSON.parse(await readFile(configPath, "utf8"));
  const { host, port } = configuredHost(configuration, token);
  if (command === "probe") {
    const result = await host.probeRuntime(runtimeId);
    console.log(JSON.stringify(result));
    if (!result.healthy) process.exitCode = 1;
    return;
  }

  await host.listen(port, "127.0.0.1");
  const stop = () => {
    void host.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(
    JSON.stringify({
      state: "online",
      port: host.server.address().port,
      runtimes: host.runtimes.map((info) => ({
        runtimeId: info.runtimeId,
        displayName: info.displayName,
        kind: info.kind,
        adapterId: info.adapterId,
        adapterVersion: info.adapterVersion,
        enabled: info.enabled !== false,
      })),
    }),
  );
}

main().catch((error) => {
  // JSON parse errors can include input text. Keep diagnostics out of secrets.
  const message =
    error instanceof SyntaxError
      ? "Invalid Host configuration JSON."
      : error.message;
  console.error(message || "Remote CLI Host could not be started.");
  process.exitCode = 1;
});
