import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { loadOfficePreview } from "./officeDocumentPreview";

const relation =
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

async function officePackage(
  parts: Record<string, string>,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  for (const [part, value] of Object.entries(parts)) zip.file(part, value);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

describe("workspace Office preview", () => {
  it("reads Word headings, formatting, tables and internal raster images only", async () => {
    const bytes = await officePackage({
      "word/document.xml":
        "<document" +
        relation +
        "><body>" +
        '<p><pPr><pStyle val="Heading1"/></pPr><r><rPr><b/></rPr><t>Local heading</t></r></p>' +
        "<tbl><tr><tc><p><r><t>Table cell</t></r></p></tc></tr></tbl>" +
        '<p><r><blip r:embed="embedded"/><blip r:embed="remote"/></r></p></body></document>',
      "word/_rels/document.xml.rels":
        '<Relationships><Relationship Id="embedded" Target="media/local.png"/><Relationship Id="remote" TargetMode="External" Target="https://example.test/image.png"/></Relationships>',
      "word/media/local.png": "test raster bytes",
    });
    const preview = await loadOfficePreview(bytes, "docx");
    if (preview.kind !== "word") throw Error("wrong format");
    expect(preview.page.blocks).toMatchObject([
      {
        kind: "text",
        heading: 1,
        runs: [{ text: "Local heading", bold: true }],
      },
      { kind: "table", rows: [["Table cell"]] },
      { kind: "image", src: expect.stringMatching(/^data:image\/png;base64,/) },
    ]);
  });

  it("keeps workbook order, sparse columns and cached formula results", async () => {
    const bytes = await officePackage({
      "xl/workbook.xml":
        "<workbook" +
        relation +
        '><sheets><sheet name="Summary" r:id="second"/><sheet name="Data" r:id="first"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship Id="first" Target="worksheets/sheet1.xml"/><Relationship Id="second" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
      "xl/sharedStrings.xml": "<sst><si><t>Label</t></si></sst>",
      "xl/worksheets/sheet1.xml": "<worksheet><sheetData/></worksheet>",
      "xl/worksheets/sheet2.xml":
        '<worksheet><sheetData><row r="7"><c r="A7" t="s"><v>0</v></c><c r="C7"><f>1+1</f><v>2</v></c><c r="AO7"><v>41</v></c></row></sheetData></worksheet>',
    });
    const preview = await loadOfficePreview(bytes, "xlsx");
    if (preview.kind !== "sheet") throw Error("wrong format");
    expect(preview.names).toEqual(["Summary", "Data"]);
    expect(await preview.read(0)).toEqual({
      rows: [{ number: 7, values: ["Label", undefined, "2"] }],
      columns: 3,
      limited: true,
    });
    expect((await preview.read(1)).rows).toEqual([]);
  });

  it("follows presentation order and reads the selected slide", async () => {
    const bytes = await officePackage({
      "ppt/presentation.xml":
        "<presentation" +
        relation +
        '><sldIdLst><sldId id="256" r:id="second"/><sldId id="257" r:id="first"/></sldIdLst></presentation>',
      "ppt/_rels/presentation.xml.rels":
        '<Relationships><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>',
      "ppt/slides/slide1.xml":
        "<sld><spTree><sp><txBody><p><r><t>Slide one</t></r></p></txBody></sp></spTree></sld>",
      "ppt/slides/slide2.xml":
        '<sld><spTree><sp><nvSpPr><ph type="title"/></nvSpPr><txBody><p><r><t>Slide two</t></r></p></txBody></sp></spTree></sld>',
    });
    const preview = await loadOfficePreview(bytes, "pptx");
    if (preview.kind !== "slides") throw Error("wrong format");
    expect(preview.count).toBe(2);
    expect((await preview.read(0)).blocks).toMatchObject([
      { kind: "text", heading: 1, runs: [{ text: "Slide two" }] },
    ]);
    expect((await preview.read(1)).blocks).toMatchObject([
      { kind: "text", runs: [{ text: "Slide one" }] },
    ]);
  });

  it("rejects encrypted Office containers, invalid XML and oversized expansion", async () => {
    await expect(
      loadOfficePreview(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), "docx"),
    ).rejects.toThrow("password");
    const invalid = await officePackage({
      "word/document.xml": "<!DOCTYPE test><test/>",
    });
    await expect(loadOfficePreview(invalid, "docx")).rejects.toThrow("invalid");
    const large = await officePackage({
      "word/document.xml": "x".repeat(8 * 1024 * 1024 + 1),
    });
    await expect(loadOfficePreview(large, "docx")).rejects.toThrow("tooLarge");
  });
});
