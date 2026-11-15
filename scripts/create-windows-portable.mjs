import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

/** Build a ZIP-only portable payload without marking the installer payload. */
export async function createWindowsPortable(distDirectory, version) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    throw Error("Invalid portable package version");
  const dist = resolve(distDirectory);
  const source = join(dist, "win-unpacked");
  for (const file of ["agents-one.exe", "resources/app.asar"])
    if (!existsSync(join(source, file)))
      throw Error(`Missing packaged application: ${file}`);
  const marker = "resources/agents-one-portable.json";
  if (existsSync(join(source, marker)))
    throw Error("Installer payload must not contain a portable marker");
  const archive = join(dist, `agents-one-${version}-portable.zip`);
  const sevenZip =
    await require("app-builder-lib/out/toolsets/7zip.js").getPath7za();
  const staging = mkdtempSync(join(dist, ".portable-zip-"));
  try {
    const folder = `agents-one-${version}-portable`;
    const payload = join(staging, folder);
    cpSync(source, payload, { recursive: true, dereference: false });
    mkdirSync(join(payload, "resources"), { recursive: true });
    writeFileSync(
      join(payload, marker),
      JSON.stringify({ schema: 1, mode: "agents-one-portable" }) + "\n",
    );
    writeFileSync(
      join(payload, "PORTABLE-README.txt"),
      "Agents One Windows x64 portable\r\n\r\n" +
        "Extract the entire ZIP once, then run agents-one.exe. Keep all files and folders together.\r\n" +
        "No installation or extraction is performed on subsequent launches.\r\n\r\n" +
        "Desktop data: %LOCALAPPDATA%\\agents-one-portable\r\n" +
        "This shares existing single-EXE portable data on this Windows account, not installed/development data.\r\n" +
        "Credentials are protected for this Windows account; copying program files does not transfer credentials.\r\n" +
        "To update: exit Agents One, extract the new ZIP into a new folder, and launch it.\r\n\r\n" +
        "首次请完整解压 ZIP，再运行 agents-one.exe；后续启动无需解压，请保留全部文件。\r\n" +
        "用户数据保存在 %LOCALAPPDATA%\\agents-one-portable，沿用本机旧便携版数据。\r\n" +
        "更新前正常退出程序，将新包解压到新目录运行；不要仅复制 EXE。\r\n",
      "utf8",
    );
    // A fresh output prevents old archive members surviving a rebuild.
    rmSync(archive, { force: true });
    execFileSync(sevenZip, ["a", "-tzip", "-mx=5", archive, folder], {
      cwd: staging,
      stdio: "pipe",
      windowsHide: true,
    });
    const listing = execFileSync(sevenZip, ["l", "-slt", archive], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (!listing.includes("agents-one-portable.json"))
      throw Error("Portable archive is missing its mode marker");
    return archive;
  } finally {
    // Only the exact directory created above is disposable.
    rmSync(staging, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const dist = resolve(process.argv[2] ?? "dist");
  mkdirSync(dist, { recursive: true });
  if (
    readdirSync(dist).some((name) => /^agents-one-.*-portable\.exe$/.test(name))
  )
    throw Error("Remove stale single-EXE portable output before ZIP packaging");
  console.log(await createWindowsPortable(dist, version));
}
