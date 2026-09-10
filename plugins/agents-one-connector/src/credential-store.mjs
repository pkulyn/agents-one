import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  protectForCurrentWindowsUser,
  unprotectForCurrentWindowsUser,
} from "./dpapi-protector.mjs";

const CONNECTOR_DIR = "agents-one/connector";

export function defaultCredentialDirectory(env = process.env) {
  if (process.platform === "win32") {
    const appData = env.APPDATA?.trim();
    return join(
      appData || join(homedir(), "AppData", "Roaming"),
      CONNECTOR_DIR,
    );
  }
  return join(
    env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"),
    CONNECTOR_DIR,
  );
}

function ensureDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(directory, 0o700);
}

function atomicWrite(path, content, mode = 0o600) {
  ensureDirectory(dirname(path));
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, content, { encoding: "utf8", mode });
  if (process.platform !== "win32") chmodSync(temporary, mode);
  renameSync(temporary, path);
  if (process.platform !== "win32") chmodSync(path, mode);
}

function validRuntimeDescriptor(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.runtimeId === "string" &&
    /^[a-z][a-z0-9-]{1,63}$/.test(value.runtimeId) &&
    typeof value.displayName === "string" &&
    value.displayName.trim(),
  );
}

function normalizeRuntimeList(metadata) {
  const candidates = Array.isArray(metadata.runtimes)
    ? metadata.runtimes
    : metadata.runtimeId && metadata.displayName
      ? [{ runtimeId: metadata.runtimeId, displayName: metadata.displayName }]
      : [];
  const runtimes = candidates
    .slice(0, 64)
    .filter(validRuntimeDescriptor)
    .map((item) => ({
      runtimeId: item.runtimeId,
      displayName: item.displayName.trim().slice(0, 80),
      ...(typeof item.kind === "string" && item.kind.trim()
        ? { kind: item.kind.trim().slice(0, 128) }
        : {}),
      ...(typeof item.adapterId === "string" && item.adapterId.trim()
        ? { adapterId: item.adapterId.trim().slice(0, 128) }
        : {}),
      ...(typeof item.adapterVersion === "string" && item.adapterVersion.trim()
        ? { adapterVersion: item.adapterVersion.trim().slice(0, 64) }
        : {}),
      ...(typeof item.capabilityDigest === "string" &&
      /^sha256:[a-f0-9]{64}$/i.test(item.capabilityDigest)
        ? { capabilityDigest: item.capabilityDigest.toLowerCase() }
        : {}),
      ...(item.enabled === false ? { enabled: false } : {}),
    }));
  const seen = new Set();
  return runtimes.filter((item) => {
    if (seen.has(item.runtimeId)) return false;
    seen.add(item.runtimeId);
    return true;
  });
}

export function createCredentialStore(
  directory = defaultCredentialDirectory(),
  options = {},
) {
  const platform = options.platform || process.platform;
  const protect = options.protect || protectForCurrentWindowsUser;
  const unprotect = options.unprotect || unprotectForCurrentWindowsUser;
  const usesOsProtection = platform === "win32";
  const metadataPath = join(directory, "device.json");
  const privateKeyPath = join(directory, "device-key.pem");
  const pendingPath = join(directory, "pairing-pending.json");

  return {
    directory,
    metadataPath,
    privateKeyPath,
    pendingPath,
    load() {
      if (!existsSync(metadataPath) || !existsSync(privateKeyPath)) return null;
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      const privateKeyFile = readFileSync(privateKeyPath, "utf8");
      const privateKeyEnvelope = (() => {
        try {
          return JSON.parse(privateKeyFile);
        } catch {
          return null;
        }
      })();
      const privateKeyPem =
        usesOsProtection &&
        privateKeyEnvelope?.protection === "dpapi-current-user"
          ? unprotect(privateKeyEnvelope.ciphertext)
          : privateKeyFile;
      const deviceToken =
        usesOsProtection &&
        metadata.protectedDeviceToken?.protection === "dpapi-current-user"
          ? unprotect(metadata.protectedDeviceToken.ciphertext)
          : metadata.deviceToken;
      if (
        !metadata ||
        typeof metadata !== "object" ||
        typeof metadata.connectEndpoint !== "string" ||
        typeof metadata.deviceId !== "string" ||
        typeof metadata.publicKey !== "string" ||
        typeof deviceToken !== "string" ||
        !privateKeyPem.includes("PRIVATE KEY")
      ) {
        throw new Error("Connector credential file is invalid.");
      }
      const runtimes = normalizeRuntimeList(metadata);
      if (!runtimes.length)
        throw new Error("Connector Runtime list is invalid.");
      const result = {
        ...metadata,
        deviceToken,
        runtimeId: metadata.runtimeId || runtimes[0].runtimeId,
        displayName: metadata.displayName || runtimes[0].displayName,
        runtimes,
        privateKeyPem,
      };
      delete result.protectedDeviceToken;
      if (
        usesOsProtection &&
        (typeof metadata.deviceToken === "string" ||
          !privateKeyEnvelope ||
          privateKeyEnvelope.protection !== "dpapi-current-user")
      ) {
        this.save(result);
      }
      return result;
    },
    save(credentials) {
      const { privateKeyPem, ...metadata } = credentials;
      if (
        typeof privateKeyPem !== "string" ||
        !privateKeyPem.includes("PRIVATE KEY")
      ) {
        throw new Error("A private device key is required.");
      }
      const runtimes = normalizeRuntimeList(metadata);
      if (!runtimes.length)
        throw new Error("At least one Runtime is required.");
      atomicWrite(
        privateKeyPath,
        usesOsProtection
          ? `${JSON.stringify({
              schemaVersion: 1,
              protection: "dpapi-current-user",
              ciphertext: protect(privateKeyPem),
            })}\n`
          : privateKeyPem,
      );
      const persistedMetadata = { ...metadata };
      if (usesOsProtection) {
        persistedMetadata.protectedDeviceToken = {
          schemaVersion: 1,
          protection: "dpapi-current-user",
          ciphertext: protect(metadata.deviceToken),
        };
        delete persistedMetadata.deviceToken;
      }
      atomicWrite(
        metadataPath,
        `${JSON.stringify(
          {
            ...persistedMetadata,
            schemaVersion: usesOsProtection ? 3 : 2,
            runtimeId: metadata.runtimeId || runtimes[0].runtimeId,
            displayName: metadata.displayName || runtimes[0].displayName,
            runtimes,
          },
          null,
        )}\n`,
      );
    },
    loadPending() {
      if (!existsSync(pendingPath)) return null;
      const persisted = JSON.parse(readFileSync(pendingPath, "utf8"));
      const pending =
        usesOsProtection && persisted?.protection === "dpapi-current-user"
          ? JSON.parse(unprotect(persisted.ciphertext))
          : persisted;
      if (
        !pending ||
        typeof pending !== "object" ||
        typeof pending.requestToken !== "string" ||
        typeof pending.sessionId !== "string" ||
        typeof pending.privateKeyPem !== "string"
      ) {
        throw new Error("Pending Connector pairing file is invalid.");
      }
      if (usesOsProtection && persisted?.protection !== "dpapi-current-user") {
        this.savePending(pending);
      }
      return pending;
    },
    savePending(pending) {
      if (
        !pending ||
        typeof pending.requestToken !== "string" ||
        typeof pending.sessionId !== "string" ||
        typeof pending.privateKeyPem !== "string"
      ) {
        throw new Error("Pending Connector pairing is invalid.");
      }
      atomicWrite(
        pendingPath,
        usesOsProtection
          ? `${JSON.stringify(
              {
                schemaVersion: 1,
                protection: "dpapi-current-user",
                ciphertext: protect(JSON.stringify(pending)),
              },
              null,
              2,
            )}\n`
          : `${JSON.stringify(pending, null, 2)}\n`,
      );
    },
    clearPending() {
      if (existsSync(pendingPath)) {
        unlinkSync(pendingPath);
      }
    },
    markRevoked() {
      const current = this.load();
      if (!current) return false;
      this.save({ ...current, status: "revoked", revokedAt: Date.now() });
      return true;
    },
    listRuntimes() {
      return this.load()?.runtimes || [];
    },
    registerRuntime(runtime) {
      if (!validRuntimeDescriptor(runtime))
        throw new Error("Runtime descriptor is invalid.");
      const current = this.load();
      if (!current) throw new Error("No paired Connector was found.");
      if (current.runtimes.some((item) => item.runtimeId === runtime.runtimeId))
        throw new Error(`Runtime is already registered: ${runtime.runtimeId}`);
      const next = normalizeRuntimeList({
        runtimes: [...current.runtimes, runtime],
      });
      this.save({ ...current, runtimes: next });
      return this.load().runtimes.find(
        (item) => item.runtimeId === runtime.runtimeId,
      );
    },
    updateRuntime(runtimeId, patch) {
      const current = this.load();
      if (!current) throw new Error("No paired Connector was found.");
      const index = current.runtimes.findIndex(
        (item) => item.runtimeId === runtimeId,
      );
      if (index < 0) throw new Error(`Runtime is not registered: ${runtimeId}`);
      const next = [...current.runtimes];
      next[index] = { ...next[index], ...patch, runtimeId };
      if (!validRuntimeDescriptor(next[index]))
        throw new Error("Runtime descriptor is invalid.");
      this.save({
        ...current,
        runtimeId:
          current.runtimeId === runtimeId ? runtimeId : current.runtimeId,
        displayName:
          current.runtimeId === runtimeId
            ? next[index].displayName
            : current.displayName,
        runtimes: next,
      });
      return this.load().runtimes.find((item) => item.runtimeId === runtimeId);
    },
    removeRuntime(runtimeId) {
      const current = this.load();
      if (!current) throw new Error("No paired Connector was found.");
      const next = current.runtimes.filter(
        (item) => item.runtimeId !== runtimeId,
      );
      if (next.length === current.runtimes.length)
        throw new Error(`Runtime is not registered: ${runtimeId}`);
      if (!next.length) throw new Error("At least one Runtime must remain.");
      this.save({
        ...current,
        runtimeId:
          current.runtimeId === runtimeId
            ? next[0].runtimeId
            : current.runtimeId,
        displayName:
          current.runtimeId === runtimeId
            ? next[0].displayName
            : current.displayName,
        runtimes: next,
      });
      return next;
    },
  };
}
