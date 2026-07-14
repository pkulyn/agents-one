import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const remoteRequestJsonMock = vi.hoisted(() => vi.fn());

vi.mock("./hermes", () => ({
  getApiUrl: () => "http://remote.example:9119",
  getRemoteAuthHeader: () => ({ Authorization: "Bearer tok" }),
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    getConnectionConfig: () => ({
      mode: "remote",
      remoteUrl: "http://remote.example:9119",
      apiKey: "tok",
      remoteDashboardUrl: "",
      remoteDashboardToken: "",
      remoteChatTransport: "auto",
      sshChatTransport: "auto",
      ssh: {},
    }),
    getRemoteDashboardSessionConfig: (
      config: { remoteUrl: string; apiKey: string },
      profile?: string,
    ) => ({
      remoteUrl: config.remoteUrl,
      apiKey: config.apiKey,
      profile,
    }),
  };
});

vi.mock("./remote-sessions", () => ({
  remoteRequestJson: remoteRequestJsonMock,
}));

import {
  REMOTE_SKILL_PREFIX,
  remoteGetSkillContent,
  remoteInstallSkill,
  remoteListInstalledSkills,
  remoteSkillPath,
  remoteUninstallSkill,
} from "./remote-skills";

beforeEach(() => {
  remoteRequestJsonMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("remote skills routing", () => {
  it("lists installed skills from the remote dashboard, keyed by marker path", async () => {
    // Remote mode used to fall through to the local CLI, showing the LOCAL
    // machine's skills while connected to a remote dashboard (#578).
    remoteRequestJsonMock.mockResolvedValue([
      { name: "pdf", category: "docs", description: "PDF tools" },
      { name: "web", description: "" },
      { notAName: true },
    ]);

    const skills = await remoteListInstalledSkills("research");

    // The path embeds the profile the skill was listed under — the content
    // lookup has no other channel for it, and resolving to the globally
    // active profile there would query the wrong profile's API.
    expect(skills).toEqual([
      {
        name: "pdf",
        category: "docs",
        description: "PDF tools",
        path: `${REMOTE_SKILL_PREFIX}research:pdf`,
      },
      {
        name: "web",
        category: "",
        description: "",
        path: `${REMOTE_SKILL_PREFIX}research:web`,
      },
    ]);
    const [, path] = remoteRequestJsonMock.mock.calls[0];
    expect(path).toContain("/api/skills");
    // Unified-dashboard scoping is delegated to remoteRequestJson so every
    // dashboard surface uses one profile URL builder.
    expect(remoteRequestJsonMock.mock.calls[0][0]).toMatchObject({
      remoteUrl: "http://remote.example:9119",
      apiKey: "tok",
      profile: "research",
    });
  });

  it("does not append ?profile= for the default profile", async () => {
    remoteRequestJsonMock.mockResolvedValue([]);
    await remoteListInstalledSkills("default");
    expect(String(remoteRequestJsonMock.mock.calls[0][1])).not.toContain(
      "profile=",
    );
  });

  it("returns [] instead of throwing when the remote is unreachable", async () => {
    remoteRequestJsonMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(remoteListInstalledSkills()).resolves.toEqual([]);
  });

  it("fetches content by unwrapping the marker path to profile + name", async () => {
    remoteRequestJsonMock.mockResolvedValue({
      name: "pdf",
      content: "# PDF skill",
    });

    const content = await remoteGetSkillContent(
      remoteSkillPath("pdf", "research"),
    );

    expect(content).toBe("# PDF skill");
    const [, path] = remoteRequestJsonMock.mock.calls[0];
    expect(path).toContain("/api/skills/content?name=pdf");
    // The profile comes from the marker path, NOT the globally active profile.
    expect(remoteRequestJsonMock.mock.calls[0][0]).toMatchObject({
      profile: "research",
    });
  });

  it("scopes a default-profile path with no ?profile= param", async () => {
    remoteRequestJsonMock.mockResolvedValue({ content: "x" });
    await remoteGetSkillContent(remoteSkillPath("pdf"));
    expect(String(remoteRequestJsonMock.mock.calls[0][1])).not.toContain(
      "profile=",
    );
  });

  it("falls back to the given profile for a bare (unprefixed) path", async () => {
    remoteRequestJsonMock.mockResolvedValue({ content: "x" });
    await remoteGetSkillContent("pdf", "research");
    const [, path] = remoteRequestJsonMock.mock.calls[0];
    expect(path).toContain("name=pdf");
    expect(remoteRequestJsonMock.mock.calls[0][0]).toMatchObject({
      profile: "research",
    });
  });

  it("percent-encodes query params consistently via searchParams", async () => {
    // Embedding a pre-encoded name in the path then calling
    // searchParams.set("profile", ...) would re-serialize it (%20 → +) only
    // when a named profile is present — everything goes through searchParams.
    remoteRequestJsonMock.mockResolvedValue({ content: "x" });
    await remoteGetSkillContent(remoteSkillPath("my skill", "research"));
    expect(String(remoteRequestJsonMock.mock.calls[0][1])).toContain(
      "name=my+skill",
    );
    remoteRequestJsonMock.mockClear();
    await remoteGetSkillContent(remoteSkillPath("my skill"));
    expect(String(remoteRequestJsonMock.mock.calls[0][1])).toContain(
      "name=my+skill",
    );
  });

  it("maps hub install/uninstall spawn results to SkillCliResult", async () => {
    remoteRequestJsonMock.mockResolvedValue({ ok: true, pid: 42 });
    await expect(remoteInstallSkill("hub/pdf")).resolves.toEqual({
      success: true,
    });
    await expect(remoteUninstallSkill("pdf")).resolves.toEqual({
      success: true,
    });
  });

  it("surfaces API error detail on a failed install", async () => {
    remoteRequestJsonMock.mockRejectedValue(
      new Error("400: identifier is required"),
    );
    const result = await remoteInstallSkill("");
    expect(result.success).toBe(false);
    expect(result.error).toContain("identifier is required");
  });
});
