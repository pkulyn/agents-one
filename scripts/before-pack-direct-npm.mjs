import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { finished } from "node:stream/promises";

/** Keep dependency JSON intact and observe both child close and disk flush. */
export async function streamCommandToFile(
  executable,
  args,
  cwd,
  output,
  env = process.env,
) {
  const file = createWriteStream(output);
  const flushed = finished(file);
  void flushed.catch(() => undefined);
  const child = spawn(executable, args, {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stdout.pipe(file);
  child.stderr.on("data", (data) => {
    stderr = (stderr + data.toString()).slice(-16384);
  });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      file.once("error", reject);
      child.once("close", resolve);
    });
    await flushed;
    if (code !== 0 && !(code === 1 && args.includes("list")))
      throw Error("npm dependency collection failed: " + code + "\n" + stderr);
  } catch (error) {
    child.kill();
    file.destroy();
    throw error;
  }
}

// @lat: [[brand-startup#Windows direct npm collection]]
export default function directWindowsNpmCollection() {
  if (process.platform !== "win32") return;
  const npm = join(
    dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  if (!existsSync(npm))
    throw Error(
      "Windows packaging requires npm beside the current Node executable.",
    );
  const require = createRequire(import.meta.url);
  const {
    NpmNodeModulesCollector,
  } = require("app-builder-lib/out/node-module-collector/npmNodeModulesCollector.js");
  // Only this build process is affected. Keep upstream arguments/graph collection.
  NpmNodeModulesCollector.prototype.streamCollectorCommandToFile = function (
    _command,
    args,
    cwd,
    output,
  ) {
    return streamCommandToFile(process.execPath, [npm, ...args], cwd, output, {
      COREPACK_ENABLE_STRICT: "0",
      ...stripSensitiveEnvVars(process.env),
    });
  };
}
