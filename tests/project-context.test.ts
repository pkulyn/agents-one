import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareProjectContextAttachment } from "../src/main/project-context";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "agents-one-project-context-"));
  roots.push(root);
  return root;
}

describe("remote project context", () => {
  it("builds a bounded snapshot with relative project files", async () => {
    const root = projectRoot();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "README.md"), "# Demo");
    writeFileSync(join(root, "src", "index.ts"), "export const ok = true;");

    const attachment = await prepareProjectContextAttachment(root);

    expect(attachment.kind).toBe("text-file");
    expect(attachment.text).toContain("--- PROJECT FILE: README.md ---");
    expect(attachment.text).toContain("--- PROJECT FILE: src/index.ts ---");
    expect(attachment.text).toContain("Evidence manifest (content sent in this snapshot):");
    expect(attachment.text).toMatch(/README\.md \| \d+ bytes \| SHA-256: [a-f0-9]{64}/i);
    expect(attachment.text).not.toMatch(/<\/?file\b/i);
    expect(attachment.text).not.toContain(root);
    expect(attachment.size).toBeLessThanOrEqual(256 * 1024);
  });

  it("excludes dependencies and credential-like files", async () => {
    const root = projectRoot();
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", "package.js"), "do not share");
    writeFileSync(join(root, ".env"), "TOKEN=secret");
    writeFileSync(join(root, "credentials.json"), "secret");
    writeFileSync(join(root, "app.ts"), "console.log('safe')");

    const attachment = await prepareProjectContextAttachment(root);

    expect(attachment.text).toContain("app.ts");
    expect(attachment.text).not.toContain("do not share");
    expect(attachment.text).not.toContain("TOKEN=secret");
    expect(attachment.text).not.toContain("credentials.json");
  });
});
