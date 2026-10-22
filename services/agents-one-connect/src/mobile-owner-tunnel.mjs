import {
  createPrivateKey,
  createPublicKey,
  createHash,
  sign,
  randomUUID,
} from "node:crypto";
import { WebSocketServer } from "ws";
import {
  OWNER_TUNNEL_PATH,
  OWNER_TUNNEL_PROTOCOL,
  canonical,
  bodyHash,
  resolveBusinessRoute,
  validate,
  validateRequest,
  tunnelError,
} from "../../../contracts/mobile-control/v1/owner-tunnel.mjs";

const AUTHORIZATION_ACK_MS = 10_000;
const MAX_BUFFER = 2 * 1024 * 1024;
const failure = (code, requestId = randomUUID()) => ({
  error: { code, message: code, retryable: false, requestId },
});

/** Independent outbound Owner plane; never shares Gateway credentials or routes. */
export function createMobileOwnerTunnel({
  stateKey,
  authenticate,
  authorization,
  authorizeDevice,
  now = Date.now,
  diagnostic = (value) => {
    if (process.env.AO_CONNECT_LOG === "1")
      console.log(
        JSON.stringify({
          tag: "ao-lease",
          ts: new Date().toISOString(),
          ...value,
        }),
      );
  },
}) {
  const seed = createHash("sha256")
    .update("agents-one/mobile-owner/ed25519/v1\0")
    .update(Buffer.from(stateKey, "hex"))
    .digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed,
    ]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey)
    .export({ type: "spki", format: "der" })
    .toString("base64");
  // Read pages can contain many long messages; request/event bounds remain smaller.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024 * 1024,
  });
  const peers = new Map();
  const rates = new Map();
  const signed = (payload) => ({
    payload,
    signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString(
      "base64",
    ),
  });
  function send(peer, frame, written) {
    if (
      peer.socket.readyState !== 1 ||
      peer.socket.bufferedAmount > MAX_BUFFER
    ) {
      peer.socket.terminate();
      return false;
    }
    peer.socket.send(JSON.stringify(frame), written);
    return true;
  }
  function finish(peer, requestId, status, body) {
    const pending = peer.pending.get(requestId);
    if (!pending) return;
    peer.pending.delete(requestId);
    clearTimeout(pending.timer);
    clearInterval(pending.guard);
    if (pending.res.destroyed || pending.res.writableEnded) return;
    if (pending.download && status >= 400) {
      pending.res.destroy();
      return;
    }
    if (pending.res.headersSent) pending.res.end();
    else {
      pending.res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      pending.res.end(JSON.stringify(body));
    }
  }
  function disconnect(peer) {
    for (const settle of peer.authorizationWaiters || []) settle(false);
    if (peers.get(peer.ownerId) === peer) peers.delete(peer.ownerId);
    for (const [requestId, pending] of peer.pending)
      finish(
        peer,
        requestId,
        pending.route.mutation ? 409 : 503,
        failure(
          pending.route.mutation ? "reconciliation_required" : "owner_offline",
          requestId,
        ),
      );
  }
  function sync(peer) {
    peer.acknowledged = false;
    peer.updateId = randomUUID();
    peer.grants = authorization(peer.ownerId);
    clearTimeout(peer.ackTimer);
    const updateId = peer.updateId;
    peer.authorizationStartedAt = performance.now();
    peer.authorizationExpiresAt = now() + 30_000;
    peer.authorizationDeadline = performance.now() + AUTHORIZATION_ACK_MS;
    peer.ackTimer = setTimeout(() => {
      // Let already-readable ACK frames reach the poll phase after a busy loop.
      setImmediate(() => {
        if (
          peer.updateId !== updateId ||
          peer.acknowledged ||
          peer.socket.readyState !== 1
        )
          return;
        diagnostic({
          event: "authorization_timeout",
          ownerId: peer.ownerId,
          updateId,
          elapsedMs: performance.now() - peer.authorizationStartedAt,
          timerLagMs: Math.max(
            0,
            performance.now() - peer.authorizationDeadline,
          ),
          bufferedBytes: peer.socket.bufferedAmount,
        });
        peer.socket.terminate();
      });
    }, AUTHORIZATION_ACK_MS);
    peer.ackTimer.unref();
    send(
      peer,
      {
        type: "authorization",
        ...signed({
          protocolVersion: OWNER_TUNNEL_PROTOCOL,
          ownerId: peer.ownerId,
          spaceId: peer.spaceId,
          updateId: peer.updateId,
          grants: peer.grants,
          expiresAt: peer.authorizationExpiresAt,
        }),
      },
      (error) =>
        diagnostic({
          event: error ? "authorization_write_failed" : "authorization_written",
          ownerId: peer.ownerId,
          updateId,
          elapsedMs: performance.now() - peer.authorizationStartedAt,
          bufferedBytes: peer.socket.bufferedAmount,
        }),
    );
    diagnostic({
      event: "authorization_queued",
      ownerId: peer.ownerId,
      updateId,
      bufferedBytes: peer.socket.bufferedAmount,
      ackBudgetMs: AUTHORIZATION_ACK_MS,
    });
    // Revocation closes existing streams immediately, without waiting for an ACK.
    for (const [requestId, pending] of peer.pending) {
      try {
        authorizeDevice(pending.deviceId, pending.grantRevision);
      } catch (error) {
        send(peer, { type: "cancel_request", requestId });
        finish(
          peer,
          requestId,
          error.status || 401,
          failure(error.code || "revoked", requestId),
        );
      }
    }
  }
  wss.on("connection", (socket) => {
    let peer;
    let alive = true;
    const helloTimer = setTimeout(() => socket.terminate(), 5000);
    helloTimer.unref();
    socket.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
      if (peer) sync(peer); // Short-lived authorization lease; disconnect fails closed.
    }, 20_000);
    heartbeat.unref();
    socket.on("message", (raw) => {
      try {
        const frame = JSON.parse(raw.toString("utf8"));
        if (!peer) {
          if (
            frame.type !== "hello" ||
            frame.protocolVersion !== OWNER_TUNNEL_PROTOCOL ||
            frame.role !== "owner"
          )
            throw tunnelError("protocol_incompatible");
          const owner = authenticate(frame.hostCredential);
          if (
            !owner ||
            frame.ownerId !== owner.ownerId ||
            frame.spaceId !== owner.spaceId
          )
            throw tunnelError("scope_denied");
          clearTimeout(helloTimer);
          const previous = peers.get(owner.ownerId);
          if (previous) {
            disconnect(previous);
            previous.socket.close(4002, "owner connection replaced");
          }
          peer = {
            socket,
            ownerId: owner.ownerId,
            spaceId: owner.spaceId,
            pending: new Map(),
            authorizationWaiters: new Set(),
            acknowledged: false,
            ownerView: null,
          };
          peers.set(owner.ownerId, peer);
          send(peer, {
            type: "hello_ack",
            protocolVersion: OWNER_TUNNEL_PROTOCOL,
          });
          sync(peer);
          return;
        }
        if (frame.type === "authorization_ack") {
          if (frame.updateId !== peer.updateId) {
            diagnostic({
              event: "authorization_ack_stale",
              ownerId: peer.ownerId,
              updateId:
                typeof frame.updateId === "string"
                  ? frame.updateId.slice(0, 80)
                  : "invalid",
            });
            return; // An older update can race a newer one.
          }
          if (peer.acknowledged) return;
          if (
            performance.now() >= peer.authorizationDeadline ||
            now() >= peer.authorizationExpiresAt
          ) {
            diagnostic({
              event: "authorization_ack_late",
              ownerId: peer.ownerId,
              updateId: peer.updateId,
            });
            peer.socket.terminate();
            return;
          }
          diagnostic({
            event: "authorization_ack_received",
            ownerId: peer.ownerId,
            updateId: peer.updateId,
            roundTripMs: performance.now() - peer.authorizationStartedAt,
          });
          peer.acknowledged = true;
          peer.leaseExpiresAt = peer.authorizationExpiresAt;
          clearTimeout(peer.ackTimer);
          for (const settle of peer.authorizationWaiters) settle(true);
          return;
        }
        if (frame.type === "owner_status") {
          validate("OwnerSpace", frame.owner);
          if (
            frame.owner.ownerId !== peer.ownerId ||
            frame.owner.spaceId !== peer.spaceId
          )
            throw tunnelError("scope_denied");
          peer.ownerView = frame.owner;
          return;
        }
        if (!["response", "event", "chunk", "end"].includes(frame.type))
          throw tunnelError("protocol_incompatible");
        const pending = peer.pending.get(frame.requestId);
        if (!pending) return;
        authorizeDevice(pending.deviceId, pending.grantRevision);
        if (frame.type === "end") {
          if (pending.download) {
            if (
              pending.bytes !== pending.download.sizeBytes ||
              pending.hash.digest("hex") !== pending.download.sha256
            ) {
              pending.res.destroy();
              finish(peer, frame.requestId, 503, {});
              return;
            }
          } else if (!pending.stream)
            throw tunnelError("protocol_incompatible");
          finish(peer, frame.requestId, 200, {});
          return;
        }
        if (frame.type === "chunk") {
          if (
            !pending.download ||
            typeof frame.data !== "string" ||
            frame.data.length > 90000 ||
            frame.offset !== pending.bytes
          )
            throw tunnelError("protocol_incompatible");
          const bytes = Buffer.from(frame.data, "base64");
          if (
            bytes.length > 65536 ||
            bytes.toString("base64") !== frame.data ||
            pending.bytes + bytes.length > pending.download.sizeBytes ||
            pending.res.writableLength > MAX_BUFFER
          )
            throw tunnelError("protocol_incompatible");
          pending.bytes += bytes.length;
          pending.hash.update(bytes);
          pending.res.write(bytes);
          return;
        }
        if (frame.type === "event") {
          if (
            !pending.stream ||
            !pending.res.headersSent ||
            Buffer.byteLength(JSON.stringify(frame.event)) > 1024 * 1024
          )
            throw tunnelError("protocol_incompatible");
          validate("Event", frame.event);
          if (
            frame.event.eventId.includes("\n") ||
            frame.event.eventId.includes("\r")
          )
            throw tunnelError("protocol_incompatible");
          if (pending.res.writableLength > MAX_BUFFER) {
            send(peer, { type: "cancel_request", requestId: frame.requestId });
            finish(peer, frame.requestId, 503, failure("owner_offline"));
            return;
          }
          pending.res.write(
            `id: ${frame.event.eventId}\nevent: ${frame.event.type}\ndata: ${JSON.stringify(frame.event)}\n\n`,
          );
          return;
        }
        if (
          !Number.isInteger(frame.status) ||
          frame.status < 200 ||
          frame.status > 599
        )
          throw tunnelError("protocol_incompatible");
        if (frame.status >= 400) validate("ErrorEnvelope", frame.body);
        else if (pending.stream) {
          if (frame.status !== 200 || pending.res.headersSent)
            throw tunnelError("protocol_incompatible");
          clearTimeout(pending.timer);
          pending.res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
          });
          pending.res.flushHeaders();
          pending.timer = setInterval(
            () => pending.res.write(": heartbeat\n\n"),
            20_000,
          );
          pending.timer.unref();
          return;
        } else if (pending.route.operationId === "downloadArtifact") {
          if (frame.status !== 200 || pending.res.headersSent)
            throw tunnelError("protocol_incompatible");
          validate("Artifact", frame.download);
          if (
            frame.download.id !== pending.route.params.id ||
            !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(
              frame.download.mime,
            )
          )
            throw tunnelError("protocol_incompatible");
          pending.download = frame.download;
          pending.bytes = 0;
          pending.hash = createHash("sha256");
          pending.res.writeHead(200, {
            "Content-Type": frame.download.mime,
            "Content-Length": frame.download.sizeBytes,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(frame.download.name.replace(/[\\/\r\n]/g, "_"))}`,
          });
          pending.res.flushHeaders();
          return;
        } else if (pending.route.responseSchema)
          validate(pending.route.responseSchema, frame.body);
        finish(peer, frame.requestId, frame.status, frame.body);
      } catch {
        socket.close(4000, "invalid owner frame");
        if (peer)
          for (const pending of peer.pending.values())
            if (pending.download) pending.res.destroy();
        disconnect(peer || { pending: new Map() });
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(helloTimer);
      clearInterval(heartbeat);
      if (peer) {
        clearTimeout(peer.ackTimer);
        disconnect(peer);
      }
    });
  });
  return {
    publicKey,
    upgrade(req, socket, head) {
      if (
        new URL(req.url || "/", "http://local").pathname !== OWNER_TUNNEL_PATH
      )
        return false;
      if (req.url !== OWNER_TUNNEL_PATH) {
        socket.destroy();
        return true;
      }
      wss.handleUpgrade(req, socket, head, (client) =>
        wss.emit("connection", client, req),
      );
      return true;
    },
    changed(ownerId) {
      const peer = peers.get(ownerId);
      if (peer) sync(peer);
    },
    revokeHost(ownerId) {
      const peer = peers.get(ownerId);
      if (peer) {
        disconnect(peer);
        peer.socket.close(4001, "host credential changed");
      }
    },
    ownerView(ownerId) {
      const peer = peers.get(ownerId);
      return peer?.ownerView &&
        peer.leaseExpiresAt > now() &&
        peer.socket.readyState === 1
        ? peer.ownerView
        : null;
    },
    async forward(req, res, url, device) {
      const route = resolveBusinessRoute(req.method, url.pathname);
      if (
        !route ||
        route.params.ownerId !== device.ownerId ||
        route.params.spaceId !== device.spaceId
      )
        throw tunnelError("resource_not_found", 404);
      if (route.scope && !device.scopes.includes(route.scope))
        throw tunnelError("scope_denied", 403);
      if (
        route.operationId === "cancelRun" &&
        !device.scopes.some(
          (s) => s === "conversation:advance" || s === "schedule:cancel",
        )
      )
        throw tunnelError("scope_denied", 403);
      const query = Object.fromEntries(url.searchParams);
      if ([...url.searchParams.keys()].length !== Object.keys(query).length)
        throw tunnelError("invalid_input");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 262144) throw tunnelError("payload_too_large", 413);
        chunks.push(chunk);
      }
      let body = null;
      if (bytes) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw tunnelError("invalid_input");
        }
      }
      const headers = Object.fromEntries(
        ["if-match", "idempotency-key", "x-client-mutation-id", "last-event-id"]
          .filter((key) => req.headers[key] !== undefined)
          .map((key) => [key, req.headers[key]]),
      );
      if (
        Object.values(headers).some(
          (value) => typeof value !== "string" || value.length > 4096,
        )
      )
        throw tunnelError("invalid_input");
      if (bytes && !req.headers["content-type"]?.startsWith("application/json"))
        throw tunnelError("invalid_input");
      validateRequest(route, headers, body, query);
      authorizeDevice(device.deviceId, device.grantRevision);
      const rateKey = `${device.deviceId}:${route.mutation ? "write" : "read"}`;
      for (const [key, value] of rates)
        if (value.start + 60_000 <= now()) rates.delete(key);
      const rate = rates.get(rateKey) || { start: now(), count: 0 };
      if (
        ++rate.count > (route.mutation ? 10 : 60) ||
        (!rates.has(rateKey) && rates.size >= 4096)
      )
        throw tunnelError("rate_limited", 429);
      rates.set(rateKey, rate);
      const peer = peers.get(device.ownerId);
      // A confirmed, unexpired connection may be refreshing its grant lease.
      // Wait for the latest ACK before signing a request with its updateId.
      if (
        !this.ownerView(device.ownerId)?.online ||
        peer.pending.size + peer.authorizationWaiters.size >= 128
      )
        throw tunnelError("owner_offline", 503);
      if (!peer.acknowledged) {
        const confirmed = await new Promise((resolve) => {
          const settle = (value) => {
            clearTimeout(timer);
            res.off("close", canceled);
            peer.authorizationWaiters.delete(settle);
            resolve(value);
          };
          const canceled = () => settle(false);
          const timer = setTimeout(
            canceled,
            Math.max(0, peer.authorizationDeadline - performance.now()),
          );
          timer.unref();
          peer.authorizationWaiters.add(settle);
          res.once("close", canceled);
        });
        if (!confirmed || res.destroyed)
          throw tunnelError("owner_offline", 503);
      }
      authorizeDevice(device.deviceId, device.grantRevision);
      if (Date.parse(device.credentials.accessExpiresAt) <= now())
        throw tunnelError("credential_expired", 401);
      if (
        peers.get(device.ownerId) !== peer ||
        !peer.acknowledged ||
        peer.leaseExpiresAt <= now() ||
        peer.socket.readyState !== 1 ||
        peer.pending.size >= 128
      )
        throw tunnelError("owner_offline", 503);
      const requestId = randomUUID();
      const context = {
        protocolVersion: OWNER_TUNNEL_PROTOCOL,
        audience: device.ownerId,
        spaceId: device.spaceId,
        deviceId: device.deviceId,
        grantRevision: device.grantRevision,
        authorizationId: peer.updateId,
        method: req.method,
        path: url.pathname,
        query,
        bodyHash: bodyHash(body),
        headers,
        requestId,
        nonce: randomUUID(),
        expiresAt: Math.min(
          now() + 30_000,
          Date.parse(device.credentials.accessExpiresAt),
        ),
      };
      const accessExpiresAt = Date.parse(device.credentials.accessExpiresAt);
      const pending = {
        res,
        deviceId: device.deviceId,
        grantRevision: device.grantRevision,
        route,
        stream: route.stream,
        timer: setTimeout(() => {
          send(peer, { type: "cancel_request", requestId });
          finish(
            peer,
            requestId,
            route.mutation ? 409 : 503,
            failure(
              route.mutation ? "reconciliation_required" : "owner_offline",
              requestId,
            ),
          );
        }, 25_000),
        guard: setInterval(() => {
          try {
            authorizeDevice(device.deviceId, device.grantRevision);
            if (accessExpiresAt <= now())
              throw tunnelError("credential_expired", 401);
          } catch (error) {
            send(peer, { type: "cancel_request", requestId });
            finish(
              peer,
              requestId,
              error.status || 401,
              failure(error.code || "revoked", requestId),
            );
          }
        }, 1000),
      };
      pending.timer.unref();
      pending.guard.unref();
      peer.pending.set(requestId, pending);
      res.once("close", () => {
        if (peer.pending.has(requestId)) {
          send(peer, { type: "cancel_request", requestId });
          finish(peer, requestId, 503, failure("owner_offline"));
        }
      });
      send(peer, { type: "request", requestId, body, ...signed(context) });
    },
    async close() {
      for (const peer of peers.values()) {
        disconnect(peer);
        peer.socket.terminate();
      }
      for (const socket of wss.clients) socket.terminate();
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}
