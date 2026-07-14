import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeProbe,
} from "../../../../shared/agent-runtimes";
import AgentRuntimesPane from "./AgentRuntimesPane";

const capabilities = {
  chat: true,
  taskDispatch: true,
  streaming: true,
  cancellation: true,
  tools: false,
  memory: false,
  orchestration: false,
  readOnlyPlanning: false,
  mailbox: false,
  securityEvents: false,
  artifacts: false,
  workspaceAccess: false,
};

function installHermesAPI(runtimes: AgentRuntimeDefinition[]): {
  listAgentRuntimes: ReturnType<typeof vi.fn>;
  saveAgentRuntime: ReturnType<typeof vi.fn>;
  probeAgentRuntime: ReturnType<typeof vi.fn>;
  setAgentRuntimeBearerToken: ReturnType<typeof vi.fn>;
} {
  let current = [...runtimes];
  const listAgentRuntimes = vi.fn(async () => current);
  const saveAgentRuntime = vi.fn(async (draft) => {
    const saved = { ...draft, managed: "user" as const };
    current = [...current.filter((runtime) => runtime.id !== saved.id), saved];
    return saved;
  });
  const probe: AgentRuntimeProbe = {
    runtimeId: "openclaw-remote",
    state: "healthy",
    capabilities,
    checkedAt: Date.now(),
    message: "OpenClaw bridge ready",
  };
  const probeAgentRuntime = vi.fn(async () => probe);
  const setAgentRuntimeBearerToken = vi.fn(async () => ({ configured: true as const }));

  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      listAgentRuntimes,
      saveAgentRuntime,
      removeAgentRuntime: vi.fn(async () => true),
      getAgentRuntimeCredentialStatus: vi.fn(async () => ({
        required: true,
        configured: false,
      })),
      setAgentRuntimeBearerToken,
      probeAgentRuntime,
    },
  });

  return {
    listAgentRuntimes,
    saveAgentRuntime,
    probeAgentRuntime,
    setAgentRuntimeBearerToken,
  };
}

describe("AgentRuntimesPane", () => {
  it("loads runtimes and probes the selected runtime", async () => {
    const api = installHermesAPI([
      {
        id: "hermes-default",
        name: "Current Hermes",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "builtin",
        config: { transport: "http", timeoutMs: 10000 },
      },
      {
        id: "openclaw-remote",
        name: "OpenClaw Remote",
        kind: "openclaw",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {
          endpoint: "https://example.test/openclaw",
          transport: "http",
          timeoutMs: 10000,
        },
      },
    ]);

    render(<AgentRuntimesPane />);

    expect((await screen.findAllByText("Current Hermes")).length).toBeGreaterThan(
      0,
    );
    fireEvent.click(screen.getAllByText("OpenClaw Remote")[0]);
    fireEvent.click(screen.getByRole("button", { name: /Probe/i }));

    await waitFor(() => {
      expect(api.probeAgentRuntime).toHaveBeenCalledWith("openclaw-remote");
    });
    expect(
      (await screen.findAllByText("OpenClaw bridge ready")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Healthy").length).toBeGreaterThan(0);
  });

  it("saves a new remote runtime without credential fields", async () => {
    const api = installHermesAPI([]);
    render(<AgentRuntimesPane />);

    fireEvent.click(await screen.findByRole("button", { name: /Add/i }));
    fireEvent.change(screen.getByPlaceholderText("https://host.example/bridge"), {
      target: { value: "https://example.test/bridge" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(api.saveAgentRuntime).toHaveBeenCalled();
    });
    expect(api.saveAgentRuntime.mock.calls[0][0]).toMatchObject({
      id: "openclaw-remote",
      name: "OpenClaw Remote",
      kind: "openclaw",
      location: "remote",
      enabled: true,
      config: {
        endpoint: "https://example.test/bridge",
        transport: "http",
        timeoutMs: 10000,
      },
    });
    expect(JSON.stringify(api.saveAgentRuntime.mock.calls[0][0])).not.toMatch(
      /apiKey|token|secret/i,
    );
  });

  it("saves an OpenClaw Bridge token through IPC without adding it to runtime config", async () => {
    const api = installHermesAPI([
      {
        id: "openclaw-remote",
        name: "OpenClaw Remote",
        kind: "openclaw",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {
          endpoint: "https://example.test/openclaw",
          transport: "http",
          timeoutMs: 10000,
        },
      },
    ]);
    render(<AgentRuntimesPane />);

    await screen.findByRole("button", { name: /OpenClaw Remote/i });
    fireEvent.change(screen.getByLabelText("Bridge token"), {
      target: { value: "bridge-test-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save token/i }));

    await waitFor(() =>
      expect(api.setAgentRuntimeBearerToken).toHaveBeenCalledWith(
        "openclaw-remote",
        "bridge-test-token",
      ),
    );
    expect(JSON.stringify(api.saveAgentRuntime.mock.calls)).not.toContain(
      "bridge-test-token",
    );
  });
});
