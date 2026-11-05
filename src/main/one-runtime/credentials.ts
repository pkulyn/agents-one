import {
  desktopSecretStore,
  type DesktopSecretStatus,
} from "../desktop-secret-store";

const runtimeIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const noLegacy = { read: () => null, remove: () => {} };

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
