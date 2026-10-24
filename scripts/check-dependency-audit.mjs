import { spawnSync } from "node:child_process";

// GHSA-ch52-4w7c-c8xp currently has no patched http-cache-semantics release.
// Its only path here is through the development-only electron-builder toolchain.
// Keep this exception narrow so any other high/critical finding still blocks CI.
const builderChain = new Set([
  "@electron/get",
  "app-builder-lib",
  "cacheable-request",
  "dmg-builder",
  "electron-builder",
  "electron-builder-squirrel-windows",
  "got",
  "http-cache-semantics",
]);
const acceptedAdvisory = "https://github.com/advisories/GHSA-ch52-4w7c-c8xp";
const npmEntry = process.env.npm_execpath;

if (!npmEntry) {
  console.error("Run this check through npm run audit:ci.");
  process.exit(1);
}

function audit(args) {
  const result = spawnSync(
    process.execPath,
    [npmEntry, "audit", ...args, "--json"],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit did not return JSON: ${result.stderr.trim()}`);
  }
  if (report.error || !report.vulnerabilities || result.status === null) {
    throw new Error(
      `npm audit failed: ${JSON.stringify(report.error ?? result.stderr.trim())}`,
    );
  }
  return report;
}

const production = audit(["--omit=dev", "--audit-level=high"]);
const productionHigh = Object.entries(production.vulnerabilities).filter(
  ([, finding]) => ["high", "critical"].includes(finding.severity),
);
if (productionHigh.length) {
  console.error(
    "Production dependency audit failed:",
    productionHigh.map(([name]) => name).join(", "),
  );
  process.exit(1);
}

const full = audit(["--audit-level=high"]);
const unexpected = Object.entries(full.vulnerabilities)
  .filter(([, finding]) => ["high", "critical"].includes(finding.severity))
  .filter(([name, finding]) => {
    if (!builderChain.has(name)) return true;
    return finding.via.some((cause) =>
      typeof cause === "string"
        ? !builderChain.has(cause)
        : name !== "http-cache-semantics" || cause.url !== acceptedAdvisory,
    );
  })
  .map(([name]) => name);

if (unexpected.length) {
  console.error(
    "Unaccepted high/critical dependency findings:",
    unexpected.join(", "),
  );
  process.exit(1);
}

const accepted = Object.entries(full.vulnerabilities)
  .filter(([, finding]) => ["high", "critical"].includes(finding.severity))
  .map(([name]) => name);
console.log("Production dependencies: no high/critical findings.");
console.log(
  accepted.length
    ? `Development-only builder advisory ${acceptedAdvisory} accepted for: ${accepted.join(", ")}.`
    : "All dependencies: no high/critical findings.",
);
