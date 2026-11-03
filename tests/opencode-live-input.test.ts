import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startOpenCodeProcess } from "../src/main/runtime-adapters/builtin/opencode-acp";
it.each([false, true])(
  "keeps one native OpenCode session alive until appended input settles (reject=%s)",
  async (reject) => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-live-"));
    const file = join(dir, "native.cjs");
    writeFileSync(
      file,
      "const fs=require('node:fs'),r=require('node:readline').createInterface({input:process.stdin});const send=f=>process.stdout.write(JSON.stringify(f)+'\\n');const reject=" +
        String(reject) +
        ";let first;const answer=text=>send({method:'session/update',params:{sessionId:'live-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});r.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync('requests.jsonl',line+'\\n');if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1}});if(m.method==='session/new')send({id:m.id,result:{sessionId:'live-session'}});if(m.method==='session/prompt'){if(!first){first=m.id;fs.writeFileSync('started','yes');if(reject)setTimeout(()=>{answer('ORIGINAL');send({id:first,result:{stopReason:'end_turn'}});},350);}else{if(reject)send({id:m.id,error:{code:-32000,message:'native input rejected'}});else{send({id:first,result:{stopReason:'end_turn'}});setTimeout(()=>{fs.writeFileSync('second-settled','yes');answer('AFTER');send({id:m.id,result:{stopReason:'end_turn'}});},150);}}}});",
    );
    let started: Awaited<ReturnType<typeof startOpenCodeProcess>> | undefined;
    try {
      started = await startOpenCodeProcess(
        { executablePath: process.execPath, acpArgs: [file], workspace: dir },
        { prompt: "ORIGINAL", mode: "full_access", workspace: dir },
        () => undefined,
        () => undefined,
      );
      const deadline = Date.now() + 3000;
      while (!existsSync(join(dir, "started")) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 10));
      expect(existsSync(join(dir, "started"))).toBe(true);
      if (reject)
        await expect(started.steer("AFTER")).rejects.toThrow(
          "native input rejected",
        );
      else await started.steer("AFTER");
      const result = await started.completion;
      expect(result.error).toBeUndefined();
      expect(result.output).toBe(reject ? "ORIGINAL" : "AFTER");
      expect(result.sessionId).toBe("live-session");
      if (!reject) expect(existsSync(join(dir, "second-settled"))).toBe(true);
      const frames = readFileSync(join(dir, "requests.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s));
      expect(frames.filter((f) => f.method === "session/new")).toHaveLength(1);
      expect(
        frames
          .filter((f) => f.method === "session/prompt")
          .map((f) => f.params.sessionId),
      ).toEqual(["live-session", "live-session"]);
      expect(frames.some((f) => f.method === "session/cancel")).toBe(false);
    } finally {
      if (started) await started.cancel();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
