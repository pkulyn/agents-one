import {
  createHash,
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { dirname } from "node:path";
import { createMobileOwnerTunnel } from "./mobile-owner-tunnel.mjs";

const BASE = "/agents-one/mobile/v1";
const ADMIN = "/agents-one/mobile/admin/v1";
const SCOPES = [
  "conversation:read",
  "conversation:create",
  "conversation:advance",
  "conversation:manage",
  "schedule:read",
  "schedule:manage",
  "schedule:trigger",
  "schedule:cancel",
  "artifact:read",
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const id = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) &&
  !value.includes("..");
const fail = (code, status = 422) => {
  throw Object.assign(new Error(code), { code, status });
};
const iso = (value) => new Date(value).toISOString();
const bearer = (req) =>
  typeof req.headers.authorization === "string"
    ? req.headers.authorization.replace(/^Bearer /, "")
    : "";
const send = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
};
async function body(req, allowed) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) fail("payload_too_large", 413);
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    fail("invalid_input");
  }
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    fail("invalid_input");
  return value;
}

/** Independent mobile identities; never accepts Gateway or connector credentials. */
export function createMobileControlService({
  owners = [],
  storagePath,
  stateKey,
  now = Date.now,
} = {}) {
  if (!Array.isArray(owners)) throw Error("Mobile Owners must be an array.");
  if (!owners.length)
    return {
      handle: async () => false,
      upgrade: () => false,
      close: async () => {},
    };
  if (!storagePath || !/^[a-f0-9]{64}$/i.test(stateKey || ""))
    throw Error(
      "Mobile control requires an encrypted persistent state file and 32-byte state key.",
    );
  const key = Buffer.from(stateKey, "hex");
  const ownerByToken = new Map(),
    ownerById = new Map();
  for (const owner of owners) {
    if (
      !id(owner.ownerId) ||
      !id(owner.spaceId) ||
      typeof owner.label !== "string" ||
      !owner.label.trim() ||
      owner.label.length > 100 ||
      typeof owner.adminToken !== "string" ||
      owner.adminToken.length < 32 ||
      owner.adminToken.length > 4096 ||
      ownerById.has(owner.ownerId) ||
      ownerByToken.has(hash(owner.adminToken))
    )
      throw Error("Invalid or duplicate mobile Owner configuration.");
    ownerByToken.set(hash(owner.adminToken), owner);
    ownerById.set(owner.ownerId, owner);
  }
  let state = {
    version: 1,
    owners: {},
    invitations: {},
    claims: {},
    devices: {},
  };
  if (existsSync(storagePath)) {
    // Corrupt or undecryptable authorization state must never reset into an empty authority.
    const envelope = JSON.parse(readFileSync(storagePath, "utf8"));
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    state = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (
      state.version !== 1 ||
      !state.owners ||
      !state.invitations ||
      !state.claims ||
      !state.devices
    )
      throw Error("Unsupported mobile authorization state.");
  }
  function persist() {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(state)),
      cipher.final(),
    ]);
    mkdirSync(dirname(storagePath), { recursive: true });
    const temporary = `${storagePath}.${randomUUID()}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify({
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
      }),
      { mode: 0o600, flag: "wx" },
    );
    renameSync(temporary, storagePath);
  }
  let tunnel;
  function mutate(fn) {
    const prior = structuredClone(state);
    try {
      const result = fn();
      persist();
      for (const ownerId of ownerById.keys()) tunnel?.changed(ownerId);
      return result;
    } catch (error) {
      state = prior;
      throw error;
    }
  }
  const enabled = (ownerId) =>
    state.owners[ownerId]?.enabled === true &&
    state.owners[ownerId]?.spaceId === ownerById.get(ownerId)?.spaceId;
  function ownerView(owner) {
    const connected = tunnel?.ownerView(owner.ownerId);
    if (connected && enabled(owner.ownerId)) return connected;
    return {
      ownerId: owner.ownerId,
      spaceId: owner.spaceId,
      label: owner.label,
      ownerType: "desktop",
      online: false,
      executionAvailable: false,
      schedulerOnline: false,
      schedulerTimeZone: owner.schedulerTimeZone || "UTC",
      capabilities: [],
      dataEpoch: "mobile-pairing-v1",
      limits: {
        maxPageSize: 100,
        maxTextCharacters: 50000,
        maxRequestBytes: 16384,
        maxTimeoutMs: 86400000,
        eventRetentionDays: 1,
        eventRetentionCount: 1,
        snapshotTtlMs: 300000,
      },
    };
  }
  function grant(device) {
    const {
      deviceId,
      deviceLabel,
      ownerId,
      spaceId,
      scopes,
      grantRevision,
      expiresAt,
      revoked,
      createdAt,
      lastSeenAt,
    } = device;
    return {
      deviceId,
      deviceLabel,
      ownerId,
      spaceId,
      scopes,
      grantRevision,
      expiresAt,
      revoked,
      createdAt,
      lastSeenAt,
    };
  }
  function claimView(claim) {
    return {
      id: claim.id,
      state:
        claim.expires <= now() && claim.state !== "rejected"
          ? "expired"
          : claim.state,
      expiresAt: iso(claim.expires),
      verificationPhrase: claim.phrase,
    };
  }
  function issue(device) {
    return {
      deviceId: device.deviceId,
      accessToken: secret(),
      accessExpiresAt: iso(now() + 15 * 60_000),
      refreshCredential: secret(),
      refreshExpiresAt: device.expiresAt,
      grantRevision: device.grantRevision,
    };
  }
  function active(device) {
    if (
      !device ||
      device.revoked ||
      ownerById.get(device.ownerId)?.spaceId !== device.spaceId
    )
      fail("revoked", 401);
    if (Date.parse(device.expiresAt) <= now()) fail("credential_expired", 401);
    if (!enabled(device.ownerId)) fail("owner_offline", 503);
    return device;
  }
  function deviceFor(req) {
    const digest = hash(bearer(req));
    const device = Object.values(state.devices).find(
      (d) => hash(d.credentials.accessToken) === digest,
    );
    if (!device) fail("credential_expired", 401);
    active(device);
    if (Date.parse(device.credentials.accessExpiresAt) <= now())
      fail("credential_expired", 401);
    return device;
  }
  const attempts = new Map();
  function rate(req, bucket = "mutation", limit = 30) {
    const address = `${req.socket.remoteAddress || "unknown"}:${bucket}`,
      time = now();
    for (const [key, value] of attempts)
      if (time - value.start > 60_000) attempts.delete(key);
    if (!attempts.has(address)) {
      if (attempts.size >= 4096) fail("rate_limited", 429);
      attempts.set(address, { start: time, count: 0 });
    }
    if (++attempts.get(address).count > limit) fail("rate_limited", 429);
  }
  function mutationKey(req) {
    const value = req.headers["idempotency-key"];
    if (!id(value) || req.headers["x-client-mutation-id"] !== value)
      fail("invalid_input");
    return value;
  }
  tunnel = createMobileOwnerTunnel({
    stateKey,
    now,
    authenticate: (credential) => {
      if (typeof credential !== "string") return null;
      const owner = [...ownerById.values()].find(
        (o) =>
          state.owners[o.ownerId]?.hostCredentialHash === hash(credential) &&
          state.owners[o.ownerId]?.spaceId === o.spaceId,
      );
      return owner || null;
    },
    authorization: (ownerId) => ({
      enabled: enabled(ownerId),
      devices: Object.values(state.devices)
        .filter((d) => d.ownerId === ownerId)
        .map(grant),
    }),
    authorizeDevice: (deviceId, revision) => {
      const device = active(state.devices[deviceId]);
      if (device.grantRevision !== revision) fail("revoked", 401);
      return device;
    },
  });
  function status(owner) {
    return {
      protocolVersion: "mobile-control/1.0",
      owner: ownerView(owner),
      enabled: enabled(owner.ownerId),
      taskChannelReady:
        !!tunnel.ownerView(owner.ownerId)?.online && enabled(owner.ownerId),
      claims: Object.values(state.claims)
        .filter(
          (c) =>
            c.ownerId === owner.ownerId &&
            c.state === "pending" &&
            c.expires > now(),
        )
        .map((c) => ({ ...claimView(c), deviceLabel: c.deviceLabel })),
      devices: Object.values(state.devices)
        .filter((d) => d.ownerId === owner.ownerId)
        .map(grant),
      allowedScopes: SCOPES,
    };
  }
  return {
    upgrade: (req, socket, head) => tunnel.upgrade(req, socket, head),
    close: () => tunnel.close(),
    async handle(req, res, url) {
      if (
        !url.pathname.startsWith(BASE + "/") &&
        !url.pathname.startsWith(ADMIN + "/")
      )
        return false;
      try {
        if (url.pathname.includes("%") || url.pathname.includes(".."))
          fail("invalid_input");
        const method = req.method,
          path = url.pathname;
        if (path.startsWith(ADMIN + "/")) {
          if (url.search) fail("invalid_input");
          const owner = ownerByToken.get(hash(bearer(req)));
          if (!owner) fail("scope_denied", 403);
          const suffix = path.slice(ADMIN.length);
          if (method === "POST" && suffix === "/host-credentials") {
            await body(req, []);
            const hostCredential = secret();
            mutate(() => {
              state.owners[owner.ownerId] = {
                ...state.owners[owner.ownerId],
                spaceId: owner.spaceId,
                hostCredentialHash: hash(hostCredential),
              };
            });
            tunnel.revokeHost(owner.ownerId);
            send(res, 200, {
              ownerId: owner.ownerId,
              spaceId: owner.spaceId,
              protocolVersion: "mobile-owner/1.0",
              signingPublicKey: tunnel.publicKey,
              hostCredential,
            });
            return true;
          }
          if (method === "GET" && suffix === "/status") {
            send(res, 200, status(owner));
            return true;
          }
          if (method === "PUT" && suffix === "/enabled") {
            const input = await body(req, ["enabled"]);
            if (typeof input.enabled !== "boolean") fail("invalid_input");
            mutate(() => {
              state.owners[owner.ownerId] = {
                ...state.owners[owner.ownerId],
                spaceId: owner.spaceId,
                enabled: input.enabled,
              };
              if (!input.enabled) {
                for (const invitation of Object.values(state.invitations))
                  if (invitation.ownerId === owner.ownerId)
                    invitation.used = true;
                for (const claim of Object.values(state.claims))
                  if (
                    claim.ownerId === owner.ownerId &&
                    claim.state !== "exchanged"
                  )
                    claim.state = "rejected";
              }
            });
            send(res, 200, status(owner));
            return true;
          }
          if (method === "POST" && suffix === "/invitations") {
            await body(req, []);
            if (!enabled(owner.ownerId)) fail("owner_offline", 503);
            const invitation = secret(),
              expires = now() + 300_000;
            mutate(() => {
              for (const [key, value] of Object.entries(state.invitations))
                if (value.expires <= now()) delete state.invitations[key];
              if (
                Object.values(state.invitations).filter(
                  (v) => v.ownerId === owner.ownerId && !v.used,
                ).length >= 5
              )
                fail("rate_limited", 429);
              state.invitations[hash(invitation)] = {
                ownerId: owner.ownerId,
                spaceId: owner.spaceId,
                expires,
                used: false,
              };
            });
            send(res, 201, {
              invitation,
              expiresAt: iso(expires),
              owner: ownerView(owner),
            });
            return true;
          }
          const approval = suffix.match(
            /^\/claims\/([A-Za-z0-9-]+)\/(approve|reject)$/,
          );
          if (method === "POST" && approval) {
            const input = await body(req, ["verificationPhrase", "scopes"]);
            const claim = state.claims[approval[1]];
            if (
              !claim ||
              claim.ownerId !== owner.ownerId ||
              claim.spaceId !== owner.spaceId
            )
              fail("resource_not_found", 404);
            if (!enabled(owner.ownerId)) fail("owner_offline", 503);
            if (claim.state !== "pending" || claim.expires <= now())
              fail("invitation_expired", 409);
            if (
              approval[2] === "approve" &&
              (input.verificationPhrase !== claim.phrase ||
                !Array.isArray(input.scopes) ||
                !input.scopes.length ||
                input.scopes.some((s) => !SCOPES.includes(s)) ||
                new Set(input.scopes).size !== input.scopes.length)
            )
              fail("invalid_input");
            mutate(() => {
              claim.state = approval[2] === "approve" ? "approved" : "rejected";
              if (claim.state === "approved") claim.scopes = input.scopes;
            });
            send(res, 200, status(owner));
            return true;
          }
          const revoke = suffix.match(/^\/devices\/([A-Za-z0-9-]+)$/);
          if (method === "DELETE" && revoke) {
            const device = state.devices[revoke[1]];
            if (!device || device.ownerId !== owner.ownerId)
              fail("resource_not_found", 404);
            mutate(() => {
              device.revoked = true;
              device.grantRevision = String(BigInt(device.grantRevision) + 1n);
            });
            send(res, 200, status(owner));
            return true;
          }
          fail("resource_not_found", 404);
        }
        if (url.search && !path.startsWith(BASE + "/owners/"))
          fail("invalid_input");
        if (method === "POST" && path === BASE + "/pairing/claims") {
          rate(req);
          const input = await body(req, ["invitation", "code", "deviceLabel"]);
          if (
            typeof input.invitation !== "string" ||
            input.code !== undefined ||
            typeof input.deviceLabel !== "string" ||
            !input.deviceLabel.trim() ||
            input.deviceLabel.length > 80
          )
            fail("invalid_input");
          const invitation = state.invitations[hash(input.invitation)];
          if (
            !invitation ||
            invitation.used ||
            invitation.expires <= now() ||
            ownerById.get(invitation.ownerId)?.spaceId !== invitation.spaceId
          )
            fail("invitation_expired", 401);
          if (!enabled(invitation.ownerId)) fail("owner_offline", 503);
          const proof = secret(),
            claim = {
              id: randomUUID(),
              ownerId: invitation.ownerId,
              spaceId: invitation.spaceId,
              deviceLabel: input.deviceLabel.trim(),
              state: "pending",
              expires: invitation.expires,
              phrase: randomBytes(6).toString("hex").match(/.{4}/g).join(" "),
              proof: hash(proof),
            };
          mutate(() => {
            for (const [key, value] of Object.entries(state.claims))
              if (value.expires + 30_000 < now()) delete state.claims[key];
            if (Object.keys(state.claims).length >= 1000)
              fail("rate_limited", 429);
            invitation.used = true;
            state.claims[claim.id] = claim;
          });
          send(res, 201, { ...claimView(claim), claimProof: proof });
          return true;
        }
        const claimPath = path.match(
          /^\/agents-one\/mobile\/v1\/pairing\/claims\/([A-Za-z0-9-]+)(\/exchange)?$/,
        );
        if (claimPath) {
          rate(
            req,
            method === "GET" ? "claim-poll" : "mutation",
            method === "GET" ? 120 : 30,
          );
          const claim = state.claims[claimPath[1]];
          if (
            !claim ||
            claim.proof !== hash(bearer(req)) ||
            ownerById.get(claim.ownerId)?.spaceId !== claim.spaceId
          )
            fail("scope_denied", 403);
          if (!enabled(claim.ownerId)) fail("owner_offline", 503);
          if (method === "GET" && !claimPath[2]) {
            send(res, 200, claimView(claim));
            return true;
          }
          if (method === "POST" && claimPath[2]) {
            const input = await body(req, ["clientMutationId"]);
            const key = mutationKey(req);
            if (
              input.clientMutationId !== undefined &&
              input.clientMutationId !== key
            )
              fail("invalid_input");
            if (claim.deviceId) {
              const device = active(state.devices[claim.deviceId]);
              if (
                claim.exchangeKey !== key ||
                now() - claim.exchangedAt > 120_000 ||
                device.rotations.length
              )
                fail("idempotency_conflict", 409);
              send(res, 200, device.credentials);
              return true;
            }
            if (claim.expires <= now()) fail("invitation_expired", 401);
            if (claim.state !== "approved")
              fail(
                claim.state === "rejected" ? "claim_rejected" : "scope_denied",
                403,
              );
            const owner = ownerById.get(claim.ownerId);
            if (!owner) fail("owner_offline", 503);
            const device = {
              deviceId: randomUUID(),
              deviceLabel: claim.deviceLabel,
              ownerId: owner.ownerId,
              spaceId: owner.spaceId,
              scopes: claim.scopes,
              grantRevision: "1",
              expiresAt: iso(now() + 30 * 86400_000),
              revoked: false,
              createdAt: iso(now()),
              lastSeenAt: iso(now()),
              rotations: [],
            };
            device.credentials = issue(device);
            mutate(() => {
              if (
                Object.values(state.devices).filter(
                  (d) => d.ownerId === owner.ownerId,
                ).length >= 200
              )
                fail("rate_limited", 429);
              state.devices[device.deviceId] = device;
              claim.deviceId = device.deviceId;
              claim.state = "exchanged";
              claim.exchangeKey = key;
              claim.exchangedAt = now();
            });
            send(res, 200, device.credentials);
            return true;
          }
          fail("resource_not_found", 404);
        }
        if (method === "POST" && path === BASE + "/auth/refresh") {
          rate(req);
          const input = await body(req, ["refreshCredential", "rotationId"]);
          if (
            typeof input.refreshCredential !== "string" ||
            !id(input.rotationId)
          )
            fail("invalid_input");
          const digest = hash(input.refreshCredential);
          const device = Object.values(state.devices).find(
            (d) =>
              hash(d.credentials.refreshCredential) === digest ||
              d.rotations.some((r) => r.digest === digest),
          );
          active(device);
          const previous = device.rotations.find((r) => r.digest === digest);
          if (previous) {
            if (
              previous.rotationId === input.rotationId &&
              now() - previous.at <= 30_000 &&
              previous === device.rotations.at(-1)
            ) {
              send(res, 200, device.credentials);
              return true;
            }
            mutate(() => {
              device.revoked = true;
              device.grantRevision = String(BigInt(device.grantRevision) + 1n);
            });
            fail("refresh_reused", 401);
          }
          if (device.rotations.length >= 4096) fail("rate_limited", 429);
          mutate(() => {
            device.rotations.push({
              digest,
              rotationId: input.rotationId,
              at: now(),
            });
            device.credentials = issue(device);
            device.lastSeenAt = iso(now());
          });
          send(res, 200, device.credentials);
          return true;
        }
        const device = deviceFor(req),
          owner = ownerById.get(device.ownerId);
        if (!owner || owner.spaceId !== device.spaceId) fail("revoked", 401);
        if (method === "GET" && path === BASE + "/devices/self") {
          send(res, 200, grant(device));
          return true;
        }
        if (method === "DELETE" && path === BASE + "/devices/self") {
          mutate(() => {
            device.revoked = true;
            device.grantRevision = String(BigInt(device.grantRevision) + 1n);
          });
          res.writeHead(204, { "Cache-Control": "no-store" });
          res.end();
          return true;
        }
        if (method === "GET" && path === BASE + "/owners") {
          send(res, 200, {
            items: [ownerView(owner)],
            nextCursor: null,
            snapshotRevision: "1",
          });
          return true;
        }
        if (
          path.startsWith(
            `${BASE}/owners/${owner.ownerId}/spaces/${owner.spaceId}/`,
          )
        ) {
          await tunnel.forward(req, res, url, device);
          return true;
        }
        fail("resource_not_found", 404);
      } catch (error) {
        send(res, error.status || 503, {
          error: {
            code: error.code || "owner_offline",
            message: error.code || "Mobile control unavailable",
            requestId: randomUUID(),
            retryable: false,
          },
        });
      }
      return true;
    },
  };
}
