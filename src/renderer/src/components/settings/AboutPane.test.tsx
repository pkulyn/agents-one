import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../I18nProvider";
import AboutPane from "./AboutPane";
import { SettingsDataContext } from "./SettingsDataContext";
import type { SettingsData } from "./useSettingsData";

function renderAbout(overrides: Partial<SettingsData> = {}): void {
  const settings = {
    appVersion: "0.1.0",
    autoUpgradeEnabled: true,
    autoUpgradeSaved: false,
    handleAutoUpgradeChange: vi.fn(),
    desktopUpdateState: null,
    desktopUpdateVersion: null,
    desktopUpdatePercent: null,
    desktopUpdateError: null,
    checkDesktopUpdate: vi.fn(),
    handleDesktopUpdate: vi.fn(),
    ...overrides,
  } as unknown as SettingsData;

  render(
    <I18nProvider>
      <SettingsDataContext.Provider value={settings}>
        <AboutPane />
      </SettingsDataContext.Provider>
    </I18nProvider>,
  );
}

describe("AboutPane", () => {
  it("shows only the Agents One desktop product card", () => {
    renderAbout();

    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
    expect(screen.queryByText("Hermes Agent")).not.toBeInTheDocument();

    const logo = screen.getByRole("img", { name: /Agents One/i });
    expect(logo.getAttribute("src")).toContain("dawn%20ring%20mark");
  });

  it("keeps the desktop update action available", () => {
    const checkDesktopUpdate = vi.fn();
    renderAbout({ checkDesktopUpdate });

    fireEvent.click(
      screen.getByRole("button", { name: /检查更新|Check for updates/i }),
    );
    expect(checkDesktopUpdate).toHaveBeenCalledOnce();
  });
});
