// Live verify the wsl-detection module against the real WSL on this
// host. Just imports the module and prints what it sees.
const path = require("path");

// We need to import the TS source. The simplest way is to use the
// already-built main bundle if available, OR spawn a quick TS compile.
// For now, replicate the logic in plain JS to confirm the *approach*.

const { execFileSync } = require("child_process");
const { existsSync, readdirSync, statSync } = require("fs");

const WSL_EXE = "C:\\Windows\\System32\\wsl.exe";

function listDistros() {
  if (!existsSync(WSL_EXE)) return [];
  try {
    const raw = execFileSync(WSL_EXE, ["-l", "-q"], {
      encoding: "utf16le",
      timeout: 5000,
      windowsHide: true,
    });
    return String(raw)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch (e) {
    console.log("error:", e.message);
    return [];
  }
}

console.log("Distros:", listDistros());

for (const distro of listDistros()) {
  const homesRoot = `\\\\wsl$\\${distro}\\home`;
  console.log();
  console.log(`Distro ${distro}:`);
  console.log("  homesRoot exists:", existsSync(homesRoot));
  if (!existsSync(homesRoot)) continue;
  for (const user of readdirSync(homesRoot)) {
    const candidate = `${homesRoot}\\${user}\\.hermes`;
    if (!existsSync(candidate)) continue;
    console.log(`  ${candidate} exists: true`);
    if (statSync(candidate).isDirectory()) {
      console.log("  contents:");
      for (const f of readdirSync(candidate)) {
        console.log("    -", f);
      }
    }
  }
}
