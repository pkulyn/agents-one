import { describe, expect, it, vi } from "vitest";
import {
  DesktopMobileCatalog,
  type DesktopCatalogSource,
} from "../src/main/mobile-control/desktop-catalog";
import type { EnforcedDesktopExecutionPolicy } from "../src/main/mobile-control/desktop-execution";
import type { AgentRuntimeDefinition } from "../src/shared/agent-runtimes";
import type { OwnerExecutionBackend } from "../src/main/mobile-control/execution-types";

function fixture(): {
  now: number;
  runtime: AgentRuntimeDefinition;
  policy: EnforcedDesktopExecutionPolicy & { unattendedApproved: boolean };
  authorize: ReturnType<typeof vi.fn<OwnerExecutionBackend["authorize"]>>;
  backend: OwnerExecutionBackend;
  source: DesktopCatalogSource;
  catalog: DesktopMobileCatalog;
} {
  const now = 1791158400000;
  const runtime: AgentRuntimeDefinition = {
    id: "runtime-1",
    name: "User runtime",
    kind: "codex",
    location: "local",
    enabled: true,
    managed: "user",
    color: "#F37021",
    avatar: "data:image/png;base64,c2VjcmV0",
    authRef: "private-auth-reference",
    config: {
      executablePath: "D:/private/codex.exe",
      endpoint: "https://private.example",
    },
    lastProbe: { state: "healthy", checkedAt: now - 1000 },
  };
  const policy = {
    id: "policy-1",
    runtimeId: runtime.id,
    projectId: "project-1",
    mode: "project_write" as const,
    enforced: true,
    runtimeConfigurationHash: "private-configuration-hash",
    workspaceRef: "private-workspace",
    unattendedApproved: true,
  };
  const authorize = vi.fn<OwnerExecutionBackend["authorize"]>(
    (policyId: string, runtimeId: string, projectId: string | undefined) => ({
      policyId,
      runtime: { ...runtime, id: runtimeId },
      projectId,
      task: { mode: "safe_write" as const, workspaceId: projectId },
    }),
  );
  const backend: OwnerExecutionBackend = {
    authorize,
    start: vi.fn(),
    get: vi.fn(),
    cancel: vi.fn(),
  };
  const source = {
    runtimes: () => [runtime],
    projects: () => [
      { id: "project-1", name: "Original project", path: "D:/private/project" },
    ],
    policies: () => [policy],
  };
  return {
    now,
    runtime,
    policy,
    authorize,
    backend,
    source,
    catalog: new DesktopMobileCatalog(source, backend, () => now),
  };
}
describe("desktop public mobile catalog", () => {
  it("advertises an opaque image reference and serves only the current original runtime image without modifying configuration", () => {
    const value = fixture();
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8XKD4n4GBgYGJAQoAJzoChzU5gKEAAAAASUVORK5CYII=";
    value.runtime.avatar = `data:image/png;base64,${png}`;
    const original = JSON.stringify(value.runtime);
    const row = value.catalog.snapshot().runtimes[0];
    expect(row).toMatchObject({ name: value.runtime.name, color: "#F37021" });
    expect(row.avatar).toMatch(/^ava-[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(png);
    expect(
      value.catalog.avatar(value.runtime.id, String(row.avatar)),
    ).toMatchObject({
      runtimeId: value.runtime.id,
      id: row.avatar,
      base64: png,
    });
    expect(JSON.stringify(value.runtime)).toBe(original);
    expect(() => value.catalog.avatar("missing", String(row.avatar))).toThrow(
      "resource_not_found",
    );
    value.runtime.avatar = undefined;
    expect(() =>
      value.catalog.avatar(value.runtime.id, String(row.avatar)),
    ).toThrow("resource_not_found");
    expect(value.catalog.snapshot().runtimes[0].allowedActions).toEqual(
      row.allowedActions,
    );
    value.source.runtimes = () => [value.runtime, value.runtime];
    expect(() =>
      value.catalog.avatar(value.runtime.id, String(row.avatar)),
    ).toThrow("requires_owner_action");
    expect(value.backend.start).not.toHaveBeenCalled();
  });
  it("retains original IDs and names while omitting config, paths, secret references and raw avatar bytes", () => {
    const value = fixture();
    const snapshot = value.catalog.snapshot();
    expect(snapshot.runtimes[0]).toMatchObject({
      id: "runtime-1",
      name: "User runtime",
      category: "local",
      healthy: true,
      avatar: null,
      allowedActions: ["read", "create", "advance"],
    });
    expect(snapshot.projects[0]).toEqual({
      id: "project-1",
      name: "Original project",
      allowedExecutionPolicyIds: ["policy-1"],
    });
    expect(snapshot.policies[0]).toMatchObject({
      id: "policy-1",
      enforced: true,
      unattendedApproved: true,
      allowedActions: ["create", "advance", "trigger"],
    });
    const bytes = JSON.stringify(snapshot);
    for (const secret of [
      "private",
      "configuration-hash",
      "c2VjcmV0",
      "authRef",
      "endpoint",
      "executablePath",
    ])
      expect(bytes).not.toContain(secret);
    expect(value.backend.start).not.toHaveBeenCalled();
  });
  it("removes executable actions when trusted policy authorization fails or disagrees with its binding", () => {
    const value = fixture();
    value.authorize.mockImplementationOnce(() => {
      throw Error("unverified_policy");
    });
    let snapshot = value.catalog.snapshot();
    expect(snapshot.policies[0]).toMatchObject({
      enforced: false,
      unattendedApproved: false,
      allowedActions: [],
      restrictionReason: "unverified_policy",
    });
    expect(snapshot.projects[0].allowedExecutionPolicyIds).toEqual([]);
    expect(snapshot.runtimes[0].allowedActions).toEqual(["read"]);
    value.authorize.mockImplementationOnce((policyId, runtimeId) => ({
      policyId,
      runtime: { ...value.runtime, id: runtimeId },
      projectId: "other-project",
      task: { mode: "safe_write", workspaceId: "other-project" },
    }));
    snapshot = value.catalog.snapshot();
    expect(snapshot.policies[0].enforced).toBe(false);
    value.runtime.enabled = false;
    expect(value.catalog.snapshot().runtimes[0].allowedActions).toEqual([
      "read",
    ]);
  });
  it("publishes automatic and explicitly confirmed full-access modes without a project while withholding unattended full access", () => {
    const value = fixture();
    value.source.projects = () => [];
    const policies = [
      {
        ...value.policy,
        id: "automatic",
        projectId: undefined,
        mode: "desktop_auto" as const,
      },
      {
        ...value.policy,
        id: "full",
        projectId: undefined,
        mode: "desktop_full_access" as const,
        unattendedApproved: false,
      },
    ];
    value.source.policies = () => policies;
    value.authorize.mockImplementation((policyId, runtimeId) => {
      const policy = policies.find((row) => row.id === policyId)!;
      return {
        policyId,
        runtime: { ...value.runtime, id: runtimeId },
        projectId: undefined,
        task:
          policy.mode === "desktop_full_access"
            ? { mode: "full_access", fullAccessConfirmed: true }
            : { mode: "safe_write" },
      };
    });
    const snapshot = value.catalog.snapshot();
    expect(snapshot.policies).toMatchObject([
      {
        id: "automatic",
        mode: "desktop_auto",
        enforced: true,
        unattendedApproved: true,
        allowedActions: ["create", "advance", "trigger"],
      },
      {
        id: "full",
        mode: "desktop_full_access",
        enforced: true,
        unattendedApproved: false,
        allowedActions: ["create", "advance"],
      },
    ]);
  });
  it("does not turn an old, future or missing probe into a healthy runtime and classifies Web Agents by transport", () => {
    const value = fixture();
    value.runtime.lastProbe!.checkedAt = value.now - 300001;
    expect(value.catalog.snapshot().runtimes[0].healthy).toBe(false);
    value.runtime.lastProbe!.checkedAt = value.now + 1;
    expect(value.catalog.snapshot().runtimes[0].healthy).toBe(false);
    value.runtime.lastProbe = undefined;
    value.runtime.config.agentTransport = "local-web";
    expect(value.catalog.snapshot().runtimes[0]).toMatchObject({
      category: "web",
      healthy: false,
    });
  });
  it("rejects duplicate original identities and invalid public source fields", () => {
    const value = fixture();
    value.source.projects = () => [
      { id: "project-1", name: "One", path: "A" },
      { id: "project-1", name: "Two", path: "B" },
    ];
    expect(() => value.catalog.snapshot()).toThrow("requires_owner_action");
    value.source.projects = () => [
      { id: "invalid/project", name: "One", path: "A" },
    ];
    expect(() => value.catalog.snapshot()).toThrow("invalid_input");
  });
});
