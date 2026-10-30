import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isToolDeletion } from "../src/tool-permission-policy.mjs";

// @lat: [[runtime-chat#Hermes Run policy before smart approval]]
test("Hermes per-Run policy precedes Smart and preserves unrelated clients", (t) => {
  const python = [process.env.PYTHON, "python", "python3"].filter(Boolean).find(
    (candidate) =>
      spawnSync(candidate, ["--version"], {
        windowsHide: true,
        timeout: 5000,
      }).status === 0,
  );
  if (!python)
    return t.skip(
      "Python 3 is unavailable for the optional native Hermes policy integration",
    );
  const pairs = [
    ["delete_document", { path: "document.md" }],
    ["terminal", { command: "powershell -Command Remove-Item document.md" }],
    ["terminal", { command: "python generate_docx.py" }],
    ["terminal", { command: ["rm", "document.md"] }],
    ["terminal", { code: "os.remove('document.md')" }],
    [
      "terminal",
      { code: "paragraph._element.getparent().remove(paragraph._element)" },
    ],
    ["patch", { patchText: "*** Delete File: document.md" }],
    [
      "file_change",
      { changes: [{ kind: { type: "delete" }, path: "document.md" }] },
    ],
    ["file_change", { fileChanges: { "document.md": { type: "delete" } } }],
    ["write_file", { content: "delete this sentence" }],
    ["read_file", { path: "document.md" }],
    ["mcp__delete_document", { input: { id: "doc" } }],
  ];
  const result = spawnSync(
    python,
    [
      fileURLToPath(
        new URL("./hermes-run-permissions.test.py", import.meta.url),
      ),
    ],
    {
      input: JSON.stringify(
        pairs.map(([name, input]) => ({
          name,
          input,
          deletion: isToolDeletion(name, input),
        })),
      ),
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
