import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  prepared: vi.fn(),
  context: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock("../src/main/pi-capabilities", () => ({
  verifyPiStrictCapabilities: async (invocation: unknown) => ({
    invocation,
    assertUnchanged: (): void => {},
  }),
}));
vi.mock("../src/main/pi-config-policy", () => ({
  assertPiNonExecutingConfig: (): void => {},
}));
vi.mock("../src/main/pi-query-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/pi-query-context")>()),
  createPiQueryContext: fixture.context,
}));
vi.mock("../src/main/runtime-inputs", () => ({
  prepareRuntimeInputs: fixture.prepared,
}));
vi.mock("child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("child_process")>()),
  spawn: fixture.spawn,
}));
import { startPiProcess } from "../src/main/pi-runtime";
const project = fs.mkdtempSync(path.join(tmpdir(), "pi-query-cancel-"));
afterAll(() => {
  if (
    !path.resolve(project).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(project).startsWith("pi-query-cancel-")
  )
    throw Error("Unsafe fixture");
  fs.rmSync(project, { recursive: true, force: true });
});
it("does not send a task cancelled while its helper namespace is being checked", async () => {
  let complete!: (value: unknown) => void;
  let allowed = true;
  fixture.context.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const pending = startPiProcess(
    { executablePath: "pi" },
    { mode: "safe_write", prompt: "cancelled fixture", workspace: project },
    () => {},
    () => allowed,
  );
  await vi.waitFor(() => expect(fixture.context).toHaveBeenCalledOnce());
  allowed = false;
  complete({
    binding: { directory: project, identity: "unused" },
    environment: {},
  });
  await expect(pending).rejects.toThrow("cancelled");
  expect(fixture.prepared).not.toHaveBeenCalled();
  expect(fixture.spawn).not.toHaveBeenCalled();
});
