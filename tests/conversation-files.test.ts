import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  writeFile,
  rm,
  realpath,
  mkdir,
  symlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findDocumentReferences,
  documentPath,
} from "../src/shared/conversation-files";
import { resolveConversationFile } from "../src/main/conversation-files";
import { resolveOneConversationWorkspace } from "../src/main/one-runtime/workspace-binding";
import type { RuntimeConversation } from "../src/shared/runtime-conversations";
const state = vi.hoisted(() => ({
  conversation: {} as Pick<
    RuntimeConversation,
    | "id"
    | "runtimeId"
    | "runtimeLocation"
    | "messages"
    | "workspace"
    | "workspaceId"
  >,
  location: "local",
  kind: "codex",
  profile: "default",
  active: null as { path: string; label: string } | null,
  restore: vi.fn(),
}));
vi.mock("../src/main/runtime-conversation-store", () => ({
  getRuntimeConversation: (id: string) =>
    state.conversation?.id === id ? state.conversation : null,
}));
vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: () => [
    { id: "agent", kind: state.kind, location: state.location },
  ],
  resolveAgentRuntimeArtifactPath: () => state.active,
  restoreConversationArtifactFile: state.restore,
}));
vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => state.profile,
}));
vi.mock("../src/main/agents-one-data-root", () => ({
  agentsOneProfileHome: (profile: string) => join(dir, profile),
}));
vi.mock("../src/main/media", () => ({ isAuthorizedMediaPath: () => false }));
vi.mock("../src/main/workspace-authority", () => ({
  resolveAuthorizedWorkspaceId: (id: string) => (id === "project" ? dir : null),
  isAuthorizedWorkspaceRoot: (path: string) => path === dir,
}));
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agents-one-file-"));
  state.location = "local";
  state.kind = "codex";
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

async function privateOneFile(name = "报告.md"): Promise<string> {
  state.kind = "one";
  const workspace = resolveOneConversationWorkspace(
    join(dir, "default", "desktop", "one", "agent"),
    { conversationId: "c", runId: "old-run" },
  ).workspace;
  await mkdir(join(workspace, "reports"), { recursive: true });
  const path = join(workspace, "reports", name);
  await writeFile(path, "generated document");
  state.conversation.messages[0].content = "文档已生成：`" + name + "`";
  state.conversation.messages[0].execution = {
    runId: "old-run",
    artifacts: [
      {
        id: "private-file",
        kind: "file",
        label: name,
        relativePath: "reports/" + name,
      },
    ],
  };
  return path;
}
const privateRef = {
  conversationId: "c",
  messageId: "m",
  artifactId: "private-file",
};

describe("projectless One document recovery", () => {
  // @lat: [[runtime-chat#Runtime Chat Rendering#Projectless One delivered documents]]
  it.each(["中文日报.md", "周报.docx", "图表.png"])(
    "resolves the saved %s artifact without an in-memory run or project grant",
    async (name) => {
      const path = await privateOneFile(name);
      await expect(resolveConversationFile(privateRef)).resolves.toMatchObject({
        path: await realpath(path),
        name,
        relativePath: join("reports", name),
        size: 18,
        image: name.endsWith(".png"),
      });
      expect(state.restore).not.toHaveBeenCalled();
    },
  );
  it("does not create missing directories or follow another conversation/profile/runtime", async () => {
    const path = await privateOneFile();
    state.conversation.id = "another";
    await expect(
      resolveConversationFile({ ...privateRef, conversationId: "another" }),
    ).resolves.toBeNull();
    state.conversation.id = "c";
    state.profile = "other";
    await expect(resolveConversationFile(privateRef)).resolves.toBeNull();
    expect(existsSync(join(dir, "other"))).toBe(false);
    state.profile = "default";
    state.kind = "codex";
    await expect(resolveConversationFile(privateRef)).resolves.toBeNull();
    state.kind = "one";
    state.location = "remote";
    state.restore.mockResolvedValue(null);
    await expect(resolveConversationFile(privateRef)).resolves.toBeNull();
    state.location = "local";
    await rm(path);
    await expect(resolveConversationFile(privateRef)).resolves.toBeNull();
  });
  it("keeps artifact ownership and revoked project boundaries", async () => {
    await privateOneFile();
    await expect(
      resolveConversationFile({ ...privateRef, artifactId: "unowned" }),
    ).resolves.toBeNull();
    state.conversation.workspaceId = "revoked-project";
    await expect(resolveConversationFile(privateRef)).resolves.toBeNull();
    state.conversation.workspaceId = undefined;
    state.conversation.messages[0].role = "user";
    await expect(resolveConversationFile(privateRef)).resolves.toBeNull();
  });
  it("rejects absolute, traversal and junction targets outside the exact conversation workspace", async () => {
    const path = await privateOneFile();
    const workspace = join(path, "..", "..");
    const outside = join(dir, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.md"), "private");
    await symlink(
      outside,
      join(workspace, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const artifact = state.conversation.messages[0].execution!.artifacts![0];
    for (const relativePath of [
      join(outside, "secret.md"),
      "../../secret.md",
      "escape/secret.md",
      "C:\\secret.md",
      "\\\\server\\share\\secret.md",
    ]) {
      artifact.relativePath = relativePath;
      await expect(resolveConversationFile(privateRef)).resolves.toBeNull();
    }
  });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
describe("conversation file references", () => {
  // @lat: [[runtime-chat#Runtime Chat Rendering#Clickable delivered documents]]
  it("recognizes Chinese Windows names, inline code, file URLs and angle links without consuming prose", () => {
    const content =
      "文件同时保存在本机： `D:\\Users\\demo\\Desktop\\示例 周报(V1.0).md`\n文件：[周报](<D:/Desktop/示例 周报(V1.0).docx>)\n位置：D:/Desktop/周报.md，已经完成。\n";
    expect(findDocumentReferences(content).map((r) => r.path)).toEqual([
      "D:\\Users\\demo\\Desktop\\示例 周报(V1.0).md",
      "D:/Desktop/示例 周报(V1.0).docx",
      "D:/Desktop/周报.md",
    ]);
    expect(
      documentPath(
        "file:///D:/Desktop/%E7%A4%BA%E4%BE%8B%20%E5%91%A8%E6%8A%A5.md",
      ),
    ).toBe("D:/Desktop/示例 周报.md");
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
    const path = join(dir, "示例 周报(V1.0).md");
    await writeFile(path, "report");
    state.conversation.messages[0].content = "本机文件：`" + path + "`";
    await expect(
      resolveConversationFile({ conversationId: "c", messageId: "m", path }),
    ).resolves.toMatchObject({
      path: await realpath(path),
      size: 6,
      name: "示例 周报(V1.0).md",
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

it("restores a saved local artifact inside the authorized project after in-memory runs are gone", async () => {
  const path = join(dir, "weather_result.md");
  await writeFile(path, "weather");
  state.conversation.workspaceId = "project";
  state.conversation.messages[0].content = "[交付物] 路径：weather_result.md";
  state.conversation.messages[0].execution = {
    runId: "old",
    artifacts: [{ id: "local-file", kind: "file", label: "weather_result.md" }],
  };
  await expect(
    resolveConversationFile({
      conversationId: "c",
      messageId: "m",
      artifactId: "local-file",
    }),
  ).resolves.toMatchObject({ path: await realpath(path), size: 7 });
  state.conversation.messages[0].execution!.artifacts![0].label =
    "../outside.md";
  await expect(
    resolveConversationFile({
      conversationId: "c",
      messageId: "m",
      artifactId: "local-file",
    }),
  ).resolves.toBeNull();
  expect(state.restore).not.toHaveBeenCalled();
});
