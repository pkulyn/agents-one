import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
export async function withFrozenBackupArchive<T>(
  source: string,
  consume: (snapshot: { path: string; sha256: string }) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(
    join(tmpdir(), "agents-one-approved-backup-"),
  );
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith("agents-one-approved-backup-")
  )
    throw Error("unsafe_backup_cleanup_path");
  try {
    const target = join(directory, "approved.agents-one-backup");
    const input = await open(source, "r");
    try {
      const before = await input.stat({ bigint: true });
      if (!before.isFile() || before.size > BigInt(MAX_BYTES))
        throw Error("invalid_backup_size");
      const output = await open(target, "wx", 0o600);
      const hash = createHash("sha256");
      let total = 0;
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        for (;;) {
          const { bytesRead } = await input.read(
            buffer,
            0,
            Math.min(buffer.length, MAX_BYTES - total + 1),
            null,
          );
          if (!bytesRead) break;
          total += bytesRead;
          if (total > MAX_BYTES) throw Error("invalid_backup_size");
          const bytes = buffer.subarray(0, bytesRead);
          hash.update(bytes);
          let written = 0;
          while (written < bytes.length) {
            const result = await output.write(
              bytes,
              written,
              bytes.length - written,
              null,
            );
            if (!result.bytesWritten)
              throw Error("backup_snapshot_write_failed");
            written += result.bytesWritten;
          }
        }
        await output.sync();
      } finally {
        await output.close();
      }
      const after = await input.stat({ bigint: true });
      if (
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs ||
        BigInt(total) !== before.size
      )
        throw Error("backup_changed_during_snapshot");
      return await consume({ path: target, sha256: hash.digest("hex") });
    } finally {
      await input.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
