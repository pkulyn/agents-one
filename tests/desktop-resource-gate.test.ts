import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createPackage } from "@electron/asar";
import { afterEach, describe, expect, it } from "vitest";

const folders: string[] = [];
const main =
  "conversation:read schedule:read artifact:read mobile-owner-tunnel-worker.cjs mobile-owner-ledger-worker.cjs desktop_auto desktop_full_access runtime-conversations.json project-folders.json";
const renderer =
  "mobile-owner-settings settings.mobile.title web-agent-opt-in attachment-chip-body";

async function fixture(
  overrides: Record<string, string> = {},
): Promise<string> {
  const folder = mkdtempSync(join(tmpdir(), "agents-one-feature-gate-"));
  folders.push(folder);
  const files = {
    "out/main/index.js": 'require("./start-test.js");',
    "out/main/start-test.js": main,
    "out/main/mobile-owner-tunnel-worker.cjs": "worker",
    "out/main/mobile-owner-ledger-worker.cjs": "worker",
    "out/renderer/index.html":
      '<script type="module" src="./assets/index.js"></script>',
    "out/renderer/assets/index.js": renderer,
    ...overrides,
  };
  for (const [name, content] of Object.entries(files)) {
    const file = join(folder, "source", name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const archive = join(folder, "app.asar");
  await createPackage(join(folder, "source"), archive);
  return archive;
}

async function verify(archive: string): Promise<unknown> {
  const gate = await import(
    pathToFileURL(resolve("scripts/verify-desktop-resource.mjs")).href
  );
  return gate.verifyDesktopResource(archive);
}

afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

describe("cumulative desktop package gate", () => {
  it("accepts mobile and web settings in the actual imported package", async () => {
    await expect(verify(await fixture())).resolves.toMatchObject({
      mobileSettings: true,
      webAgentOptIn: true,
      independentTransport: true,
    });
  });

  it("rejects a mobile-free Main even when an unused complete chunk is left over", async () => {
    await expect(
      verify(
        await fixture({
          "out/main/start-test.js": "legacy local pairing",
          "out/main/start-unused.js": main,
        }),
      ),
    ).rejects.toThrow("mobile_resource_missing:conversation:read");
  });

  it.each(["mobile-owner-settings", "web-agent-opt-in"])(
    "rejects missing %s in the loaded Renderer despite an unused good chunk",
    async (marker) => {
      await expect(
        verify(
          await fixture({
            "out/renderer/assets/index.js": renderer.replace(marker, ""),
            "out/renderer/assets/unused.js": renderer,
          }),
        ),
      ).rejects.toThrow("desktop_renderer_missing:" + marker);
    },
  );

  it("checks settings loaded through a reachable split chunk", async () => {
    await expect(
      verify(
        await fixture({
          "out/renderer/assets/index.js": 'import("./settings.js");',
          "out/renderer/assets/settings.js": renderer,
        }),
      ),
    ).resolves.toMatchObject({ reachableRendererChunks: 2 });
  });

  it("rejects projectless permission regression even when settings are present", async () => {
    await expect(
      verify(
        await fixture({
          "out/main/start-test.js": main.replace(
            "desktop_auto",
            "desktop_analysis",
          ),
        }),
      ),
    ).rejects.toThrow("desktop_main_missing:desktop_auto");
  });
});
