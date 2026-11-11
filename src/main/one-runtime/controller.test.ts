import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startOneWorker } from "./controller";

// @lat: [[main-process#One session resume reconciliation#Waits for Main before dispatching a resumed prompt]]
it("waits for asynchronous Main reconciliation before acknowledging a resumed session", async () => {
  const root = mkdtempSync(join(tmpdir(), "one-ready-reconcile-"));
  let releaseReady!: () => void;
  let readyStarted!: () => void;
  let worker: ReturnType<typeof startOneWorker> | undefined;
  const readyGate = new Promise<void>((resolve) => {
    releaseReady = resolve;
  });
  const readyStartedPromise = new Promise<void>((resolve) => {
    readyStarted = resolve;
  });
  try {
    const workerPath = join(root, "fake-worker.cjs");
    writeFileSync(
      workerPath,
      [
        "const path=require('node:path');let sessionFile;",
        "process.on('message',message=>{",
        "if(message.type==='start'){sessionFile=path.join(message.options.stateDir,'sessions','resume.jsonl');process.send({type:'event',event:{type:'model-call-limit',maxOutputTokens:message.options.maxOutputTokens}});process.send({type:'ready',sessionId:'resume-session',sessionFile});}",
        "else if(message.type==='ready-ack'){process.send({type:'event',event:{type:'after-ready-ack'}});process.send({type:'complete',sessionId:'resume-session',output:'done',sessionFile});}",
        "else if(message.type==='cancel')process.send({type:'cancelled'});",
        "});",
        "process.on('disconnect',()=>process.exit(0));",
      ].join("\n"),
      "utf8",
    );
    const events: unknown[] = [];
    let readyArgs: [string, string | undefined] | undefined;
    worker = startOneWorker({
      workerPath,
      workspace: root,
      stateDir: root,
      baseUrl: "http://127.0.0.1:1/v1",
      modelId: "test-model",
      apiKey: "",
      maxOutputTokens: 16000,
      prompt: "continue",
      tools: [],
      executeTool: async () => "",
      onReady: async (sessionId, sessionFile) => {
        readyArgs = [sessionId, sessionFile];
        readyStarted();
        await readyGate;
      },
      onEvent: (event) => events.push(event),
    });

    await readyStartedPromise;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(events).not.toContainEqual({ type: "after-ready-ack" });

    releaseReady();
    await expect(worker.completion).resolves.toMatchObject({
      sessionId: "resume-session",
      output: "done",
    });
    expect(readyArgs).toEqual([
      "resume-session",
      join(root, "sessions", "resume.jsonl"),
    ]);
    expect(events).toContainEqual({
      type: "model-call-limit",
      maxOutputTokens: 16000,
    });
    expect(events).toContainEqual({ type: "after-ready-ack" });
  } finally {
    releaseReady();
    if (worker) {
      worker.cancel();
      await worker.completion.catch(() => undefined);
    }
    rmSync(root, { recursive: true, force: true });
  }
});

// @lat: [[main-process#One session resume reconciliation#Does not acknowledge a resumed prompt when Main rejects validation]]
it("does not acknowledge a resumed prompt when Main rejects session validation", async () => {
  const root = mkdtempSync(join(tmpdir(), "one-ready-reconcile-reject-"));
  let worker: ReturnType<typeof startOneWorker> | undefined;
  try {
    const workerPath = join(root, "fake-worker.cjs");
    writeFileSync(
      workerPath,
      [
        "process.on('message',message=>{",
        "if(message.type==='start')process.send({type:'ready',sessionId:'resume-session'});",
        "else if(message.type==='ready-ack'){process.send({type:'event',event:{type:'after-ready-ack'}});process.send({type:'complete',sessionId:'resume-session',output:'should not run'});}",
        "else if(message.type==='cancel')process.send({type:'cancelled'});",
        "});",
        "process.on('disconnect',()=>process.exit(0));",
      ].join("\n"),
      "utf8",
    );
    const events: unknown[] = [];
    worker = startOneWorker({
      workerPath,
      workspace: root,
      stateDir: root,
      baseUrl: "http://127.0.0.1:1/v1",
      modelId: "test-model",
      apiKey: "",
      prompt: "continue",
      tools: [],
      executeTool: async () => "",
      onReady: async () => {
        throw new Error("session validation failed");
      },
      onEvent: (event) => events.push(event),
    });

    await expect(worker.completion).rejects.toThrow(
      "Could not save the One session binding",
    );
    expect(events).not.toContainEqual({ type: "after-ready-ack" });
  } finally {
    worker?.cancel();
    if (worker) await worker.completion.catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
});
