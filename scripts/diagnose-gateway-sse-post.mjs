import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

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
const requestedContract = (
  process.env.AGENTS_ONE_GATEWAY_CONTRACT || "auto"
).trim();
const hermesModel = (
  process.env.AGENTS_ONE_GATEWAY_MODEL || "hermes-agent"
).trim();

const CONTRACTS = new Set(["auto", "gateway-v1", "hermes-v1"]);

function safeEndpointFrom(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

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

function inferredContract() {
  if (requestedContract !== "auto") return requestedContract;
  const pathname = new URL(baseUrl).pathname.replace(/\/+$/, "");
  return /(?:^|\/)agents-one\/v1$/i.test(pathname) ? "gateway-v1" : "hermes-v1";
}

function runBody(contract, label, idempotencyKey) {
  if (contract === "hermes-v1") {
    return {
      model: hermesModel,
      input: `Reply with exactly ${label}`,
      session_id: `sse-post-diagnostic-${randomUUID()}`,
    };
  }
  return {
    runtimeId,
    mode: "conversation",
    idempotencyKey,
    input: {
      runtimeId,
      text: `Reply with exactly ${label}`,
    },
  };
}

function runIdFrom(text) {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed?.id === "string"
      ? parsed.id
      : typeof parsed?.run_id === "string"
        ? parsed.run_id
        : undefined;
  } catch {
    return undefined;
  }
}

async function createRun(label, close, contract) {
  const idempotencyKey = `sse-post-diagnostic-${randomUUID()}`;
  const evidence = await responseEvidence(
    await request("/runs", {
      method: "POST",
      close,
      body: runBody(contract, label, idempotencyKey),
    }),
  );
  const runId = runIdFrom(evidence.text);
  return { evidence, runId };
}

async function runSequence(label, close, contract) {
  const first = await createRun(`${label}-ONE`, close, contract);
  const output = {
    mode: label,
    contract,
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

  const second = await createRun(`${label}-TWO`, close, contract);
  output.secondPost = {
    ...second.evidence,
    text: undefined,
    hasRunId: Boolean(second.runId),
  };
  return output;
}

export async function runDiagnostic() {
  if (!baseUrl || !token || !runtimeId) {
    throw new Error(
      "Set AGENTS_ONE_GATEWAY_URL, AGENTS_ONE_GATEWAY_TOKEN, and AGENTS_ONE_GATEWAY_RUNTIME_ID before running this diagnostic.",
    );
  }
  if (!CONTRACTS.has(requestedContract)) {
    throw new Error(
      "AGENTS_ONE_GATEWAY_CONTRACT must be auto, gateway-v1, or hermes-v1.",
    );
  }
  const contract = inferredContract();
  return {
    endpoint: safeEndpointFrom(baseUrl),
    runtimeId,
    tokenConfigured: true,
    contract,
    testedAt: new Date().toISOString(),
    sequences: [
      await runSequence("default-connection", false, contract),
      await runSequence("connection-close", true, contract),
    ],
  };
}

const isMain =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try {
    console.log(JSON.stringify(await runDiagnostic(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
