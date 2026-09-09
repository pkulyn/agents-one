import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const children: FakeChild[] = [];

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = {
    end: vi.fn(),
    write: vi.fn((line: string) => this.handleRequest(line)),
  };

  private respond(frame: unknown): void {
    queueMicrotask(() => this.stdout.emit("data", Buffer.from(`${JSON.stringify(frame)}\n`)));
  }

  private handleRequest(line: string): void {
    const request = JSON.parse(line) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
    };
    if (!request.id) return;
    if (request.method === "model/list") {
      this.respond({
        id: request.id,
        result: {
          models: [
            {
              id: "gpt-test",
              displayName: "GPT Test",
              supportedReasoningEfforts: ["low", "high"],
            },
          ],
        },
      });
      return;
    }
    this.respond({ id: request.id, result: {} });
    if (request.method === "thread/compact/start") {
      const threadId = request.params?.threadId;
      this.respond({
        method: "item/started",
        params: { threadId, item: { id: "cmp_1", type: "contextCompaction" } },
      });
      this.respond({
        method: "item/completed",
        params: { threadId, item: { id: "cmp_1", type: "contextCompaction" } },
      });
    }
  }
}

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const spawn = vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  return { ...actual, spawn, default: { ...actual, spawn } };
});

vi.mock("../src/main/codex-runtime", () => ({
  codexInvocation: () => ({ command: "codex", prefix: [] }),
}));

vi.mock("../src/main/process-control", () => ({
  terminateProcessTree: vi.fn().mockResolvedValue(undefined),
}));

import {
  compactCodexAppServerThread,
  listCodexAppServerModels,
} from "../src/main/codex-app-server";

describe("Codex App Server controls", () => {
  beforeEach(() => {
    children.length = 0;
  });

  it("reads the native model catalogue", async () => {
    await expect(listCodexAppServerModels({ executablePath: "codex" })).resolves.toEqual([
      {
        id: "gpt-test",
        displayName: "GPT Test",
        reasoningEfforts: ["low", "high"],
      },
    ]);
  });

  it("waits for the standard contextCompaction item lifecycle", async () => {
    const progress: string[] = [];
    await expect(
      compactCodexAppServerThread({ executablePath: "codex" }, "thr_123", (message) =>
        progress.push(message),
      ),
    ).resolves.toBeUndefined();

    const requests = children[0].stdin.write.mock.calls.map(([line]) =>
      JSON.parse(line as string),
    );
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "thread/resume", params: { threadId: "thr_123" } }),
        expect.objectContaining({
          method: "thread/compact/start",
          params: { threadId: "thr_123" },
        }),
      ]),
    );
    expect(progress).toEqual([
      "已请求 Codex 压缩当前会话上下文…",
      "Codex 正在压缩当前会话上下文…",
      "Codex 已完成上下文压缩，正在同步结果…",
    ]);
  });
});
