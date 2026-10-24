import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCodeAcpAdapter } from "../src/adapters/opencode-acp.mjs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createChildShutdown } from "../src/child-shutdown.mjs";
class Child extends EventEmitter {
  exitCode = null;
  signalCode = null;
  signals = [];
  kill(signal = "SIGTERM") {
    this.signals.push(signal);
    this.killed = true;
    return true;
  }
}
test("kill acknowledgement does not settle shutdown before close; repeated calls share completion", async () => {
  const child = new Child();
  const stop = createChildShutdown(child);
  const first = stop();
  assert.equal(stop(), first);
  let settled = false;
  first.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(child.killed, true);
  assert.equal(settled, false);
  child.emit("close", 0);
  await first;
  assert.equal(settled, true);
  assert.deepEqual(child.signals, ["SIGTERM"]);
});
test("already closed children do not receive another termination signal", async () => {
  const child = new Child();
  const stop = createChildShutdown(child);
  child.emit("close", 0);
  await stop();
  assert.deepEqual(child.signals, []);
});
test("unresponsive children are escalated and an unconfirmed close fails explicitly", async () => {
  const child = new Child();
  const stop = createChildShutdown(child, { killAfterMs: 10, timeoutMs: 30 });
  await assert.rejects(stop(), /shutdown timed out/);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("real cancellation rejects pending ACP work and waits for the child to exit", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "remote-acp-cancel-close-"));
  const program = [
    "const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');",
    "rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1}});else if(m.method==='session/new')send({id:m.id,result:{sessionId:'cancel-session'}});else if(m.method==='session/prompt')fs.writeFileSync('pending.pid',String(process.pid));});",
  ].join("");
  const adapter = createOpenCodeAcpAdapter({
    executablePath: process.execPath,
    acpArgs: ["-e", program],
    workspaceRoot: workspace,
  });
  let started;
  try {
    started = await adapter.startRun(
      { input: { text: "hang" } },
      { emit: () => undefined },
    );
    for (let i = 0; i < 100 && !existsSync(join(workspace, "pending.pid")); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(existsSync(join(workspace, "pending.pid")), true);
    const pid = Number(readFileSync(join(workspace, "pending.pid"), "utf8"));
    assert.equal(await adapter.cancelRun(started.vendorRunId), true);
    const result = await adapter.getRun(started.vendorRunId);
    assert.equal(result.status, "cancelled");
    assert.equal(result.error, undefined);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    if (started) await adapter.cancelRun(started.vendorRunId);
    rmSync(workspace, { recursive: true, force: true });
  }
});
