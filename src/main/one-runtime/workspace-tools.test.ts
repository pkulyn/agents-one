import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createOneWorkspaceTools } from "./workspace-tools";

it("limits One workspace tools to the task grant and preserves file content", async () => {
  const root = await mkdtemp(join(tmpdir(), "one-workspace-"));
  try {
    await writeFile(join(root, "notes.txt"), "  hello\n", "utf8");
    const { tools, executeTool } = createOneWorkspaceTools({
      workspace: root,
      runtimeId: "one-test",
      taskId: "task-test",
      expiresAt: Date.now() + 60000,
      permission: "read",
    });
    const signal = new AbortController().signal;
    expect(tools.map((tool) => tool.name)).toEqual([
      "workspace_list",
      "workspace_read",
      "workspace_search",
    ]);
    expect(
      JSON.parse(
        await executeTool("workspace_read", { path: "notes.txt" }, signal),
      ).content,
    ).toBe("  hello\n");
    expect(
      JSON.parse(
        await executeTool(
          "workspace_search",
          { path: ".", query: "hello" },
          signal,
        ),
      ).matches,
    ).toEqual([expect.objectContaining({ path: "notes.txt", line: 1 })]);
    await writeFile(
      join(root, "too-large.txt"),
      Buffer.alloc(256 * 1024 + 1, 65),
    );
    const limited = JSON.parse(
      await executeTool(
        "workspace_search",
        { path: ".", query: "hello" },
        signal,
      ),
    );
    expect(limited).toMatchObject({
      searchedFiles: 1,
      skippedFiles: 1,
      truncated: true,
    });
    expect(
      JSON.parse(await executeTool("workspace_list", { path: "." }, signal))
        .entries[0].path,
    ).toBe("notes.txt");
    await expect(
      executeTool("workspace_read", { path: "../outside.txt" }, signal),
    ).rejects.toThrow();
    await expect(
      executeTool("workspace_write", { path: "notes.txt" }, signal),
    ).rejects.toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(
      executeTool("workspace_read", { path: "notes.txt" }, abort.signal),
    ).rejects.toThrow("cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves file data and requires a fresh approved deletion", async () => {
  const root = await mkdtemp(join(tmpdir(), "one-workspace-write-"));
  try {
    let approved = false;
    const { executeTool } = createOneWorkspaceTools({
      workspace: root,
      runtimeId: "one-test",
      taskId: "task-test",
      expiresAt: Date.now() + 60000,
      permission: "write",
      confirmDelete: async () => approved,
    });
    const signal = new AbortController().signal;
    const content = "  new text  \n";
    await executeTool("workspace_write", { path: "note.txt", content }, signal);
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe(content);
    const read = JSON.parse(
      await executeTool("workspace_read", { path: "note.txt" }, signal),
    );
    await expect(
      executeTool(
        "workspace_write",
        { path: "note.txt", content: "unapproved overwrite" },
        signal,
      ),
    ).rejects.toThrow("checksum");
    expect(await readFile(join(root, "note.txt"), "utf8")).toBe(content);
    await executeTool(
      "workspace_write",
      { path: "note.txt", content, expectedSha256: read.sha256 },
      signal,
    );
    await expect(
      executeTool(
        "workspace_delete",
        { path: "note.txt", expectedSha256: read.sha256 },
        signal,
      ),
    ).rejects.toThrow("not approved");
    await writeFile(join(root, "note.txt"), "changed", "utf8");
    await expect(
      executeTool(
        "workspace_write",
        { path: "note.txt", content: "stale", expectedSha256: read.sha256 },
        signal,
      ),
    ).rejects.toThrow("changed");
    approved = true;
    await expect(
      executeTool(
        "workspace_delete",
        { path: "note.txt", expectedSha256: read.sha256 },
        signal,
      ),
    ).rejects.toThrow("changed");
    const current = JSON.parse(
      await executeTool("workspace_read", { path: "note.txt" }, signal),
    );
    await executeTool(
      "workspace_delete",
      { path: "note.txt", expectedSha256: current.sha256 },
      signal,
    );
    await expect(readFile(join(root, "note.txt"))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// @lat: [[runtime-chat#Automatic tool execution and deletion confirmation#One deletion consent revoked by cancellation]]
it("does not delete a file when its One task is cancelled while confirmation is pending", async () => {
  const root = await mkdtemp(join(tmpdir(), "one-workspace-delete-cancel-"));
  try {
    const file = join(root, "report.docx");
    await writeFile(file, "keep this document", "utf8");

    let confirmRequested!: () => void;
    let resolveConfirmation!: (approved: boolean) => void;
    const confirmationRequested = new Promise<void>((resolve) => {
      confirmRequested = resolve;
    });
    const confirmDelete = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve;
          confirmRequested();
        }),
    );
    const { executeTool } = createOneWorkspaceTools({
      workspace: root,
      runtimeId: "one-test",
      taskId: "task-test",
      expiresAt: Date.now() + 60000,
      permission: "write",
      confirmDelete,
    });
    const run = new AbortController();
    const read = JSON.parse(
      await executeTool("workspace_read", { path: "report.docx" }, run.signal),
    );
    const deletion = executeTool(
      "workspace_delete",
      { path: "report.docx", expectedSha256: read.sha256 },
      run.signal,
    );

    await confirmationRequested;
    run.abort();
    resolveConfirmation(true);

    await expect(deletion).rejects.toThrow("not approved");
    expect(await readFile(file, "utf8")).toBe("keep this document");
    expect(confirmDelete).toHaveBeenCalledTimes(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
