import { createRequire } from "node:module";
import { posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyMobileResource } from "./verify-mobile-resource.mjs";

const asar = createRequire(import.meta.url)("@electron/asar");

/** Inspect only chunks reachable from the package's actual Renderer entry. */
export function verifyDesktopResource(archive) {
  const mobile = verifyMobileResource(archive);
  const files = new Map(
    asar
      .listPackage(archive)
      .map((name) => [
        name.replaceAll("\\", "/").replace(/^\//, ""),
        name.replace(/^[/\\]/, ""),
      ]),
  );
  const read = (name) => {
    const key = files.get(name);
    if (!key) throw Error("desktop_resource_missing:" + name);
    return asar.extractFile(archive, key).toString();
  };
  const html = read("out/renderer/index.html");
  const entries = [
    ...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)["']/g),
  ];
  if (entries.length !== 1) throw Error("desktop_renderer_entry_ambiguous");
  const rendererEntry = posix.normalize(
    posix.join("out/renderer", entries[0][1]),
  );
  const visited = new Set();
  const chunks = [];
  const visit = (file) => {
    if (!file.startsWith("out/renderer/"))
      throw Error("desktop_renderer_path_invalid");
    if (visited.has(file)) return;
    visited.add(file);
    const code = read(file);
    chunks.push(code);
    for (const match of code.matchAll(/["'](\.{1,2}\/[^"'?#]+\.js)["']/g)) {
      visit(posix.normalize(posix.join(posix.dirname(file), match[1])));
    }
  };
  visit(rendererEntry);
  const renderer = chunks.join("\n");
  for (const marker of [
    "mobile-owner-settings",
    "settings.mobile.title",
    "web-agent-opt-in",
    "attachment-chip-body",
  ]) {
    if (!renderer.includes(marker))
      throw Error("desktop_renderer_missing:" + marker);
  }
  const main = read("out/main/" + mobile.importedMain);
  for (const marker of [
    "desktop_auto",
    "desktop_full_access",
    "runtime-conversations.json",
    "project-folders.json",
  ]) {
    if (!main.includes(marker)) throw Error("desktop_main_missing:" + marker);
  }
  return {
    ...mobile,
    rendererEntry,
    reachableRendererChunks: visited.size,
    mobileSettings: true,
    webAgentOptIn: true,
    projectlessPermissions: true,
    attachmentCards: true,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(verifyDesktopResource(resolve(process.argv[2]))),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
