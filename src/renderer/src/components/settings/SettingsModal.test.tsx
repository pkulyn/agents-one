import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../I18nProvider";
import SettingsModal from "./SettingsModal";

vi.mock("./useSettingsData", () => ({ useSettingsData: () => ({}) }));
vi.mock("./AppearancePane", () => ({ default: () => <div>Appearance</div> }));
vi.mock("./LanguagePane", () => ({ default: () => <div>Language</div> }));
vi.mock("./PrivacyPane", () => ({ default: () => <div>Privacy</div> }));
vi.mock("./DataPane", () => ({ default: () => <div>Data</div> }));
vi.mock("./ArchivePane", () => ({ default: () => <div>Archives</div> }));
vi.mock("./AboutPane", () => ({ default: () => <div>About</div> }));
vi.mock("./LogsPane", () => ({ default: () => <div>Logs</div> }));
vi.mock("./VoiceInputPane", () => ({
  default: () => <div>Voice input pane</div>,
}));
vi.mock("./MobileConnectionPane", () => ({
  default: ({ profile }: { profile?: string }) => (
    <div>Mobile Owner settings: {profile}</div>
  ),
}));

describe("SettingsModal navigation", () => {
  // @lat: [[desktop-updates#Cumulative desktop feature acceptance]]
  it("keeps mobile access first and opens its profile-scoped pane", async () => {
    render(
      <I18nProvider>
        <SettingsModal open profile="personal" onClose={vi.fn()} />
      </I18nProvider>,
    );
    const entry = document.querySelector(
      '[data-desktop-feature="mobile-owner-settings"]',
    );
    expect(entry).toBe(document.querySelector(".settings-modal-nav-item"));
    fireEvent.click(entry!);
    await waitFor(() =>
      expect(screen.getByText("Mobile Owner settings: personal")).toBeVisible(),
    );
  });

  it("uses one general group without a separate Agents One heading", () => {
    render(
      <I18nProvider>
        <SettingsModal open onClose={vi.fn()} />
      </I18nProvider>,
    );

    const labels = document.querySelectorAll(".settings-modal-nav-group-label");
    expect(labels).toHaveLength(1);
    expect(labels[0]).not.toHaveTextContent("Agents One");
  });

  it("opens the voice input pane when targeted by settings navigation", () => {
    render(
      <I18nProvider>
        <SettingsModal open initialSection="voice" onClose={vi.fn()} />
      </I18nProvider>,
    );

    expect(document.body).toHaveTextContent("Voice input pane");
  });
});
