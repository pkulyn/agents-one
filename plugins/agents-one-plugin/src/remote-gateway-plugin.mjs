import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  EVENT_STREAM_PROTOCOL,
  EventJournal,
  eventStreamCapability,
} from "./event-stream.mjs";

export const AGENTS_ONE_PLUGIN_ID = "agents-one-plugin-sdk";
export const AGENTS_ONE_PLUGIN_VERSION = "0.1.1";

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function error(response, status, code, message) {
  json(response, status, {
    error: { code, message, retryable: status >= 500 },
    requestId: `req_${randomUUID()}`,
  });
}

async function readJson(request) {
  const parts = [];
  for await (const part of request) parts.push(part);
  const text = Buffer.concat(parts).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function bearer(request) {
  const value = request.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function validRunInput(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.input &&
    typeof value.input.text === "string",
  );
}

function runPayload(record) {
  return {
    id: record.id,
    status: record.status,
    conversationId: record.conversationId,
    ...(record.output ? { output: record.output } : {}),
    ...(record.error ? { error: { message: record.error } } : {}),
    ...(record.artifacts.length ? { artifacts: record.artifacts } : {}),
    ...(record.model ? { model: record.model } : {}),
    ...(record.usage ? { usage: record.usage } : {}),
    events: record.journal.snapshot(),
  };
}

function recordStatus(record, status) {
  if (!status || record.status === status) return;
  record.status = status;
  if (status === "succeeded" && !record.terminalEvent) {
    record.terminalEvent = true;
    record.journal.append({
      type: "run.completed",
      data: { summary: "远程任务已完成。" },
    });
  }
  if (
    ["failed", "cancelled", "timed_out"].includes(status) &&
    !record.terminalEvent
  ) {
    record.terminalEvent = true;
    record.journal.append({
      type: "run.failed",
      data: { summary: `远程任务结束：${status}。` },
    });
  }
}

function artifactBytes(input) {
  if (!input || typeof input !== "object") return Buffer.alloc(0);
  if (Buffer.isBuffer(input.bytes)) return input.bytes;
  if (input.bytes instanceof Uint8Array) return Buffer.from(input.bytes);
  if (typeof input.contentBase64 === "string") {
    return Buffer.from(input.contentBase64, "base64");
  }
  if (typeof input.content_base64 === "string") {
    return Buffer.from(input.content_base64, "base64");
  }
  return Buffer.alloc(0);
}

function upsertArtifact(record, artifact) {
  const index = record.artifacts.findIndex(
    (item) => item?.id && artifact?.id && item.id === artifact.id,
  );
  if (index >= 0)
    record.artifacts[index] = { ...record.artifacts[index], ...artifact };
  else record.artifacts.push(artifact);
}

/**
 * Hosts a vendor adapter behind Agents One Remote Gateway v1.
 * `adapter.startRun` must return quickly and continue work asynchronously.
 */
export function createRemoteGatewayPlugin({
  agent,
  token,
  adapter,
  limits = {},
}) {
  if (!agent?.id || !agent?.kind || !adapter?.startRun) {
    throw new Error("agent metadata and adapter.startRun are required.");
  }
  const runs = new Map();
  const authorize =
    typeof token === "function"
      ? token
      : (candidate) => Boolean(token) && candidate === token;
  const maxEvents = limits.maxEvents || 200;
  const maxArtifactBytes = limits.maxArtifactBytes || 10 * 1024 * 1024;
  const publishedArtifacts = new Map();
  const declaredCapabilities =
    adapter.capabilities && typeof adapter.capabilities === "object"
      ? adapter.capabilities
      : {};

  function artifactPublisher(record) {
    return async (input) => {
      if (!input || typeof input !== "object") {
        throw new Error("Artifact input is required.");
      }
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const mime = typeof input.mime === "string" ? input.mime.trim() : "";
      const bytes = artifactBytes(input);
      if (!name || !mime || !bytes.length) {
        throw new Error("Artifact name, mime and bytes are required.");
      }
      if (bytes.length > maxArtifactBytes) {
        throw new Error("Artifact exceeds the publish limit.");
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (
        typeof input.sha256 === "string" &&
        input.sha256.trim() &&
        input.sha256.trim().toLowerCase() !== sha256
      ) {
        throw new Error("Artifact SHA-256 does not match its bytes.");
      }
      const id =
        typeof input.id === "string" && input.id.trim()
          ? input.id.trim()
          : `artifact_${randomUUID()}`;
      const existing = publishedArtifacts.get(id);
      if (existing && existing.sha256 !== sha256) {
        throw new Error("Artifact id is already bound to different bytes.");
      }
      const artifact = {
        id,
        name,
        label: name,
        mime,
        size: bytes.length,
        sha256,
        ...(typeof input.expiresAt === "string" && input.expiresAt.trim()
          ? { expiresAt: input.expiresAt.trim() }
          : {}),
      };
      publishedArtifacts.set(id, { ...artifact, bytes });
      upsertArtifact(record, artifact);
      record.journal.append({
        id: `artifact:${id}`,
        type: "artifact.created",
        data: {
          artifact: {
            id,
            label: name,
            mime,
            size: bytes.length,
            sha256,
          },
        },
      });
      return artifact;
    };
  }

  async function refresh(record) {
    if (!adapter.getRun) return;
    const publishArtifact = artifactPublisher(record);
    const update = await adapter.getRun(record.vendorRunId, record, {
      publishArtifact,
    });
    if (!update || typeof update !== "object") return;
    recordStatus(record, update.status);
    if (update.output) record.output = update.output;
    if (update.error) record.error = String(update.error);
    if (Array.isArray(update.artifacts)) {
      for (const artifact of update.artifacts) upsertArtifact(record, artifact);
    }
    if (update.model) record.model = update.model;
    if (update.usage) record.usage = update.usage;
    for (const event of update.events || []) record.journal.append(event);
  }

  const server = createServer(async (request, response) => {
    try {
      if (!authorize(bearer(request)))
        return error(
          response,
          401,
          "unauthorized",
          "Gateway token is invalid.",
        );
      const url = new URL(request.url || "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/capabilities") {
        return json(response, 200, {
          protocolVersion: "1.0",
          plugin: {
            id: AGENTS_ONE_PLUGIN_ID,
            version: AGENTS_ONE_PLUGIN_VERSION,
            kind: "remote-gateway",
          },
          agent: {
            id: agent.id,
            kind: agent.kind,
            displayName: agent.displayName || agent.id,
          },
          capabilities: {
            ...declaredCapabilities,
            conversation: { stream: "sse", continuation: true },
            tasks: {
              start: true,
              get: true,
              cancel: Boolean(adapter.cancelRun),
            },
            artifacts: {
              ...(declaredCapabilities.artifacts &&
              typeof declaredCapabilities.artifacts === "object"
                ? declaredCapabilities.artifacts
                : {}),
              upload: Boolean(adapter.uploadArtifact),
              download: true,
            },
            eventStream: eventStreamCapability("poll"),
          },
          limits: {
            maxConcurrentRuns: 2,
            defaultTimeoutSeconds: 120,
            maxTimeoutSeconds: 600,
            ...limits,
          },
        });
      }
      if (request.method === "POST" && url.pathname === "/artifacts") {
        if (typeof adapter.uploadArtifact !== "function") {
          return error(
            response,
            409,
            "artifact_upload_unsupported",
            "Artifact upload is unsupported.",
          );
        }
        const input = await readJson(request);
        const contentBase64 =
          typeof input.contentBase64 === "string"
            ? input.contentBase64
            : typeof input.content_base64 === "string"
              ? input.content_base64
              : "";
        if (
          typeof input.name !== "string" ||
          !input.name.trim() ||
          typeof input.mime !== "string" ||
          !input.mime.trim() ||
          !contentBase64
        ) {
          return error(
            response,
            422,
            "invalid_artifact",
            "name, mime and contentBase64 are required.",
          );
        }
        const bytes = Buffer.from(contentBase64, "base64");
        if (!bytes.length || bytes.length > maxArtifactBytes) {
          return error(
            response,
            413,
            "artifact_too_large",
            "Artifact exceeds the upload limit.",
          );
        }
        const uploaded = await adapter.uploadArtifact(
          {
            name: input.name.trim(),
            mime: input.mime.trim(),
            size: bytes.length,
            sha256: typeof input.sha256 === "string" ? input.sha256 : undefined,
            contentBase64,
            bytes,
          },
          { request },
        );
        if (
          !uploaded ||
          typeof uploaded !== "object" ||
          typeof uploaded.id !== "string"
        ) {
          return error(
            response,
            502,
            "invalid_artifact_response",
            "The adapter did not return an artifact id.",
          );
        }
        return json(response, 201, uploaded);
      }
      const artifactMatch = url.pathname.match(/^\/artifacts\/([^/]+)$/);
      if (request.method === "GET" && artifactMatch) {
        const artifactId = decodeURIComponent(artifactMatch[1]);
        const local = publishedArtifacts.get(artifactId);
        const downloaded =
          local ||
          (typeof adapter.getArtifact === "function"
            ? await adapter.getArtifact(artifactId, { request })
            : undefined);
        if (!downloaded && typeof adapter.getArtifact !== "function") {
          return error(
            response,
            404,
            "artifact_not_found",
            "Artifact was not found.",
          );
        }
        if (
          !downloaded ||
          typeof downloaded !== "object" ||
          typeof downloaded.id !== "string"
        ) {
          return error(
            response,
            502,
            "invalid_artifact_response",
            "The adapter did not return a valid artifact.",
          );
        }
        const payload = { ...downloaded };
        if (Buffer.isBuffer(payload.bytes)) {
          payload.contentBase64 = payload.bytes.toString("base64");
          delete payload.bytes;
        }
        if (
          typeof payload.content_base64 === "string" &&
          typeof payload.contentBase64 !== "string"
        ) {
          payload.contentBase64 = payload.content_base64;
        }
        return json(response, 200, payload);
      }
      if (request.method === "POST" && url.pathname === "/runs") {
        const input = await readJson(request);
        if (!validRunInput(input))
          return error(response, 422, "invalid_run", "input.text is required.");
        const id = `run_${randomUUID()}`;
        const record = {
          id,
          status: "queued",
          conversationId:
            input.conversationId || `conversation_${randomUUID()}`,
          input,
          artifacts: [],
          journal: new EventJournal({ runId: id, maxEvents }),
          vendorRunId: undefined,
        };
        const emit = (event) => record.journal.append(event);
        emit({
          type: "run.started",
          data: { summary: "任务已派发到远程智能体。" },
        });
        runs.set(id, record);
        const runtimeId =
          typeof input.runtimeId === "string"
            ? input.runtimeId
            : typeof input.input?.runtimeId === "string"
              ? input.input.runtimeId
              : undefined;
        // Keep routing metadata explicit for adapters that do not inspect the
        // full request body. The top-level field remains backward compatible.
        const started = await adapter.startRun(input, {
          runId: id,
          emit,
          runtimeId,
          publishArtifact: artifactPublisher(record),
        });
        if (started?.vendorRunId) record.vendorRunId = started.vendorRunId;
        recordStatus(record, started?.status);
        return json(response, 202, runPayload(record));
      }
      const match = url.pathname.match(
        /^\/runs\/([^/]+)(?:\/(cancel|events))?$/,
      );
      if (!match)
        return error(response, 404, "not_found", "Resource not found.");
      const record = runs.get(decodeURIComponent(match[1]));
      if (!record)
        return error(response, 404, "run_not_found", "Run not found.");
      if (request.method === "POST" && match[2] === "cancel") {
        if (!adapter.cancelRun)
          return error(
            response,
            409,
            "cancel_unsupported",
            "Cancellation is unsupported.",
          );
        await adapter.cancelRun(record.vendorRunId, record);
        record.status = "cancelling";
        record.journal.append({
          type: "run.status",
          data: { summary: "正在取消远程任务。" },
        });
        return json(response, 202, runPayload(record));
      }
      await refresh(record);
      if (request.method === "GET" && match[2] === "events") {
        const after = Number(url.searchParams.get("afterSequence") || 0);
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        for (const event of record.journal.after(after)) {
          response.write(
            `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
        }
        response.end();
        return;
      }
      if (request.method === "GET")
        return json(response, 200, runPayload(record));
      return error(response, 405, "method_not_allowed", "Method not allowed.");
    } catch (cause) {
      return error(
        response,
        500,
        "gateway_error",
        "The adapter could not process this request.",
      );
    }
  });

  return {
    protocol: EVENT_STREAM_PROTOCOL,
    server,
    listen: (port, host = "127.0.0.1") =>
      new Promise((resolve) => server.listen(port, host, resolve)),
    close: () =>
      new Promise((resolve, reject) =>
        server.close((cause) => (cause ? reject(cause) : resolve())),
      ),
  };
}
