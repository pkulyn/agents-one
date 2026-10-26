import { describe, expect, it, vi } from "vitest";
import {
  DesktopTaskSelectionCatalog,
  desktopTaskInput,
} from "../src/main/mobile-control/desktop-task-selection";
import type { AgentRuntimeDefinition } from "../src/shared/agent-runtimes";
import type { DesktopExecutionPolicyCatalog } from "../src/main/mobile-control/desktop-execution";

const runtime = (
  id: string,
  kind: AgentRuntimeDefinition["kind"] = "codex",
): AgentRuntimeDefinition => ({
  id,
  name: id,
  kind,
  enabled: true,
  managed: "user",
  location: "local",
  config: { model: "original-model" },
});
type Fixture = {
  runtimes: AgentRuntimeDefinition[];
  projects: { id: string; identity: string }[];
  legacy: DesktopExecutionPolicyCatalog;
  source: {
    guard: ReturnType<typeof vi.fn>;
    runtimes(): AgentRuntimeDefinition[];
    projects(): { id: string; identity: string }[];
  };
  catalog: DesktopTaskSelectionCatalog;
};
function fixture(): Fixture {
  const runtimes = [runtime("codex-1"), runtime("claude-1", "claude-code")];
  const projects = [{ id: "project-1", identity: "private-original-root" }];
  const legacy: DesktopExecutionPolicyCatalog = {
    list: vi.fn(() => []),
    authorize: vi.fn(() => {
      throw Error("old-proof-required");
    }),
  };
  const source = {
    guard: vi.fn(),
    runtimes: () => runtimes,
    projects: () => projects,
  };
  const catalog = new DesktopTaskSelectionCatalog(source, legacy);
  return { runtimes, projects, legacy, source, catalog };
}
describe("desktop task-time selections", () => {
  it("offers all configured agents and independent project/mode choices without storing approvals", () => {
    const value = fixture(),
      before = JSON.stringify(value.runtimes);
    const policies = value.catalog.list();
    expect(policies).toHaveLength(12);
    for (const runtime of value.runtimes) {
      expect(
        policies
          .filter((row) => row.runtimeId === runtime.id)
          .map((row) => [row.projectId, row.mode]),
      ).toEqual([
        [undefined, "desktop_analysis"],
        [undefined, "desktop_auto"],
        [undefined, "desktop_full_access"],
        ["project-1", "desktop_analysis"],
        ["project-1", "desktop_auto"],
        ["project-1", "desktop_full_access"],
      ]);
    }
    expect(
      policies
        .filter((row) => row.mode !== "desktop_full_access")
        .every((row) => row.enforced && row.unattendedApproved),
    ).toBe(true);
    expect(
      policies
        .filter((row) => row.mode === "desktop_full_access")
        .every((row) => row.enforced && !row.unattendedApproved),
    ).toBe(true);
    expect(
      policies.every((row) => /^desktop-task-[a-f0-9]{64}$/.test(row.id)),
    ).toBe(true);
    expect(JSON.stringify(policies)).not.toContain("private-original-root");
    expect(JSON.stringify(value.runtimes)).toBe(before);
    expect(value.legacy.authorize).not.toHaveBeenCalled();
  });
  it("invalidates selected identities on runtime configuration or project identity changes", () => {
    const value = fixture(),
      selected = value.catalog
        .list()
        .find((row) => row.mode === "desktop_auto" && row.projectId)!;
    expect(value.catalog.authorize(selected.id)).toEqual(selected);
    value.runtimes[0].name = "Renamed";
    expect(value.catalog.authorize(selected.id).id).toBe(selected.id);
    value.projects[0].identity = "replaced-root";
    expect(() => value.catalog.authorize(selected.id)).toThrow(
      "unverified_policy",
    );
    const next = value.catalog
      .list()
      .find((row) => row.mode === "desktop_auto" && row.projectId)!;
    value.runtimes[0].config.model = "changed-model";
    expect(() => value.catalog.authorize(next.id)).toThrow("unverified_policy");
  });
  it("authorizes projectless automatic and explicitly confirmed full access without assigning a project", () => {
    const value = fixture();
    const automatic = value.catalog
      .list()
      .find(
        (row) =>
          row.runtimeId === "codex-1" &&
          !row.projectId &&
          row.mode === "desktop_auto",
      )!;
    const fullAccess = value.catalog
      .list()
      .find(
        (row) =>
          row.runtimeId === "codex-1" &&
          !row.projectId &&
          row.mode === "desktop_full_access",
      )!;
    expect(value.catalog.authorize(automatic.id)).toMatchObject({
      projectId: undefined,
      mode: "desktop_auto",
    });
    expect(value.catalog.authorize(fullAccess.id)).toMatchObject({
      projectId: undefined,
      mode: "desktop_full_access",
      unattendedApproved: false,
    });
    expect(
      desktopTaskInput("desktop_analysis", runtime("codex-1"), undefined),
    ).toEqual({ mode: "analysis" });
    expect(
      desktopTaskInput("desktop_auto", runtime("codex-1"), undefined),
    ).toEqual({ mode: "safe_write" });
    expect(
      desktopTaskInput("desktop_full_access", runtime("codex-1"), undefined),
    ).toEqual({ mode: "full_access", fullAccessConfirmed: true });
  });
  it("refuses disabled, removed, reauthorization and inactive sources", () => {
    const value = fixture(),
      selected = value.catalog.list()[0];
    value.runtimes[0].enabled = false;
    expect(() => value.catalog.authorize(selected.id)).toThrow(
      "unverified_policy",
    );
    value.runtimes[0].enabled = true;
    value.runtimes[0].needsReauthorization = true;
    expect(() => value.catalog.authorize(selected.id)).toThrow(
      "unverified_policy",
    );
    value.runtimes.shift();
    expect(() => value.catalog.authorize(selected.id)).toThrow(
      "unverified_policy",
    );
    value.source.guard.mockImplementation(() => {
      throw Error("profile_inactive");
    });
    expect(() => value.catalog.list()).toThrow("profile_inactive");
  });
  it("continues to delegate old identifiers to their original proof checks", () => {
    const value = fixture();
    expect(() => value.catalog.authorize("policy-original")).toThrow(
      "old-proof-required",
    );
    expect(value.legacy.authorize).toHaveBeenCalledWith("policy-original");
    expect(() => value.catalog.authorize("desktop-task-forged")).toThrow(
      "unverified_policy",
    );
  });
});
