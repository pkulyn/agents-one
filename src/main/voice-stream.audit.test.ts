import { describe, expect, it } from "vitest";
import { normalizeStreamingCaptureAudit } from "./voice-stream";

describe("streaming voice capture audit", () => {
  it("keeps only finite non-negative renderer capture counters", () => {
    // @lat: [[voice-input#Transport and privacy boundary]]
    expect(
      normalizeStreamingCaptureAudit({
        capturedChunks: 24,
        capturedBytes: 196_608,
        sendFailures: 0,
      }),
    ).toEqual({
      capturedChunks: 24,
      capturedBytes: 196_608,
      sendFailures: 0,
    });
    expect(
      normalizeStreamingCaptureAudit({
        capturedChunks: -1,
        capturedBytes: Number.POSITIVE_INFINITY,
        sendFailures: "none",
      }),
    ).toEqual({ capturedChunks: 0, capturedBytes: 0, sendFailures: 0 });
  });

  it("does not create an audit record when the IPC payload is absent", () => {
    expect(normalizeStreamingCaptureAudit(undefined)).toBeNull();
  });
});
