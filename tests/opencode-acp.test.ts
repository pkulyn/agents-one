import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  opencodeInvocation,
  openCodePermissionEnvironment,
  openCodeProxyEnvironment,
  probeOpenCodeRuntime,
  startOpenCodeProcess,
} from "../src/main/runtime-adapters/builtin/opencode-acp";

function fakeAcpScript(chunks = ["OpenCode 已回复。"]): string {
  return [
    "const readline=require('readline');",
    "const rl=readline.createInterface({input:process.stdin});",
    "const send=(x)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');",
    "rl.on('line',(line)=>{const m=JSON.parse(line);",
    "if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentInfo:{name:'OpenCode',version:'test'},agentCapabilities:{sessionCapabilities:{resume:true}}}});",
    "else if(m.method==='session/new'||m.method==='session/resume')send({id:m.id,result:{sessionId:'session-test'}});",
    `else if(m.method==='session/prompt'){for(const text of ${JSON.stringify(chunks)})send({method:'session/update',params:{sessionId:'session-test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});send({id:m.id,result:{stopReason:'end_turn'}});}`,
    "});",
  ].join("");
}

function hangingAcpScript(): string {
  return [
    "const readline=require('readline');",
    "const rl=readline.createInterface({input:process.stdin});",
    "const send=(x)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');",
    "rl.on('line',(line)=>{const m=JSON.parse(line);",
    "if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentInfo:{name:'OpenCode',version:'test'}}});",
    "else if(m.method==='session/new')send({id:m.id,result:{sessionId:'session-cancel'}});",
    "});",
  ].join("");
}

function writingAcpScript(): string {
  return [
    "const fs=require('fs'),readline=require('readline');",
    "const rl=readline.createInterface({input:process.stdin});",
    "const send=(x)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');",
    "rl.on('line',(line)=>{const m=JSON.parse(line);if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentInfo:{name:'OpenCode',version:'test'}}});else if(m.method==='session/new')send({id:m.id,result:{sessionId:'session-write'}});else if(m.method==='session/prompt'){fs.writeFileSync(process.cwd()+'/created.txt','created by ACP');send({id:m.id,result:{stopReason:'end_turn'}})}});",
  ].join("");
}

function metadataAcpScript(): string {
  return [
    "const fs=require('fs'),readline=require('readline');",
    "const rl=readline.createInterface({input:process.stdin});",
    "const send=(x)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');",
    "rl.on('line',(line)=>{const m=JSON.parse(line);",
    "if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentInfo:{name:'OpenCode',version:'test'},agentCapabilities:{sessionCapabilities:{resume:true}}}});",
    "else if(m.method==='session/new')send({id:m.id,result:{sessionId:'session-metadata',configOptions:[{id:'model',category:'model',currentValue:'ark/glm-5.2'}]}});",
    "else if(m.method==='session/prompt'){fs.writeFileSync(process.cwd()+'/prompt.txt',m.params.prompt[0].text);send({method:'session/update',params:{sessionId:'session-metadata',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'用户'}}}});send({method:'session/update',params:{sessionId:'session-metadata',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'请求介绍'}}}});send({method:'session/update',params:{sessionId:'session-metadata',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'我是 OpenCode。'}}}});send({method:'session/update',params:{sessionId:'session-metadata',update:{sessionUpdate:'usage_update',used:42,size:100}}});send({id:m.id,result:{stopReason:'end_turn',usage:{inputTokens:10,outputTokens:4,totalTokens:14}}});}",
    "});",
  ].join("");
}

function toolAcpScript(): string {
  return [
    "const readline=require('readline');",
    "const rl=readline.createInterface({input:process.stdin});",
    "const send=(x)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');",
    "rl.on('line',(line)=>{const m=JSON.parse(line);",
    "if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentInfo:{name:'OpenCode',version:'test'}}});",
    "else if(m.method==='session/new')send({id:m.id,result:{sessionId:'session-tool'}});",
    "else if(m.method==='session/prompt'){const rawInput={filePath:process.cwd()+'/README.md',limit:10};send({method:'session/update',params:{sessionId:'session-tool',update:{sessionUpdate:'tool_call',toolCallId:'call-1',title:'read',kind:'read',status:'pending',rawInput:{}}}});send({method:'session/update',params:{sessionId:'session-tool',update:{sessionUpdate:'tool_call_update',toolCallId:'call-1',title:'read',kind:'read',status:'in_progress',rawInput}}});send({method:'session/update',params:{sessionId:'session-tool',update:{sessionUpdate:'tool_call_update',toolCallId:'call-1',title:'Users\\README.md',status:'completed',content:[{type:'content',content:{type:'text',text:'1: hello'}}],rawOutput:{output:'<path>'+process.cwd()+'/README.md</path>'}}}});send({method:'session/update',params:{sessionId:'session-tool',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'读取完成。'}}}});send({id:m.id,result:{stopReason:'end_turn'}});} ",
    "});",
  ].join("");
}

function continuationAcpScript(
  capabilities: unknown,
  failRestore = false,
): string {
  return [
    "const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});",
    "const send=(x)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');",
    `const capabilities=${JSON.stringify(capabilities)},failRestore=${JSON.stringify(failRestore)};`,
    "rl.on('line',(line)=>{const m=JSON.parse(line);fs.appendFileSync(process.cwd()+'/requests.jsonl',line+'\\n');",
    "if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:capabilities}});",
    "else if(m.method==='session/new')send({id:m.id,result:{sessionId:'new-empty-session'}});",
    "else if(m.method==='session/load'||m.method==='session/resume'){if(failRestore){send({id:m.id,error:{code:-32000,message:'session not found'}});return;}if(m.method==='session/load')send({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'OLD-REPLAY'}}}});send({id:m.id,result:{}});}",
    "else if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'CURRENT-ANSWER'}}}});send({id:m.id,result:{stopReason:'end_turn'}});}",
    "});",
  ].join("");
}

function lifecycleAcpScript(delayMs: number, ignoresCancel = false): string {
  return [
    "const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});",
    "const send=(x)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');",
    `const delayMs=${delayMs},ignoresCancel=${ignoresCancel};let promptId,timer;`,
    "rl.on('line',line=>{const m=JSON.parse(line);",
    "if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{sessionCapabilities:{resume:{}}}}});",
    "else if(m.method==='session/new')send({id:m.id,result:{sessionId:'lifecycle-session'}});",
    "else if(m.method==='session/resume')send({id:m.id,result:{}});",
    "else if(m.method==='session/prompt'){promptId=m.id;fs.writeFileSync('prompt-started.txt','started');if(m.params.prompt[0].text.endsWith('\\nlong')){timer=setTimeout(()=>{send({method:'session/update',params:{sessionId:'lifecycle-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'LONG-TURN-OK'}}}});send({id:m.id,result:{stopReason:'end_turn'}})},delayMs)}else{send({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:fs.existsSync('cancel-ack.txt')?'SAME-SESSION-OK':'UNFINISHED-CANCEL'}}}});send({id:m.id,result:{stopReason:'end_turn'}})}}",
    "else if(m.method==='session/cancel'&&!ignoresCancel){clearTimeout(timer);setTimeout(()=>{fs.writeFileSync('cancel-ack.txt','tool stopped');send({id:promptId,result:{stopReason:'cancelled'}})},1500)}",
    "});",
  ].join("");
}

describe("OpenCode ACP adapter", () => {
  // @lat: [[plugin-sdk#ACP turn deadlines#Configured deadline remains bounded]]
  it("enforces the configured prompt deadline independently of initialization", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-acp-deadline-"));
    try {
      const started = await startOpenCodeProcess(
        {
          executablePath: process.execPath,
          acpArgs: ["-e", lifecycleAcpScript(5_000)],
          timeoutMs: 100,
        },
        { prompt: "long", mode: "analysis", workspace },
        () => undefined,
        () => undefined,
      );
      const result = await started.completion;
      expect(result).toMatchObject({
        sessionId: "lifecycle-session",
        error: "OpenCode ACP 请求超时：session/prompt",
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  // @lat: [[plugin-sdk#ACP turn deadlines#Unresponsive cancellation cleanup]]
  it("forces cleanup when an unresponsive agent ignores cancellation", async () => {
    const workspace = mkdtempSync(
      join(tmpdir(), "opencode-acp-cancel-fallback-"),
    );
    try {
      const started = await startOpenCodeProcess(
        {
          executablePath: process.execPath,
          acpArgs: ["-e", lifecycleAcpScript(60_000, true)],
          timeoutMs: 70_000,
        },
        { prompt: "long", mode: "analysis", workspace },
        () => undefined,
        () => undefined,
      );
      await expect
        .poll(() => {
          try {
            return readFileSync(join(workspace, "prompt-started.txt"), "utf8");
          } catch {
            return "";
          }
        })
        .toBe("started");
      await started.cancel();
      await expect(started.completion).resolves.toMatchObject({
        sessionId: "lifecycle-session",
        error: expect.any(String),
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 15_000);

  // @lat: [[plugin-sdk#ACP turn deadlines#Long prompt completion]]
  it("allows a prompt longer than the handshake deadline within the Runtime timeout", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-acp-long-turn-"));
    try {
      const started = await startOpenCodeProcess(
        {
          executablePath: process.execPath,
          acpArgs: ["-e", lifecycleAcpScript(32_000)],
          timeoutMs: 40_000,
        },
        { prompt: "long", mode: "analysis", workspace },
        () => undefined,
        () => undefined,
      );
      const result = await started.completion;
      expect(result.error).toBeUndefined();
      expect(result.output).toBe("LONG-TURN-OK");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 45_000);

  // @lat: [[plugin-sdk#ACP turn deadlines#Cancellation preserves continuation]]
  it("waits for tool cancellation acknowledgement before restoring the same session", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-acp-cancel-drain-"));
    try {
      const config = {
        executablePath: process.execPath,
        acpArgs: ["-e", lifecycleAcpScript(60_000)],
        timeoutMs: 70_000,
      };
      const started = await startOpenCodeProcess(
        config,
        { prompt: "long", mode: "analysis", workspace },
        () => undefined,
        () => undefined,
      );
      await expect
        .poll(() => {
          try {
            return readFileSync(join(workspace, "prompt-started.txt"), "utf8");
          } catch {
            return "";
          }
        })
        .toBe("started");
      const sessionId = started.sessionId;
      await started.cancel();
      const cancelled = await started.completion;
      expect(cancelled.error).toBeUndefined();
      expect(readFileSync(join(workspace, "cancel-ack.txt"), "utf8")).toBe(
        "tool stopped",
      );
      const next = await startOpenCodeProcess(
        config,
        { prompt: "follow up", mode: "analysis", workspace, sessionId },
        () => undefined,
        () => undefined,
      );
      const result = await next.completion;
      expect(result).toMatchObject({ sessionId, output: "SAME-SESSION-OK" });
      expect(result.error).toBeUndefined();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it.each([
    [{ sessionCapabilities: { resume: {} } }, "session/resume"],
    [{ sessionCapabilities: { resume: true } }, "session/resume"],
    [{ loadSession: true }, "session/load"],
  ])(
    "restores the provider session for capabilities %j without replaying old answers",
    async (capabilities, method) => {
      const workspace = mkdtempSync(
        join(tmpdir(), "opencode-acp-continuation-"),
      );
      try {
        const output: string[] = [];
        const started = await startOpenCodeProcess(
          {
            executablePath: process.execPath,
            acpArgs: ["-e", continuationAcpScript(capabilities)],
          },
          {
            prompt: "follow up",
            mode: "analysis",
            workspace,
            sessionId: "persisted-session",
          },
          (chunk) => output.push(chunk),
          () => undefined,
        );
        const result = await started.completion;
        expect(result).toMatchObject({
          sessionId: "persisted-session",
          output: "CURRENT-ANSWER",
        });
        expect(result.error).toBeUndefined();
        expect(output.join("")).toBe("CURRENT-ANSWER");
        const requests = readFileSync(join(workspace, "requests.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(requests.map((request) => request.method)).toEqual([
          "initialize",
          method,
          "session/prompt",
        ]);
        expect(requests[1].params.sessionId).toBe("persisted-session");
        expect(requests[2].params.sessionId).toBe("persisted-session");
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    },
  );

  it.each([false, true])(
    "does not silently create a fresh session when continuation fails (restore=%s)",
    async (supportsRestore) => {
      const workspace = mkdtempSync(
        join(tmpdir(), "opencode-acp-restore-failure-"),
      );
      try {
        const started = await startOpenCodeProcess(
          {
            executablePath: process.execPath,
            acpArgs: [
              "-e",
              continuationAcpScript(
                supportsRestore ? { loadSession: true } : {},
                true,
              ),
            ],
          },
          {
            prompt: "follow up",
            mode: "analysis",
            workspace,
            sessionId: "persisted-session",
          },
          () => undefined,
          () => undefined,
        );
        const result = await started.completion;
        expect(result.error).toBeTruthy();
        expect(result.output).toBe("");
        const requests = readFileSync(
          join(workspace, "requests.jsonl"),
          "utf8",
        );
        expect(requests).not.toContain("session/new");
        expect(requests).not.toContain("session/prompt");
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    },
  );

  it("resolves Windows npm shims without using a shell", () => {
    const shim = join("C:", "Tools", "opencode.cmd");
    expect(
      opencodeInvocation(shim, "win32", (path) =>
        [
          join(
            "C:",
            "Tools",
            "node_modules",
            "opencode-ai",
            "bin",
            "opencode.exe",
          ),
        ].includes(path),
      ),
    ).toEqual({
      command: join(
        "C:",
        "Tools",
        "node_modules",
        "opencode-ai",
        "bin",
        "opencode.exe",
      ),
      prefix: [],
    });
  });

  it("completes an ACP handshake and returns live capabilities", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-acp-probe-"));
    try {
      const result = await probeOpenCodeRuntime({
        executablePath: process.execPath,
        acpArgs: ["-e", fakeAcpScript()],
        workspace,
      });
      expect(result).toMatchObject({
        healthy: true,
        workspaceAccess: true,
        message: "OpenCode test",
        capabilities: expect.objectContaining({
          chat: true,
          streaming: true,
          workspaceAccess: true,
        }),
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  // @lat: [[adapter-registry#Built-in adapters]]
  it("streams ACP assistant updates through the normalized Runtime event contract", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-acp-run-"));
    try {
      const output: string[] = [];
      const events: string[] = [];
      const started = await startOpenCodeProcess(
        {
          executablePath: process.execPath,
          acpArgs: ["-e", fakeAcpScript()],
        },
        { prompt: "请回复", mode: "analysis", workspace },
        (chunk) => output.push(chunk),
        (event) => events.push(event.type),
      );
      const result = await started.completion;
      expect(result).toMatchObject({
        sessionId: "session-test",
        output: "OpenCode 已回复。",
      });
      expect(output.join("")).toBe("OpenCode 已回复。");
      expect(events).toContain("message");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("preserves standalone whitespace deltas in live output and the completed answer", async () => {
    const chunks = [
      "#",
      " ",
      "周报",
      "\n",
      "\n",
      "-",
      " ",
      "**",
      "消息",
      "**",
      "\n",
      "  ",
      "- 子项",
      "\n\n",
    ];
    const live: string[] = [];
    const events: string[] = [];
    const started = await startOpenCodeProcess(
      {
        executablePath: process.execPath,
        acpArgs: ["-e", fakeAcpScript(chunks)],
      },
      { prompt: "周报", mode: "analysis" },
      (chunk) => live.push(chunk),
      (event) => events.push(event.type),
    );
    const result = await started.completion;
    expect(live).toEqual(chunks);
    expect(result.output).toBe(chunks.join(""));
    expect(events.filter((event) => event === "message")).toHaveLength(1);
  });

  it("coalesces thought deltas and preserves OpenCode identity, model, and usage metadata", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-acp-metadata-"));
    try {
      const events: Array<{ type: string; summary: string }> = [];
      const started = await startOpenCodeProcess(
        {
          executablePath: process.execPath,
          acpArgs: ["-e", metadataAcpScript()],
        },
        { prompt: "你是谁？", mode: "analysis", workspace },
        () => undefined,
        (event) => events.push({ type: event.type, summary: event.summary }),
      );
      const result = await started.completion;
      const prompt = readFileSync(join(workspace, "prompt.txt"), "utf8");

      expect(prompt).toContain("Agents One 通过 OpenCode ACP 接入");
      expect(result).toMatchObject({
        model: { provider: "ark", id: "glm-5.2" },
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
          contextUsedTokens: 42,
          contextWindowTokens: 100,
        },
      });
      expect(
        events
          .filter((event) => event.type === "progress")
          .map((event) => event.summary),
      ).toEqual(["用户", "用户请求介绍"]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("preserves structured ACP tool names, inputs, outputs, and call ids", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-acp-tools-"));
    try {
      const events: Array<{
        type: string;
        summary: string;
        detail?: string;
        tool?: {
          name: string;
          callId?: string;
          inputSummary?: string;
          outputSummary?: string;
        };
      }> = [];
      const started = await startOpenCodeProcess(
        {
          executablePath: process.execPath,
          acpArgs: ["-e", toolAcpScript()],
        },
        { prompt: "读取 README", mode: "analysis", workspace },
        () => undefined,
        (event) => events.push(event),
      );
      const result = await started.completion;
      const toolEvents = events.filter((event) =>
        ["tool_call", "tool_result"].includes(event.type),
      );

      expect(result.output).toBe("读取完成。");
      expect(toolEvents.map((event) => event.type)).toEqual([
        "tool_call",
        "tool_call",
        "tool_result",
      ]);
      expect(toolEvents[1]).toMatchObject({
        type: "tool_call",
        summary: "正在调用工具：read",
        detail: '{"filePath":"README.md","limit":10}',
        tool: {
          name: "read",
          callId: "call-1",
          inputSummary: '{"filePath":"README.md","limit":10}',
        },
      });
      expect(toolEvents[2]).toMatchObject({
        type: "tool_result",
        summary: "工具已完成：read",
        detail: "1: hello",
        tool: {
          name: "read",
          callId: "call-1",
          outputSummary: "1: hello",
        },
      });
      expect(toolEvents[2]?.detail).not.toContain(workspace);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("cancels a pending ACP prompt without leaving a child process behind", async () => {
    const started = await startOpenCodeProcess(
      {
        executablePath: process.execPath,
        acpArgs: ["-e", hangingAcpScript()],
      },
      { prompt: "请开始一个长任务", mode: "analysis" },
      () => undefined,
      () => undefined,
    );
    await expect(started.cancel()).resolves.toBeUndefined();
    await expect(started.completion).resolves.toMatchObject({
      error: expect.any(String),
    });
  });

  it("publishes a hashed relative diff artifact from a workspace change", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-acp-artifact-"));
    try {
      const started = await startOpenCodeProcess(
        {
          executablePath: process.execPath,
          acpArgs: ["-e", writingAcpScript()],
        },
        { prompt: "写一个文件", mode: "safe_write", workspace },
        () => undefined,
        () => undefined,
      );
      const result = await started.completion;
      expect(result.artifacts).toEqual([
        expect.objectContaining({
          kind: "diff",
          size: expect.any(Number),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          content: expect.stringContaining("created.txt"),
        }),
      ]);
      expect(result.artifacts[0]?.content).not.toContain(workspace);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe("OpenCode shared permission semantics", () => {
  it("preserves inherited config and credentials while requiring native mutation approval", () => {
    const source = {
      PATH: "portable",
      CUSTOM_PROVIDER_TOKEN: "private",
      OPENCODE_PERMISSION: JSON.stringify({
        read: { "*.env": "deny" },
        custom_query: "ask",
      }),
    };
    const env = openCodePermissionEnvironment("analysis", source);
    expect(env.CUSTOM_PROVIDER_TOKEN).toBe("private");
    expect(JSON.parse(env.OPENCODE_PERMISSION!)).toMatchObject({
      read: { "*.env": "deny" },
      custom_query: "ask",
      edit: "ask",
      bash: "ask",
      task: "ask",
    });
    expect(source.OPENCODE_PERMISSION).not.toContain("edit");
  });

  it("restores an automatically removed original and reports permission failure instead of success", async () => {
    const workspace = mkdtempSync(
      join(tmpdir(), "opencode-removal-protection-"),
    );
    const original = join(workspace, "original.txt");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(original, "preserve original");
    const script = writingAcpScript().replace(
      "fs.writeFileSync(process.cwd()+'/created.txt','created by ACP')",
      "fs.unlinkSync(process.cwd()+'/original.txt')",
    );
    try {
      const started = await startOpenCodeProcess(
        { executablePath: process.execPath, acpArgs: ["-e", script] },
        { prompt: "删除文件", mode: "safe_write", workspace },
        () => undefined,
        () => undefined,
      );
      const result = await started.completion;
      expect(readFileSync(original, "utf8")).toBe("preserve original");
      expect(result.error).toContain("[Agents One 权限不足]");
      expect(result.error).toContain("完全访问");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it.each([
    ["analysis", "read", true],
    ["analysis", "search", true],
    ["analysis", "edit", false],
    ["safe_write", "edit", true],
    ["safe_write", "delete", false],
    ["safe_write", "move", false],
    ["full_access", "delete", true],
  ] as const)(
    "applies %s permission to %s through an actual ACP request",
    async (mode, kind, allowed) => {
      const workspace = mkdtempSync(join(tmpdir(), "opencode-permission-"));
      const script = [
        "const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});",
        "const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');let prompt;",
        "rl.on('line',line=>{const m=JSON.parse(line);",
        "if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1}});",
        "else if(m.method==='session/new')send({id:m.id,result:{sessionId:'permission-session'}});",
        "else if(m.method==='session/prompt'){prompt=m.id;send({id:9001,method:'session/request_permission',params:{sessionId:'permission-session',toolCall:{toolCallId:'permission-tool',kind:" +
          JSON.stringify(kind) +
          ",title:" +
          JSON.stringify(kind) +
          "},options:[{kind:'reject_once',optionId:'reject'},{kind:'allow_once',optionId:'once'}]}})}",
        "else if(m.id===9001){fs.writeFileSync('permission-result.json',JSON.stringify(m.result));send({method:'session/update',params:{sessionId:'permission-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'操作结果'}}}});send({id:prompt,result:{stopReason:'end_turn'}})}});",
      ].join("");
      try {
        const events: Array<{ type: string; summary: string }> = [];
        const started = await startOpenCodeProcess(
          { executablePath: process.execPath, acpArgs: ["-e", script] },
          {
            mode,
            prompt: "权限验证",
            workspace,
            fullAccessConfirmed: mode === "full_access",
          },
          () => undefined,
          (event) => events.push(event),
        );
        const result = await started.completion;
        const response = JSON.parse(
          readFileSync(join(workspace, "permission-result.json"), "utf8"),
        );
        expect(response.outcome.outcome).toBe(
          allowed ? "selected" : "cancelled",
        );
        if (allowed) expect(result.error).toBeUndefined();
        else {
          expect(result.error).toContain("[Agents One 权限不足]");
          expect(
            events.some(
              (event) =>
                event.type === "error" && event.summary.includes("切换"),
            ),
          ).toBe(true);
        }
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    },
  );
});

// @lat: [[runtime-chat#ACP agent request identity preservation]]
it.each([0, "0", "9001", "009"])(
  "preserves exact ACP permission response identity %j",
  async (id) => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-rpc-id-"));
    const script = [
      "const fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});",
      "const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');let prompt;const id=" +
        JSON.stringify(id) +
        ";",
      "rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1}});else if(m.method==='session/new')send({id:m.id,result:{sessionId:'id-session'}});",
      "else if(m.method==='session/prompt'){prompt=m.id;send({id,method:'session/request_permission',params:{toolCall:{kind:'edit',title:'write'},options:[{kind:'allow_once',optionId:'once'}]}})}",
      "else if(!m.method){fs.writeFileSync('response.json',JSON.stringify(m));if(m.id===id)send({id:prompt,result:{stopReason:'end_turn'}})}});",
    ].join("");
    try {
      const started = await startOpenCodeProcess(
        { executablePath: process.execPath, acpArgs: ["-e", script] },
        {
          mode: "safe_write",
          workspace,
          prompt: "Synthetic tool permission",
          timeoutMs: 1000,
        },
        () => {},
        () => {},
      );
      const result = await started.completion.catch((error) => ({
        error: String(error),
      }));
      const response = JSON.parse(
        readFileSync(join(workspace, "response.json"), "utf8"),
      );
      expect(response.id).toBe(id);
      expect(response.result.outcome).toEqual({
        outcome: "selected",
        optionId: "once",
      });
      expect(result.error).toBeUndefined();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);

// @lat: [[runtime-chat#ACP turn session and deadline metadata]]
it.each([1500, 100])(
  "publishes the session before completion and honors task deadline %i",
  async (timeoutMs) => {
    const workspace = mkdtempSync(join(tmpdir(), "opencode-task-deadline-"));
    const metadata: Array<{ sessionId?: string }> = [];
    try {
      const started = await startOpenCodeProcess(
        {
          executablePath: process.execPath,
          acpArgs: ["-e", lifecycleAcpScript(400)],
          timeoutMs: timeoutMs === 1500 ? 100 : 1500,
        },
        { prompt: "long", mode: "analysis", workspace, timeoutMs },
        () => undefined,
        () => undefined,
        (update) => metadata.push(update),
      );
      await expect
        .poll(() =>
          metadata.some((update) => update.sessionId === "lifecycle-session"),
        )
        .toBe(true);
      const result = await started.completion;
      expect(result.sessionId).toBe("lifecycle-session");
      if (timeoutMs === 1500) {
        expect(result.error).toBeUndefined();
        expect(result.output).toBe("LONG-TURN-OK");
      } else expect(result.error).toBe("OpenCode ACP 请求超时：session/prompt");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);

// @lat: [[runtime-chat#OpenCode Windows system proxy inheritance]]
describe("OpenCode Windows proxy inheritance", () => {
  it("inherits the enabled manual proxy and preserves permission environment", () => {
    const source = { OPENCODE_PERMISSION: '{"*":"ask"}', KEEP: "unchanged" };
    const result = openCodeProxyEnvironment(source, {
      enabled: true,
      server: "127.0.0.1:7890",
      bypass: "localhost;10.*;<local>",
    });
    expect(result).toMatchObject({
      ...source,
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
    });
    expect(result.NO_PROXY?.split(",")).toEqual(
      expect.arrayContaining(["localhost", "127.0.0.1", "::1", "10.*"]),
    );
    expect(source).not.toHaveProperty("HTTPS_PROXY");
  });
  it.each([
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ])("preserves explicit %s settings", (key) => {
    const source = {
      [key]: "http://explicit:8123",
      NO_PROXY: "private.example",
    };
    expect(
      openCodeProxyEnvironment(source, {
        enabled: true,
        server: "system:7890",
      }),
    ).toBe(source);
  });
  it("preserves explicit bypass and protocol-specific proxy routes", () => {
    expect(
      openCodeProxyEnvironment(
        { no_proxy: "private.example" },
        {
          enabled: true,
          server: "http=plain:8080;https=secure:8081;socks=socks:1080",
        },
      ),
    ).toEqual({
      HTTP_PROXY: "http://plain:8080",
      HTTPS_PROXY: "http://secure:8081",
      no_proxy: "private.example",
    });
    expect(
      openCodeProxyEnvironment(
        {},
        { enabled: true, server: "http=plain:8080" },
      ),
    ).not.toHaveProperty("HTTPS_PROXY");
  });
  it.each([
    { enabled: false, server: "system:7890" },
    { enabled: true },
    { enabled: true, server: "socks=socks:1080" },
    { enabled: true, server: "not a valid proxy" },
  ])("ignores disabled or unusable settings %j", (settings) => {
    expect(openCodeProxyEnvironment({ KEEP: "unchanged" }, settings)).toEqual({
      KEEP: "unchanged",
    });
  });
});
