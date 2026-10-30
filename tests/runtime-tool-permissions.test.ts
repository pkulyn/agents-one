import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { transpileModule, ModuleKind } from "typescript";
import {
  isToolDeletion,
  toolPermissionDecision,
} from "../src/shared/runtime-permissions";
import {
  createRuntimePermissionBridge,
  type RuntimePermissionBridge,
} from "../src/main/runtime-tool-permissions";
import { startCodexPermissionTurn } from "../src/main/codex-permission-turn";

vi.mock("electron", () => ({ BrowserWindow: {}, dialog: {} }));
const bridges: RuntimePermissionBridge[] = [];
const directories: string[] = [];
afterEach(() => {
  bridges.splice(0).forEach((bridge) => bridge.dispose());
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }));
});
const directory = (): string => {
  const path = mkdtempSync(join(tmpdir(), "agents-one-permission-"));
  directories.push(path);
  return path;
};
const bridge = async (
  authorize: RuntimePermissionBridge["authorize"],
): Promise<RuntimePermissionBridge> => {
  const result = await createRuntimePermissionBridge(authorize);
  bridges.push(result);
  return result;
};
const ask = (
  b: RuntimePermissionBridge,
  name: string,
  input: Record<string, unknown>,
  token = b.environment.AGENTS_ONE_PERMISSION_TOKEN,
): Promise<Response> =>
  fetch(b.environment.AGENTS_ONE_PERMISSION_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: JSON.stringify({ name, input }),
  });

describe("Runtime tool authorization", () => {
  // @lat: [[runtime-chat#Automatic tool execution and deletion confirmation]]
  it("allows document generation and editing while requiring deletion confirmation", () => {
    expect(
      toolPermissionDecision("safe_write", "Terminal", {
        command: "python build_report.py",
      }),
    ).toBe("allow");
    expect(
      toolPermissionDecision("safe_write", "write", {
        path: "report.docx",
        content: "delete is just a word in this document",
      }),
    ).toBe("allow");
    expect(
      toolPermissionDecision("safe_write", "Edit", {
        path: "report.md",
        new_string: "remove old text",
      }),
    ).toBe("allow");
    expect(
      toolPermissionDecision("safe_write", "Terminal", {
        command:
          'python -c "paragraph._element.getparent().remove(paragraph._element)"',
      }),
    ).toBe("allow");
    for (const input of [
      { command: 'Remove-Item -LiteralPath "report.docx"' },
      { command: "python -c \"import os; os.unlink('report.docx')\"" },
      { patch: "*** Delete File: report.md" },
      { changes: [{ path: "report.md", kind: "delete" }] },
    ]) {
      expect(isToolDeletion("tool", input)).toBe(true);
      expect(toolPermissionDecision("safe_write", "tool", input)).toBe(
        "confirm",
      );
      expect(toolPermissionDecision("full_access", "tool", input)).toBe(
        "allow",
      );
    }
    expect(toolPermissionDecision("analysis", "edit", { kind: "edit" })).toBe(
      "deny",
    );
  });

  it("binds approvals to a live capability and denies pending requests on disposal", async () => {
    let decide!: (allowed: boolean) => void;
    const authorize = vi.fn(
      async () =>
        new Promise<boolean>((resolve) => {
          decide = resolve;
        }),
    );
    const b = await bridge(authorize);
    expect((await ask(b, "delete", {}, "wrong-token")).status).toBe(403);
    expect(authorize).not.toHaveBeenCalled();
    const pending = ask(b, "delete", { path: "report.docx" });
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce());
    b.dispose();
    decide(true);
    // A disposed Run must never deliver a late positive approval.
    const response = await pending;
    expect(await response.json()).toEqual({ allowed: false });
  });

  // @lat: [[runtime-chat#Native CLI deletion approvals]]
  it.each([false, true])(
    "runs the Claude pre-tool hook with deletion approval %s",
    async (allowed) => {
      const b = await bridge(
        async (name, input) => !isToolDeletion(name, input) || allowed,
      );
      const dir = directory(),
        hook = join(dir, "hook.cjs");
      writeFileSync(
        hook,
        transpileModule(
          readFileSync(
            join(process.cwd(), "src/main/runtime-permission-hook.ts"),
            "utf8",
          ),
          { compilerOptions: { module: ModuleKind.CommonJS } },
        ).outputText,
      );
      const invoke = (command: string): Promise<Record<string, unknown>> =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const child = spawn(process.execPath, [hook], {
            env: { ...process.env, ...b.environment },
            stdio: ["pipe", "pipe", "pipe"],
          });
          let output = "";
          child.stdout.on("data", (chunk) => (output += chunk));
          child.on("error", reject);
          child.on("close", () => {
            try {
              resolve(JSON.parse(output));
            } catch (error) {
              reject(error);
            }
          });
          child.stdin.end(
            JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
          );
        });
      expect(await invoke("python create_docx.py")).toMatchObject({
        hookSpecificOutput: { permissionDecision: "allow" },
      });
      expect(await invoke("rm report.docx")).toMatchObject({
        hookSpecificOutput: { permissionDecision: allowed ? "allow" : "deny" },
      });
    },
  );

  it.each([false, true])(
    "executes Codex document tools with per-deletion decision %s",
    async (allowed) => {
      const dir = directory(),
        script = join(dir, "app-server.cjs"),
        file = join(dir, "report.docx");
      writeFileSync(
        script,
        `const fs=require('node:fs'),r=require('readline').createInterface({input:process.stdin});const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');let command=0;r.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')send({id:m.id,result:{}});else if(m.method==='thread/start'||m.method==='thread/resume')send({id:m.id,result:{thread:{id:'permission-thread'}}});else if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'turn-1'}}});command=900;send({id:command,method:'item/commandExecution/requestApproval',params:{threadId:'permission-thread',command:'python create_docx.py'}});}else if(m.id===900){if(m.result.decision==='accept')fs.writeFileSync(${JSON.stringify(file)},'document');command=901;send({id:command,method:'item/commandExecution/requestApproval',params:{threadId:'permission-thread',command:'rm report.docx'}});}else if(m.id===901){if(m.result.decision==='accept')fs.unlinkSync(${JSON.stringify(file)});send({method:'item/completed',params:{threadId:'permission-thread',item:{id:'answer',type:'agentMessage',text:'done'}}});send({method:'turn/completed',params:{threadId:'permission-thread',turn:{id:'turn-1',status:'completed'}}});}});`,
      );
      const authorize = vi.fn(
        async (name: string, input: Record<string, unknown>) =>
          !isToolDeletion(name, input) || allowed,
      );
      const b = await bridge(authorize);
      const started = await startCodexPermissionTurn({
        invocation: { command: process.execPath, prefix: [script] },
        cwd: dir,
        prompt: "Make report",
        imagePaths: [],
        inputArtifacts: [],
        environment: process.env,
        bridge: b,
        onOutput: () => undefined,
      });
      const result = await started.completion;
      expect(result.error).toBeUndefined();
      expect(result.sessionId).toBe("permission-thread");
      expect(existsSync(file)).toBe(!allowed);
      expect(authorize).toHaveBeenCalledTimes(2);
    },
  );
  it.each([false, true])(
    "runs the actual Pi automatic tool hook with deletion decision %s",
    async (allowed) => {
      const home = directory();
      vi.stubEnv("AGENTS_ONE_USER_DATA_DIR", home);
      const b = await bridge(
        async (name, input) => !isToolDeletion(name, input) || allowed,
      );
      vi.stubEnv(
        "AGENTS_ONE_PERMISSION_URL",
        b.environment.AGENTS_ONE_PERMISSION_URL,
      );
      vi.stubEnv(
        "AGENTS_ONE_PERMISSION_TOKEN",
        b.environment.AGENTS_ONE_PERMISSION_TOKEN,
      );
      try {
        const { piAutomaticPermissionExtension } =
          await import("../src/main/pi-runtime");
        const source = readFileSync(piAutomaticPermissionExtension(), "utf8");
        const extension = new Function(
          source.replace("export default function", "return function"),
        )();
        let handler!: (event: unknown) => Promise<unknown>;
        extension({
          on: (event: string, callback: typeof handler): void => {
            if (event === "tool_call") handler = callback;
          },
        });
        expect(
          await handler({
            toolName: "bash",
            input: { command: "python generate_report.py" },
          }),
        ).toBeUndefined();
        const deletion = await handler({
          toolName: "bash",
          input: { command: "rm report.docx" },
        });
        if (allowed) expect(deletion).toBeUndefined();
        else expect(deletion).toMatchObject({ block: true });
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});
