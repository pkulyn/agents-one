import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  EVENT_STREAM_PROTOCOL,
  EventJournal,
  eventStreamCapability,
} from "./event-stream.mjs";

export const AGENTS_ONE_PLUGIN_ID = "agents-one-plugin-sdk";
export const AGENTS_ONE_PLUGIN_VERSION = "0.1.5";

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

function eventCursor(request, url, journal) {
  const raw =
    request.headers["last-event-id"] ?? url.searchParams.get("afterSequence");
  if (typeof raw !== "string" || !raw.trim()) return 0;
  const numeric = Number(raw);
  if (Number.isSafeInteger(numeric) && numeric >= 0) return numeric;
  return (
    journal.snapshot().find((event) => event.id === raw.trim())?.sequence || 0
  );
}

export async function readJsonBody(request, maxBytes = 512 * 1024) {
  const parts = [];
  let size = 0;
  for await (const part of request) {
    const buffer = Buffer.isBuffer(part)
      ? part
      : part instanceof Uint8Array
        ? Buffer.from(part)
        : Buffer.from(String(part), "utf8");
    size += buffer.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    parts.push(buffer);
  }
  const text = Buffer.concat(parts).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function bearer(request) {
  const value = request.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function requestRuntimeId(request, url) {
  const header = request.headers["x-agents-one-runtime-id"];
  const value = Array.isArray(header) ? header[0] : header;
  const runtimeId =
    typeof value === "string" && value.trim()
      ? value.trim()
      : url.searchParams.get("runtimeId")?.trim();
  return runtimeId || undefined;
}

function validRunInput(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.input &&
    typeof value.input.text === "string",
  );
}

function requestIdempotencyKey(request, input) {
  const header = request.headers["idempotency-key"];
  const value =
    (Array.isArray(header) ? header[0] : header) || input?.idempotencyKey;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim();
  return normalized.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
    ? normalized
    : undefined;
}

function requestFingerprint(input) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        runtimeId: input?.runtimeId || input?.input?.runtimeId || null,
        mode: input?.mode || null,
        conversationId: input?.conversationId || null,
        text: input?.input?.text || "",
        model: input?.model || input?.input?.model || null,
      }),
    )
    .digest("hex");
}

function runPayload(record) {
  return {
    id: record.id,
    status: record.status,
    conversationId: record.conversationId,
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    ...(record.runtimeId ? { runtimeId: record.runtimeId } : {}),
    ...(record.output ? { output: record.output } : {}),
    ...(record.error ? { error: { message: record.error } } : {}),
    ...(record.artifacts.length ? { artifacts: record.artifacts } : {}),
    ...(record.model ? { model: record.model } : {}),
    ...(record.requestedModel ? { requestedModel: record.requestedModel } : {}),
    ...(record.model ? { actualModel: record.model } : {}),
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
  record.persist?.();
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
  runtimes = [],
  statePath,
}) {
  if (!agent?.id || !agent?.kind || !adapter?.startRun) {
    throw new Error("agent metadata and adapter.startRun are required.");
  }
  const runs = new Map();
  const idempotency = new Map();
  const authorize =
    typeof token === "function"
      ? token
      : (candidate) => Boolean(token) && candidate === token;
  const maxEvents = limits.maxEvents || 200;
  const maxArtifactBytes = limits.maxArtifactBytes || 10 * 1024 * 1024;
  const maxConcurrentRuns = Math.max(
    1,
    Math.min(Number(limits.maxConcurrentRuns) || 2, 100),
  );
  const publishedArtifacts = new Map();
  const artifactDirectory =
    typeof statePath === "string" && statePath.trim()
      ? `${statePath.trim()}.artifacts`
      : undefined;
  const declaredCapabilities =
    adapter.capabilities && typeof adapter.capabilities === "object"
      ? adapter.capabilities
      : {};
  const declaredEventStream =
    declaredCapabilities.eventStream &&
    typeof declaredCapabilities.eventStream === "object"
      ? declaredCapabilities.eventStream
      : {};

  function persistState() {
    if (typeof statePath !== "string" || !statePath.trim()) return;
    const state = {
      schemaVersion: 1,
      idempotency: [...idempotency.entries()],
      artifacts: [...publishedArtifacts.values()].map((artifact) => {
        const metadata = { ...artifact };
        delete metadata.bytes;
        delete metadata.bytesPath;
        return metadata;
      }),
      runs: [...runs.values()].map((record) => ({
        id: record.id,
        status: record.status,
        conversationId: record.conversationId,
        sessionId: record.sessionId,
        runtimeId: record.runtimeId,
        requestedModel: record.requestedModel,
        actualModel: record.model,
        usage: record.usage,
        output: record.output,
        error: record.error,
        artifacts: record.artifacts,
        vendorRunId: record.vendorRunId,
        terminalEvent: record.terminalEvent,
        reconciliationRequired: record.reconciliationRequired,
        events: record.journal.snapshot(),
      })),
    };
    const target = statePath.trim();
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporary, target);
    if (process.platform !== "win32") chmodSync(target, 0o600);
  }

  function restoreState() {
    if (typeof statePath !== "string" || !statePath.trim()) return;
    const target = statePath.trim();
    if (!existsSync(target)) return;
    try {
      const state = JSON.parse(readFileSync(target, "utf8"));
      if (!state || state.schemaVersion !== 1)
        throw new Error("unsupported state");
      for (const item of Array.isArray(state.idempotency)
        ? state.idempotency
        : []) {
        if (Array.isArray(item) && typeof item[0] === "string")
          idempotency.set(item[0], item[1]);
      }
      for (const item of Array.isArray(state.artifacts)
        ? state.artifacts
        : []) {
        if (!item || typeof item.id !== "string") continue;
        publishedArtifacts.set(item.id, {
          ...item,
          ...(artifactDirectory ? { bytesPath: artifactPath(item.id) } : {}),
        });
      }
      for (const item of Array.isArray(state.runs) ? state.runs : []) {
        if (!item || typeof item.id !== "string") continue;
        const journal = new EventJournal({ runId: item.id, maxEvents });
        for (const event of Array.isArray(item.events) ? item.events : [])
          journal.append(event);
        const active = ["queued", "running", "cancelling"].includes(
          item.status,
        );
        const record = {
          id: item.id,
          status: active ? "running" : item.status,
          conversationId: item.conversationId,
          sessionId: item.sessionId,
          runtimeId: item.runtimeId,
          requestedModel: item.requestedModel,
          model: item.actualModel,
          usage: item.usage,
          output: item.output,
          error: item.error,
          artifacts: Array.isArray(item.artifacts) ? item.artifacts : [],
          vendorRunId: item.vendorRunId,
          terminalEvent: item.terminalEvent,
          reconciliationRequired: active,
          journal,
        };
        runs.set(record.id, record);
      }
    } catch {
      // Do not overwrite a corrupt state file; the operator can repair it.
    }
  }

  restoreState();

  function artifactPath(id) {
    if (!artifactDirectory) return undefined;
    const key = createHash("sha256").update(id).digest("hex");
    return join(artifactDirectory, `${key}.bin`);
  }

  function persistArtifactBytes(id, bytes) {
    const target = artifactPath(id);
    if (!target) return undefined;
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(temporary, bytes, { mode: 0o600 });
    renameSync(temporary, target);
    if (process.platform !== "win32") chmodSync(target, 0o600);
    return target;
  }

  function localArtifactBytes(artifact) {
    if (Buffer.isBuffer(artifact?.bytes)) return artifact.bytes;
    if (typeof artifact?.bytesPath !== "string") return undefined;
    try {
      return readFileSync(artifact.bytesPath);
    } catch {
      return undefined;
    }
  }

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
      const bytesPath = persistArtifactBytes(id, bytes);
      publishedArtifacts.set(id, {
        ...artifact,
        bytes,
        ...(bytesPath ? { bytesPath } : {}),
      });
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
      persistState();
      return artifact;
    };
  }

  async function refresh(record) {
    if (
      ["succeeded", "failed", "cancelled", "timed_out"].includes(record.status)
    )
      return;
    const publishArtifact = artifactPublisher(record);
    const applyUpdate = (update) => {
      if (!update || typeof update !== "object") return false;
      if (update.output) record.output = update.output;
      if (update.sessionId) record.sessionId = String(update.sessionId);
      if (update.error) record.error = String(update.error);
      if (Array.isArray(update.artifacts)) {
        for (const artifact of update.artifacts)
          upsertArtifact(record, artifact);
      }
      if (update.model) record.model = update.model;
      if (update.requestedModel) record.requestedModel = update.requestedModel;
      if (update.actualModel) record.model = update.actualModel;
      if (update.usage) record.usage = update.usage;
      for (const event of update.events || []) record.journal.append(event);
      // Provider evidence must be durable before the SDK synthesizes the
      // terminal run event. Otherwise a successful refresh can persist
      // run.completed ahead of assistant.completed/tool/workspace evidence.
      recordStatus(record, update.status);
      return true;
    };

    if (record.reconciliationRequired) {
      record.reconciliationRequired = false;
      if (typeof adapter.reconcileRun === "function") {
        try {
          const reconciled = await adapter.reconcileRun(
            record.vendorRunId,
            record,
            { publishArtifact },
          );
          if (applyUpdate(reconciled)) {
            persistState();
            return;
          }
        } catch (cause) {
          record.error = `host_restart_reconciliation_required: ${
            cause instanceof Error ? cause.message : String(cause)
          }`.slice(0, 2_000);
        }
      }
      if (!record.error) {
        record.error =
          "host_restart_reconciliation_required: Host 重启后未能恢复该 Provider 进程。";
      }
      record.terminalEvent = true;
      record.status = "failed";
      record.journal.append({
        id: `${record.id}:host-restart`,
        type: "run.failed",
        data: {
          summary: "Remote CLI Host 重启，运行未能恢复，已完成终态对账。",
          code: "host_restart_reconciliation_required",
          detail: record.error,
        },
      });
      persistState();
      return;
    }

    if (!adapter.getRun) return;
    const update = await adapter.getRun(record.vendorRunId, record, {
      publishArtifact,
    });
    applyUpdate(update);
    persistState();
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
            ...(typeof agent.version === "string" && agent.version.trim()
              ? { version: agent.version.trim().slice(0, 64) }
              : {}),
          },
          ...(Array.isArray(runtimes) && runtimes.length
            ? {
                runtimes: runtimes.map((runtime) => ({
                  runtimeId: runtime.runtimeId,
                  displayName: runtime.displayName || runtime.runtimeId,
                  ...(runtime.kind ? { kind: runtime.kind } : {}),
                  ...(runtime.adapterId
                    ? { adapterId: runtime.adapterId }
                    : {}),
                  ...(runtime.adapterVersion
                    ? { adapterVersion: runtime.adapterVersion }
                    : {}),
                  ...(runtime.enabled === false ? { enabled: false } : {}),
                })),
              }
            : {}),
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
            eventStream: eventStreamCapability("poll", declaredEventStream),
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
        const input = await readJsonBody(request);
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
          {
            request,
            runtimeId: requestRuntimeId(request, url),
            record: requestRuntimeId(request, url)
              ? { runtimeId: requestRuntimeId(request, url) }
              : undefined,
          },
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
        const runtimeId = requestRuntimeId(request, url);
        const local = publishedArtifacts.get(artifactId);
        const localBytes = localArtifactBytes(local);
        const localDownload =
          local && localBytes ? { ...local, bytes: localBytes } : undefined;
        const downloaded =
          localDownload ||
          (typeof adapter.getArtifact === "function"
            ? await adapter.getArtifact(artifactId, {
                request,
                runtimeId,
                record: runtimeId ? { runtimeId } : undefined,
              })
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
        const input = await readJsonBody(request);
        if (!validRunInput(input))
          return error(response, 422, "invalid_run", "input.text is required.");
        const idempotencyKey = requestIdempotencyKey(request, input);
        if (idempotencyKey) {
          const fingerprint = requestFingerprint(input);
          const previous = idempotency.get(idempotencyKey);
          if (previous) {
            if (previous.fingerprint !== fingerprint) {
              return error(
                response,
                409,
                "idempotency_conflict",
                "Idempotency-Key 已绑定到不同的运行请求。",
              );
            }
            const existing = runs.get(previous.runId);
            if (existing) return json(response, 202, runPayload(existing));
          }
        }
        const activeRuns = [...runs.values()].filter((candidate) =>
          ["queued", "running", "cancelling"].includes(candidate.status),
        ).length;
        const requestedRuntimeId =
          typeof input.runtimeId === "string"
            ? input.runtimeId
            : typeof input.input?.runtimeId === "string"
              ? input.input.runtimeId
              : undefined;
        const activeRuntimeRuns = [...runs.values()].filter(
          (candidate) =>
            candidate.runtimeId === requestedRuntimeId &&
            ["queued", "running", "cancelling"].includes(candidate.status),
        ).length;
        const maxRuntimeConcurrentRuns = Math.max(
          1,
          Math.min(
            Number(
              limits.runtimeLimits?.[requestedRuntimeId]?.maxConcurrentRuns,
            ) ||
              Number(limits.maxConcurrentRunsPerRuntime) ||
              maxConcurrentRuns,
            100,
          ),
        );
        if (
          activeRuns >= maxConcurrentRuns ||
          (requestedRuntimeId && activeRuntimeRuns >= maxRuntimeConcurrentRuns)
        ) {
          return error(
            response,
            429,
            "run_limit_reached",
            "远程智能体当前运行数已达到上限，请稍后重试。",
          );
        }
        const id = `run_${randomUUID()}`;
        // Older desktop clients used a provider session ID as conversationId.
        // Resolve that alias only within the same Runtime, without rewriting
        // historical records or changing the incoming idempotency fingerprint.
        const legacyConversation =
          input.conversationId &&
          [...runs.values()]
            .reverse()
            .find(
              (candidate) =>
                candidate.runtimeId === requestedRuntimeId &&
                candidate.sessionId === input.conversationId,
            );
        const record = {
          id,
          status: "queued",
          conversationId:
            legacyConversation?.conversationId ||
            input.conversationId ||
            `conversation_${randomUUID()}`,
          runtimeId:
            typeof input.runtimeId === "string"
              ? input.runtimeId
              : typeof input.input?.runtimeId === "string"
                ? input.input.runtimeId
                : undefined,
          input,
          requestedModel:
            typeof input.model === "string"
              ? input.model.trim()
              : typeof input.input?.model === "string"
                ? input.input.model.trim()
                : undefined,
          artifacts: [],
          journal: new EventJournal({ runId: id, maxEvents }),
          vendorRunId: undefined,
        };
        record.persist = persistState;
        const emit = (event) => {
          const appended = record.journal.append(event);
          persistState();
          return appended;
        };
        emit({
          type: "run.started",
          data: { summary: "任务已派发到远程智能体。" },
        });
        runs.set(id, record);
        if (idempotencyKey) {
          idempotency.set(idempotencyKey, {
            runId: id,
            fingerprint: requestFingerprint(input),
          });
        }
        persistState();
        const runtimeId = record.runtimeId;
        // Keep routing metadata explicit for adapters that do not inspect the
        // full request body. The top-level field remains backward compatible.
        let started;
        try {
          // Bind the adapter's first turn to the exact identity returned by
          // the Gateway. Keep provider session IDs separate from this ID,
          // including after the durable Gateway journal is reopened.
          const previous = [...runs.values()]
            .reverse()
            .find(
              (candidate) =>
                candidate !== record &&
                candidate.runtimeId === runtimeId &&
                candidate.conversationId === record.conversationId &&
                typeof candidate.sessionId === "string" &&
                candidate.sessionId,
            );
          const adapterInput = {
            ...input,
            conversationId: record.conversationId,
            ...(previous?.sessionId &&
            !input.sessionId &&
            !input.input?.sessionId
              ? { sessionId: previous.sessionId }
              : {}),
          };
          started = await adapter.startRun(adapterInput, {
            runId: id,
            emit,
            runtimeId,
            publishArtifact: artifactPublisher(record),
          });
        } catch (cause) {
          runs.delete(id);
          if (idempotencyKey) idempotency.delete(idempotencyKey);
          throw cause;
        }
        if (started?.vendorRunId) record.vendorRunId = started.vendorRunId;
        if (started?.sessionId) record.sessionId = String(started.sessionId);
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
        if (
          ["succeeded", "failed", "cancelled", "timed_out"].includes(
            record.status,
          )
        ) {
          return error(
            response,
            409,
            "run_state_conflict",
            "运行已经进入终态，无法取消；请查询原 Run。",
          );
        }
        if (record.status === "cancelling")
          return json(response, 202, runPayload(record));
        const accepted = await adapter.cancelRun(record.vendorRunId, record);
        if (accepted === false) {
          await refresh(record);
          if (
            ["succeeded", "failed", "cancelled", "timed_out"].includes(
              record.status,
            )
          ) {
            return error(
              response,
              409,
              "run_state_conflict",
              "运行已完成，无法取消；请查询原 Run。",
            );
          }
        }
        record.status = "cancelling";
        record.journal.append({
          type: "run.status",
          data: { summary: "正在取消远程任务。" },
        });
        persistState();
        return json(response, 202, runPayload(record));
      }
      await refresh(record);
      if (request.method === "GET" && match[2] === "events") {
        const after = eventCursor(request, url, record.journal);
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
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
      const status =
        Number.isInteger(cause?.status) && cause.status >= 400
          ? cause.status
          : 500;
      const code =
        typeof cause?.code === "string" ? cause.code : "gateway_error";
      const message =
        typeof cause?.message === "string"
          ? cause.message
          : "The adapter could not process this request.";
      return error(response, status, code, message);
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
