import { copyFile, mkdir } from "node:fs/promises";

const source = new URL(
  "../../../contracts/mobile-control/v1/",
  import.meta.url,
);
const target = new URL("../packaged-owner-contract/", import.meta.url);

await mkdir(target, { recursive: true });
for (const file of ["owner-tunnel.mjs", "schema.json", "openapi.json"]) {
  await copyFile(new URL(file, source), new URL(file, target));
}
