import { verifyDesktopResource } from "./verify-desktop-resource.mjs";
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

  verifyDesktopResource(join(outputDirectory, "resources", "app.asar"));

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
  const { appInfo } = packager;
  const productName = appInfo.productName || appInfo.productFilename;
  const productVersion = appInfo.version;
  const buildVersion = appInfo.buildVersion || productVersion;
  if (!productName || !productVersion || !buildVersion) {
    throw new Error(
      "Windows package is missing product name or version metadata.",
    );
  }
  const numericVersion = buildVersion.split("-")[0].split("+")[0];
  const versionInfos = Resource.VersionInfo.fromEntries(resources.entries);
  if (!versionInfos.length)
    versionInfos.push(Resource.VersionInfo.createEmpty());
  for (const info of versionInfos) {
    info.setFileVersion(numericVersion);
    info.setProductVersion(numericVersion);
    const languages = info.getAllLanguagesForStringValues();
    if (!languages.length) languages.push({ lang: 1033, codepage: 1200 });
    for (const language of languages) {
      info.setStringValues(language, {
        ...info.getStringValues(language),
        FileDescription: productName,
        ProductName: productName,
        InternalName: executableName,
        OriginalFilename: `${executableName}.exe`,
        FileVersion: buildVersion,
        ProductVersion: productVersion,
      });
    }
    info.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  await writeFile(executablePath, Buffer.from(executable.generate()));
  console.log(
    "[Agents One] Embedded Windows application icon and Agents One product identity.",
  );
}
