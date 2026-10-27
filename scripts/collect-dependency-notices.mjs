import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute, sep } from "node:path";

const noticeName = /^(?:licen[cs]e|copying|notice|copyright)(?:[._-].*)?$/i;

// @lat: [[brand-startup#Packaged dependency notices]]
export function collectDependencyNotices(project) {
  const root = resolve(project);
  const lockBytes = readFileSync(join(root, "package-lock.json"));
  const lock = JSON.parse(lockBytes);
  const packages = [];
  const skippedOptional = [];
  const sections = [
    "Agents One production dependency notices",
    "Original package declarations and notice files are retained below. Project MIT licensing does not replace these terms.",
  ];
  for (const [location, entry] of Object.entries(lock.packages).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (!location || entry.dev === true || entry.link) continue;
    const directory = resolve(root, location);
    const rel = relative(root, directory);
    if (
      !location.startsWith("node_modules/") ||
      isAbsolute(rel) ||
      rel === ".." ||
      rel.startsWith(".." + sep)
    )
      throw Error("Invalid dependency lock location");
    const manifestPath = join(directory, "package.json");
    if (!existsSync(manifestPath)) {
      if (entry.optional) {
        skippedOptional.push(location);
        continue;
      }
      throw Error("Required dependency is missing: " + location);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.version !== entry.version)
      throw Error("Dependency version does not match lock: " + location);
    const files = readdirSync(directory)
      .filter(
        (name) =>
          noticeName.test(name) && statSync(join(directory, name)).isFile(),
      )
      .sort();
    const standalone = files.length > 0;
    if (!standalone) {
      const readme = readdirSync(directory).find((name) =>
        /^readme(?:\.[a-z]+)?$/i.test(name),
      );
      if (readme) files.push(readme);
    }
    const declaredLicense =
      manifest.license || manifest.licenses || entry.license || "Not declared";
    const notices = files.map((name) => {
      const bytes = readFileSync(join(directory, name));
      if (bytes.length > 2 * 1024 * 1024)
        throw Error("Unexpectedly large dependency notice: " + location);
      return {
        name,
        text: bytes.toString("utf8"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    });
    const item = {
      name: manifest.name,
      version: manifest.version,
      location,
      declaredLicense,
      author: manifest.author,
      repository: manifest.repository,
      integrity: entry.integrity,
      standaloneNotice: standalone,
      files: notices.map(({ name, sha256 }) => ({ name, sha256 })),
    };
    packages.push(item);
    sections.push(
      "=".repeat(72),
      JSON.stringify(item, null, 2),
      ...notices.map((n) => "--- " + n.name + " ---\n" + n.text),
    );
  }
  const index = {
    schema: 1,
    scope:
      "Installed production lockfile dependencies; optional packages absent on this platform are listed separately. This inventory is not a blanket MIT grant or a legal approval.",
    lockfileSha256: createHash("sha256").update(lockBytes).digest("hex"),
    packages,
    skippedOptional,
    withoutStandaloneNotice: packages
      .filter((p) => !p.standaloneNotice)
      .map((p) => ({ name: p.name, version: p.version })),
  };
  return { index, text: sections.join("\n\n") + "\n" };
}
