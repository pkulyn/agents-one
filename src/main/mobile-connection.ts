import { createHash, createPublicKey } from "node:crypto";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, win32 } from "node:path";
import type { DesktopSecretStore } from "./desktop-secret-store";
import { desktopSecretStore } from "./desktop-secret-store";
import {
  getActiveProfileNameSync,
  agentsOneProfileHome,
  profileHome,
} from "./utils";
import { assertAgentsOneWritesAllowed } from "./restore-write-lock";
import {
  MOBILE_DEVICE_SCOPES,
  type MobileConnectionCommand,
  type MobileConnectionResult,
  type MobileConnectionStatus,
} from "../shared/mobile-connection";
import { assertMobileSchema } from "../shared/mobile-control";
import type { OwnerTunnelBinding } from "./mobile-control/owner-tunnel";

/** Windows path spelling is not a profile or credential identity. */
function connectionHome(profile: string): string {
  return process.platform === "win32" &&
    /^(?:[A-Za-z]:[\\/]|\\\\)/.test(profile)
    ? win32
        .normalize(profile)
        .replace(/[\\/]+$/, "")
        .toLowerCase()
    : profile;
}
const connectionKey = (home: string): string =>
  "mobile-connection:" + createHash("sha256").update(home).digest("hex");
function legacyHermesProfileHome(profile: string): string | undefined {
  const absolute =
    process.platform === "win32"
      ? /^(?:[A-Za-z]:[\\/]|\\\\)/.test(profile)
      : profile.startsWith("/");
  if (!absolute) return undefined;
  const name =
    process.platform === "win32" ? win32.basename(profile) : basename(profile);
  if (!/^[a-z0-9_][a-z0-9_-]{0,63}$/i.test(name)) return undefined;
  return profileHome(name);
}
function isOnlyDefaultProfileHome(profile: string): boolean {
  const path = process.platform === "win32" ? win32 : { basename, dirname };
  if (path.basename(profile).toLowerCase() !== "default") return false;
  try {
    const info = lstatSync(profile);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    const profiles = readdirSync(path.dirname(profile), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name.toLowerCase());
    return profiles.length === 1 && profiles[0] === "default";
  } catch {
    return false;
  }
}
function connectionAliases(profile: string): string[] {
  const canonical = connectionHome(profile);
  const legacyHome = legacyHermesProfileHome(profile);
  if (process.platform !== "win32" || !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(profile))
    return [...new Set([profile, ...(legacyHome ? [legacyHome] : [])])];
  const aliases = [
    canonical,
    profile,
    win32.normalize(profile),
    win32.normalize(profile).replaceAll("\\", "/"),
    ...(legacyHome
      ? [
          legacyHome,
          win32.normalize(legacyHome),
          win32.normalize(legacyHome).replaceAll("\\", "/"),
        ]
      : []),
  ];
  try {
    // Only this existing directory, never other profiles or arbitrary records.
    const physical = realpathSync.native(profile);
    aliases.push(physical, physical.replaceAll("\\", "/"));
  } catch {
    /* Missing paths retain only their explicit spellings. */
  }
  return [...new Set(aliases)];
}

const noLegacy = { read: () => null, remove: () => {} };
interface Saved {
  endpoint: string;
  managementToken: string;
  ownerId: string;
  spaceId: string;
  hostCredential?: string;
  signingPublicKey?: string;
  [key: string]: unknown;
}
const validId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id) &&
  !id.includes("..");
function endpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048)
    throw Error("invalid_input");
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw Error("invalid_input");
  return url.origin;
}
function status(value: unknown): Omit<MobileConnectionStatus, "configured"> {
  if (!value || typeof value !== "object") throw Error("protocol_incompatible");
  const data = value as Record<string, unknown>;
  if (
    data.protocolVersion !== "mobile-control/1.0" ||
    typeof data.enabled !== "boolean" ||
    typeof data.taskChannelReady !== "boolean" ||
    !Array.isArray(data.claims) ||
    data.claims.length > 1000 ||
    !Array.isArray(data.devices) ||
    data.devices.length > 200 ||
    !Array.isArray(data.allowedScopes) ||
    data.allowedScopes.some(
      (s) => !(MOBILE_DEVICE_SCOPES as readonly unknown[]).includes(s),
    )
  )
    throw Error("protocol_incompatible");
  assertMobileSchema("OwnerSpace", data.owner);
  for (const claim of data.claims) {
    assertMobileSchema("PairingClaim", claim);
    if (typeof claim.deviceLabel !== "string" || claim.deviceLabel.length > 80)
      throw Error("protocol_incompatible");
  }
  for (const device of data.devices) {
    assertMobileSchema("DeviceGrant", device);
    if (
      typeof device.createdAt !== "string" ||
      typeof device.lastSeenAt !== "string"
    )
      throw Error("protocol_incompatible");
  }
  // Build a projection; unknown server fields and secrets never cross preload.
  const owner = data.owner as {
    ownerId: string;
    spaceId: string;
    label: string;
    online: boolean;
  };
  return {
    protocolVersion: "mobile-control/1.0",
    enabled: data.enabled,
    taskChannelReady: data.taskChannelReady,
    owner: {
      ownerId: owner.ownerId,
      spaceId: owner.spaceId,
      label: owner.label,
      online: owner.online,
    },
    allowedScopes: data.allowedScopes as string[],
    claims: data.claims.map((c) => ({
      id: c.id,
      deviceLabel: c.deviceLabel,
      verificationPhrase: c.verificationPhrase,
      expiresAt: c.expiresAt,
      state: c.state,
    })),
    devices: data.devices.map((d) => ({
      deviceId: d.deviceId,
      deviceLabel: d.deviceLabel,
      scopes: d.scopes,
      expiresAt: d.expiresAt,
      revoked: d.revoked,
      createdAt: d.createdAt,
      lastSeenAt: d.lastSeenAt,
      grantRevision: d.grantRevision,
    })),
  };
}

/** Profile-scoped management, independent of Gateway credentials and desktop.json. */
export class MobileConnectionManager {
  private queues = new Map<string, Promise<unknown>>();
  constructor(
    private readonly store: () =>
      | DesktopSecretStore
      | undefined = desktopSecretStore,
    private readonly request: typeof fetch = fetch,
  ) {}
  async execute(
    profile: string,
    command: MobileConnectionCommand,
  ): Promise<MobileConnectionResult> {
    return this.serialized(profile, () => this.apply(profile, command));
  }
  private async serialized<T>(
    profile: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const queueKey = connectionHome(profile);
    const previous = this.queues.get(queueKey) || Promise.resolve();
    const pending = previous.catch(() => {}).then(task);
    this.queues.set(queueKey, pending);
    try {
      return await pending;
    } finally {
      if (this.queues.get(queueKey) === pending) this.queues.delete(queueKey);
    }
  }
  private saved(profile: string): string | undefined {
    const store = this.store();
    if (!store) return undefined;
    const targetKey = connectionKey(connectionHome(profile));
    const legacyHome = legacyHermesProfileHome(profile);
    const legacyKey = legacyHome
      ? connectionKey(connectionHome(legacyHome))
      : undefined;
    for (const alias of connectionAliases(profile)) {
      const key = connectionKey(alias);
      const raw = store.get(key, noLegacy);
      if (raw) {
        if (legacyKey === key && key !== targetKey) {
          try {
            // Keep the original OS-protected record for rollback.
            store.set(targetKey, raw, noLegacy);
          } catch {
            /* The legacy binding remains readable if the copy cannot persist. */
          }
        }
        return raw;
      }
      // An unreadable current record must not fall back to older trust.
      if (store.status(key).unreadable)
        throw Error("secure_storage_unavailable");
    }
    if (
      isOnlyDefaultProfileHome(profile) &&
      store.copyUniquePrefixedRecord("mobile-connection:", targetKey)
    ) {
      const migrated = store.get(targetKey, noLegacy);
      if (migrated) return migrated;
      if (store.status(targetKey).unreadable)
        throw Error("secure_storage_unavailable");
    }
    return undefined;
  }
  /** Main-only Host credentials; never projected across preload or stored in desktop.json. */
  async ownerBinding(profile: string): Promise<OwnerTunnelBinding | undefined> {
    return this.serialized(profile, async () => {
      const key = connectionKey(connectionHome(profile));
      const store = this.store();
      const raw = this.saved(profile);
      if (!raw) return undefined;
      const config = JSON.parse(raw) as Saved;
      const current = status(await this.remote(config, "GET", "/status"));
      if (
        current.owner!.ownerId !== config.ownerId ||
        current.owner!.spaceId !== config.spaceId
      )
        throw Error("connection_binding_conflict");
      if (!current.enabled) return undefined;
      if (!store?.protector.available)
        throw Error("secure_storage_unavailable");
      if (!config.hostCredential || !config.signingPublicKey) {
        const registration = (await this.remote(
          config,
          "POST",
          "/host-credentials",
          {},
        )) as Record<string, unknown>;
        if (
          registration.protocolVersion !== "mobile-owner/1.0" ||
          registration.ownerId !== config.ownerId ||
          registration.spaceId !== config.spaceId ||
          typeof registration.hostCredential !== "string" ||
          registration.hostCredential.length < 32 ||
          registration.hostCredential.length > 4096 ||
          typeof registration.signingPublicKey !== "string" ||
          !/^[A-Za-z0-9+/=]{40,200}$/.test(registration.signingPublicKey)
        )
          throw Error("protocol_incompatible");
        try {
          if (
            createPublicKey({
              key: Buffer.from(registration.signingPublicKey, "base64"),
              type: "spki",
              format: "der",
            }).asymmetricKeyType !== "ed25519"
          )
            throw Error();
        } catch {
          throw Error("protocol_incompatible");
        }
        config.hostCredential = registration.hostCredential;
        config.signingPublicKey = registration.signingPublicKey;
        if (
          store.set(key, JSON.stringify(config), noLegacy).protection !==
          "os-protected"
        )
          throw Error("secure_storage_unavailable");
      }
      return {
        endpoint: endpoint(config.endpoint),
        ownerId: config.ownerId,
        spaceId: config.spaceId,
        hostCredential: config.hostCredential,
        signingPublicKey: config.signingPublicKey,
      };
    });
  }
  private async remote(
    config: Saved,
    method: string,
    route: string,
    input?: unknown,
  ): Promise<unknown> {
    try {
      const response = await this.request(
        endpoint(config.endpoint) + "/agents-one/mobile/admin/v1" + route,
        {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${config.managementToken}`,
            Accept: "application/json",
            "Cache-Control": "no-store",
            ...(input ? { "Content-Type": "application/json" } : {}),
          },
          body: input ? JSON.stringify(input) : undefined,
        },
      );
      if (!response.ok)
        throw Error(
          response.status === 401 || response.status === 403
            ? "scope_denied"
            : response.status === 409
              ? "invitation_expired"
              : "service_unavailable",
        );
      if (
        !response.headers.get("content-type")?.startsWith("application/json") ||
        !response.body
      )
        throw Error("protocol_incompatible");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 512 * 1024) throw Error("protocol_incompatible");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      const code = (error as Error).message;
      throw Error(
        [
          "scope_denied",
          "invitation_expired",
          "protocol_incompatible",
          "service_unavailable",
        ].includes(code)
          ? code
          : "service_unavailable",
      );
    }
  }
  private async apply(
    profile: string,
    command: MobileConnectionCommand,
  ): Promise<MobileConnectionResult> {
    if (
      !command ||
      typeof command !== "object" ||
      ![
        "status",
        "save",
        "enabled",
        "invite",
        "approve",
        "reject",
        "revoke",
      ].includes(command.action)
    )
      throw Error("invalid_input");
    const key = connectionKey(connectionHome(profile));
    const store = this.store();
    let raw: string | undefined;
    try {
      raw = this.saved(profile);
    } catch (error) {
      if (command.action === "status")
        return {
          status: {
            configured: true,
            connectionError: "secure_storage_unavailable",
          },
        };
      throw error;
    }
    const saved: Saved | undefined = raw ? JSON.parse(raw) : undefined;
    if (command.action === "status" && !saved)
      return { status: { configured: false } };
    if (command.action === "save") {
      if (!store?.protector.available)
        throw Error("secure_storage_unavailable");
      if (
        typeof command.managementToken !== "string" ||
        command.managementToken.trim().length < 32 ||
        command.managementToken.length > 4096
      )
        throw Error("invalid_input");
      const config = {
        ...saved,
        endpoint: endpoint(command.endpoint),
        managementToken: command.managementToken.trim(),
        ownerId: "",
        spaceId: "",
      };
      const verified = status(await this.remote(config, "GET", "/status"));
      if (
        saved &&
        (saved.endpoint !== config.endpoint ||
          saved.ownerId !== verified.owner!.ownerId ||
          saved.spaceId !== verified.owner!.spaceId)
      )
        throw Error("connection_binding_conflict");
      config.ownerId = verified.owner!.ownerId;
      config.spaceId = verified.owner!.spaceId;
      const result = store.set(key, JSON.stringify(config), noLegacy);
      if (result.protection !== "os-protected")
        throw Error("secure_storage_unavailable");
      return {
        status: { ...verified, configured: true, endpoint: config.endpoint },
      };
    }
    if (!saved) throw Error("connection_required");
    let current: Omit<MobileConnectionStatus, "configured">;
    try {
      current = status(await this.remote(saved, "GET", "/status"));
    } catch (error) {
      if (command.action === "status")
        return {
          status: {
            configured: true,
            endpoint: saved.endpoint,
            connectionError: (error as Error).message,
          },
        };
      throw error;
    }
    if (
      current.owner!.ownerId !== saved.ownerId ||
      current.owner!.spaceId !== saved.spaceId
    )
      throw Error("connection_binding_conflict");
    if (command.action === "status")
      return {
        status: { ...current, configured: true, endpoint: saved.endpoint },
      };
    if (command.action === "invite") {
      const value = (await this.remote(saved, "POST", "/invitations", {})) as {
        invitation: string;
        expiresAt: string;
      };
      if (
        typeof value.invitation !== "string" ||
        value.invitation.length > 4096 ||
        typeof value.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(value.expiresAt))
      )
        throw Error("protocol_incompatible");
      return {
        status: { ...current, configured: true, endpoint: saved.endpoint },
        invitation: {
          invitation: value.invitation,
          expiresAt: value.expiresAt,
          endpoint: saved.endpoint,
        },
      };
    }
    let response: unknown;
    if (command.action === "enabled") {
      if (typeof command.enabled !== "boolean") throw Error("invalid_input");
      response = await this.remote(saved, "PUT", "/enabled", {
        enabled: command.enabled,
      });
    } else {
      if (!validId(command.id)) throw Error("invalid_input");
      if (command.action === "approve") {
        if (
          typeof command.verificationPhrase !== "string" ||
          command.verificationPhrase.length > 100 ||
          !Array.isArray(command.scopes) ||
          !command.scopes.length ||
          command.scopes.length > 9 ||
          command.scopes.some(
            (s) => !(MOBILE_DEVICE_SCOPES as readonly string[]).includes(s),
          )
        )
          throw Error("invalid_input");
        response = await this.remote(
          saved,
          "POST",
          `/claims/${command.id}/approve`,
          {
            verificationPhrase: command.verificationPhrase,
            scopes: command.scopes,
          },
        );
      } else if (command.action === "reject")
        response = await this.remote(
          saved,
          "POST",
          `/claims/${command.id}/reject`,
          {},
        );
      else
        response = await this.remote(saved, "DELETE", `/devices/${command.id}`);
    }
    const next = status(response);
    if (
      next.owner!.ownerId !== saved.ownerId ||
      next.owner!.spaceId !== saved.spaceId
    )
      throw Error("connection_binding_conflict");
    return { status: { ...next, configured: true, endpoint: saved.endpoint } };
  }
}
const manager = new MobileConnectionManager();
const connectionListeners = new Set<() => void>();
let pendingConnectionChanges = 0;
export function isMobileConnectionChanging(): boolean {
  return pendingConnectionChanges > 0;
}
export function onMobileConnectionChanged(listener: () => void): () => void {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}
function notifyMobileConnectionChanged(): void {
  for (const listener of connectionListeners) {
    try {
      listener();
    } catch {
      /* Lifecycle errors cannot change management results. */
    }
  }
}
export function mobileOwnerBinding(
  profile: string,
): Promise<OwnerTunnelBinding | undefined> {
  return manager.ownerBinding(agentsOneProfileHome(profile));
}
export function manageMobileConnection(
  profile: string | undefined,
  command: MobileConnectionCommand,
): Promise<MobileConnectionResult> {
  const name = profile || getActiveProfileNameSync();
  const home = agentsOneProfileHome(name); // Existing validation prevents arbitrary profile paths.
  if (command?.action !== "status") assertAgentsOneWritesAllowed();
  if (command?.action === "status") return manager.execute(home, command);
  pendingConnectionChanges++;
  notifyMobileConnectionChanged();
  return manager.execute(home, command).finally(() => {
    pendingConnectionChanges--;
    notifyMobileConnectionChanged();
  });
}
