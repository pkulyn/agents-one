/** Connect native Hermes approval events to a single live SDK Run. */
export function createHermesApprovalForwarder({ respond, stop }) {
  const runs = new Map();
  const validId = (value) =>
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
  const revoke = (id) => {
    const run = runs.get(id);
    if (run) run.active = false;
    runs.delete(id);
  };
  const fail = async (id, run) => {
    if (!run.active) return;
    revoke(id);
    await stop({ vendorRunId: run.vendorRunId, runtimeId: run.runtimeId });
  };
  return {
    bind(id, { vendorRunId, runtimeId }, authorizeTool) {
      if (
        !validId(id) ||
        !validId(vendorRunId) ||
        !validId(runtimeId) ||
        typeof authorizeTool !== "function"
      )
        throw Error("Invalid Hermes approval binding");
      if (
        runs.has(id) ||
        [...runs.values()].some(
          (r) => r.vendorRunId === vendorRunId && r.runtimeId === runtimeId,
        )
      )
        throw Error("Hermes approval Run is already bound");
      runs.set(id, {
        vendorRunId,
        runtimeId,
        authorizeTool,
        active: true,
        seen: new Map(),
        pending: null,
      });
    },
    revoke,
    async forward(id, event) {
      const run = runs.get(id);
      if (!run?.active) return false;
      const requestId = event?.approvalRequestId;
      const command = event?.command;
      if (
        !validId(requestId) ||
        typeof command !== "string" ||
        !command.trim() ||
        Buffer.byteLength(command) > 256 * 1024
      ) {
        await fail(id, run);
        return false;
      }
      if (run.seen.has(requestId)) {
        if (run.seen.get(requestId) !== command) await fail(id, run);
        return false;
      }
      if (run.pending) {
        // The legacy native response endpoint cannot distinguish concurrent approvals.
        await fail(id, run);
        return false;
      }
      run.seen.set(requestId, command);
      if (run.seen.size > 256) run.seen.delete(run.seen.keys().next().value);
      const ticket = {};
      run.pending = ticket;
      try {
        const allowed = await run.authorizeTool("terminal", {
          command,
          kind: "execute",
        });
        if (!run.active || runs.get(id) !== run || run.pending !== ticket)
          return false;
        await respond({
          vendorRunId: run.vendorRunId,
          runtimeId: run.runtimeId,
          approvalRequestId: requestId,
          allowed: allowed === true,
        });
        return true;
      } catch {
        await fail(id, run);
        return false;
      } finally {
        if (run.pending === ticket) run.pending = null;
      }
    },
  };
}
