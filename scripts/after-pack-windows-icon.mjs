import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

export default async function applyWindowsExecutableIcon(context) {
  if (context.electronPlatformName !== "win32") return;

  const packager = context.packager;
  const outputDirectory = resolve(context.appOutDir);
  const executableName =
    packager.platformSpecificBuildOptions.executableName ||
    packager.appInfo.productFilename;
  const executablePath = resolve(outputDirectory, `${executableName}.exe`);
  if (dirname(executablePath) !== outputDirectory) {
    throw new Error("Windows icon target must be inside the package output.");
  }

  const iconPath = await packager.getIconPath();
  if (!iconPath) throw new Error("Windows package has no application icon.");
  const projectRequire = createRequire(
    join(packager.projectDir, "package.json"),
  );
  const { NtExecutable, NtExecutableResource, Data, Resource } =
    projectRequire("resedit");
  const executable = NtExecutable.from(await readFile(executablePath));
  const resources = NtExecutableResource.from(executable);
  const iconFile = Data.IconFile.from(await readFile(iconPath));
  const existingGroup = Resource.IconGroupEntry.fromEntries(
    resources.entries,
  )[0];
  Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries,
    existingGroup?.id ?? 1,
    existingGroup?.lang ?? 1033,
    iconFile.icons.map((icon) => icon.data),
  );
  resources.outputResource(executable);
  await writeFile(executablePath, Buffer.from(executable.generate()));
  console.log("[Agents One] Embedded Windows rainbow-ring application icon.");
}
