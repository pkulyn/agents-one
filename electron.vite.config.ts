import { resolveDesktopContentSecurityPolicy } from "./src/shared/desktop-csp";
import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildSync } from "esbuild";
import { createDesktopSourceReceipt } from "./scripts/desktop-source-receipt.mjs";

const rendererPort = Number(
  process.env.AGENTS_ONE_RENDERER_PORT ||
    process.env.HERMES_DESKTOP_RENDERER_PORT ||
    0,
);

// Auto-update is a build-time capability, not a runtime environment switch.
// Unsigned public Alpha builds leave this false. A future signed pipeline may
// opt in only after its update source and rollback path have been verified.
const signedAutoUpdateBuild =
  process.env.AGENTS_ONE_SIGNED_AUTO_UPDATE_BUILD === "1";

export default defineConfig({
  main: {
    plugins: [
      {
        name: "agents-one-mobile-workers",
        generateBundle() {
          if (process.env.AGENTS_ONE_RELEASE_BUILD === "1") {
            this.emitFile({
              type: "asset",
              fileName: "desktop-source-receipt.json",
              source: JSON.stringify(createDesktopSourceReceipt(process.cwd())),
            });
          }
          for (const [entry, fileName] of [
            [
              "src/main/mobile-control/project-text-write-worker.ts",
              "project-text-write-worker.cjs",
            ],
            [
              "src/main/mobile-control/owner-ledger-worker.ts",
              "mobile-owner-ledger-worker.cjs",
            ],
            [
              "src/main/mobile-control/owner-tunnel-worker.ts",
              "mobile-owner-tunnel-worker.cjs",
            ],
          ]) {
            const bundle = buildSync({
              entryPoints: [resolve(entry)],
              bundle: true,
              platform: "node",
              format: "cjs",
              external: ["electron", "bufferutil", "utf-8-validate"],
              write: false,
            });
            this.emitFile({
              type: "asset",
              fileName,
              source: bundle.outputFiles[0].text,
            });
          }
        },
      },
    ],
    define: {
      __AGENTS_ONE_SIGNED_AUTO_UPDATE_BUILD__: JSON.stringify(
        signedAutoUpdateBuild,
      ),
    },
    build: {
      // electron-builder can omit JavaScript-only external packages from
      // app.asar when its production-dependency collector sees a package's
      // manifest but not its published output directory. Bundle the main
      // process packages instead; keep better-sqlite3 external because it
      // loads a native .node binary that is unpacked separately below.
      externalizeDeps: {
        exclude: [
          "@anthropic-ai/claude-agent-sdk",
          "@electron-toolkit/utils",
          "electron-updater",
          "i18next",
          "tar",
          "ws",
          "yaml",
        ],
      },
      rollupOptions: {
        // ws catches missing optional native accelerators and uses its
        // JavaScript implementation. Keep those requires inside ws's try/catch.
        external: ["better-sqlite3", "bufferutil", "utf-8-validate"],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          askpass: resolve("src/preload/askpass.ts"),
        },
      },
    },
  },
  renderer: {
    ...(rendererPort > 0
      ? {
          server: {
            port: rendererPort,
            strictPort: false,
          },
        }
      : {}),
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [
      tailwindcss(),
      react(),
      {
        name: "agents-one-development-csp",
        apply: "serve",
        transformIndexHtml(html) {
          const pattern =
            /(http-equiv="Content-Security-Policy"\s+content=")[^"]+("\s*\/?>)/;
          if (!pattern.test(html))
            throw Error("Renderer CSP metadata is missing");
          return html.replace(
            pattern,
            (_, prefix, suffix) =>
              prefix + resolveDesktopContentSecurityPolicy(true) + suffix,
          );
        },
      },
    ],
  },
});
