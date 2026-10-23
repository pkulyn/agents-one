import { describe, expect, it, vi } from "vitest";
import { summarizeTaskOutput } from "../src/shared/runtime-output";

const fixture = vi.hoisted(() => ({ script: "", args: [] as string[] }));
vi.mock("child_process", async (original) => {
  const actual = await original<typeof import("child_process")>();
  return {
    ...actual,
    spawn: (_command: string, args: string[], options: object) => {
      fixture.args = args;
      return actual.spawn(
        process.execPath,
        ["-e", fixture.script, "--", ...args],
        options,
      );
    },
  };
});
vi.mock("../src/main/mobile-control/codex-mobile-context", () => ({
  prepareCodexMobileContext: () => {
    throw Error("unexpected mobile call");
  },
}));
vi.mock("../src/main/mobile-control/codex-effective-config", () => ({
  readCodexMobileConfiguration: () => {
    throw Error("unexpected mobile call");
  },
}));
vi.mock("../src/main/mobile-control/codex-invocation-identity", () => ({
  captureCodexInspectionIdentity: vi.fn(),
  assertReviewedCodexInspectionNative: vi.fn(),
  assertCodexInspectionIdentity: vi.fn(),
}));
vi.mock("../src/main/mobile-control/codex-project-write-context", () => ({
  createCodexProjectWriteRunner: () => {
    throw Error("unexpected mobile call");
  },
}));
import { startCodexProcess } from "../src/main/codex-runtime";
import { startClaudeCodeProcess } from "../src/main/claude-code-runtime";

const session = "11111111-1111-4111-8111-111111111111";
describe("Claude and Codex attachment process boundary", () => {
  // @lat: [[runtime-chat#Claude and Codex attachment regression]]
  it.each(["claude", "codex"] as const)(
    "keeps %s new and resumed attachment answers intact across large tool output and UTF-8 chunks",
    async (kind) => {
      fixture.script = [
        "const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(1),kind=" +
          JSON.stringify(kind) +
          ";",
        "const dir=args[args.indexOf('--add-dir')+1],files=fs.readdirSync(dir);",
        "if(fs.readFileSync(path.join(dir,'测试文档.txt'),'utf8')!=='联调测试正文'||!fs.readFileSync(path.join(dir,'开机图片.png')).equals(Buffer.from('image fixture')))process.exit(2);",
        "if(kind==='codex'&&args[args.indexOf('--image')+1]!==path.join(dir,'开机图片.png'))process.exit(3);",
        "const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');",
        "if(kind==='codex')send({type:'thread.started',thread_id:'11111111-1111-4111-8111-111111111111'});",
        "send(kind==='claude'?{type:'user',message:{content:[{type:'tool_result',content:'A'.repeat(1024*1024)}]}}:{type:'item.completed',item:{type:'command_execution',aggregated_output:'A'.repeat(1024*1024)}});",
        "const answer='图片是开机素材，文本是联调测试。';const final=Buffer.from(JSON.stringify(kind==='claude'?{type:'result',subtype:'success',result:answer}:{type:'item.completed',item:{type:'agent_message',text:answer}})+'\\n');",
        "const split=final.indexOf(Buffer.from('图片'))+1;process.stdout.write(final.subarray(0,split));setTimeout(()=>process.stdout.write(final.subarray(split)),20);",
      ].join("");
      const start =
        kind === "claude" ? startClaudeCodeProcess : startCodexProcess;
      let sessionId: string | undefined;
      for (const phase of ["new", "resume"]) {
        let streamed = "";
        const started = await start(
          { executablePath: process.execPath },
          {
            prompt: "解释附件",
            mode: "safe_write",
            sessionId,
            attachments: [
              {
                id: "txt",
                kind: "text-file",
                name: "测试文档.txt",
                mime: "text/plain",
                size: 18,
                text: "联调测试正文",
              },
              {
                id: "img",
                kind: "image",
                name: "开机图片.png",
                mime: "image/png",
                size: 13,
                dataUrl:
                  "data:image/png;base64," +
                  Buffer.from("image fixture").toString("base64"),
              },
            ],
          },
          (chunk) => {
            streamed += chunk;
          },
        );
        const result = await started.completion;
        expect(result.error).toBeUndefined();
        expect(result.inputArtifacts.map((a) => a.id)).toEqual(["txt", "img"]);
        expect(result.sessionId).toEqual(
          kind === "codex"
            ? session
            : (sessionId ?? expect.stringMatching(/^[0-9a-f-]{36}$/)),
        );
        if (phase === "resume") {
          expect(fixture.args).toContain(
            kind === "codex" ? "resume" : "--resume",
          );
          expect(fixture.args).toContain(sessionId);
        }
        sessionId = result.sessionId;
        expect(summarizeTaskOutput(result.output).finalText).toBe(
          "图片是开机素材，文本是联调测试。",
        );
        expect(summarizeTaskOutput(streamed).finalText).toBe(
          "图片是开机素材，文本是联调测试。",
        );
        expect(result.output.length).toBeLessThanOrEqual(512 * 1024);
      }
    },
  );
});
