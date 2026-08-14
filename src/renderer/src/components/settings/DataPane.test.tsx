import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../I18nProvider";
import DataPane from "./DataPane";
import { SettingsDataContext } from "./SettingsDataContext";
import type { SettingsData } from "./useSettingsData";

function renderDataPane(overrides: Partial<SettingsData> = {}): void {
  const settings = {
    backingUp: false,
    backupResult: null,
    importing: false,
    importResult: null,
    handleBackup: vi.fn(),
    handleImport: vi.fn(),
    handleRestartAfterRestore: vi.fn().mockResolvedValue(undefined),
    openclawFound: false,
    openclawPath: null,
    migrationDismissed: false,
    migrating: false,
    migrationLog: "",
    migrationResult: null,
    migrationResultType: null,
    migrationLogRef: { current: null },
    handleMigrate: vi.fn(),
    handleDismissMigration: vi.fn(),
    ...overrides,
  } as unknown as SettingsData;

  render(
    <I18nProvider>
      <SettingsDataContext.Provider value={settings}>
        <DataPane />
      </SettingsDataContext.Provider>
    </I18nProvider>,
  );
}

describe("DataPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("describes an Agents One recovery package and its exclusions", () => {
    renderDataPane();

    expect(
      screen.getByText(
        /导出或恢复 Agents One 的配置、项目、任务、聊天和协作记录|Export or restore Agents One configuration, projects, tasks, chats, and collaboration records/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /已知凭据存储和项目实际文件不会备份|Known credential stores and actual project files are excluded/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /导出 Agents One 备份|Export Agents One Backup/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /从备份恢复|Restore from Backup/i,
      }),
    ).toBeInTheDocument();
  });

  it("disables duplicate actions while export or restore is running", () => {
    renderDataPane({ backingUp: true, importing: true });

    expect(
      screen.getByRole("button", { name: /正在导出|Exporting/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: /正在检查并恢复|Checking and restoring/i,
      }),
    ).toBeDisabled();
  });

  it("uses structured success flags instead of message text heuristics", () => {
    renderDataPane({
      backupResult: {
        success: true,
        message: "Export finished without a magic keyword",
      },
      importResult: {
        success: false,
        message: "complete appears here, but restore failed",
      },
    });

    expect(
      screen.getByText("Export finished without a magic keyword"),
    ).toHaveClass("success");
    expect(
      screen.getByText("complete appears here, but restore failed"),
    ).toHaveClass("error");
  });

  it("offers to restart Agents One after a successful restore", () => {
    const handleRestartAfterRestore = vi.fn().mockResolvedValue(undefined);
    renderDataPane({
      importResult: {
        success: true,
        message: "Restore finished",
        requiresRestart: true,
      },
      handleRestartAfterRestore,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /重启 Agents One|Restart Agents One/i,
      }),
    );
    expect(handleRestartAfterRestore).toHaveBeenCalledOnce();
  });
});
