import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Wait for Chromium's Windows OS-crypt key metadata before confirming a new secret. */
export async function waitForWindowsSecretMetadata(
  userData: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 20000;
  const pollMs = options.pollMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  const path = join(userData, "Local State");
  while (Date.now() <= deadline) {
    try {
      const metadata = await stat(path);
      if (metadata.isFile() && metadata.size <= 2 * 1024 * 1024) {
        const value: unknown = JSON.parse(await readFile(path, "utf8"));
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const crypt = (value as Record<string, unknown>).os_crypt;
          if (crypt && typeof crypt === "object" && !Array.isArray(crypt)) {
            const key = (crypt as Record<string, unknown>).encrypted_key;
            if (typeof key === "string" && key.length > 8) return;
          }
        }
      }
    } catch {
      // Chromium may still be creating or atomically replacing the file.
    }
    if (Date.now() >= deadline) break;
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error("系统凭据保护尚未完成持久化，请稍候重试保存。");
}
