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
});
