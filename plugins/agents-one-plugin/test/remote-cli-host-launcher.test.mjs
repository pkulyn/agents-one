import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const entry = fileURLToPath(
  new URL("../bin/remote-cli-host.mjs", import.meta.url),
);
const fixture = String.raw`
const lines = require("node:readline").createInterface({input: process.stdin});
lines.on("line", (line) => {
  const data = JSON.parse(line);
  if (data.method === "initialize") process.stdout.write(JSON.stringify({
    id: data.id, result: { protocolVersion: 1, agentInfo: { name: "Fixture", version: "test" } },
  }) + "\n");
});
`;

test(
  "Home Host probes one adapter and publishes isolated Runtime capabilities",
  { timeout: 15_000 },
  async (t) => {
    const workspaceRoot = mkdtempSync(
      join(tmpdir(), "agents-one-home-launcher-"),
    );
    const configPath = join(workspaceRoot, "host.json");
    const env = {
      ...process.env,
      AGENTS_ONE_HOST_TOKEN: "local-fixture-token",
    };
    writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        port: 0,
        statePath: join(workspaceRoot, "state.json"),
        runtimes: [
          {
            runtimeId: "open-fixture",
            displayName: "OpenCode",
            kind: "opencode",
            options: {
              workspaceRoot,
              executablePath: process.execPath,
              acpArgs: ["-e", fixture],
            },
          },
          {
            runtimeId: "codex-fixture",
            displayName: "Codex",
            kind: "codex",
            options: { workspaceRoot },
          },
        ],
      }),
    );
    const args = [entry, "probe", configPath, "open-fixture"];
    const result = await exec(process.execPath, args, { env });
    assert.equal(JSON.parse(result.stdout).healthy, true);

    const child = spawn(process.execPath, [entry, "serve", configPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const closed = once(child, "close");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    });
    const lines = createInterface({ input: child.stdout });
    const [line] = await Promise.race([
      once(lines, "line"),
      closed.then(([code]) => {
        throw new Error("Host closed during startup: " + code);
      }),
    ]);
    const ready = JSON.parse(line);
    assert.equal(ready.state, "online");
    assert.equal(line.includes(env.AGENTS_ONE_HOST_TOKEN), false);
    assert.deepEqual(
      ready.runtimes.map((item) => item.adapterId),
      ["opencode-acp", "codex-app-server"],
    );
    const response = await fetch(
      "http://127.0.0.1:" + ready.port + "/capabilities",
      {
        headers: {
          authorization: "Bearer " + env.AGENTS_ONE_HOST_TOKEN,
          "x-agents-one-runtime-id": "codex-fixture",
        },
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).capabilities.permissions.modes, [
      "analysis",
    ]);
  },
);
