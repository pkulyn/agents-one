import { describe, expect, it } from "vitest";
import {
  runtimeIsolationInfo,
  runtimeSteeringPlan,
  unattendedRuntimePreflight,
} from "../src/shared/agent-runtimes";
import {
  conversationEntryMeta,
  isModelContextEntry,
} from "../src/shared/runtime-conversations";

describe("runtime governance contracts", () => {
  it("does not describe a worktree as a system sandbox", () => {
    const info = runtimeIsolationInfo(
      { location: "local" },
      { mode: "implementation", worktreeId: "w1" },
    );
    expect(info.level).toBe("worktree");
    expect(info.summary).toContain("共享宿主系统");
  });

  it("blocks unattended full host access and requires confirmation for cancel-resume steering", () => {
    const info = runtimeIsolationInfo(
      { location: "local" },
      { mode: "full_access" },
    );
    expect(
      unattendedRuntimePreflight(info, { mode: "full_access" }).allowed,
    ).toBe(false);
    expect(
      runtimeSteeringPlan({ steering: "cancel_resume", cancellation: true }),
    ).toEqual({ kind: "cancel_resume", confirmationRequired: true });
  });

  it("excludes platform audit entries from model context while keeping legacy user entries", () => {
    const platform = {
      role: "system" as const,
      controlAudit: { requestId: "x" },
    };
    expect(conversationEntryMeta(platform).audience).not.toContain("model");
    expect(
      isModelContextEntry({
        id: "u",
        role: "user",
        content: "hello",
        createdAt: 1,
      }),
    ).toBe(true);
  });
});
