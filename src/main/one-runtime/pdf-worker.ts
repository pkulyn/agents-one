import { DOMMatrix, DOMPoint, DOMRect } from "geometry-interfaces";

Object.assign(globalThis, { DOMMatrix, DOMPoint, DOMRect });
process.once("message", (message: unknown) => {
  void (async () => {
    if (
      !message ||
      typeof message !== "object" ||
      !("data" in message) ||
      typeof message.data !== "string" ||
      message.data.length > 1_400_000
    )
      throw new Error("Invalid PDF request");
    const data = new Uint8Array(Buffer.from(message.data, "base64"));
    if (
      data.byteLength > 1024 * 1024 ||
      !Buffer.from(data.subarray(0, 5)).equals(Buffer.from("%PDF-"))
    )
      throw new Error("Invalid or oversized PDF document");
    const { getDocument, VerbosityLevel } =
      await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { WorkerMessageHandler } =
      await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    // PDF.js runs in this separately terminated, memory-limited process.
    (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker =
      { WorkerMessageHandler };
    const loading = getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: true,
      verbosity: VerbosityLevel.ERRORS,
    });
    try {
      const pdf = await loading.promise;
      if (pdf.numPages > 100) throw new Error("PDF exceeds the 100-page limit");
      const pages: string[] = [];
      let size = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        size += Buffer.byteLength(text, "utf8");
        if (size > 256 * 1024)
          throw new Error("Extracted PDF text exceeds the size limit");
        pages.push(text);
        page.cleanup();
      }
      process.send?.({
        ok: true,
        pages: pdf.numPages,
        text: pages.join("\n\n"),
      });
    } finally {
      await loading.destroy();
    }
  })().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "PDF extraction failed";
    process.send?.({ ok: false, error: message.slice(0, 300) });
  });
});
process.on("disconnect", () => process.exit(0));
