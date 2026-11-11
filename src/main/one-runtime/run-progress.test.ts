import { describe, expect, it } from "vitest";
import {
  oneSessionProgress,
  type OneSessionProgressCounters,
} from "./run-progress";

function counters(): OneSessionProgressCounters {
  return { compactions: 0, requestRetries: 0, summaryRetries: 0 };
}

describe("One Pi lifecycle progress", () => {
  it("counts model requests and exposes a bounded transient retry lifecycle", () => {
    const state = counters();
    const call = oneSessionProgress(
      { type: "one_model_call", count: 2, limit: 64 },
      state,
    );
    const retry = oneSessionProgress(
      {
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 2,
        delayMs: 1000,
        errorMessage: "503 temporarily unavailable",
      },
      state,
    );
    const recovered = oneSessionProgress(
      { type: "auto_retry_end", success: true, attempt: 2 },
      state,
    );

    expect(call).toBeUndefined();
    expect(retry).toMatchObject({ code: "one_request_retry_scheduled" });
    expect(retry?.summary).toContain("SDK 重试 1/2");
    expect(retry?.summary).toContain("503 temporarily unavailable");
    expect(recovered).toMatchObject({ code: "one_request_retry_recovered" });
    expect(recovered?.summary).toContain("累计 1 次请求重试");
    expect(state.requestRetries).toBe(1);
  });

  it("counts compactions, token estimates, overflow recovery, and failures distinctly", () => {
    const state = counters();
    const started = oneSessionProgress(
      { type: "compaction_start", reason: "overflow" },
      state,
    );
    const completed = oneSessionProgress(
      {
        type: "compaction_end",
        reason: "overflow",
        result: { tokensBefore: 80000, estimatedTokensAfter: 12000 },
        aborted: false,
        willRetry: true,
      },
      state,
    );
    const failed = oneSessionProgress(
      {
        type: "compaction_end",
        reason: "threshold",
        result: undefined,
        aborted: false,
        errorMessage: "summary provider unavailable",
      },
      state,
    );

    expect(started?.summary).toContain("第 1 次");
    expect(started?.summary).toContain("模型上下文超限");
    expect(completed?.summary).toContain("第 1 次");
    expect(completed?.summary).toContain("80000→12000");
    expect(completed?.summary).toContain("继续重试原任务");
    expect(failed).toMatchObject({ code: "one_compaction_failed" });
    expect(failed?.summary).toContain("summary provider unavailable");
    expect(state.compactions).toBe(1);
  });

  it("counts summary retries and rejects malformed or unrelated events", () => {
    const state = counters();
    const scheduled = oneSessionProgress(
      {
        type: "summarization_retry_scheduled",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 250,
        errorMessage: "temporary summary error",
      },
      state,
    );
    const started = oneSessionProgress(
      { type: "summarization_retry_attempt_start", source: "compaction" },
      state,
    );
    const finished = oneSessionProgress(
      { type: "summarization_retry_finished" },
      state,
    );

    expect(scheduled?.summary).toContain("第 1 次摘要重试");
    expect(scheduled?.summary).toContain("SDK 重试 1/3");
    expect(started?.code).toBe("one_summary_retry_started");
    expect(finished?.code).toBe("one_summary_retry_finished");
    expect(state.summaryRetries).toBe(1);
    expect(
      oneSessionProgress({ type: "auto_retry_start", delayMs: -1 }, state),
    ).toMatchObject({
      code: "one_request_retry_scheduled",
      summary: expect.stringContaining("稍后"),
    });
    expect(
      oneSessionProgress({ type: "other", attempt: 1 }, state),
    ).toBeUndefined();
    expect(oneSessionProgress(null, state)).toBeUndefined();
  });
});
