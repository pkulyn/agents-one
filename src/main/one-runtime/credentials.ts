import {
  desktopSecretStore,
  type DesktopSecretStatus,
} from "../desktop-secret-store";

const runtimeIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const noLegacy = { read: () => null, remove: () => {} };
const serverIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/** Hex encoding keeps distinct runtime IDs in distinct protected records. */
export function oneCredentialKey(runtimeId: string): string {
  if (!runtimeIdPattern.test(runtimeId))
    throw new Error("One runtime ID is invalid");
  return (
    "AGENTS_ONE_ONE_" +
    Buffer.from(runtimeId, "utf8").toString("hex").toUpperCase() +
    "_API_KEY"
  );
}

/** Never downgrade a One model credential to a plaintext configuration file. */
export function setOneCredential(
  runtimeId: string,
  value: string,
): DesktopSecretStatus {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 4096 ||
    /[\0\r\n]/.test(value)
  )
    throw new Error("Model API key is invalid");
  const store = desktopSecretStore();
  if (!store?.protector.available)
    throw new Error("Protected credential storage is unavailable");
  return store.set(oneCredentialKey(runtimeId), value.trim(), noLegacy);
}

/** Main-process-only access; never expose this value to the renderer. */
export function getOneCredential(runtimeId: string): string | null {
  const store = desktopSecretStore();
  if (!store?.protector.available) return null;
  return store.get(oneCredentialKey(runtimeId), noLegacy);
}

export function oneCredentialStatus(runtimeId: string): {
  configured: boolean;
  storage?: DesktopSecretStatus;
} {
  const key = oneCredentialKey(runtimeId);
  const store = desktopSecretStore();
  return {
    configured: Boolean(store?.protector.available && store.get(key, noLegacy)),
    ...(store ? { storage: store.status(key) } : {}),
  };
}

const providerIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function oneProviderCredentialKey(
  runtimeId: string,
  providerId: string,
): string {
  if (!runtimeIdPattern.test(runtimeId) || !providerIdPattern.test(providerId))
    throw new Error("One provider identity is invalid");
  return (
    "AGENTS_ONE_ONE_" +
    Buffer.from(runtimeId, "utf8").toString("hex").toUpperCase() +
    "_PROVIDER_" +
    Buffer.from(providerId, "utf8").toString("hex").toUpperCase() +
    "_API_KEY"
  );
}

/** Provider-scoped credentials stay in the protected store, never in config. */
export function setOneProviderCredential(
  runtimeId: string,
  providerId: string,
  value: string,
): DesktopSecretStatus {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 4096 ||
    /[\0\r\n]/.test(value)
  )
    throw new Error("Model API key is invalid");
  const store = desktopSecretStore();
  if (!store?.protector.available)
    throw new Error("Protected credential storage is unavailable");
  return store.set(
    oneProviderCredentialKey(runtimeId, providerId),
    value.trim(),
    noLegacy,
  );
}

/** Main-process-only access; never expose this value to the renderer. */
export function getOneProviderCredential(
  runtimeId: string,
  providerId: string,
): string | null {
  const store = desktopSecretStore();
  if (!store?.protector.available) return null;
  return store.get(oneProviderCredentialKey(runtimeId, providerId), noLegacy);
}

export function oneProviderCredentialStatus(
  runtimeId: string,
  providerId: string,
): { configured: boolean; storage?: DesktopSecretStatus } {
  const key = oneProviderCredentialKey(runtimeId, providerId);
  const store = desktopSecretStore();
  return {
    configured: Boolean(store?.protector.available && store.get(key, noLegacy)),
    ...(store ? { storage: store.status(key) } : {}),
  };
}

function oneMcpSecretKey(runtimeId: string, serverId: string): string {
  if (!runtimeIdPattern.test(runtimeId) || !serverIdPattern.test(serverId))
    throw new Error("One MCP server identity is invalid");
  return `AGENTS_ONE_ONE_${Buffer.from(runtimeId + ":" + serverId, "utf8")
    .toString("hex")
    .toUpperCase()}_MCP`;
}

/** Persist MCP bearer tokens and process environment values with OS protection. */
export function setOneMcpSecrets(
  runtimeId: string,
  serverId: string,
  values: Record<string, string>,
): void {
  const entries = Object.entries(values);
  if (
    entries.length > 33 ||
    entries.some(
      ([name, value]) =>
        !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) ||
        typeof value !== "string" ||
        value.length > 4096 ||
        /[\0\r\n]/.test(value),
    ) ||
    entries.reduce((sum, [, value]) => sum + Buffer.byteLength(value), 0) >
      16 * 1024
  )
    throw new Error("One MCP credentials are invalid or too large");
  const store = desktopSecretStore();
  if (!store?.protector.available)
    throw new Error("Protected credential storage is unavailable");
  store.set(
    oneMcpSecretKey(runtimeId, serverId),
    JSON.stringify(values),
    noLegacy,
  );
}

/** Main-process-only MCP credentials; never expose them back to the renderer. */
export function getOneMcpSecrets(
  runtimeId: string,
  serverId: string,
): Record<string, string> {
  const store = desktopSecretStore();
  if (!store?.protector.available) return {};
  const raw = store.get(oneMcpSecretKey(runtimeId, serverId), noLegacy);
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.values(value).some((item) => typeof item !== "string")
    )
      return {};
    return value as Record<string, string>;
  } catch {
    return {};
  }
}
