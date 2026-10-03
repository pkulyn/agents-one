import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const frameHashes = (frames: Buffer[]): string[] =>
  frames.map((frame) => createHash("sha256").update(frame).digest("hex"));

function peIconResources(executable: Buffer): {
  frames: Buffer[];
  otherResources: Record<string, string>;
} {
  const pe = executable.readUInt32LE(0x3c);
  expect(executable.toString("ascii", pe, pe + 4)).toBe("PE\u0000\u0000");
  const optional = pe + 24;
  const directories =
    optional + (executable.readUInt16LE(optional) === 0x20b ? 112 : 96);
  const sectionTable = optional + executable.readUInt16LE(pe + 20);
  const sections = Array.from(
    { length: executable.readUInt16LE(pe + 6) },
    (_, index) => sectionTable + index * 40,
  );
  const offsetForRva = (rva: number): number => {
    const section = sections.find((entry) => {
      const start = executable.readUInt32LE(entry + 12);
      return (
        rva >= start &&
        rva <
          start +
            Math.max(
              executable.readUInt32LE(entry + 8),
              executable.readUInt32LE(entry + 16),
            )
      );
    });
    if (section === undefined)
      throw new Error("PE resource RVA has no section");
    return (
      executable.readUInt32LE(section + 20) +
      rva -
      executable.readUInt32LE(section + 12)
    );
  };
  const resource = offsetForRva(executable.readUInt32LE(directories + 16));
  const entries = (
    relative: number,
  ): Array<{ id: number; target: number; label: string }> => {
    const directory = resource + relative;
    const count =
      executable.readUInt16LE(directory + 12) +
      executable.readUInt16LE(directory + 14);
    return Array.from({ length: count }, (_, index) => {
      const entry = directory + 16 + index * 8;
      const id = executable.readUInt32LE(entry);
      const nameOffset = resource + (id & 0x7fffffff);
      return {
        id,
        label:
          id & 0x80000000
            ? executable.toString(
                "utf16le",
                nameOffset + 2,
                nameOffset + 2 + executable.readUInt16LE(nameOffset) * 2,
              )
            : String(id),
        target: executable.readUInt32LE(entry + 4) & 0x7fffffff,
      };
    });
  };
  const resourceType = (
    id: number,
  ): Array<{ id: number; target: number; label: string }> => {
    const entry = entries(0).find((entry) => entry.id === id);
    if (!entry) throw new Error(`Missing PE resource type ${id}`);
    return entries(entry.target);
  };
  const dataLeaf = (relative: number): Buffer => {
    const descriptor = resource + relative;
    const offset = offsetForRva(executable.readUInt32LE(descriptor));
    return executable.subarray(
      offset,
      offset + executable.readUInt32LE(descriptor + 4),
    );
  };
  const dataFor = (relative: number): Buffer =>
    dataLeaf(entries(relative)[0].target);
  const otherResources: Record<string, string> = {};
  for (const type of entries(0)) {
    if (type.id === 3 || type.id === 14) continue;
    for (const name of entries(type.target)) {
      for (const language of entries(name.target)) {
        otherResources[`${type.label}/${name.label}/${language.label}`] =
          createHash("sha256").update(dataLeaf(language.target)).digest("hex");
      }
    }
  }
  const group = dataFor(resourceType(14)[0].target);
  const icons = resourceType(3);
  const frames = Array.from({ length: group.readUInt16LE(4) }, (_, index) => {
    const id = group.readUInt16LE(6 + index * 14 + 12);
    const icon = icons.find((entry) => entry.id === id);
    if (!icon) throw new Error(`Missing PE icon ${id}`);
    return dataFor(icon.target);
  });
  return { frames, otherResources };
}

describe("Windows packaged executable icon", () => {
  // @lat: [[brand-startup#Windows executable icon#Other platform isolation]]
  it("leaves non-Windows packages untouched", async () => {
    const hook = await import(
      pathToFileURL(resolve("scripts/after-pack-windows-icon.mjs")).href
    );
    await expect(hook.default({ electronPlatformName: "linux" })).resolves.toBe(
      undefined,
    );
  });

  // @lat: [[brand-startup#Windows executable icon#Output path boundary]]
  it("rejects an executable target outside the package directory", async () => {
    const hook = await import(
      pathToFileURL(resolve("scripts/after-pack-windows-icon.mjs")).href
    );
    await expect(
      hook.default({
        electronPlatformName: "win32",
        appOutDir: tmpdir(),
        packager: {
          platformSpecificBuildOptions: { executableName: "../outside" },
          appInfo: { productFilename: "Agents One" },
        },
      }),
    ).rejects.toThrow("inside the package output");
  });

  // @lat: [[brand-startup#Windows executable icon#Embedded icon frames]]
  it.skipIf(process.platform !== "win32")(
    "embeds every brand ICO frame into a real Electron executable copy",
    async () => {
      const workspace = mkdtempSync(join(tmpdir(), "agents-one-icon-"));
      try {
        const executable = join(workspace, "agents-one.exe");
        copyFileSync(
          resolve("node_modules/electron/dist/electron.exe"),
          executable,
        );
        const ico = readFileSync(resolve("build/icon.ico"));
        const expected = Array.from(
          { length: ico.readUInt16LE(4) },
          (_, index) => {
            const entry = 6 + index * 16;
            const offset = ico.readUInt32LE(entry + 12);
            return ico.subarray(offset, offset + ico.readUInt32LE(entry + 8));
          },
        );
        const original = peIconResources(readFileSync(executable));
        expect(frameHashes(original.frames)).not.toEqual(frameHashes(expected));
        const hook = await import(
          pathToFileURL(resolve("scripts/after-pack-windows-icon.mjs")).href
        );
        await hook.default({
          electronPlatformName: "win32",
          appOutDir: workspace,
          packager: {
            projectDir: process.cwd(),
            appInfo: { productFilename: "Agents One" },
            platformSpecificBuildOptions: { executableName: "agents-one" },
            getIconPath: async () => resolve("build/icon.ico"),
          },
        });
        const actual = peIconResources(readFileSync(executable));
        expect(frameHashes(actual.frames)).toEqual(frameHashes(expected));
        expect(actual.otherResources).toEqual(original.otherResources);
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
