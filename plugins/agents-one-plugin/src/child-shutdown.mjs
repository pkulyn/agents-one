/** A kill request is not evidence that process handles have closed. */
export function createChildShutdown(
  child,
  { killAfterMs = 1500, timeoutMs = 5000 } = {},
) {
  let closed = false;
  let resolveClosed;
  const completion = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  child.once("close", () => {
    closed = true;
    resolveClosed();
  });
  let shutdown;
  return () => {
    if (shutdown) return shutdown;
    shutdown = (async () => {
      if (closed) return;
      let escalation, deadline;
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        escalation = setTimeout(() => {
          if (!closed) {
            try {
              child.kill("SIGKILL");
            } catch {
              /* The deadline reports unconfirmed teardown. */
            }
          }
        }, killAfterMs);
        await Promise.race([
          completion,
          new Promise((_, reject) => {
            deadline = setTimeout(
              () => reject(Error("OpenCode ACP process shutdown timed out.")),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(escalation);
        clearTimeout(deadline);
      }
    })();
    return shutdown;
  };
}
