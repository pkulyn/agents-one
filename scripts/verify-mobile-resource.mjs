import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const asar = createRequire(import.meta.url)("@electron/asar");
/** Validate the imported Main chunk, never an unused leftover file. */
export function verifyMobileResource(archive) {
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
    if (!key) throw Error("mobile_resource_missing_file:" + name);
    return asar.extractFile(archive, key).toString();
  };
  const entry = read("out/main/index.js");
  const matches = [
    ...entry.matchAll(/["']\.\/(start-[A-Za-z0-9_-]+\.js)["']/g),
  ];
  if (matches.length !== 1) throw Error("mobile_resource_entry_ambiguous");
  const chunk = matches[0][1];
  const code = read("out/main/" + chunk);
  for (const marker of [
    "conversation:read",
    "schedule:read",
    "artifact:read",
    "mobile-owner-tunnel-worker.cjs",
    "mobile-owner-ledger-worker.cjs",
  ]) {
    if (!code.includes(marker))
      throw Error("mobile_resource_missing:" + marker);
  }
  for (const file of [
    "mobile-owner-tunnel-worker.cjs",
    "mobile-owner-ledger-worker.cjs",
  ]) {
    if (!read("out/main/" + file).length)
      throw Error("mobile_resource_worker_empty");
  }
  return {
    importedMain: chunk,
    independentTransport: true,
    independentLedger: true,
    ownerReadScopes: true,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(JSON.stringify(verifyMobileResource(resolve(process.argv[2]))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
