import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
let directory: string;
let npmFixture: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agents-one-audit-policy-"));
  npmFixture = join(directory, "npm.cjs");
  writeFileSync(
    npmFixture,
    'const f=JSON.parse(process.env.AGENTS_ONE_AUDIT_FIXTURE);const r=process.argv.includes("--omit=dev")?f.production:f.full;console.log(r.raw??JSON.stringify(r.report));process.exitCode=r.status;',
  );
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});
type Reply = { report?: object; raw?: string; status: number };
const clean: Reply = { report: { vulnerabilities: {} }, status: 0 };
function check(production: Reply, full = clean): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [resolve("scripts/check-dependency-audit.mjs")],
    {
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        npm_execpath: npmFixture,
        AGENTS_ONE_AUDIT_FIXTURE: JSON.stringify({ production, full }),
      },
    },
  );
}
describe("release dependency audit policy", () => {
  // @lat: [[desktop-updates#Dependency audit enforcement]]
  it("accepts a completed clean production and full audit", () => {
    expect(check(clean).status).toBe(0);
  });
  it("rejects production critical findings", () => {
    expect(
      check({
        report: { vulnerabilities: { dependency: { severity: "critical" } } },
        status: 1,
      }).status,
    ).toBe(1);
  });
  it("does not carry forward the old development-only builder waiver", () => {
    const report = {
      vulnerabilities: {
        "http-cache-semantics": {
          severity: "high",
          via: [{ url: "https://github.com/advisories/GHSA-ch52-4w7c-c8xp" }],
        },
      },
    };
    expect(check(clean, { report, status: 1 }).status).toBe(1);
  });
  it.each([
    { raw: "network failed", status: 1 },
    { report: { error: { code: "EAI_AGAIN" } }, status: 1 },
    { report: { vulnerabilities: {} }, status: 2 },
    { report: { vulnerabilities: {} }, status: 1 },
    {
      report: { vulnerabilities: { dependency: { severity: "unknown" } } },
      status: 0,
    },
  ])(
    "fails closed on unavailable or inconsistent audit replies %j",
    (reply) => {
      expect(check(clean, reply).status).toBe(1);
    },
  );
});
