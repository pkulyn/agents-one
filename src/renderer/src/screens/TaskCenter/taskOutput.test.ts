import { describe, expect, it } from "vitest";
import { summarizeTaskOutput } from "./taskOutput";

describe("summarizeTaskOutput", () => {
  it("surfaces the final Codex answer while retaining transport context", () => {
    const summary = summarizeTaskOutput(`Reading additional input from stdin...\n{"type":"item.completed","item":{"type":"error","message":"Falling back from WebSockets to HTTPS transport. request timed out"}}\n{"type":"item.completed","item":{"type":"agent_message","text":"Runtime test succeeded."}}\n{"type":"turn.completed","usage":{"input_tokens":120,"output_tokens":8}}`);

    expect(summary).toEqual({
      finalText: "Runtime test succeeded.",
      transportNote: "WebSocket unavailable; completed over HTTPS.",
      usage: "120 input / 8 output tokens",
      hasStructuredEvents: true,
    });
  });

  it("leaves normal plain-text runtime output alone", () => {
    expect(summarizeTaskOutput("plain output")).toEqual({
      hasStructuredEvents: false,
    });
  });

  it("surfaces a Claude Code stream-json result without its startup metadata", () => {
    const summary = summarizeTaskOutput('{"type":"assistant","message":{"content":[{"type":"text","text":"Claude is working."}]}}\n{"type":"result","result":"Claude task succeeded.","usage":{"input_tokens":20,"output_tokens":4}}');

    expect(summary).toEqual({
      finalText: "Claude task succeeded.",
      usage: "20 input / 4 output tokens",
      hasStructuredEvents: true,
    });
  });
});
