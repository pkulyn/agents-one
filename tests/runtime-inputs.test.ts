import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
let testHome: string;

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "hermes-runtime-inputs-"));
  roots.push(value);
  return value;
}

async function loadModules(): Promise<{
  prepareRuntimeInputs: typeof import("../src/main/runtime-inputs").prepareRuntimeInputs;
  stageAttachment: typeof import("../src/main/attachment-staging").stageAttachment;
}> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  const inputs = await import("../src/main/runtime-inputs");
  const staging = await import("../src/main/attachment-staging");
  return {
    prepareRuntimeInputs: inputs.prepareRuntimeInputs,
    stageAttachment: staging.stageAttachment,
  };
}

describe("Runtime input staging", () => {
  beforeEach(() => {
    testHome = root();
  });

  it("copies explicit text and staged document inputs into a private task directory", async () => {
    const { prepareRuntimeInputs, stageAttachment } = await loadModules();
    const staging = root();
    const source = stageAttachment(
      "session-1",
      "source.pdf",
      Buffer.from("document bytes").toString("base64"),
    );

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

  it("rejects secret-like file names before a Runtime can access them", async () => {
    const { prepareRuntimeInputs } = await loadModules();
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

  it("rejects arbitrary renderer paths that were not staged by the main process", async () => {
    const { prepareRuntimeInputs } = await loadModules();
    const source = join(root(), "untrusted.pdf");
    writeFileSync(source, "document bytes");
    expect(() =>
      prepareRuntimeInputs(
        undefined,
        [
          {
            id: "untrusted-1",
            kind: "path-ref",
            name: "untrusted.pdf",
            mime: "application/pdf",
            size: 14,
            path: source,
          },
        ],
        "task-3",
        root(),
      ),
    ).toThrow(/main-process staged attachment/i);
  });
});
