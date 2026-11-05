import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import mammoth from "mammoth";
import JSZip from "jszip";
import { build } from "esbuild";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createOneDocumentTools } from "./document-tools";

it("creates and reads a real Word document within the authorized workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "one-docx-"));
  try {
    const pdfWorkerPath = join(root, "one-pdf-worker.mjs");
    await build({
      entryPoints: [join(process.cwd(), "src/main/one-runtime/pdf-worker.ts")],
      outfile: pdfWorkerPath,
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["@napi-rs/canvas"],
      banner: {
        js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
      },
      logLevel: "silent",
    });
    const opts = {
      pdfWorkerPath,
      workspace: root,
      runtimeId: "one-test",
      taskId: "task-test",
      expiresAt: Date.now() + 60000,
    };
    const writer = createOneDocumentTools({ ...opts, permission: "write" });
    const signal = new AbortController().signal;
    const created = JSON.parse(
      await writer.executeTool(
        "document_create_word",
        {
          path: "nested/report.docx",
          title: "项目报告",
          paragraphs: ["第一段", "Second paragraph"],
        },
        signal,
      ),
    );
    expect(created.sha256).toMatch(/^[a-f0-9]{64}$/);
    const text = await mammoth.extractRawText({
      buffer: readFileSync(join(root, "nested", "report.docx")),
    });
    expect(text.value).toContain("项目报告");
    expect(text.value).toContain("第一段");
    const reader = createOneDocumentTools({ ...opts, permission: "read" });
    const read = JSON.parse(
      await reader.executeTool(
        "document_read_word",
        { path: "nested/report.docx" },
        signal,
      ),
    );
    expect(read.sha256).toBe(created.sha256);
    expect(read.text).toContain("Second paragraph");
    const originalBytes = readFileSync(join(root, "nested", "report.docx"));
    await expect(
      writer.executeTool(
        "document_create_word",
        { path: "nested/report.docx", title: "overwrite", paragraphs: [] },
        signal,
      ),
    ).rejects.toThrow("checksum");
    expect(readFileSync(join(root, "nested", "report.docx"))).toEqual(
      originalBytes,
    );
    await writer.executeTool(
      "document_create_word",
      {
        path: "nested/report.docx",
        title: "Updated",
        paragraphs: [],
        expectedSha256: read.sha256,
      },
      signal,
    );
    await expect(
      reader.executeTool(
        "document_create_word",
        { path: "no.docx", title: "x", paragraphs: [] },
        signal,
      ),
    ).rejects.toThrow("not authorized");
    await expect(
      writer.executeTool(
        "document_create_word",
        { path: "../escape.docx", title: "x", paragraphs: [] },
        signal,
      ),
    ).rejects.toThrow();
    await expect(
      writer.executeTool(
        "document_create_word",
        {
          path: "nested/report.docx",
          title: "x",
          paragraphs: [],
          expectedSha256: "0".repeat(64),
        },
        signal,
      ),
    ).rejects.toThrow("changed");
    const zip = new JSZip();
    zip.file("word/document.xml", "x".repeat(17 * 1024 * 1024));
    const bomb = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(central).toBeGreaterThan(0);
    const documentCentral = bomb.indexOf(
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      central + 4,
    );
    expect(documentCentral).toBeGreaterThan(central);
    bomb.writeUInt32LE(1, documentCentral + 24);
    writeFileSync(join(root, "bomb.docx"), bomb);
    await expect(
      reader.executeTool("document_read_word", { path: "bomb.docx" }, signal),
    ).rejects.toThrow(/expands beyond|mismatch/);
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("One PDF verified", { x: 40, y: 700, font });
    writeFileSync(join(root, "sample.pdf"), await pdf.save());
    const extracted = JSON.parse(
      await reader.executeTool(
        "document_read_pdf",
        { path: "sample.pdf" },
        signal,
      ),
    );
    expect(extracted.pages).toBe(1);
    expect(extracted.text).toContain("One PDF verified");
    expect(extracted.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      reader.executeTool(
        "document_read_pdf",
        { path: "../escape.pdf" },
        signal,
      ),
    ).rejects.toThrow();
    const emptyPdf = await PDFDocument.create();
    emptyPdf.addPage();
    writeFileSync(join(root, "empty.pdf"), await emptyPdf.save());
    const empty = JSON.parse(
      await reader.executeTool(
        "document_read_pdf",
        { path: "empty.pdf" },
        signal,
      ),
    );
    expect(empty.warning).toContain("OCR");
    const tooMany = await PDFDocument.create();
    for (let i = 0; i < 101; i++) tooMany.addPage();
    writeFileSync(join(root, "many.pdf"), await tooMany.save());
    await expect(
      reader.executeTool("document_read_pdf", { path: "many.pdf" }, signal),
    ).rejects.toThrow("100-page");
    writeFileSync(join(root, "large.pdf"), Buffer.alloc(1024 * 1024 + 1));
    await expect(
      reader.executeTool("document_read_pdf", { path: "large.pdf" }, signal),
    ).rejects.toThrow();
    writeFileSync(join(root, "bad.pdf"), "not a PDF");
    await expect(
      reader.executeTool("document_read_pdf", { path: "bad.pdf" }, signal),
    ).rejects.toThrow();
    writeFileSync(join(root, "bad.docx"), "not a document");
    await expect(
      reader.executeTool("document_read_word", { path: "bad.docx" }, signal),
    ).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
