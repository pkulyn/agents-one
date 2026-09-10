// Standalone probe — does Node's fs see \\wsl$\... paths?
const fs = require("fs");
const distro = process.env.WSL_PROBE_DISTRO || "Ubuntu";
const user = process.env.WSL_PROBE_USER || "user";
const home = `\\\\wsl$\\${distro}\\home\\${user}`;
const tests = [
  "\\\\wsl$\\",
  `\\\\wsl$\\${distro}`,
  `\\\\wsl$\\${distro}\\home`,
  home,
  `${home}\\.hermes`,
  `${home}\\.hermes\\.env`,
];
for (const p of tests) {
  try {
    console.log(p.padEnd(60), "→", fs.existsSync(p));
  } catch (e) {
    console.log(p.padEnd(60), "→ ERR", e.message);
  }
}
console.log();
// Show what readdir says about the wsl root
try {
  console.log("readdirSync \\\\wsl$\\:", fs.readdirSync("\\\\wsl$\\"));
} catch (e) {
  console.log("readdir failed:", e.message);
}
