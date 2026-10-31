import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findDocumentReferences,
  documentPath,
} from "../src/shared/conversation-files";
import { resolveConversationFile } from "../src/main/conversation-files";
import type { RuntimeConversation } from "../src/shared/runtime-conversations";
const state = vi.hoisted(() => ({
  conversation: {} as Pick<
    RuntimeConversation,
    "id" | "runtimeId" | "runtimeLocation" | "messages"
  >,
  location: "local",
  profile: "default",
  active: null as { path: string; label: string } | null,
  restore: vi.fn(),
}));
vi.mock("../src/main/runtime-conversation-store", () => ({
  getRuntimeConversation: (id: string) =>
    state.conversation?.id === id ? state.conversation : null,
}));
vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: () => [{ id: "agent", location: state.location }],
  resolveAgentRuntimeArtifactPath: () => state.active,
  restoreConversationArtifactFile: state.restore,
}));
vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => state.profile,
}));
vi.mock("../src/main/media", () => ({ isAuthorizedMediaPath: () => false }));
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agents-one-file-"));
  state.location = "local";
  state.profile = "default";
  state.active = null;
  state.restore.mockReset();
  state.conversation = {
    id: "c",
    runtimeId: "agent",
    runtimeLocation: "local",
    messages: [{ id: "m", role: "agent", content: "" }],
  };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
describe("conversation file references", () => {
  // @lat: [[runtime-chat#Runtime Chat Rendering#Clickable delivered documents]]
  it("recognizes Chinese Windows names, inline code, file URLs and angle links without consuming prose", () => {
    const content =
      "文件同时保存在本机： `D:\\Users\\chenfl\\Desktop\\AI 周报(V1.0).md`\n文件：[周报](<D:/Desktop/AI 周报(V1.0).docx>)\n位置：D:/Desktop/周报.md，已经完成。\n";
    expect(findDocumentReferences(content).map((r) => r.path)).toEqual([
      "D:\\Users\\chenfl\\Desktop\\AI 周报(V1.0).md",
      "D:/Desktop/AI 周报(V1.0).docx",
      "D:/Desktop/周报.md",
    ]);
    expect(documentPath("file:///D:/Desktop/AI%20%E5%91%A8%E6%8A%A5.md")).toBe(
      "D:/Desktop/AI 周报.md",
    );
  });
  it("does not turn commands, executable paths, HTTP URLs or UNC paths into local grants", () => {
    expect(
      findDocumentReferences(
        "```powershell\nRemove-Item D:/Desktop/report.md\n```\n`cat /tmp/report.md`\nhttps://example.com/report.md\nC:/temp/run.exe\n\\\\server\\share\\report.md",
      ),
    ).toEqual([]);
    expect(documentPath("file://server/share/report.md")).toBeNull();
  });
  it("allows an existing document explicitly referenced by a saved local reply outside projects", async () => {
    const path = join(dir, "AI 周报(V1.0).md");
    await writeFile(path, "report");
    state.conversation.messages[0].content = "本机文件：`" + path + "`";
    await expect(
      resolveConversationFile({ conversationId: "c", messageId: "m", path }),
    ).resolves.toMatchObject({
      path: await realpath(path),
      size: 6,
      name: "AI 周报(V1.0).md",
    });
    await expect(
      resolveConversationFile({
        conversationId: "c",
        messageId: "m",
        path: join(dir, "other.md"),
      }),
    ).resolves.toBeNull();
    state.conversation.messages[0].role = "user";
    await expect(
      resolveConversationFile({ conversationId: "c", messageId: "m", path }),
    ).resolves.toBeNull();
  });
  it("does not interpret a remote machine's identical path as a file on this PC", async () => {
    const path = join(dir, "same.md");
    await writeFile(path, "local secret");
    state.conversation.messages[0].content = "`" + path + "`";
    state.location = "remote";
    await expect(
      resolveConversationFile({ conversationId: "c", messageId: "m", path }),
    ).resolves.toBeNull();
  });
  it("restores only an artifact id owned by that saved reply after restarting", async () => {
    const path = join(dir, "download.md");
    await writeFile(path, "download");
    state.location = "remote";
    state.restore.mockResolvedValue(path);
    state.conversation.messages[0].execution = {
      runId: "old-run",
      artifacts: [{ kind: "file", id: "artifact-one", label: "原始文档.md" }],
    };
    await expect(
      resolveConversationFile({
        conversationId: "c",
        messageId: "m",
        artifactId: "unowned",
      }),
    ).resolves.toBeNull();
    expect(state.restore).not.toHaveBeenCalled();
    await expect(
      resolveConversationFile({
        conversationId: "c",
        messageId: "m",
        artifactId: "artifact-one",
      }),
    ).resolves.toMatchObject({ name: "原始文档.md", size: 8 });
    expect(state.restore).toHaveBeenCalledWith("agent", "artifact-one");
  });
  it("returns unavailable for moved files and aborts an artifact load when the profile changes", async () => {
    const path = join(dir, "gone.md");
    state.conversation.messages[0].content = "`" + path + "`";
    await expect(
      resolveConversationFile({ conversationId: "c", messageId: "m", path }),
    ).resolves.toBeNull();
    state.conversation.messages[0].execution = {
      runId: "r",
      artifacts: [{ kind: "file", id: "switch-profile", label: "gone.md" }],
    };
    state.restore.mockImplementation(async () => {
      state.profile = "other";
      return path;
    });
    await expect(
      resolveConversationFile({
        conversationId: "c",
        messageId: "m",
        artifactId: "switch-profile",
      }),
    ).resolves.toBeNull();
  });
});
