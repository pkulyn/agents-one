import { loadConfigFromFile, type Plugin } from "vite";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import {
  PRODUCTION_DESKTOP_CSP,
  resolveDesktopContentSecurityPolicy,
} from "../src/shared/desktop-csp";
// @lat: [[main-process#Production desktop script policy]]
it("uses a strict source HTML policy and only opts into inline scripts for development", () => {
  const html = readFileSync(resolve("src/renderer/index.html"), "utf8");
  expect(html).toContain('content="' + PRODUCTION_DESKTOP_CSP + '"');
  expect(resolveDesktopContentSecurityPolicy()).not.toContain(
    "script-src 'self' 'unsafe-inline'",
  );
  expect(resolveDesktopContentSecurityPolicy()).not.toContain("unsafe-eval");
  expect(resolveDesktopContentSecurityPolicy(true)).toContain(
    "script-src 'self' 'unsafe-inline'",
  );
});
it.skipIf(process.platform !== "win32")(
  "blocks inline scripts and event handlers in real isolated Electron while loading same-origin scripts",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "agents-one-csp-"));
    try {
      writeFileSync(
        join(directory, "allowed.js"),
        'window.externalLoaded=true;try{new Function("window.evalRan=true")()}catch{window.evalBlocked=true}try{new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));window.wasmRan=true}catch{window.wasmBlocked=true}',
      );
      writeFileSync(
        join(directory, "index.html"),
        '<!doctype html><meta http-equiv="Content-Security-Policy" content="' +
          PRODUCTION_DESKTOP_CSP +
          '"><button id="test" onclick="window.handlerRan=true">test</button><script>window.inlineRan=true</script><script src="./allowed.js"></script>',
      );
      const main = join(directory, "main.cjs");
      writeFileSync(
        main,
        'const {app,BrowserWindow}=require("electron");const path=require("node:path");app.setPath("userData",path.join(__dirname,"profile"));app.disableHardwareAcceleration();app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await w.loadFile(path.join(__dirname,"index.html"));const result=await w.webContents.executeJavaScript(\'document.getElementById("test").click();JSON.stringify({external:window.externalLoaded===true,inline:window.inlineRan===true,handler:window.handlerRan===true,eval:window.evalRan===true,evalBlocked:window.evalBlocked===true,wasm:window.wasmRan===true,wasmBlocked:window.wasmBlocked===true})\');console.log("CSP_RESULT="+result);w.destroy();app.quit();}).catch(e=>{console.error(e.message);app.exit(1);});',
      );
      const electron = createRequire(import.meta.url)("electron") as string;
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(electron, [main], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 25000,
        env: environment,
      });
      expect(result.status, result.stderr).toBe(0);
      const line = result.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("CSP_RESULT="));
      expect(line).toBeDefined();
      expect(JSON.parse(line!.slice(11))).toEqual({
        external: true,
        inline: false,
        handler: false,
        eval: false,
        evalBlocked: true,
        wasm: false,
        wasmBlocked: true,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  35000,
);

it("loads the actual serve-only Vite plugin and grants only the development inline exception", async () => {
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "development" },
    resolve("electron.vite.config.ts"),
  );
  const config = loaded!.config as {
    renderer: { plugins: Array<Plugin | Plugin[]> };
  };
  const plugin = config.renderer.plugins
    .flat()
    .find((p) => p.name === "agents-one-development-csp")!;
  expect(plugin.apply).toBe("serve");
  const hook = plugin.transformIndexHtml;
  if (typeof hook !== "function") throw Error("missing transform");
  const html = readFileSync(resolve("src/renderer/index.html"), "utf8");
  const transformed = await hook(html, {
    path: "/",
    filename: resolve("src/renderer/index.html"),
  });
  expect(transformed).toContain("script-src 'self' 'unsafe-inline';");
  expect(transformed).not.toContain("unsafe-eval");
});
