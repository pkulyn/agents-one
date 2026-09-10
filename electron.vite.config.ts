import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
    define: {
      __AGENTS_ONE_SIGNED_AUTO_UPDATE_BUILD__: JSON.stringify(
        signedAutoUpdateBuild,
      ),
    },
    build: {
      rollupOptions: {
        external: ["better-sqlite3"],
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
    plugins: [tailwindcss(), react()],
  },
});
