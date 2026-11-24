import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkspaceDocument } from "./workspace-document-preview";

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

async function tempDocument(name: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "workspace-preview-"));
  fixtures.push(folder);
  return join(folder, name);
}

describe("workspace document preview capability", () => {
  it("returns exact bytes and refuses unsupported or mismatched resolved files", async () => {
    const file = await tempDocument("preview.pdf");
    const bytes = new Uint8Array([0, 1, 254, 255]);
    await writeFile(file, bytes);
    expect(await readWorkspaceDocument(file, "preview.PDF")).toEqual({
      status: "ok",
      bytes,
    });
    expect(await readWorkspaceDocument(null, "../preview.pdf")).toEqual({
      status: "unavailable",
    });
    expect(await readWorkspaceDocument(file, "preview.docx")).toEqual({
      status: "unavailable",
    });
    expect(await readWorkspaceDocument(file, "preview.docm")).toEqual({
      status: "unavailable",
    });
  });

  it("rejects oversized documents before reading them", async () => {
    const file = await tempDocument("large.xlsx");
    const handle = await open(file, "w");
    try {
      await handle.truncate(32 * 1024 * 1024 + 1);
    } finally {
      await handle.close();
    }
    expect(await readWorkspaceDocument(file, "large.xlsx")).toEqual({
      status: "tooLarge",
    });
  });
});
