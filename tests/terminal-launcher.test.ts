import { describe, expect, it } from "vitest";
import {
  resolveTerminalCommand,
  resolveTerminalCommandAsync,
} from "../src/main/terminal-launcher";

describe("terminal launcher command resolution", () => {
  it("prefers protected Store PowerShell 7 packages on Windows", () => {
    const command = resolveTerminalCommand("C:\\work\\repo", {
      platform: "win32",
      env: {
        SystemDrive: "C:",
      },
      getWindowsPackageInstallLocations: () => [
        "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.2.0_x64__8wekyb3d8bbwe",
      ],
      exists: (filePath) =>
        filePath ===
          "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.2.0_x64__8wekyb3d8bbwe\\pwsh.exe" ||
        filePath === "C:\\Windows\\System32\\cmd.exe",
    });

    expect(command).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        "start",
        "",
        "/D",
        "C:\\work\\repo",
        "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.2.0_x64__8wekyb3d8bbwe\\pwsh.exe",
        "-NoExit",
        "-NoLogo",
      ],
      cwd: "C:\\work\\repo",
    });
  });

  it("uses the async Windows package resolver for app launches", async () => {
    const command = await resolveTerminalCommandAsync("C:\\work\\repo", {
      platform: "win32",
      env: {
        SystemDrive: "C:",
      },
      getWindowsPackageInstallLocations: () => [
        "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.2.0_x64__8wekyb3d8bbwe",
      ],
      exists: (filePath) =>
        filePath ===
          "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.2.0_x64__8wekyb3d8bbwe\\pwsh.exe" ||
        filePath === "C:\\Windows\\System32\\cmd.exe",
    });

    expect(command?.args).toContain(
      "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.2.0_x64__8wekyb3d8bbwe\\pwsh.exe",
    );
  });

  it("uses Windows Terminal when PowerShell 7 is unavailable", () => {
    const command = resolveTerminalCommand("C:\\work\\repo", {
      platform: "win32",
      env: {
        SystemDrive: "C:",
      },
      getWindowsPackageInstallLocations: (packageName) =>
        packageName === "Microsoft.WindowsTerminal"
          ? [
              "C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.24.11321.0_x64__8wekyb3d8bbwe",
            ]
          : [],
      exists: (filePath) =>
        filePath ===
          "C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.24.11321.0_x64__8wekyb3d8bbwe\\WindowsTerminal.exe" ||
        filePath === "C:\\Windows\\System32\\cmd.exe",
    });

    expect(command).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        "start",
        "",
        "/D",
        "C:\\work\\repo",
        "C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.24.11321.0_x64__8wekyb3d8bbwe\\WindowsTerminal.exe",
        "-d",
        "C:\\work\\repo",
      ],
      cwd: "C:\\work\\repo",
    });
  });

  it("does not trust user-profile Windows app execution aliases", () => {
    const command = resolveTerminalCommand("C:\\work\\repo", {
      platform: "win32",
      env: {
        LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
        SystemDrive: "C:",
      },
      exists: (filePath) =>
        filePath ===
          "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe" ||
        filePath ===
          "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe" ||
        filePath === "C:\\Windows\\System32\\cmd.exe",
    });

    expect(command).toBeNull();
  });

  it("rejects Windows package locations outside protected Program Files", () => {
    const command = resolveTerminalCommand("C:\\work\\repo", {
      platform: "win32",
      env: {
        SystemDrive: "C:",
      },
      getWindowsPackageInstallLocations: () => [
        "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\Microsoft.PowerShell_8wekyb3d8bbwe",
      ],
      exists: (filePath) =>
        filePath === "C:\\Windows\\System32\\cmd.exe" ||
        filePath ===
          "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\Microsoft.PowerShell_8wekyb3d8bbwe\\pwsh.exe",
    });

    expect(command).toBeNull();
  });

  it("falls back to the built-in Windows PowerShell by absolute path", () => {
    const command = resolveTerminalCommand("C:\\work\\repo", {
      platform: "win32",
      env: {
        SystemDrive: "C:",
      },
      exists: (filePath) =>
        filePath === "C:\\Windows\\System32\\cmd.exe" ||
        filePath ===
          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    });

    expect(command).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        "start",
        "",
        "/D",
        "C:\\work\\repo",
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        "-NoExit",
        "-NoLogo",
      ],
      cwd: "C:\\work\\repo",
    });
  });

  it("uses the system macOS open command instead of searching PATH", () => {
    const command = resolveTerminalCommand("/Users/me/repo", {
      platform: "darwin",
      env: { PATH: "/tmp/bin" },
      exists: (filePath) => filePath === "/usr/bin/open",
    });

    expect(command).toEqual({
      command: "/usr/bin/open",
      args: ["-a", "Terminal", "/Users/me/repo"],
      cwd: "/Users/me/repo",
    });
  });

  it("resolves Linux terminal names from PATH without shell-parsing env args", () => {
    const command = resolveTerminalCommand("/home/me/repo", {
      platform: "linux",
      env: {
        TERMINAL: "gnome-terminal --new-window",
        PATH: "/opt/bin:/usr/bin",
      },
      exists: (filePath) => filePath === "/usr/bin/x-terminal-emulator",
      realpath: (filePath) => filePath,
    });

    expect(command).toEqual({
      command: "/usr/bin/x-terminal-emulator",
      args: [],
      cwd: "/home/me/repo",
    });
  });

  it("does not resolve relative terminal executables from the worktree", () => {
    const command = resolveTerminalCommand("/home/me/repo", {
      platform: "linux",
      env: {
        TERMINAL: "./terminal",
        PATH: ".",
      },
      exists: () => true,
      realpath: (filePath) => filePath,
    });

    expect(command).toBeNull();
  });

  it("ignores every relative PATH entry, not only dot", () => {
    const command = resolveTerminalCommand("/home/me/repo", {
      platform: "linux",
      env: {
        PATH: "bin:tools",
      },
      exists: (filePath) =>
        filePath === "bin/x-terminal-emulator" ||
        filePath === "tools/x-terminal-emulator",
    });

    expect(command).toBeNull();
  });

  it("does not resolve absolute terminal executables from the worktree", () => {
    const command = resolveTerminalCommand("/home/me/repo", {
      platform: "linux",
      env: {
        TERMINAL: "/home/me/repo/terminal",
        PATH: "/home/me/repo/bin",
      },
      exists: () => true,
    });

    expect(command).toBeNull();
  });

  it("rejects terminal symlinks that resolve back into the worktree", () => {
    const command = resolveTerminalCommand("/home/me/repo", {
      platform: "linux",
      env: {
        PATH: "/usr/bin",
      },
      exists: (filePath) =>
        filePath === "/home/me/repo" || filePath === "/usr/bin/x-terminal-emulator",
      realpath: (filePath) =>
        filePath === "/usr/bin/x-terminal-emulator"
          ? "/home/me/repo/bin/x-terminal-emulator"
          : filePath,
    });

    expect(command).toBeNull();
  });

  it("rejects candidates when their real path cannot be resolved", () => {
    const command = resolveTerminalCommand("/home/me/repo", {
      platform: "linux",
      env: {
        PATH: "/usr/bin",
      },
      exists: (filePath) => filePath === "/usr/bin/x-terminal-emulator",
      realpath: () => {
        throw new Error("realpath failed");
      },
    });

    expect(command).toBeNull();
  });
});
