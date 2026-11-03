import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, it, expect, vi } from "vitest";
import { createPiLiveInput } from "../src/main/pi-live-input";
function fixture(): {
  child: ChildProcess;
  frames: Array<Record<string, unknown>>;
  channel: ReturnType<typeof createPiLiveInput>;
} {
  const child = new EventEmitter() as ChildProcess;
  const frames: Array<Record<string, unknown>> = [];
  Object.assign(child, {
    stdin: {
      writable: true,
      write: vi.fn((line: string) => {
        frames.push(JSON.parse(line));
        return true;
      }),
    },
  });
  return { child, frames, channel: createPiLiveInput(child) };
}
describe("live Pi input acknowledgement", () => {
  it("keeps consecutive input requests independent and waits for the matching acknowledgement", async () => {
    const { channel, frames } = fixture();
    const first = channel.send("steer", "first");
    const second = channel.send("steer", "second");
    expect(frames.map((f) => f.message)).toEqual(["first", "second"]);
    let done = false;
    void first.then(() => {
      done = true;
    });
    channel.accept({ type: "response", id: frames[1].id, success: true });
    await second;
    expect(done).toBe(false);
    channel.accept({ type: "response", id: frames[0].id, success: true });
    await first;
    expect(done).toBe(true);
  });
  it("reports rejection without claiming delivery", async () => {
    const { channel, frames } = fixture();
    const input = channel.send("steer", "change direction");
    const check = expect(input).rejects.toThrow("rejected by runtime");
    channel.accept({
      type: "response",
      id: frames[0].id,
      success: false,
      error: "rejected by runtime",
    });
    await check;
  });
  it("rejects pending input when the process ends", async () => {
    const { channel, child } = fixture();
    const input = channel.send("steer", "change");
    const check = expect(input).rejects.toThrow(
      "closed before acknowledgement",
    );
    child.emit("close", 0);
    await check;
    await expect(channel.send("steer", "late")).rejects.toThrow("closed");
  });
});
