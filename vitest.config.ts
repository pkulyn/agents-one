import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src/renderer/src"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    globals: true,
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "main",
          environment: "node",
          globals: true,
          include: [
            "src/main/**/*.test.ts",
            "src/shared/**/*.test.ts",
            "tests/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "renderer",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/renderer/src/test/setup.ts"],
          include: [
            "src/renderer/src/**/*.test.ts",
            "src/renderer/src/**/*.test.tsx",
          ],
        },
      },
    ],
  },
});
