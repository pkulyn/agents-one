vi.mock("../src/main/pi-config-policy", () => ({
  assertPiNonExecutingConfig: (): void => {},
}));
vi.mock("../src/main/pi-capabilities", () => ({
  verifyPiStrictCapabilities: async (invocation: {
    command: string;
    prefix: string[];
  }) => ({ invocation, assertUnchanged: (): void => {} }),
}));
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { summarizeTaskOutput } from "../src/shared/runtime-output";

const fixture = vi.hoisted(() => ({
  script: "",
  args: [] as string[],
  cwd: "",
}));
vi.mock("child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("child_process")>();
  return {
    ...original,
    spawn: (_command: string, _args: string[], options: object) => {
      fixture.args = _args;
      fixture.cwd = (options as { cwd: string }).cwd;
      return original.spawn(process.execPath, ["-e", fixture.script], options);
    },
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

function actualGuard(): (target: string) => unknown {
  const index = fixture.args.indexOf("--extension");
  expect(index).toBeGreaterThanOrEqual(0);
  const source = fs.readFileSync(fixture.args[index + 1], "utf8");
  let check!: (event: unknown, ctx: { cwd: string }) => unknown;
  const install = new Function(
    "fs",
    "path",
    source
      .replace(/^import .*;\r?$/gm, "")
      .replace(
        "export default function agentsOneReadOnly",
        "return function agentsOneReadOnly",
      ),
  )(fs, path);
  install({
    on: (_event: string, handler: typeof check) => {
      check = handler;
    },
  });
  return (target) =>
    check({ toolName: "write", input: { path: target } }, { cwd: fixture.cwd });
}
it("refuses automatic writes when the actual Main-selected directory contains the executing CLI", async () => {
  // @lat: [[runtime-chat#Pi automatic write scope]]
  const directory = fs.mkdtempSync(path.join(tmpdir(), "pi-main-write-scope-"));
  if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep))
    throw Error("Unsafe fixture root");
  const cli = path.join(directory, "runner.mjs");
  fs.writeFileSync(cli, "fixture original");
  fixture.script =
    'process.stdout.write(JSON.stringify({type:"agent_end",messages:[{role:"assistant",content:[{type:"text",text:"done"}],stopReason:"stop"}]}));';
  try {
    const started = await startPiProcess(
      { executablePath: cli },
      { prompt: "fixture", mode: "safe_write", workspace: directory },
      () => {},
    );
    await started.completion;
    const check = actualGuard();
    expect(check("ordinary.txt")).toMatchObject({ block: true });
    expect(check(path.join(directory, "../outside.txt"))).toMatchObject({
      block: true,
    });
    expect(check(cli)).toMatchObject({ block: true });
    expect(fs.readFileSync(cli, "utf8")).toBe("fixture original");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
it("binds projectless automatic writes to the existing private conversation directory", async () => {
  fixture.script =
    'process.stdout.write(JSON.stringify({type:"agent_end",messages:[{role:"assistant",content:[{type:"text",text:"done"}],stopReason:"stop"}]}));';
  const started = await startPiProcess(
    { executablePath: process.execPath },
    { prompt: "fixture", mode: "safe_write" },
    () => {},
  );
  await started.completion;
  const check = actualGuard();
  expect(fixture.cwd).not.toBe(process.cwd());
  expect(check("draft.txt")).toBeUndefined();
  expect(check(path.join(process.cwd(), "source.ts"))).toMatchObject({
    block: true,
  });
});

it.each(["sibling", "ancestor"])(
  "binds Main write authority relative to a %s CLI installation",
  async (placement) => {
    const directory = fs.mkdtempSync(
      path.join(tmpdir(), "pi-main-install-scope-"),
    );
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep))
      throw Error("Unsafe fixture root");
    const workspace = path.join(directory, "workspace");
    fs.mkdirSync(workspace);
    const install =
      placement === "ancestor" ? directory : path.join(directory, "runtime");
    fs.mkdirSync(install, { recursive: true });
    const cli = path.join(install, "runner.exe");
    fs.writeFileSync(cli, "fixture");
    fixture.script =
      'process.stdout.write(JSON.stringify({type:"agent_end",messages:[{role:"assistant",content:[{type:"text",text:"done"}],stopReason:"stop"}]}));';
    try {
      const started = await startPiProcess(
        { executablePath: cli },
        { prompt: "fixture", mode: "safe_write", workspace },
        () => {},
      );
      await started.completion;
      const result = actualGuard()("ordinary.txt");
      if (placement === "ancestor")
        expect(result).toMatchObject({ block: true });
      else expect(result).toBeUndefined();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);
