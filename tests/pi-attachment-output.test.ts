import { describe, expect, it, vi } from "vitest";
import { summarizeTaskOutput } from "../src/shared/runtime-output";

const fixture = vi.hoisted(() => ({ script: "" }));
vi.mock("child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("child_process")>();
  return {
    ...original,
    spawn: (_command: string, _args: string[], options: object) =>
      original.spawn(process.execPath, ["-e", fixture.script], options),
  };
});

import { startPiProcess, piOutputError } from "../src/main/pi-runtime";

describe("Pi attachment output retention", () => {
  // @lat: [[runtime-chat#Pi attachment output retention]]
  it("keeps the final answer after a large binary echo and split UTF-8 process chunks", async () => {
    fixture.script = [
      "const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');",
      "const user={role:'user',content:[{type:'image',mimeType:'image/png',data:'A'.repeat(3*1024*1024)}]};",
      "const message={role:'assistant',content:[{type:'thinking',thinking:'已读取两个附件。'},{type:'text',text:'图片是品牌开屏，文本是联调测试记录。'}],stopReason:'stop'};",
      "send({type:'message_end',message});",
      "const bytes=Buffer.from(JSON.stringify({type:'agent_end',messages:[message,user]})+'\\n');",
      "const split=bytes.indexOf(Buffer.from('图片'))+1;process.stdout.write(bytes.subarray(0,split));setTimeout(()=>process.stdout.write(bytes.subarray(split)),10);",
    ].join("");
    let streamed = "";
    const started = await startPiProcess(
      { executablePath: process.execPath },
      { prompt: "解释附件", mode: "safe_write" },
      (chunk) => {
        streamed += chunk;
      },
    );
    const result = await started.completion;
    expect(result.error).toBeUndefined();
    expect(piOutputError(result.output)).toBeUndefined();
    expect(summarizeTaskOutput(result.output).finalText).toBe(
      "图片是品牌开屏，文本是联调测试记录。",
    );
    expect(summarizeTaskOutput(streamed).finalText).toBe(
      "图片是品牌开屏，文本是联调测试记录。",
    );
    expect(result.output.length).toBeLessThan(512 * 1024);
    expect(result.output).not.toContain("�");
  });
});
