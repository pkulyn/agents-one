import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Agents from "./Agents";

function installHermesAPI(): {
  listAgentRuntimes: ReturnType<typeof vi.fn>;
  probeAgentRuntime: ReturnType<typeof vi.fn>;
} {
  const api = {
    listAgentRuntimes: vi.fn().mockResolvedValue([]),
    probeAgentRuntime: vi.fn().mockResolvedValue({
      state: "healthy",
      capabilities: {},
      checkedAt: Date.now(),
    }),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

describe("Agents", () => {
  it("only shows connected runtimes and not the legacy local Hermes profile", async () => {
    const api = installHermesAPI();
    api.listAgentRuntimes.mockResolvedValue([
      {
        id: "pi-local",
        name: "Pi",
        kind: "pi",
        location: "local",
        enabled: true,
        managed: "user",
        config: { transport: "cli" },
      },
    ]);

    render(
      <Agents
        onChatWithRuntime={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Pi")).toBeTruthy();
    });
    expect(screen.queryByText("本地 Hermes 档案（兼容）")).toBeNull();
    expect(screen.queryByText("新建本地档案")).toBeNull();
  });

  it("opens a formal task conversation for the selected runtime", async () => {
    const api = installHermesAPI();
    api.listAgentRuntimes.mockResolvedValue([
      {
        id: "codex-local",
        name: "Codex",
        kind: "codex",
        location: "local",
        enabled: true,
        managed: "user",
        config: { transport: "cli" },
      },
    ]);

    const onChatWithRuntime = vi.fn();
    render(<Agents onChatWithRuntime={onChatWithRuntime} />);

    await screen.findByText("Codex");
    expect(screen.getByRole("button", { name: "管理" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "对话" }));
    expect(onChatWithRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ id: "codex-local" }),
    );
  });

  it("shows the unified transport label, connection hint, and capability badges", async () => {
    const api = installHermesAPI();
    api.listAgentRuntimes.mockResolvedValue([
      {
        id: "hermes-gateway",
        name: "Hermes Gateway",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {
          endpoint: "https://gateway.example/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          transport: "http",
        },
      },
    ]);
    api.probeAgentRuntime.mockResolvedValue({
      runtimeId: "hermes-gateway",
      state: "healthy",
      capabilities: {
        chat: true,
        taskDispatch: true,
        tools: true,
        artifacts: false,
        workspaceAccess: true,
      },
      checkedAt: Date.now(),
    });

    render(<Agents onChatWithRuntime={() => {}} />);

    await screen.findByText("Hermes Gateway");
    // Unified access label (plan 1.1/1.5).
    expect(screen.getByText(/Gateway v1/)).toBeTruthy();
    // Connection hint shows the Gateway endpoint.
    expect(
      screen.getByText("https://gateway.example/agents-one/v1"),
    ).toBeTruthy();
    // Capability badges come from the probe (chat/taskDispatch/tools/
    // workspaceAccess; artifacts is false). "对话" also names the chat button,
    // so scope to the capability badge row.
    const capabilities = document.querySelector(".agents-runtime-capabilities");
    expect(capabilities?.textContent).toContain("对话");
    expect(capabilities?.textContent).toContain("任务派发");
    expect(capabilities?.textContent).toContain("工具");
    expect(capabilities?.textContent).toContain("工作区");
    expect(capabilities?.textContent).not.toContain("产物");
  });
});
