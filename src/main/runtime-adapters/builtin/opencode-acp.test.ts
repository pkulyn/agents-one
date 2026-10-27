import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openCodeConversationWorkspace } from "./opencode-acp";

let userData = "";

afterEach(() => {
  vi.unstubAllEnvs();
  const temporaryParent = `${resolve(tmpdir())}${sep}`;
  if (userData && resolve(userData).startsWith(temporaryParent)) {
    rmSync(userData, { recursive: true, force: true });
  }
  userData = "";
});

describe("OpenCode no-project workspace", () => {
  it("uses the Agents One profile data root instead of the system temp directory", () => {
    userData = mkdtempSync(join(tmpdir(), "agents-one-opencode-cwd-"));
    vi.stubEnv("AGENTS_ONE_USER_DATA_DIR", userData);

    expect(openCodeConversationWorkspace("writer")).toBe(
      join(
        userData,
        "data",
        "profiles",
        "writer",
        "desktop",
        "runtime-chat",
        "opencode",
      ),
    );
  });
});
