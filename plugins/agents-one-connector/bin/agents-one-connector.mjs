#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { diagnoseConnect, printStatus } from "./commands.mjs";
import {
  pairConnector,
  requestConnectorPairing,
  completeConnectorPairing,
  localConnectorStatus,
  revokeConnector,
  runConnectorTunnel,
  listConnectorRuntimes,
  registerConnectorRuntime,
  updateConnectorRuntime,
  removeConnectorRuntime,
  probeConnectorRuntime,
  publishConnectorRuntimes,
} from "../src/connector-client.mjs";

function args(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    result[key] = argv[index + 1]?.startsWith("--") ? true : argv[++index];
  }
  return result;
}

function usage() {
  console.log(
    `Agents One Connector CLI\n\nCommands:\n  pair             Enter an Agents One generated code\n  request-pairing  Generate a code on the agent side\n  complete-pairing Finish an approved connector-first pairing\n  status           Show local pairing status (never prints credentials)\n  revoke           Revoke the paired device\n  runtimes         List local Runtime registrations\n  register         Register a Runtime from --runtime JSON\n  enable           Enable a Runtime\n  disable          Disable a Runtime\n  update           Update a Runtime from --patch JSON\n  remove           Remove a Runtime without removing device credentials\n  probe            Probe one Runtime through --runtime-adapters\n  publish          Publish the local Runtime list to Connect\n  run              Run the paired Connector with one or many Runtime adapters\n  diagnose         Check a Connect endpoint\n\nExamples:\n  agents-one-connector request-pairing --connect https://connect.example --runtime-id hers-home2 --name Hers\n  agents-one-connector run --runtime-adapters ./runtime-adapters.mjs`,
  );
}

function runtimeList(input) {
  if (!input.runtimes) return undefined;
  try {
    const value = JSON.parse(String(input.runtimes));
    if (!Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error("--runtimes must be a JSON array of Runtime descriptors.");
  }
}

function jsonOption(input, name) {
  if (!input[name]) throw new Error(`--${name} must be provided as JSON.`);
  try {
    return JSON.parse(String(input[name]));
  } catch {
    throw new Error(`--${name} must contain valid JSON.`);
  }
}

async function loadRuntimeAdapters(input) {
  if (!input["runtime-adapters"])
    throw new Error("This command requires --runtime-adapters <module path>.");
  const module = await import(
    pathToFileURL(resolve(input["runtime-adapters"])).href
  );
  const adapters = module.runtimeAdapters || module.default;
  if (!adapters || typeof adapters !== "object" || Array.isArray(adapters))
    throw new Error("Adapter module must export runtimeAdapters as an object.");
  return adapters;
}

const input = args(process.argv.slice(2));
const command = input._[0];
try {
  if (!command || command === "help" || command === "--help") {
    usage();
  } else if (command === "pair") {
    if (input["generate-code"] === true || input["generate-code"] === "true") {
      const result = await requestConnectorPairing({
        connectEndpoint: input.connect,
        runtimeId: input["runtime-id"],
        displayName: input.name || input["display-name"] || "Remote agent",
        runtimes: runtimeList(input),
      });
      console.log(
        JSON.stringify({ status: "awaiting_desktop_code", ...result }, null, 2),
      );
      console.error(
        "请将 pairingCode 输入 Agents One；批准后运行 complete-pairing。 ",
      );
      process.exit(0);
    }
    const result = await pairConnector({
      connectEndpoint: input.connect,
      pairingCode: input.code,
      runtimeId: input["runtime-id"],
      displayName: input.name || input["display-name"] || "Remote agent",
      runtimes: runtimeList(input),
    });
    console.log(JSON.stringify({ status: "paired", ...result }, null, 2));
  } else if (command === "request-pairing") {
    const result = await requestConnectorPairing({
      connectEndpoint: input.connect,
      runtimeId: input["runtime-id"],
      displayName: input.name || input["display-name"] || "Remote agent",
      runtimes: runtimeList(input),
    });
    console.log(
      JSON.stringify({ status: "awaiting_desktop_code", ...result }, null, 2),
    );
    console.error(
      "请将 pairingCode 输入 Agents One 的‘输入接入校验码’；批准后运行 complete-pairing。 ",
    );
    if (input.wait === true || input.wait === "true") {
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const completed = await completeConnectorPairing();
        if (completed.state === "paired") {
          console.log(JSON.stringify(completed, null, 2));
          break;
        }
        if (completed.state === "expired")
          throw new Error("Pairing code expired.");
      }
    }
  } else if (command === "complete-pairing") {
    console.log(JSON.stringify(await completeConnectorPairing(), null, 2));
  } else if (command === "status") {
    printStatus(localConnectorStatus());
  } else if (command === "runtimes") {
    console.log(JSON.stringify(listConnectorRuntimes(), null, 2));
  } else if (command === "register") {
    const runtime = registerConnectorRuntime({
      runtime: jsonOption(input, "runtime"),
    });
    if (input.publish === true || input.publish === "true")
      await publishConnectorRuntimes({});
    console.log(JSON.stringify(runtime, null, 2));
  } else if (command === "enable" || command === "disable") {
    const runtime = updateConnectorRuntime({
      runtimeId: input["runtime-id"],
      patch: { enabled: command === "enable" },
    });
    if (input.publish === true || input.publish === "true")
      await publishConnectorRuntimes({});
    console.log(JSON.stringify(runtime, null, 2));
  } else if (command === "update") {
    const runtime = updateConnectorRuntime({
      runtimeId: input["runtime-id"],
      patch: jsonOption(input, "patch"),
    });
    if (input.publish === true || input.publish === "true")
      await publishConnectorRuntimes({});
    console.log(JSON.stringify(runtime, null, 2));
  } else if (command === "remove") {
    const runtimes = removeConnectorRuntime({
      runtimeId: input["runtime-id"],
    });
    if (input.publish === true || input.publish === "true")
      await publishConnectorRuntimes({});
    console.log(JSON.stringify(runtimes, null, 2));
  } else if (command === "probe") {
    const adapters = await loadRuntimeAdapters(input);
    console.log(
      JSON.stringify(
        await probeConnectorRuntime({
          runtimeId: input["runtime-id"],
          runtimeAdapters: adapters,
        }),
        null,
        2,
      ),
    );
  } else if (command === "publish") {
    console.log(JSON.stringify(await publishConnectorRuntimes({}), null, 2));
  } else if (command === "revoke") {
    console.log(JSON.stringify(await revokeConnector(), null, 2));
  } else if (command === "run") {
    let onRequest;
    let runtimeAdapters;
    if (input["runtime-adapters"]) {
      const adapterModule = await import(
        pathToFileURL(resolve(input["runtime-adapters"])).href
      );
      runtimeAdapters = adapterModule.runtimeAdapters || adapterModule.default;
      if (
        !runtimeAdapters ||
        typeof runtimeAdapters !== "object" ||
        Array.isArray(runtimeAdapters)
      ) {
        throw new Error(
          "Runtime adapter module must export runtimeAdapters as an object.",
        );
      }
    } else {
      if (!input.adapter)
        throw new Error(
          "run requires --adapter <module path> or --runtime-adapters <module path>.",
        );
      const adapterModule = await import(
        pathToFileURL(resolve(input.adapter)).href
      );
      onRequest = adapterModule.default || adapterModule.onRequest;
      if (typeof onRequest !== "function") {
        throw new Error(
          "Adapter module must export a default function or onRequest.",
        );
      }
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await runConnectorTunnel({
      onRequest,
      runtimeAdapters,
      signal: controller.signal,
      onState: (state) =>
        console.error(JSON.stringify({ connector: state.state })),
    });
  } else if (command === "diagnose") {
    await diagnoseConnect(input.connect);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Connector command failed.",
  );
  process.exitCode = 1;
}
