import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  profile: "owner",
  locked: false,
  getRun: vi.fn(),
}));
vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => state.profile,
}));
vi.mock("../src/main/restore-write-lock", () => ({
  assertAgentsOneWritesAllowed: () => {
    if (state.locked) throw Error("restore_write_locked");
  },
}));
vi.mock("../src/main/agent-runtimes", () => ({
  getAgentRuntimeRun: state.getRun,
}));
vi.mock("../src/main/mobile-control/closed-project-write", () => ({
  discoverClosedProjectWrites: () => ({ entries: [], blocked: [] }),
}));
import type { ProjectWriteRunner } from "../src/main/mobile-control/project-write-runner";
beforeEach(() => {
  vi.resetModules();
  state.profile = "owner";
  state.locked = false;
  state.getRun
    .mockReset()
    .mockResolvedValue({ id: "run-one", status: "failed" });
});
async function fixture(): Promise<{
  api: typeof import("../src/main/mobile-control/project-write-recovery");
  release: ReturnType<typeof vi.fn>;
  review: ReturnType<typeof vi.fn>;
}> {
  const api = await import("../src/main/mobile-control/project-write-recovery");
  const release = vi.fn(async (_id, _token, _ack, guard) => guard());
  const review = vi.fn(async () => [
    {
      id: "local-one",
      path: "file.txt",
      state: "changed",
      reviewToken: "a".repeat(64),
    },
  ]);
  const runner = {
    releaseRetainedWrite: release,
    reviewRetainedWrites: review,
  } as unknown as ProjectWriteRunner;
  api.registerRetainedProjectWrite({
    profile: "owner",
    runId: "run-one",
    projectId: "project-one",
    localId: "local-one",
    path: "file.txt",
    runner,
  });
  return { api, release, review };
}
it("binds terminal Run/profile and explicit release to the Main capability, never to arbitrary paths", async () => {
  const { api, release } = await fixture();
  const caller = vi.fn();
  const status = await api.manageMobileWriteRecovery(
    "owner",
    { action: "status" },
    caller,
  );
  const item = status.items[0];
  expect(item).toMatchObject({
    runId: "run-one",
    projectId: "project-one",
    path: "file.txt",
    state: "changed",
  });
  await expect(
    api.manageMobileWriteRecovery(
      "owner",
      {
        action: "release",
        id: item.id,
        reviewToken: item.reviewToken!,
        acknowledged: true,
        path: "arbitrary",
      } as never,
      caller,
    ),
  ).rejects.toThrow("invalid_input");
  state.getRun.mockResolvedValue({ id: "run-one", status: "running" });
  const active = await api.manageMobileWriteRecovery(
    "owner",
    { action: "status" },
    caller,
  );
  expect(active.items[0]).toMatchObject({
    state: "blocked",
    restrictionReason: "run_active",
  });
  await expect(
    api.manageMobileWriteRecovery(
      "owner",
      {
        action: "release",
        id: item.id,
        reviewToken: item.reviewToken!,
        acknowledged: true,
      },
      caller,
    ),
  ).rejects.toThrow("run_active");
  expect(release).not.toHaveBeenCalled();
  state.getRun.mockResolvedValue({ id: "run-one", status: "failed" });
  const final = await api.manageMobileWriteRecovery(
    "owner",
    {
      action: "release",
      id: item.id,
      reviewToken: item.reviewToken!,
      acknowledged: true,
    },
    caller,
  );
  expect(release).toHaveBeenCalledWith(
    "local-one",
    "a".repeat(64),
    true,
    expect.any(Function),
  );
  expect(final.items).toEqual([]);
});
it("rejects profile changes after Run lookup, lost frame authority and restored data before release", async () => {
  const { api, release } = await fixture();
  const item = (
    await api.manageMobileWriteRecovery(
      "owner",
      { action: "status" },
      () => undefined,
    )
  ).items[0];
  const command = {
    action: "release" as const,
    id: item.id,
    reviewToken: item.reviewToken!,
    acknowledged: true as const,
  };
  state.locked = true;
  await expect(
    api.manageMobileWriteRecovery("owner", command, () => undefined),
  ).rejects.toThrow("restore_write_locked");
  state.locked = false;
  state.getRun.mockImplementationOnce(async () => {
    state.profile = "other";
    return { id: "run-one", status: "failed" };
  });
  await expect(
    api.manageMobileWriteRecovery("owner", command, () => undefined),
  ).rejects.toThrow("profile_inactive");
  state.profile = "owner";
  let permitted = true;
  state.getRun.mockImplementationOnce(async () => {
    permitted = false;
    return { id: "run-one", status: "failed" };
  });
  await expect(
    api.manageMobileWriteRecovery("owner", command, () => {
      if (!permitted) throw Error("scope_denied");
    }),
  ).rejects.toThrow("scope_denied");
  expect(release).not.toHaveBeenCalled();
});
