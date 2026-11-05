import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCodeAcpAdapter } from "../src/adapters/opencode-acp.mjs";

test(
  "remote ACP permits a model turn longer than the handshake timeout",
  { timeout: 45000 },
  async () => {
    const workspace = mkdtempSync(join(tmpdir(), "one-remote-long-turn-"));
    const program = [
      "const rl=require('node:readline').createInterface({input:process.stdin});",
      "const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');",
      "rl.on('line',line=>{const m=JSON.parse(line);",
      "if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{}}});",
      "else if(m.method==='session/new')send({id:m.id,result:{sessionId:'long-session'}});",
      "else if(m.method==='session/prompt')setTimeout(()=>{send({method:'session/update',params:{sessionId:'long-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'long turn done'}}}});send({id:m.id,result:{stopReason:'end_turn'}})},31000);});",
    ].join("");
    const adapter = createOpenCodeAcpAdapter({
      executablePath: process.execPath,
      acpArgs: ["-e", program],
      workspaceRoot: workspace,
    });
    let runId;
    try {
      const start = await adapter.startRun(
        { mode: "analysis", input: { text: "hello" } },
        { emit: () => undefined },
      );
      runId = start.vendorRunId;
      let run;
      do {
        await new Promise((resolve) => setTimeout(resolve, 250));
        run = await adapter.getRun(runId);
      } while (run.status === "running");
      assert.equal(run.status, "succeeded", run.error);
      assert.equal(run.output, "long turn done");
    } finally {
      if (runId) await adapter.cancelRun(runId);
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);

test(
  "remote ACP respects a host-configured turn deadline",
  { timeout: 10000 },
  async () => {
    const workspace = mkdtempSync(join(tmpdir(), "one-remote-deadline-"));
    const program = [
      "const rl=require('node:readline').createInterface({input:process.stdin});",
      "const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');",
      "rl.on('line',line=>{const m=JSON.parse(line);",
      "if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{}}});",
      "else if(m.method==='session/new')send({id:m.id,result:{sessionId:'deadline-session'}});});",
    ].join("");
    const adapter = createOpenCodeAcpAdapter({
      executablePath: process.execPath,
      acpArgs: ["-e", program],
      workspaceRoot: workspace,
      promptTimeoutMs: 250,
    });
    let runId;
    try {
      runId = (
        await adapter.startRun(
          { mode: "analysis", input: { text: "hello" } },
          { emit: () => undefined },
        )
      ).vendorRunId;
      let run;
      do {
        await new Promise((resolve) => setTimeout(resolve, 50));
        run = await adapter.getRun(runId);
      } while (run.status === "running");
      assert.equal(run.status, "failed");
      assert.match(run.error, /session\/prompt/);
    } finally {
      if (runId) await adapter.cancelRun(runId);
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);
