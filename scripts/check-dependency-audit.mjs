import { spawnSync } from "node:child_process";

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
  if (result.status !== 0 && result.status !== 1)
    throw new Error("npm audit did not complete successfully.");
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error("npm audit did not return valid JSON.");
  }
  if (
    report.error ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== "object" ||
    Array.isArray(report.vulnerabilities)
  )
    throw new Error("npm audit did not return a vulnerability report.");
  const findings = Object.entries(report.vulnerabilities);
  const severities = new Set(["info", "low", "moderate", "high", "critical"]);
  if (
    findings.some(
      ([, finding]) => !finding || !severities.has(finding.severity),
    ) ||
    (result.status === 1 && findings.length === 0)
  )
    throw new Error("npm audit returned an inconsistent vulnerability report.");
  return findings
    .filter(([, finding]) => ["high", "critical"].includes(finding.severity))
    .map(([name]) => name);
}

const productionHigh = audit(["--omit=dev", "--audit-level=high"]);
if (productionHigh.length) {
  console.error(
    "Production dependency audit failed:",
    productionHigh.join(", "),
  );
  process.exit(1);
}
const allHigh = audit(["--audit-level=high"]);
if (allHigh.length) {
  console.error("Dependency audit failed:", allHigh.join(", "));
  process.exit(1);
}
console.log(
  "Production and development dependencies: no high/critical findings.",
);
