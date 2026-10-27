import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { assertPiNonExecutingConfig } from "../src/main/pi-config-policy";
let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(tmpdir(), "pi-auth-policy-"));
});
afterEach(() => {
  if (
    !path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(directory).startsWith("pi-auth-policy-")
  )
    throw Error("Unsafe fixture");
  fs.rmSync(directory, { recursive: true, force: true });
});
function models(provider: unknown): void {
  fs.writeFileSync(
    path.join(directory, "models.json"),
    JSON.stringify({ providers: { fixture: provider } }),
  );
}
it.each([
  { apiKey: "!do-not-run" },
  { headers: { authorization: "!do-not-run" } },
  { models: [{ id: "fixture", headers: { custom: "!do-not-run" } }] },
  { modelOverrides: { fixture: { headers: { custom: "!do-not-run" } } } },
])("rejects native executable fields %j", (provider) => {
  models(provider);
  expect(() => assertPiNonExecutingConfig(directory)).toThrow("本轮任务未发送");
});
it("rejects stored command keys", () => {
  fs.writeFileSync(
    path.join(directory, "auth.json"),
    JSON.stringify({ fixture: { type: "api_key", key: "!do-not-run" } }),
  );
  expect(() => assertPiNonExecutingConfig(directory)).toThrow("本轮任务未发送");
});
it("preserves literals, templates, escaped bang, OAuth and unrelated leading-bang data", () => {
  models({
    name: "!name",
    apiKey: "$TOKEN",
    headers: { custom: "$!literal", another: "literal!" },
    models: [
      {
        id: "!id",
        name: "!name",
        headers: { custom: "literal" },
        samplingParams: { custom: "!body-data" },
      },
    ],
    modelOverrides: { fixture: { headers: { custom: "prefix-$TOKEN" } } },
    unknown: { custom: "!unknown-data" },
  });
  fs.writeFileSync(
    path.join(directory, "auth.json"),
    JSON.stringify({
      fixture: {
        type: "api_key",
        key: "$TOKEN",
        env: { TOKEN: "!literal-env-data" },
        unknown: true,
      },
      oauth: {
        type: "oauth",
        access: "!opaque-access",
        refresh: "!opaque-refresh",
        expires: 123,
        unknown: { key: "!not-api-key" },
      },
    }),
  );
  const before = fs
    .readdirSync(directory)
    .map((file) => [file, fs.readFileSync(path.join(directory, file), "utf8")]);
  expect(() => assertPiNonExecutingConfig(directory)).not.toThrow();
  expect(
    fs
      .readdirSync(directory)
      .map((file) => [
        file,
        fs.readFileSync(path.join(directory, file), "utf8"),
      ]),
  ).toEqual(before);
});
it("supports Pi model BOM, line comments and trailing commas without changing strings", () => {
  fs.writeFileSync(
    path.join(directory, "models.json"),
    '\uFEFF{\n// comment\n"providers":{"fixture":{"name":"literal // ,}","apiKey":"$TOKEN",},},}',
  );
  expect(() => assertPiNonExecutingConfig(directory)).not.toThrow();
});
it("detects commands in commented model configuration", () => {
  fs.writeFileSync(
    path.join(directory, "models.json"),
    '{// comment\n"providers":{"fixture":{"apiKey":"!do-not-run",},},}',
  );
  expect(() => assertPiNonExecutingConfig(directory)).toThrow();
});
it("accepts genuinely absent and empty native auth state", () => {
  expect(() => assertPiNonExecutingConfig(directory)).not.toThrow();
  fs.writeFileSync(path.join(directory, "auth.json"), "");
  expect(() => assertPiNonExecutingConfig(directory)).not.toThrow();
});
it.each([
  "secret-invalid-json",
  "[]",
  "null",
  '{"providers":[]}',
  '{"providers":{"fixture":{"headers":[]}}}',
])("rejects unverifiable models %s with a fixed diagnostic", (content) => {
  fs.writeFileSync(path.join(directory, "models.json"), content);
  try {
    assertPiNonExecutingConfig(directory);
    throw Error("unexpected acceptance");
  } catch (error) {
    expect(String(error)).toContain("本轮任务未发送");
    expect(String(error)).not.toContain("secret-invalid-json");
  }
});
it("bounds native file size before parsing", () => {
  fs.writeFileSync(
    path.join(directory, "models.json"),
    Buffer.alloc(8 * 1024 * 1024 + 1, 32),
  );
  expect(() => assertPiNonExecutingConfig(directory)).toThrow();
});
it("refuses native config directories", () => {
  fs.mkdirSync(path.join(directory, "auth.json"));
  expect(() => assertPiNonExecutingConfig(directory)).toThrow();
});
it("checks fresh native credentials on repeated dispatch", () => {
  const file = path.join(directory, "auth.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ fixture: { type: "api_key", key: "literal" } }),
  );
  assertPiNonExecutingConfig(directory);
  fs.writeFileSync(
    file,
    JSON.stringify({ fixture: { type: "api_key", key: "!do-not-run" } }),
  );
  expect(() => assertPiNonExecutingConfig(directory)).toThrow();
});
it("handles a symlinked native directory consistently", () => {
  const actual = path.join(directory, "actual");
  fs.mkdirSync(actual);
  const alias = path.join(directory, "alias");
  fs.symlinkSync(actual, alias, "junction");
  fs.writeFileSync(
    path.join(actual, "auth.json"),
    JSON.stringify({ fixture: { type: "api_key", key: "!do-not-run" } }),
  );
  expect(() => assertPiNonExecutingConfig(alias)).toThrow();
});
