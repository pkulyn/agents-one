import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname } from "path";

export interface DesktopSecretProtector {
  available: boolean;
  backend: string;
  warning?: string;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

interface ProtectedSecretRecord {
  ciphertext: string;
  previousCiphertext?: string;
  updatedAt: number;
  migratedFrom?: "env";
}

interface ProtectedSecretFile {
  schemaVersion: 1;
  records: Record<string, ProtectedSecretRecord>;
}

export interface DesktopSecretStatus {
  protection: "os-protected" | "legacy-fallback" | "unavailable";
  backend: string;
  warning?: string;
  unreadable?: boolean;
}

let activeStore: DesktopSecretStore | undefined;

function emptyFile(): ProtectedSecretFile {
  return { schemaVersion: 1, records: {} };
}

function validFile(value: unknown): value is ProtectedSecretFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProtectedSecretFile>;
  return (
    candidate.schemaVersion === 1 &&
    Boolean(candidate.records) &&
    typeof candidate.records === "object"
  );
}

/** OS-protected storage for secrets entered and managed by the desktop UI. */
export class DesktopSecretStore {
  constructor(
    readonly filePath: string,
    readonly protector: DesktopSecretProtector,
  ) {}

  private readFile(): ProtectedSecretFile {
    if (!existsSync(this.filePath)) return emptyFile();
    const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (!validFile(parsed))
      throw new Error("Protected secret store is invalid.");
    return parsed;
  }

  private writeFile(data: ProtectedSecretFile): void {
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(directory, 0o700);
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      if (process.platform !== "win32") chmodSync(temporary, 0o600);
      renameSync(temporary, this.filePath);
      if (process.platform !== "win32") chmodSync(this.filePath, 0o600);
    } catch (error) {
      try {
        if (existsSync(temporary)) unlinkSync(temporary);
      } catch {
        // Preserve the original write error.
      }
      throw error;
    }
  }

  status(key?: string): DesktopSecretStatus {
    if (!this.protector.available) {
      let hasProtectedRecord = false;
      if (key) {
        try {
          hasProtectedRecord = Boolean(this.readFile().records[key]);
        } catch {
          hasProtectedRecord = true;
        }
      }
      if (hasProtectedRecord) {
        return {
          protection: "unavailable",
          backend: this.protector.backend,
          warning:
            this.protector.warning ||
            "The operating-system credential backend is unavailable. Restore it or re-enter the credential.",
          unreadable: true,
        };
      }
      return {
        protection: "legacy-fallback",
        backend: this.protector.backend,
        warning: this.protector.warning,
      };
    }
    if (key) {
      try {
        const record = this.readFile().records[key];
        if (record)
          this.protector.decrypt(Buffer.from(record.ciphertext, "base64"));
      } catch {
        return {
          protection: "unavailable",
          backend: this.protector.backend,
          warning:
            "The saved credential cannot be decrypted for this user or machine. Re-enter it to continue.",
          unreadable: true,
        };
      }
    }
    return { protection: "os-protected", backend: this.protector.backend };
  }

  get(
    key: string,
    legacy: { read(): string | null; remove(): void },
  ): string | null {
    let data: ProtectedSecretFile;
    try {
      data = this.readFile();
    } catch {
      return legacy.read();
    }
    const record = data.records[key];
    if (record && this.protector.available) {
      try {
        return this.protector.decrypt(Buffer.from(record.ciphertext, "base64"));
      } catch {
        if (record.previousCiphertext) {
          try {
            const recovered = this.protector.decrypt(
              Buffer.from(record.previousCiphertext, "base64"),
            );
            data.records[key] = {
              ciphertext: record.previousCiphertext,
              updatedAt: Date.now(),
            };
            this.writeFile(data);
            return recovered;
          } catch {
            // A different user/machine cannot decrypt either generation.
          }
        }
        return legacy.read();
      }
    }

    const oldValue = legacy.read();
    if (!oldValue || !this.protector.available) return oldValue;
    try {
      this.set(key, oldValue, legacy, "env");
    } catch {
      // Migration is best-effort on read. The legacy value remains readable
      // if protected persistence or plaintext cleanup fails.
    }
    return oldValue;
  }

  set(
    key: string,
    value: string,
    legacy: { read(): string | null; remove(): void },
    migratedFrom?: "env",
  ): DesktopSecretStatus {
    if (!this.protector.available) {
      return this.status(key);
    }
    let data: ProtectedSecretFile;
    try {
      data = this.readFile();
    } catch {
      // Preserve a malformed file for manual recovery before accepting a new
      // credential. Re-entry must repair the app instead of deadlocking it.
      if (existsSync(this.filePath)) {
        renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      }
      data = emptyFile();
    }
    const prior = data.records[key];
    const ciphertext = this.protector.encrypt(value).toString("base64");
    if (this.protector.decrypt(Buffer.from(ciphertext, "base64")) !== value) {
      throw new Error("Protected secret verification failed.");
    }
    data.records[key] = {
      ciphertext,
      ...(prior?.ciphertext ? { previousCiphertext: prior.ciphertext } : {}),
      updatedAt: Date.now(),
      ...(migratedFrom ? { migratedFrom } : {}),
    };
    this.writeFile(data);
    // Delete plaintext only after the protected copy was atomically persisted
    // and verified. If deletion fails, the protected copy remains valid and
    // the caller receives the failure instead of silently losing the old value.
    legacy.remove();
    return this.status(key);
  }
}

export function configureDesktopSecretStore(store: DesktopSecretStore): void {
  activeStore = store;
}

export function desktopSecretStore(): DesktopSecretStore | undefined {
  return activeStore;
}
