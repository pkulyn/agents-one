import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { extractOnePdf } from "./pdf-extract";

it("keeps unrelated secrets out of the parser and waits for cancellation", async () => {
  const root = mkdtempSync(join(tmpdir(), "one-pdf-worker-"));
  const previous = process.env.ONE_PDF_TEST_SECRET;
  process.env.ONE_PDF_TEST_SECRET = "not-for-pdf-worker";
  try {
    const worker = join(root, "check.cjs");
    writeFileSync(
      worker,
      'process.once("message",()=>process.send({ok:true,pages:1,text:process.env.ONE_PDF_TEST_SECRET?"leaked":"clear"}));process.on("disconnect",()=>process.exit(0));',
    );
    expect(
      await extractOnePdf(
        worker,
        Buffer.from("test"),
        new AbortController().signal,
      ),
    ).toEqual({ pages: 1, text: "clear" });
    const hanging = join(root, "hanging.cjs");
    writeFileSync(
      hanging,
      'process.once("message",()=>setInterval(()=>{},1000));',
    );
    const abort = new AbortController();
    const pending = extractOnePdf(hanging, Buffer.from("test"), abort.signal);
    setTimeout(() => abort.abort(), 100);
    await expect(pending).rejects.toThrow("cancelled");
  } finally {
    if (previous === undefined) delete process.env.ONE_PDF_TEST_SECRET;
    else process.env.ONE_PDF_TEST_SECRET = previous;
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
