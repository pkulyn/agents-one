import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const resizeScript = resolve(root, "scripts/resize-brand-icon.ps1");
const markPath = resolve(root, "src/renderer/src/assets/agents-one-mark.svg");
const pngTargets = [resolve(root, "build/icon.png"), resolve(root, "resources/icon.png")];
const icoTarget = resolve(root, "build/icon.ico");
const iconSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

async function renderPng(size, target) {
  await execFileAsync(chrome, [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    `--window-size=${size},${size}`,
    `--screenshot=${target}`,
    pathToFileURL(markPath).href,
  ]);
}

const tempDir = await mkdtemp(resolve(tmpdir(), "agents-one-brand-"));
try {
  const masterPath = resolve(tempDir, "icon-512.png");
  await renderPng(512, masterPath);
  const masterPng = await readFile(masterPath);
  await Promise.all(pngTargets.map((target) => writeFile(target, masterPng)));

  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    resizeScript,
    "-SourcePath",
    masterPath,
    "-OutputDirectory",
    tempDir,
    "-SizesCsv",
    iconSizes.join(","),
  ]);
  const images = await Promise.all(
    iconSizes.map(async (size) => ({
      size,
      png: await readFile(resolve(tempDir, `icon-${size}.png`)),
    })),
  );
  await writeFile(icoTarget, makeIco(images));
  console.log(`Generated Agents One PNG assets and ${images.length}-size Windows ICO.`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
