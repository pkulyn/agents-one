let restoreWriteLockDepth = 0;

/** Freeze ordinary desktop persistence while a restore replaces its stores. */
export function beginAgentsOneRestoreWriteLock(): void {
  restoreWriteLockDepth += 1;
}

/** Release the short-lived export lock; restore deliberately never calls it. */
export function endAgentsOneTemporaryWriteLock(): void {
  restoreWriteLockDepth = Math.max(0, restoreWriteLockDepth - 1);
}

export function isAgentsOneRestoreWriteLocked(): boolean {
  return restoreWriteLockDepth > 0;
}

export function assertAgentsOneWritesAllowed(): void {
  if (restoreWriteLockDepth > 0) {
    throw new Error("Agents One 正在恢复备份并即将重启，当前写入已暂停。");
  }
}
