import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOpenCodeAcpAdapter } from "../src/adapters/opencode-acp.mjs";
import { createRemoteGatewayPlugin } from "../src/remote-gateway-plugin.mjs";

for (const [capabilities, expectedMethod] of [
  [{ loadSession: true }, "session/load"],
  [{ sessionCapabilities: { resume: {} } }, "session/resume"],
]) {
  test(`remote OpenCode keeps provider identity separate and continues via ${expectedMethod}`, async () => {
    const workspace = mkdtempSync(
      join(tmpdir(), "remote-opencode-continuation-"),
    );
    const program = [
      "const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});",
      "const send=(v)=>process.stdout.write(JSON.stringify(v)+'\\n');",
      `const capabilities=${JSON.stringify(capabilities)};`,
      "rl.on('line',(line)=>{const m=JSON.parse(line);fs.appendFileSync(process.cwd()+'/requests.jsonl',line+'\\n');",
      "if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:capabilities}});",
      "else if(m.method==='session/new')send({id:m.id,result:{sessionId:'native-opencode-session'}});",
      "else if(m.method==='session/load'||m.method==='session/resume'){if(m.params.sessionId!=='native-opencode-session'){send({id:m.id,error:{code:-32000,message:'wrong provider session'}});return;}if(m.method==='session/load')send({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'OLD-REPLAY'}}}});send({id:m.id,result:{}});}",
      "else if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'CURRENT-ANSWER'}}}});send({id:m.id,result:{stopReason:'end_turn'}});}",
      "});",
    ].join("");
    const adapter = createOpenCodeAcpAdapter({
      executablePath: process.execPath,
      acpArgs: ["-e", program],
      workspaceRoot: workspace,
    });
    const plugin = createRemoteGatewayPlugin({
      agent: { id: "open", kind: "opencode" },
      token: "test-token",
      adapter,
    });
    const headers = {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    };
    try {
      assert.equal((await adapter.probe()).capabilities.sessions.resume, true);
      await plugin.listen(0);
      const base = `http://127.0.0.1:${plugin.server.address().port}`;
      const turn = async (conversationId) => {
        const response = await fetch(`${base}/runs`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            runtimeId: "opencode",
            mode: "conversation",
            conversationId,
            input: { text: "follow up" },
          }),
        });
        assert.equal(response.status, 202);
        let run = await response.json();
        for (
          let attempt = 0;
          attempt < 100 && ["queued", "running"].includes(run.status);
          attempt++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          run = await (
            await fetch(`${base}/runs/${run.id}`, { headers })
          ).json();
        }
        assert.equal(run.status, "succeeded", run.error?.message);
        assert.equal(run.output, "CURRENT-ANSWER");
        assert.equal(run.sessionId, "native-opencode-session");
        return run;
      };
      const first = await turn();
      const second = await turn(first.conversationId);
      assert.equal(second.conversationId, first.conversationId);
      const requests = readFileSync(join(workspace, "requests.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(
        requests.filter((request) => request.method === "session/new").length,
        1,
      );
      assert.equal(
        requests.filter((request) => request.method === expectedMethod).length,
        1,
      );
    } finally {
      await plugin.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
}
