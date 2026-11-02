import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileTypeIcon, fileTypeFor } from "./FileTypeIcon";
import { AttachmentChip } from "./AttachmentChip";

vi.mock("./useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe("file format presentation", () => {
  it("recognizes paths, legacy Office formats and MIME-only attachments", () => {
    expect(fileTypeFor("C:\\Reports\\预算.XLSM")).toBe("xlsx");
    expect(fileTypeFor("/reports/slides.ppsx")).toBe("pptx");
    expect(fileTypeFor("letter.doc")).toBe("docx");
    expect(fileTypeFor("notes.MD", "text/plain")).toBe("markdown");
    expect(
      fileTypeFor(
        "attachment",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("docx");
    expect(fileTypeFor("download", "application/pdf; charset=binary")).toBe(
      "pdf",
    );
    expect(fileTypeFor("data.tsv")).toBe("csv");
    expect(fileTypeFor("photo", "image/png")).toBe("photo");
    expect(fileTypeFor("data.tar.gz")).toBe("zip");
    expect(fileTypeFor("config.json")).toBe("code");
    expect(fileTypeFor("unknown.bin", "application/octet-stream")).toBe(
      "genericfile",
    );
  });

  it("bundles every approved icon at all display sizes without network requests", () => {
    const names = [
      "a.docx",
      "a.xlsx",
      "a.pptx",
      "a.pdf",
      "a.md",
      "a.txt",
      "a.csv",
      "a.jpg",
      "a.zip",
      "a.json",
      "a.unknown",
    ];
    const { container } = render(
      <>
        {names.flatMap((name) =>
          ([16, 24, 48] as const).map((size) => (
            <FileTypeIcon key={`${name}-${size}`} name={name} size={size} />
          )),
        )}
      </>,
    );
    const icons = container.querySelectorAll("img");
    expect(icons).toHaveLength(33);
    for (const icon of icons) {
      expect(icon.getAttribute("src")).toMatch(
        /file-types\/|^data:image\/svg\+xml/,
      );
      expect(icon.getAttribute("src")).not.toMatch(/^https?:/);
      expect(icon).toHaveAttribute("alt", "");
    }
  });

  it("preserves real image thumbnails and composer removal while using icons for other attachments", () => {
    const remove = vi.fn();
    const { container } = render(
      <>
        <AttachmentChip
          attachment={{
            id: "image",
            kind: "image",
            name: "photo.png",
            mime: "image/png",
            size: 10,
            dataUrl: "data:image/png;base64,AA==",
          }}
          onRemove={remove}
        />
        <AttachmentChip
          attachment={{
            id: "doc",
            kind: "text-file",
            name: "budget.xlsx",
            mime: "application/octet-stream",
            size: 10,
          }}
        />
      </>,
    );
    expect(container.querySelector(".attachment-chip-thumb")).toHaveAttribute(
      "src",
      "data:image/png;base64,AA==",
    );
    expect(container.querySelectorAll(".file-type-icon")).toHaveLength(1);
    expect(container.querySelector(".file-type-icon")).toHaveAttribute(
      "data-file-type",
      "xlsx",
    );
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(remove).toHaveBeenCalledOnce();
  });
});
