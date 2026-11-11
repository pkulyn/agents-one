export interface OneSessionProgressCounters {
  compactions: number;
  requestRetries: number;
  summaryRetries: number;
}

export interface OneSessionProgress {
  code: string;
  summary: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function seconds(value: unknown): string {
  const milliseconds = count(value);
  return milliseconds === undefined
    ? "稍后"
    : `${Math.max(1, Math.ceil(milliseconds / 1000))} 秒后`;
}

function diagnostic(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function compactionReason(value: unknown): string {
  switch (value) {
    case "threshold":
      return "达到上下文阈值";
    case "overflow":
      return "模型上下文超限";
    case "manual":
      return "手动压缩";
    default:
      return "上下文压缩";
  }
}

/** Converts stable Pi 1.5.0 lifecycle events into concise Run timeline diagnostics. */
export function oneSessionProgress(
  event: unknown,
  counters: OneSessionProgressCounters,
): OneSessionProgress | undefined {
  if (!isRecord(event) || typeof event.type !== "string") return undefined;

  if (event.type === "compaction_start") {
    counters.compactions += 1;
    return {
      code: "one_compaction_started",
      summary: `One 正在进行第 ${counters.compactions} 次上下文压缩（${compactionReason(event.reason)}）。`,
    };
  }

  if (event.type === "compaction_end") {
    const result = isRecord(event.result) ? event.result : undefined;
    if (typeof event.errorMessage === "string" && event.errorMessage.trim()) {
      return {
        code: "one_compaction_failed",
        summary: `One 第 ${counters.compactions} 次上下文压缩失败：${diagnostic(event.errorMessage, "未知错误")}`,
      };
    }
    if (event.aborted === true) {
      return {
        code: "one_compaction_cancelled",
        summary: `One 第 ${counters.compactions} 次上下文压缩已取消。`,
      };
    }
    if (!result) {
      return {
        code: "one_compaction_failed",
        summary: `One 第 ${counters.compactions} 次上下文压缩未生成摘要。`,
      };
    }
    const tokensBefore = count(result.tokensBefore);
    const estimatedTokensAfter = count(result.estimatedTokensAfter);
    const usage =
      tokensBefore !== undefined && estimatedTokensAfter !== undefined
        ? `（估算 tokens：${tokensBefore}→${estimatedTokensAfter}）`
        : "";
    return {
      code: "one_compaction_completed",
      summary: `One 已完成第 ${counters.compactions} 次上下文压缩${usage}${event.willRetry === true ? "，将继续重试原任务" : ""}。`,
    };
  }

  if (event.type === "auto_retry_start") {
    counters.requestRetries += 1;
    const attempt = count(event.attempt);
    const maxAttempts = count(event.maxAttempts);
    const progress =
      attempt !== undefined && maxAttempts !== undefined
        ? `（SDK 重试 ${attempt}/${maxAttempts}）`
        : "";
    return {
      code: "one_request_retry_scheduled",
      summary: `One 模型请求暂时失败，${seconds(event.delayMs)}进行第 ${counters.requestRetries} 次重试${progress}：${diagnostic(event.errorMessage, "临时服务错误")}`,
    };
  }

  if (event.type === "auto_retry_end") {
    if (event.success === true) {
      return {
        code: "one_request_retry_recovered",
        summary: `One 已通过自动重试恢复（本次运行累计 ${counters.requestRetries} 次请求重试）。`,
      };
    }
    const attempts = count(event.attempt);
    return {
      code: "one_request_retry_exhausted",
      summary: `One 自动重试结束${attempts ? `（已尝试 ${attempts} 次）` : ""}：${diagnostic(event.finalError, "已达到重试上限")}`,
    };
  }

  if (event.type === "summarization_retry_scheduled") {
    counters.summaryRetries += 1;
    const attempt = count(event.attempt);
    const maxAttempts = count(event.maxAttempts);
    const progress =
      attempt !== undefined && maxAttempts !== undefined
        ? `（SDK 重试 ${attempt}/${maxAttempts}）`
        : "";
    return {
      code: "one_summary_retry_scheduled",
      summary: `One 上下文摘要请求暂时失败，${seconds(event.delayMs)}进行第 ${counters.summaryRetries} 次摘要重试${progress}：${diagnostic(event.errorMessage, "临时服务错误")}`,
    };
  }

  if (event.type === "summarization_retry_attempt_start") {
    return {
      code: "one_summary_retry_started",
      summary: `One 正在重试上下文摘要（本次运行累计 ${counters.summaryRetries} 次摘要重试）。`,
    };
  }

  if (event.type === "summarization_retry_finished") {
    return {
      code: "one_summary_retry_finished",
      summary: `One 上下文摘要重试流程已结束（本次运行累计 ${counters.summaryRetries} 次摘要重试）。`,
    };
  }

  return undefined;
}
