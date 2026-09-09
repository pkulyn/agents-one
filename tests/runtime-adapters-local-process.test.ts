import { describe, expect, it } from "vitest";
import {
  normalizeRuntimeEvent,
  parseRuntimeJsonLine,
} from "../src/main/runtime-adapters/event-normalizer";
import { startLocalProcess } from "../src/main/runtime-adapters/local-process";

describe("Runtime adapter local process", () => {
  it("normalizes common assistant, tool, and lifecycle events", () => {
    expect(
      normalizeRuntimeEvent({ type: "assistant.delta", text: "你好" }),
    ).toEqual(expect.objectContaining({ type: "message", summary: "你好" }));
    expect(
      normalizeRuntimeEvent({
        type: "tool.started",
        tool: { name: "workspace", callId: "call-1" },
      }),
    ).toEqual(
      expect.objectContaining({
        type: "tool_call",
        tool: expect.objectContaining({ name: "workspace", callId: "call-1" }),
      }),
    );
    expect(
      normalizeRuntimeEvent({
        type: "tool_call_update",
        data: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-acp-1",
          title: "read",
          kind: "read",
          status: "in_progress",
          rawInput: { filePath: "README.md", limit: 10 },
        },
      }),
    ).toEqual(
      expect.objectContaining({
        type: "tool_call",
        detail: '{"filePath":"README.md","limit":10}',
        tool: expect.objectContaining({
          name: "read",
          callId: "call-acp-1",
          inputSummary: '{"filePath":"README.md","limit":10}',
        }),
      }),
    );
    expect(
      normalizeRuntimeEvent({
        type: "tool_call_update",
        data: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-acp-1",
          title: "read",
          status: "completed",
          content: [{ type: "text", text: "1: hello" }],
        },
      }),
    ).toEqual(
      expect.objectContaining({
        type: "tool_result",
        detail: "1: hello",
        tool: expect.objectContaining({
          name: "read",
          callId: "call-acp-1",
          outputSummary: "1: hello",
        }),
      }),
    );
    expect(normalizeRuntimeEvent({ type: "run.completed" })).toEqual(
      expect.objectContaining({ type: "completed" }),
    );
    expect(
      normalizeRuntimeEvent({ type: "unknown", text: "token=secret-value" }),
    ).toEqual(expect.objectContaining({ summary: "token=[redacted]" }));
    expect(parseRuntimeJsonLine("not json")).toBeUndefined();
  });

  // @lat: [[adapter-registry#UI and CLI discovery]]
  it("runs a CLI with shell-free arguments, bounded diagnostics, and JSON lines", async () => {
    const lines: string[] = [];
    const child = startLocalProcess({
      command: process.execPath,
      args: [
        "-e",
        'console.log(JSON.stringify({type:"assistant.delta",text:"ok",usage:{inputTokens:12,apiKey:"secret-value"}})); console.error("token=secret-value");',
      ],
      maxDiagnostics: 4,
      onLine: (line) => lines.push(line.line),
    });
    const result = await child.completion;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"assistant.delta"');
    expect(result.stderr).toContain("token=[redacted]");
    expect(lines).toEqual(
      expect.arrayContaining([expect.stringContaining("assistant.delta")]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "stdout",
          json: expect.objectContaining({
            usage: { inputTokens: 12, apiKey: "[redacted]" },
          }),
        }),
      ]),
    );
  });
});
