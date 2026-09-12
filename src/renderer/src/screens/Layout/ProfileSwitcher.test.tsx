import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import { t as translate } from "../../../../shared/i18n";

const i18nTestState = vi.hoisted(() => ({
  locale: "zh-CN" as "en" | "zh-CN",
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>): string =>
      translate(key, i18nTestState.locale, options),
  }),
}));

vi.mock("../../components/profile/ProfileModalContext", () => ({
  useProfileModal: () => ({
    openProfile: vi.fn(),
  }),
}));

vi.mock("../../components/common/ProfileAvatar", () => ({
  default: ({ name }: { name: string }): React.JSX.Element => (
    <span data-testid={`avatar-${name}`} />
  ),
}));

import ProfileSwitcher from "./ProfileSwitcher";

interface ProfileInfo {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  skillCount: number;
  gatewayRunning: boolean;
}

function installHermesAPI(
  profiles: ProfileInfo[],
  runtimes: AgentRuntimeDefinition[] = [],
): void {
  Object.defineProperty(window, "agentsOneAPI", {
    configurable: true,
    value: {
      listProfiles: vi.fn().mockResolvedValue(profiles),
      listAgentRuntimes: vi.fn().mockResolvedValue(runtimes),
      setActiveProfile: vi.fn().mockResolvedValue(undefined),
    },
  });
}

function profile(id: string, name = id): ProfileInfo {
  return {
    id,
    name,
    isDefault: id === "default",
    isActive: id === "default",
    model: "",
    skillCount: 0,
    gatewayRunning: false,
  };
}

function runtime(
  id: string,
  name: string,
  kind: AgentRuntimeDefinition["kind"],
): AgentRuntimeDefinition {
  return {
    id,
    name,
    kind,
    location: kind === "hermes" ? "remote" : "local",
    enabled: true,
    managed: "user",
    config: {},
  };
}

describe("ProfileSwitcher", () => {
  beforeEach(() => {
    i18nTestState.locale = "zh-CN";
  });
  it("shows the app name for an unrenamed default profile", async () => {
    installHermesAPI([profile("default")]);

    render(
      <ProfileSwitcher
        activeProfile="default"
        onSwitch={() => {}}
        onManage={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Agents One")).toBeInTheDocument();
    });
  });

  it("shows the selected default runtime", async () => {
    installHermesAPI(
      [profile("default", "卢姐")],
      [
        runtime("hermes-remote", "Hermes", "hermes"),
        runtime("codex", "Codex", "codex"),
      ],
    );

    render(
      <ProfileSwitcher
        activeProfile="default"
        onSwitch={() => {}}
        onManage={() => {}}
        defaultRuntimeId="codex"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Codex")).toBeInTheDocument();
    });
  });

  it("lets the user choose a default runtime", async () => {
    const onDefaultRuntimeChange = vi.fn();
    installHermesAPI(
      [profile("default")],
      [
        runtime("hermes-remote", "Hermes", "hermes"),
        runtime("codex", "Codex", "codex"),
      ],
    );

    render(
      <ProfileSwitcher
        activeProfile="default"
        onSwitch={() => {}}
        onManage={() => {}}
        defaultRuntimeId="hermes-remote"
        onDefaultRuntimeChange={onDefaultRuntimeChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTitle("默认智能体：Hermes")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTitle("默认智能体：Hermes"));
    await waitFor(() => {
      expect(screen.getByText("选择默认智能体")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Codex/ }));

    expect(onDefaultRuntimeChange).toHaveBeenCalledWith("codex");
  });

  it("renders default-agent controls in English", async () => {
    i18nTestState.locale = "en";
    installHermesAPI(
      [profile("default")],
      [runtime("hermes-remote", "Hermes", "hermes")],
    );

    render(
      <ProfileSwitcher
        activeProfile="default"
        onSwitch={() => {}}
        onManage={() => {}}
        defaultRuntimeId="hermes-remote"
      />,
    );

    const trigger = await screen.findByTitle("Default agent: Hermes");
    fireEvent.click(trigger);
    expect(screen.getByText("Select default agent")).toBeVisible();
    expect(screen.getAllByText("Default").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Hermes Agent Runtime \/ Remote/).length,
    ).toBeGreaterThan(0);
  });
});
