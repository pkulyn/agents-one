import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareRuntimeInputs } from "../src/main/runtime-inputs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "hermes-runtime-inputs-"));
  roots.push(value);
  return value;
}

describe("Runtime input staging", () => {
  it("copies explicit text and document inputs into a private task directory", () => {
    const staging = root();
    const source = join(staging, "source.pdf");
    writeFileSync(source, "document bytes");

    const result = prepareRuntimeInputs(
      undefined,
      [
        {
          id: "text-1",
          kind: "text-file",
          name: "brief.md",
          mime: "text/markdown",
          size: 13,
          text: "# Brief\nHello",
        },
        {
          id: "doc-1",
          kind: "path-ref",
          name: "source.pdf",
          mime: "application/pdf",
          size: 14,
          path: source,
        },
      ],
      "task-1",
      join(staging, "private-inputs"),
    );

    expect(result.artifacts.map((artifact) => artifact.name)).toEqual([
      "brief.md",
      "source.pdf",
    ]);
    expect(result.promptContext).toContain(result.directory!);
    expect(readFileSync(result.files[0].path, "utf8")).toBe("# Brief\nHello");
    expect(readFileSync(result.files[1].path, "utf8")).toBe("document bytes");
    expect(result.files[1].path).not.toBe(source);
  });

  it("rejects secret-like file names before a Runtime can access them", () => {
    expect(() =>
      prepareRuntimeInputs(
        undefined,
        [
          {
            id: "secret-1",
            kind: "text-file",
            name: ".env",
            mime: "text/plain",
            size: 8,
            text: "TOKEN=x",
          },
        ],
        "task-2",
        root(),
      ),
    ).toThrow(/excluded/i);
  });
});
