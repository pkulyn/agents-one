import JSZip from "jszip";
import type { WorkspaceDocumentFormat } from "../../../../shared/workspace-document-preview";

type OfficeFormat = Exclude<WorkspaceDocumentFormat, "pdf">;
type Run = { text: string; bold?: boolean; italic?: boolean };
export type OfficeBlock =
  | { kind: "text"; runs: Run[]; heading?: number }
  | { kind: "table"; rows: string[][] }
  | { kind: "image"; src: string; alt: string };
export type OfficePage = { blocks: OfficeBlock[]; limited: boolean };
type SheetPage = {
  rows: { number: number; values: string[] }[];
  columns: number;
  limited: boolean;
};
export type OfficePreview =
  | { kind: "word"; page: OfficePage }
  | {
      kind: "slides";
      count: number;
      read: (index: number) => Promise<OfficePage>;
    }
  | {
      kind: "sheet";
      names: string[];
      read: (index: number) => Promise<SheetPage>;
    };

const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 48 * 1024 * 1024;
const MAX_BLOCKS = 600;
const MAX_ROWS = 200;
const MAX_COLUMNS = 40;
const PACKAGE_ORIGIN = "https://package.invalid";
const RASTER_MIME = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["bmp", "image/bmp"],
]);

type OfficePackage = {
  xml: (path: string) => Promise<Document>;
  read: (path: string) => Promise<Uint8Array>;
  has: (path: string) => boolean;
};

async function openOfficePackage(bytes: Uint8Array): Promise<OfficePackage> {
  // Password-protected Office files use a compound-file container.
  if (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    throw new Error("password");
  }
  const zip = await JSZip.loadAsync(bytes);
  if (
    Object.keys(zip.files).length > 2500 ||
    !zip.file("[Content_Types].xml")
  ) {
    throw new Error("invalid");
  }
  let total = 0;
  const cache = new Map<string, Promise<Uint8Array>>();
  const read = (path: string): Promise<Uint8Array> => {
    const cached = cache.get(path);
    if (cached) return cached;
    const result = new Promise<Uint8Array>((resolve, reject) => {
      const entry = zip.file(path);
      if (!entry || entry.unsafeOriginalName !== path) {
        reject(new Error("invalid"));
        return;
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const stream = (
        entry as unknown as {
          internalStream(type: "uint8array"): {
            on(event: "data", listener: (chunk: Uint8Array) => void): void;
            on(event: "error", listener: (error: Error) => void): void;
            on(event: "end", listener: () => void): void;
            pause(): void;
            resume(): void;
          };
        }
      ).internalStream("uint8array");
      stream.on("data", (chunk: Uint8Array) => {
        if (
          size + chunk.byteLength > MAX_ENTRY_BYTES ||
          total + chunk.byteLength > MAX_EXPANDED_BYTES
        ) {
          stream.pause();
          reject(new Error("tooLarge"));
          return;
        }
        size += chunk.byteLength;
        total += chunk.byteLength;
        chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => {
        const output = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          output.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(output);
      });
      stream.resume();
    });
    cache.set(path, result);
    return result;
  };

  const xml = async (path: string): Promise<Document> => {
    const source = new TextDecoder().decode(await read(path));
    if (/<!DOCTYPE/i.test(source)) throw new Error("invalid");
    const parsed = new DOMParser().parseFromString(source, "application/xml");
    if (parsed.getElementsByTagName("parsererror").length)
      throw new Error("invalid");
    return parsed;
  };
  return { xml, read, has: (path: string) => Boolean(zip.file(path)) };
}

function descendants(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS("*", name));
}

function children(root: Element, name: string): Element[] {
  return Array.from(root.children).filter((child) => child.localName === name);
}

function attribute(element: Element, name: string): string {
  return (
    Array.from(element.attributes).find((item) => item.localName === name)
      ?.value ?? ""
  );
}

function relationshipId(element: Element, name = "id"): string {
  return (
    Array.from(element.attributes).find(
      (item) =>
        item.localName === name &&
        item.namespaceURI?.endsWith("/relationships"),
    )?.value ?? ""
  );
}

async function relationships(
  pkg: OfficePackage,
  part: string,
): Promise<Map<string, string>> {
  const split = part.lastIndexOf("/") + 1;
  const relationPart =
    part.slice(0, split) + "_rels/" + part.slice(split) + ".rels";
  const paths = new Map<string, string>();
  if (!pkg.has(relationPart)) return paths;
  for (const item of descendants(await pkg.xml(relationPart), "Relationship")) {
    const target = item.getAttribute("Target");
    if (!target || item.getAttribute("TargetMode") === "External") continue;
    const url = new URL(target, PACKAGE_ORIGIN + "/" + part);
    if (url.origin === PACKAGE_ORIGIN && !url.search && !url.hash) {
      paths.set(
        item.getAttribute("Id") ?? "",
        decodeURIComponent(url.pathname.slice(1)),
      );
    }
  }
  return paths;
}

function documentText(root: Element): string {
  return descendants(root, "t")
    .map((node) => node.textContent ?? "")
    .join("")
    .slice(0, 16000);
}

async function imageBlock(
  pkg: OfficePackage,
  part: string | undefined,
  alt: string,
): Promise<OfficeBlock | undefined> {
  const mime =
    part && RASTER_MIME.get(part.split(".").at(-1)?.toLowerCase() ?? "");
  if (!part || !mime || !pkg.has(part)) return;
  const bytes = await pkg.read(part);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return {
    kind: "image",
    src: "data:" + mime + ";base64," + btoa(binary),
    alt,
  };
}

function tableBlock(table: Element): OfficeBlock {
  return {
    kind: "table",
    rows: children(table, "tr")
      .slice(0, MAX_ROWS)
      .map((row) =>
        children(row, "tc").slice(0, MAX_COLUMNS).map(documentText),
      ),
  };
}

async function readWord(pkg: OfficePackage): Promise<OfficePage> {
  const part = "word/document.xml";
  const document = await pkg.xml(part);
  const body = descendants(document, "body")[0];
  if (!body) throw new Error("invalid");
  const links = await relationships(pkg, part);
  const blocks: OfficeBlock[] = [];
  const elements = Array.from(body.children).filter(
    (node) => node.localName === "p" || node.localName === "tbl",
  );
  let imageCount = 0;
  let limited = elements.length > MAX_BLOCKS;
  for (const element of elements.slice(0, MAX_BLOCKS)) {
    if (element.localName === "tbl") {
      blocks.push(tableBlock(element));
      limited ||=
        children(element, "tr").length > MAX_ROWS ||
        children(element, "tr").some(
          (row) => children(row, "tc").length > MAX_COLUMNS,
        );
      continue;
    }
    const style = descendants(element, "pStyle")[0];
    const heading = style
      ? Number(/^heading([1-6])$/i.exec(attribute(style, "val"))?.[1]) ||
        undefined
      : undefined;
    const runs = descendants(element, "r")
      .slice(0, 500)
      .map((run) => ({
        text: Array.from(run.children)
          .map((node) =>
            node.localName === "t"
              ? (node.textContent ?? "")
              : node.localName === "br"
                ? "\n"
                : node.localName === "tab"
                  ? "\t"
                  : "",
          )
          .join("")
          .slice(0, 16000),
        bold: descendants(run, "b").some(
          (tag) => !/^(?:0|false|off)$/.test(attribute(tag, "val")),
        ),
        italic: descendants(run, "i").some(
          (tag) => !/^(?:0|false|off)$/.test(attribute(tag, "val")),
        ),
      }));
    if (runs.some((run) => run.text))
      blocks.push({ kind: "text", runs, heading });
    for (const blip of descendants(element, "blip")) {
      if (imageCount >= 32) {
        limited = true;
        break;
      }
      const image = await imageBlock(
        pkg,
        links.get(relationshipId(blip, "embed")),
        "",
      );
      if (image) {
        blocks.push(image);
        imageCount++;
      }
    }
  }
  return { blocks, limited };
}

async function openSlides(pkg: OfficePackage): Promise<OfficePreview> {
  const part = "ppt/presentation.xml";
  const [doc, links] = await Promise.all([
    pkg.xml(part),
    relationships(pkg, part),
  ]);
  const slides = descendants(doc, "sldId").map((entry) =>
    links.get(relationshipId(entry)),
  );
  if (!slides.length || slides.some((slide) => !slide))
    throw new Error("invalid");
  return {
    kind: "slides",
    count: slides.length,
    async read(index) {
      const slide = slides[index];
      if (!slide) throw new Error("invalid");
      const [xml, media] = await Promise.all([
        pkg.xml(slide),
        relationships(pkg, slide),
      ]);
      const tree = descendants(xml, "spTree")[0];
      if (!tree) throw new Error("invalid");
      const elements = descendants(tree, "sp").concat(
        descendants(tree, "pic"),
        descendants(tree, "tbl"),
      );
      const ordered = elements.sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
      );
      const blocks: OfficeBlock[] = [];
      for (const element of ordered.slice(0, 100)) {
        if (element.localName === "tbl") {
          blocks.push(tableBlock(element));
        } else if (element.localName === "pic") {
          const blip = descendants(element, "blip")[0];
          const info = descendants(element, "cNvPr")[0];
          const image = await imageBlock(
            pkg,
            blip && media.get(relationshipId(blip, "embed")),
            info?.getAttribute("descr") ?? "",
          );
          if (image) blocks.push(image);
        } else {
          const type = descendants(element, "ph")[0]?.getAttribute("type");
          for (const paragraph of descendants(element, "p").slice(0, 30)) {
            const text = documentText(paragraph);
            if (text)
              blocks.push({
                kind: "text",
                runs: [{ text }],
                heading:
                  type === "title" || type === "ctrTitle" ? 1 : undefined,
              });
          }
        }
      }
      return { blocks, limited: elements.length > 100 };
    },
  };
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? "";
  let index = 0;
  for (const char of letters) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

async function openWorkbook(pkg: OfficePackage): Promise<OfficePreview> {
  const part = "xl/workbook.xml";
  const [doc, links, strings] = await Promise.all([
    pkg.xml(part),
    relationships(pkg, part),
    pkg.has("xl/sharedStrings.xml")
      ? pkg.xml("xl/sharedStrings.xml")
      : undefined,
  ]);
  const shared = strings ? descendants(strings, "si").map(documentText) : [];
  const sheets = descendants(doc, "sheet").map((node) => ({
    name: node.getAttribute("name") ?? "",
    part: links.get(relationshipId(node)),
  }));
  if (!sheets.length || sheets.some((sheet) => !sheet.part))
    throw new Error("invalid");
  return {
    kind: "sheet",
    names: sheets.map((sheet) => sheet.name),
    async read(index) {
      const target = sheets[index]?.part;
      if (!target) throw new Error("invalid");
      const rows = descendants(await pkg.xml(target), "row");
      let columns = 0;
      let limited = rows.length > MAX_ROWS;
      const data = rows.slice(0, MAX_ROWS).map((row, index) => {
        const values: string[] = [];
        let nextColumn = 0;
        for (const cell of children(row, "c")) {
          const column = columnIndex(cell.getAttribute("r") ?? "");
          const position = column < 0 ? nextColumn : column;
          nextColumn = position + 1;
          if (position >= MAX_COLUMNS) {
            limited = true;
            continue;
          }
          const value = children(cell, "v")[0]?.textContent ?? "";
          const type = cell.getAttribute("t");
          values[position] =
            type === "s" && value
              ? (shared[Number(value)] ?? "")
              : type === "inlineStr"
                ? documentText(cell)
                : type === "b" && value
                  ? value === "1"
                    ? "TRUE"
                    : "FALSE"
                  : value.slice(0, 16000);
        }
        columns = Math.max(columns, values.length);
        return { number: Number(row.getAttribute("r")) || index + 1, values };
      });
      return { rows: data, columns, limited };
    },
  };
}

export async function loadOfficePreview(
  bytes: Uint8Array,
  format: OfficeFormat,
): Promise<OfficePreview> {
  const archive = await openOfficePackage(bytes);
  if (format === "docx") return { kind: "word", page: await readWord(archive) };
  return format === "xlsx" ? openWorkbook(archive) : openSlides(archive);
}
