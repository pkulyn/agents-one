export const CONNECT_STATE_LIMITS = Object.freeze({
  pairings: 256,
  devices: 256,
  expiredPairingRetentionMs: 5 * 60 * 1000,
  revokedDeviceRetentionMs: 24 * 60 * 60 * 1000,
});
/** Compact expired authority without evicting active device credentials. */
export function pruneConnectState(
  { pairings, devices, runtimes, desktopTokens },
  at,
) {
  const expiredPending = new Set(),
    revokedSessions = new Set(),
    removedSessions = new Set(),
    removedDevices = new Set(),
    revokedDevices = new Set();
  for (const [id, device] of devices) {
    if (device.state !== "revoked") continue;
    if (!Number.isFinite(device.revokedAt)) device.revokedAt = at;
    revokedDevices.add(id);
    if (typeof device.sessionId === "string")
      revokedSessions.add(device.sessionId);
    if (
      at - device.revokedAt >=
      CONNECT_STATE_LIMITS.revokedDeviceRetentionMs
    ) {
      devices.delete(id);
      removedDevices.add(id);
      if (typeof device.sessionId === "string")
        removedSessions.add(device.sessionId);
    }
  }
  for (const [code, pairing] of pairings) {
    if (removedSessions.has(pairing.sessionId)) {
      pairings.delete(code);
      continue;
    }
    if (
      pairing.state === "pending" &&
      Number.isFinite(pairing.expiresAt) &&
      pairing.expiresAt <= at
    ) {
      if (typeof pairing.sessionId === "string")
        expiredPending.add(pairing.sessionId);
      if (
        at - pairing.expiresAt >=
        CONNECT_STATE_LIMITS.expiredPairingRetentionMs
      )
        pairings.delete(code);
    }
  }
  for (const [value, record] of desktopTokens) {
    if (
      expiredPending.has(record.sessionId) ||
      revokedSessions.has(record.sessionId) ||
      removedDevices.has(record.deviceId)
    )
      desktopTokens.delete(value);
  }
  for (const [key, id] of runtimes) {
    if (revokedDevices.has(id)) runtimes.delete(key);
  }
}
