import { randomUUID } from "node:crypto";
import { getActiveProfileNameSync } from "../utils";
import { assertAgentsOneWritesAllowed } from "../restore-write-lock";
import {
  discoverClosedProjectWrites,
  type WriteRecoveryCapability,
} from "./closed-project-write";
import type {
  MobileWriteRecoveryCommand,
  MobileWriteRecoveryItem,
  MobileWriteRecoveryStatus,
} from "../../shared/mobile-write-recovery";
interface Entry {
  id: string;
  profile: string;
  runId: string;
  projectId: string;
  localId: string;
  path: string;
  runner: WriteRecoveryCapability;
  restarted?: true;
}
const entries = new Map<string, Entry>();
const overflow = new Set<string>();
function fail(code: string): never {
  throw Object.assign(Error(code), { code });
}
/** Main's observed closed worker creates the recovery capability. */
export function registerRetainedProjectWrite(input: Omit<Entry, "id">): void {
  if (
    [...entries.values()].some(
      (e) =>
        e.profile === input.profile &&
        e.runId === input.runId &&
        e.localId === input.localId,
    )
  )
    return;
  if (entries.size >= 128) {
    overflow.add(input.profile);
    return;
  }
  const id = `recovery-${randomUUID()}`;
  entries.set(id, { ...input, id });
}
export async function manageMobileWriteRecovery(
  profile: string | undefined,
  command: MobileWriteRecoveryCommand,
  assertCaller: () => void,
): Promise<MobileWriteRecoveryStatus> {
  const selected = profile || getActiveProfileNameSync();
  const guard = (): void => {
    assertCaller();
    if (selected !== getActiveProfileNameSync()) fail("profile_inactive");
    assertAgentsOneWritesAllowed();
  };
  guard();
  if (
    !command ||
    typeof command !== "object" ||
    Array.isArray(command) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(command))
  )
    fail("invalid_input");
  const discovered = discoverClosedProjectWrites(
    selected,
    new Set(
      [...entries.values()]
        .filter((e) => e.profile === selected)
        .map((e) => e.projectId),
    ),
  );
  for (const entry of discovered.entries) registerRetainedProjectWrite(entry);
  const fields = Object.keys(command).sort().join(",");
  if (
    command.action === "status"
      ? fields !== "action"
      : command.action !== "release" ||
        fields !== "acknowledged,action,id,reviewToken" ||
        command.acknowledged !== true ||
        !/^recovery-[a-f0-9-]{36}$/.test(command.id) ||
        !/^[a-f0-9]{64}$/.test(command.reviewToken)
  )
    fail("invalid_input");
  const { getAgentRuntimeRun } = await import("../agent-runtimes");
  async function terminal(
    entry: Entry,
  ): Promise<"run_active" | "run_unavailable" | undefined> {
    guard();
    if (entry.restarted) return undefined;
    const run = await getAgentRuntimeRun(entry.runId);
    guard();
    return !run || run.id !== entry.runId
      ? "run_unavailable"
      : run.status === "running"
        ? "run_active"
        : undefined;
  }
  if (command.action === "release") {
    const entry = entries.get(command.id);
    if (!entry || entry.profile !== selected) fail("resource_not_found");
    const restriction = await terminal(entry);
    if (restriction) fail(restriction);
    guard();
    await entry.runner.releaseRetainedWrite(
      entry.localId,
      command.reviewToken,
      true,
      guard,
    );
    entries.delete(entry.id);
  }
  const items: MobileWriteRecoveryItem[] = [];
  for (const entry of entries.values()) {
    if (entry.profile !== selected) continue;
    const restriction = await terminal(entry);
    let item: MobileWriteRecoveryItem = {
      id: entry.id,
      runId: entry.runId,
      projectId: entry.projectId,
      path: entry.path,
      state: "blocked",
      restrictionReason: restriction ?? "requires_owner_action",
    };
    if (!restriction) {
      try {
        const review = (await entry.runner.reviewRetainedWrites()).find(
          (r) => r.id === entry.localId,
        );
        if (review)
          item = {
            ...item,
            state: review.state,
            reviewToken: review.reviewToken,
            restrictionReason: undefined,
          };
      } catch {
        /* Changed project authority and unknown locks remain visibly blocked. */
      }
    }
    guard();
    items.push(item);
  }
  guard();
  return {
    items: [...items, ...discovered.blocked],
    capacityExceeded: overflow.has(selected),
  };
}
