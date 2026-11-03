import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCodexPermissionTurn } from "../src/main/codex-permission-turn";
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
});
function fixture(badAck = false): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "codex-live-"));
  directories.push(dir);
  const file = join(dir, "native.cjs");
  writeFileSync(
    file,
    "const fs=require('node:fs'),r=require('node:readline').createInterface({input:process.stdin});const send=f=>process.stdout.write(JSON.stringify(f)+'\\n');const badAck=" +
      String(badAck) +
      ";r.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync('requests.jsonl',line+'\\n');if(m.method==='initialize')send({id:m.id,result:{}});if(m.method==='thread/start'||m.method==='thread/resume')send({id:m.id,result:{thread:{id:'thread-one'}}});if(m.method==='turn/start'){process.stdout.write(JSON.stringify({id:m.id,result:{turn:{id:'turn-one'}}})+'\\n'+JSON.stringify({method:'turn/completed',params:{threadId:'thread-one',turn:{id:'stale-turn',status:'completed'}}})+'\\n');}if(m.method==='turn/steer'){send({id:m.id,result:{turnId:badAck?'wrong-turn':'turn-one'}});if(!badAck)setTimeout(()=>{send({method:'item/completed',params:{threadId:'thread-one',item:{id:'reply',type:'agentMessage',text:'AFTER'}}});send({method:'turn/completed',params:{threadId:'thread-one',turn:{id:'turn-one',status:'completed'}}});},50);}});",
  );
  return { dir, file };
}
describe("Codex native live input", () => {
  it.each([
    ["analysis", "read-only"],
    ["full_access", "danger-full-access"],
    ["safe_write", "workspace-write"],
    ["implementation", "workspace-write"],
  ] as const)(
    "keeps %s policy and steers the same active turn",
    async (mode, sandbox) => {
      const { dir, file } = fixture();
      const started = await startCodexPermissionTurn({
        invocation: { command: process.execPath, prefix: [file] },
        cwd: dir,
        prompt: "BEFORE",
        mode,
        imagePaths: [],
        inputArtifacts: [],
        environment: process.env,
        onOutput: () => undefined,
      });
      try {
        await started.steer!("AFTER");
        const result = await started.completion;
        expect(result.error).toBeUndefined();
        expect(result.output).toContain("AFTER");
        expect(result.sessionId).toBe("thread-one");
        const frames = readFileSync(join(dir, "requests.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(
          frames.find((f) => f.method === "thread/start").params,
        ).toMatchObject({ approvalPolicy: "never", sandbox });
        expect(frames.filter((f) => f.method === "turn/start")).toHaveLength(1);
        expect(frames.find((f) => f.method === "turn/steer").params).toEqual({
          threadId: "thread-one",
          expectedTurnId: "turn-one",
          input: [{ type: "text", text: "AFTER" }],
        });
      } finally {
        await started.cancel();
      }
    },
  );
  it("rejects a mismatched native acknowledgement without silently starting another turn", async () => {
    const { dir, file } = fixture(true);
    const started = await startCodexPermissionTurn({
      invocation: { command: process.execPath, prefix: [file] },
      cwd: dir,
      prompt: "BEFORE",
      mode: "analysis",
      imagePaths: [],
      inputArtifacts: [],
      environment: process.env,
      onOutput: () => undefined,
    });
    try {
      await expect(started.steer!("AFTER")).rejects.toThrow("did not match");
    } finally {
      await started.cancel();
    }
  });
});
