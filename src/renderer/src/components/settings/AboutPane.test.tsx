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
    desktopUpdatePolicy: { enabled: true, reason: null },
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

  it("lets unsigned builds check versions without automatic update controls", () => {
    const checkDesktopUpdate = vi.fn();
    renderAbout({
      desktopUpdatePolicy: { enabled: false, reason: "unsigned-build" },
      checkDesktopUpdate,
    });
    const button = screen.getByRole("button", {
      name: /检查更新|Check for updates/i,
    });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(checkDesktopUpdate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/未签名|unsigned build/i),
    ).not.toBeInTheDocument();
  });
  it("directs an unsigned update to GitHub without downloading it", () => {
    const handleDesktopUpdate = vi.fn();
    renderAbout({
      desktopUpdatePolicy: { enabled: false, reason: "unsigned-build" },
      desktopUpdateState: "available",
      desktopUpdateVersion: "0.1.1",
      handleDesktopUpdate,
    });
    expect(
      screen.getByText(
        /请手动到 GitHub 下载新版本并安装|manually download.*GitHub/i,
      ),
    ).toBeVisible();
    const link = screen.getByRole("link", { name: /GitHub/i });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/pkulyn/agents-one/releases/latest",
    );
    expect(handleDesktopUpdate).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /检查更新|Check for updates/i }),
    ).toBeEnabled();
  });
});
