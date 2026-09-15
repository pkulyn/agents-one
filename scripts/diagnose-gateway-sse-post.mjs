import { randomUUID } from "node:crypto";

const baseUrl = (
  process.env.AGENTS_ONE_GATEWAY_URL ||
  process.env.HERMES_GATEWAY_ENDPOINT ||
  ""
).replace(/\/+$/, "");
const token = (
  process.env.AGENTS_ONE_GATEWAY_TOKEN ||
  process.env.HERMES_GATEWAY_TOKEN ||
  ""
).trim();
const runtimeId = (process.env.AGENTS_ONE_GATEWAY_RUNTIME_ID || "").trim();

if (!baseUrl || !token || !runtimeId) {
  console.error(
    "Set AGENTS_ONE_GATEWAY_URL, AGENTS_ONE_GATEWAY_TOKEN, and AGENTS_ONE_GATEWAY_RUNTIME_ID before running this diagnostic.",
  );
  process.exit(2);
}

const safeEndpoint = (() => {
  const value = new URL(baseUrl);
  return `${value.origin}${value.pathname}`;
})();

function selectedHeaders(response) {
  return Object.fromEntries(
    ["connection", "content-type", "server", "via", "x-request-id"]
      .map((name) => [name, response.headers.get(name)])
      .filter(([, value]) => value),
  );
}

async function responseEvidence(response) {
  const text = await response.text();
  let errorCode;
  try {
    const parsed = JSON.parse(text);
    errorCode = parsed?.error?.code;
  } catch {
    // Body shape is evidence only; never print provider/model output.
  }
  return {
    status: response.status,
    bodyBytes: Buffer.byteLength(text),
    ...(errorCode ? { errorCode } : {}),
    headers: selectedHeaders(response),
    text,
  };
}

async function request(path, { method = "GET", body, close = false } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: path.endsWith("/events")
        ? "text/event-stream"
        : "application/json",
      authorization: `Bearer ${token}`,
      ...(close ? { connection: "close" } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120_000),
  });
}

async function createRun(label, close) {
  const idempotencyKey = `sse-post-diagnostic-${randomUUID()}`;
  const evidence = await responseEvidence(
    await request("/runs", {
      method: "POST",
      close,
      body: {
        runtimeId,
        mode: "conversation",
        idempotencyKey,
        input: {
          runtimeId,
          text: `Reply with exactly ${label}`,
        },
      },
    }),
  );
  let runId;
  try {
    runId = JSON.parse(evidence.text)?.id;
  } catch {
    // The status and bounded metadata below are sufficient for a failure.
  }
  return { evidence, runId };
}

async function runSequence(label, close) {
  const first = await createRun(`${label}-ONE`, close);
  const output = {
    mode: label,
    firstPost: {
      ...first.evidence,
      text: undefined,
      hasRunId: Boolean(first.runId),
    },
  };
  if (!first.runId) return output;

  const events = await responseEvidence(
    await request(`/runs/${encodeURIComponent(first.runId)}/events`, { close }),
  );
  output.events = {
    ...events,
    text: undefined,
    hasSseFrames: /(?:^|\n)(?:id|event|data):/.test(events.text),
  };

  const second = await createRun(`${label}-TWO`, close);
  output.secondPost = {
    ...second.evidence,
    text: undefined,
    hasRunId: Boolean(second.runId),
  };
  return output;
}

console.log(
  JSON.stringify(
    {
      endpoint: safeEndpoint,
      runtimeId,
      tokenConfigured: true,
      testedAt: new Date().toISOString(),
      sequences: [
        await runSequence("default-connection", false),
        await runSequence("connection-close", true),
      ],
    },
    null,
    2,
  ),
);
