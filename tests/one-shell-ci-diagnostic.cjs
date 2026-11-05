/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { spawn } = require("node:child_process");
if (process.platform !== "win32") process.exit(0);
const keys = [
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOME",
  "LANG",
  "LC_ALL",
];
const restricted = Object.fromEntries(
  keys
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
function probe(name, executable, args, env) {
  return new Promise((resolve) => {
    const started = Date.now();
    const result = {
      name,
      spawned: false,
      exited: false,
      closed: false,
      expectedOutput: false,
      elapsedMs: 0,
      exitCode: null,
      errorCode: null,
    };
    const child = spawn(executable, args, {
      cwd: require("node:os").tmpdir(),
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      result.elapsedMs = Date.now() - started;
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(result);
    };
    const deadline = setTimeout(() => {
      child.kill();
      done();
    }, 15000);
    child.once("spawn", () => {
      result.spawned = true;
    });
    child.once("error", (error) => {
      result.errorCode = error.code || "error";
      done();
    });
    child.once("exit", (code) => {
      result.exited = true;
      result.exitCode = code;
    });
    child.once("close", () => {
      result.closed = true;
      done();
    });
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("one-probe-ok"))
        result.expectedOutput = true;
    });
    child.stderr.resume();
  });
}
const psArgs = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output 'one-probe-ok'",
];
const withKeys = (keys) => ({
  ...restricted,
  ...Object.fromEntries(
    keys
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  ),
});
const paths = [
  "SystemDrive",
  "ComSpec",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "ProgramData",
  "CommonProgramFiles",
  "CommonProgramFiles(x86)",
  "CommonProgramW6432",
  "PUBLIC",
  "ALLUSERSPROFILE",
];
const user = [
  "PSModulePath",
  "USERDOMAIN",
  "USERNAME",
  "USERDOMAIN_ROAMINGPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOGONSERVER",
  "SESSIONNAME",
];
const machine = [
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "OS",
  "PATHEXT",
];
Promise.all([
  probe(
    "powershell-modulepath",
    "powershell.exe",
    psArgs,
    withKeys(["PSModulePath"]),
  ),
  probe(
    "powershell-home",
    "powershell.exe",
    psArgs,
    withKeys(["HOMEDRIVE", "HOMEPATH"]),
  ),
  probe(
    "powershell-identity",
    "powershell.exe",
    psArgs,
    withKeys(["USERNAME", "USERDOMAIN", "USERDOMAIN_ROAMINGPROFILE"]),
  ),
  probe(
    "powershell-session",
    "powershell.exe",
    psArgs,
    withKeys(["LOGONSERVER", "SESSIONNAME"]),
  ),
  probe("powershell-paths", "powershell.exe", psArgs, withKeys(paths)),
  probe("powershell-user", "powershell.exe", psArgs, withKeys(user)),
  probe("powershell-machine", "powershell.exe", psArgs, withKeys(machine)),
  probe("powershell-restricted", "powershell.exe", psArgs, restricted),
  probe("powershell-full", "powershell.exe", psArgs, process.env),
  probe(
    "cmd-restricted",
    "cmd.exe",
    ["/d", "/c", "echo one-probe-ok"],
    restricted,
  ),
]).then((results) =>
  console.log("One Windows CI process probes:", JSON.stringify(results)),
);
