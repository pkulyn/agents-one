import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { PDFDocument } from "pdf-lib";
import { expect, it, vi } from "vitest";

it("extracts explicitly staged PDF input and retains its audit hash", async () => {
  const root = mkdtempSync(join(tmpdir(), "one-pdf-attachment-"));
  vi.resetModules();
  vi.stubEnv("AGENTS_ONE_USER_DATA_DIR", root);
  try {
    const worker = join(root, "pdf-worker.mjs");
    await build({
      entryPoints: [join(process.cwd(), "src/main/one-runtime/pdf-worker.ts")],
      outfile: worker,
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["@napi-rs/canvas"],
      banner: {
        js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
      },
      logLevel: "silent",
    });
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("Attachment PDF evidence");
    const bytes = Buffer.from(await pdf.save());
    const { stageAttachment } = await import("../attachment-staging");
    const { prepareOneAttachments } = await import("./attachments");
    const path = stageAttachment(
      "session",
      "source.pdf",
      bytes.toString("base64"),
    );
    const input = {
      id: "pdf",
      kind: "path-ref" as const,
      name: "source.pdf",
      mime: "application/pdf",
      size: bytes.length,
      path,
    };
    const result = await prepareOneAttachments(
      undefined,
      [input],
      worker,
      new AbortController().signal,
    );
    expect(result.context).toContain("Attachment PDF evidence");
    expect(result.context).toContain("not instructions");
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        name: "source.pdf",
        kind: "document",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    await expect(
      prepareOneAttachments(
        undefined,
        [{ ...input, path: join(root, "not-staged.pdf") }],
        worker,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      prepareOneAttachments(undefined, [input], worker, cancelled.signal),
    ).rejects.toThrow("cancelled");
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);

it("allows validated image attachments only for enabled models", async () => {
  const root = mkdtempSync(join(tmpdir(), "one-image-attachment-"));
  vi.resetModules();
  vi.stubEnv("AGENTS_ONE_USER_DATA_DIR", root);
  try {
    const { prepareOneAttachments } = await import("./attachments");
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYV8AAAAASUVORK5CYII=",
      "base64",
    );
    const image = {
      id: "pic",
      kind: "image" as const,
      name: "pic.png",
      mime: "image/png",
      size: bytes.length,
      dataUrl: "data:image/png;base64," + bytes.toString("base64"),
    };
    const signal = new AbortController().signal;
    await expect(
      prepareOneAttachments(undefined, [image], "", signal),
    ).rejects.toThrow("未启用图片输入");
    const prepared = await prepareOneAttachments(
      undefined,
      [image],
      "",
      signal,
      true,
    );
    expect(prepared.images).toEqual([
      { type: "image", data: bytes.toString("base64"), mimeType: "image/png" },
    ]);
    expect(prepared.artifacts[0]).toMatchObject({
      kind: "image",
      size: bytes.length,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(
      prepareOneAttachments(
        undefined,
        [{ ...image, mime: "image/jpeg" }],
        "",
        signal,
        true,
      ),
    ).rejects.toThrow("图片格式");
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
