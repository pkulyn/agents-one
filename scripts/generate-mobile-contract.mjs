import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(root, "src/shared/mobile-control.ts"),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const {
  MOBILE_SCHEMAS: schemas,
  MOBILE_ROUTES: routes,
  MOBILE_CONTROL_VERSION: version,
  MOBILE_ERROR_CODES: errorCodes,
  mobileQuerySchemas,
} = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
const base = "contracts/mobile-control/v1";
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:agents-one:mobile-control:1.0",
  $defs: schemas,
};
const openapiRefs = (value) =>
  JSON.parse(
    JSON.stringify(value).replaceAll("#/$defs/", "#/components/schemas/"),
  );
const paths = {};
for (const route of routes) {
  const parameters = [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$" },
  }));
  if (route.mutation)
    for (const name of ["X-Client-Mutation-Id", "Idempotency-Key"])
      parameters.push({
        name,
        in: "header",
        required: true,
        schema: { type: "string", maxLength: 160 },
      });
  if (route.revision)
    parameters.push({
      name: "If-Match",
      in: "header",
      required: true,
      schema: { type: "string", pattern: '^"(?:0|[1-9][0-9]{0,63})"$' },
    });
  if (route.stream)
    parameters.push({
      name: "Last-Event-ID",
      in: "header",
      required: false,
      schema: { type: "string" },
    });
  for (const [name, spec] of Object.entries(mobileQuerySchemas(route)))
    parameters.push({
      name,
      in: "query",
      required: false,
      schema: openapiRefs(spec),
    });
  const response = {
    description:
      route.status === 202
        ? "Accepted receipt; execution has not necessarily completed."
        : "Successful response",
    headers: {
      "Cache-Control": { schema: { type: "string", const: "no-store" } },
    },
  };
  if (route.response)
    response.content = route.stream
      ? {
          "text/event-stream": {
            schema: { type: "string" },
            "x-event-schema": { $ref: "#/components/schemas/Event" },
          },
        }
      : {
          "application/json": {
            schema: { $ref: `#/components/schemas/${route.response}` },
          },
        };
  else if (route.operationId === "downloadArtifact")
    response.content = {
      "application/octet-stream": {
        schema: { type: "string", format: "binary" },
      },
    };
  (paths[route.path] ??= {})[route.method.toLowerCase()] = {
    operationId: route.operationId,
    parameters,
    security: route.proof
      ? [{ claimProof: [] }]
      : ["claimPairing", "refreshCredentials"].includes(route.operationId)
        ? []
        : [{ bearerAuth: [] }],
    ...(route.scope ? { "x-required-scope": route.scope } : {}),
    ...(route.body
      ? {
          requestBody: {
            required: !["ActionInput", "ExchangeInput"].includes(route.body),
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${route.body}` },
              },
            },
          },
        }
      : {}),
    responses: {
      [route.status]: response,
      default: {
        description:
          "Stable error code; redact credentials, paths and content.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
          },
        },
      },
    },
  };
}
const openapi = {
  openapi: "3.1.0",
  info: { title: "Agents One Mobile Control", version },
  paths,
  components: {
    schemas: openapiRefs(schemas),
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      claimProof: {
        type: "http",
        scheme: "bearer",
        description: "Short-lived claim proof; never a device access token.",
      },
    },
  },
};

function sample(spec, depth = 0) {
  if (depth > 10) throw new Error("Recursive schema");
  if (spec.$ref) return sample(schemas[spec.$ref.split("/").at(-1)], depth + 1);
  if (spec.anyOf) return sample(spec.anyOf[0], depth + 1);
  if (spec.enum) return spec.enum[0];
  if (spec.type === "object")
    return Object.fromEntries(
      Object.entries(spec.properties)
        .filter(([key]) => spec.required.includes(key))
        .map(([key, value]) => [key, sample(value, depth + 1)]),
    );
  if (spec.type === "array")
    return Array.from({ length: spec.minItems ?? 1 }, (_, index) =>
      spec.items?.format === "utc-date-time"
        ? `2026-10-${String(5 + index).padStart(2, "0")}T03:00:00Z`
        : sample(spec.items, depth + 1),
    );
  if (spec.type === "integer") return spec.minimum ?? 0;
  if (spec.type === "boolean") return false;
  if (spec.type === "null") return null;
  if (spec.format === "utc-date-time") return "2026-10-04T03:00:00Z";
  if (spec.format === "iana-time-zone") return "Asia/Shanghai";
  if (spec.pattern?.includes("[a-f0-9]")) return "a".repeat(64);
  if (spec.pattern?.includes("[0-9]{0,63}")) return "9007199254740993";
  return "fixture-value";
}
const fixtures = {
  version,
  errors: errorCodes.map((code) => ({
    error: {
      code,
      message: code,
      retryable: false,
      requestId: "fixture-request",
    },
  })),
  objects: Object.fromEntries(
    Object.entries(schemas)
      .filter(([name]) => !name.endsWith("Input"))
      .map(([name, spec]) => [name, sample(spec)]),
  ),
  enums: Object.fromEntries(
    Object.entries(schemas)
      .filter(([, spec]) => spec.enum)
      .map(([name, spec]) => [name, spec.enum]),
  ),
};
// A real 2px PNG fixture also permits clients to verify the read identity and bytes.
const avatarBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8XKD4n4GBgYGJAQoAJzoChzU5gKEAAAAASUVORK5CYII=";
const avatarBytes = Buffer.from(avatarBase64, "base64"),
  avatarMime = "image/png";
fixtures.objects.RuntimeAvatar = {
  id: `ava-${createHash("sha256").update(avatarMime).update("\0").update(avatarBytes).digest("hex")}`,
  runtimeId: "fixture-runtime",
  mime: avatarMime,
  sizeBytes: avatarBytes.length,
  sha256: createHash("sha256").update(avatarBytes).digest("hex"),
  base64: avatarBase64,
};

function kotlinType(spec) {
  if (spec.$ref) {
    const name = spec.$ref.split("/").at(-1);
    return schemas[name].enum ? "String" : name;
  }
  if (spec.anyOf)
    return `${kotlinType(spec.anyOf.find((item) => item.type !== "null"))}?`;
  return (
    {
      string: "String",
      integer: "Long",
      boolean: "Boolean",
      object: "JsonObject",
      array: `List<${spec.items ? kotlinType(spec.items) : "JsonElement"}>`,
    }[spec.type] ?? "JsonElement"
  );
}
const declarations = Object.entries(schemas)
  .filter(([, spec]) => !spec.enum)
  .map(([name, spec]) => {
    // JSON object requests preserve omitted/null PATCH distinctions; the Owner validates writes.
    if (name.endsWith("Input") || !spec.properties)
      return `typealias ${name} = JsonObject`;
    const props = Object.entries(spec.properties).map(([key, value]) => {
      let type = kotlinType(value);
      const optional = !spec.required?.includes(key);
      if (optional && !type.endsWith("?")) type += "?";
      return `    val ${key}: ${type}${optional ? " = null" : ""}`;
    });
    return `@Serializable\ndata class ${name}(\n${props.join(",\n")}\n)`;
  })
  .join("\n\n");
const kotlin = `// Generated by scripts/generate-mobile-contract.mjs. Do not edit.\npackage one.agents.mobile.contract\n\nimport kotlinx.serialization.Serializable\nimport kotlinx.serialization.json.JsonElement\nimport kotlinx.serialization.json.JsonObject\n\nconst val MOBILE_PROTOCOL = "${version}"\n\n${declarations}\n`;
const kotlinTests = `// Generated by scripts/generate-mobile-contract.mjs. Do not edit.\npackage one.agents.mobile.contract\n\nimport java.io.File\nimport kotlin.test.Test\nimport kotlinx.serialization.json.*\n\nclass GeneratedContractTest {\n    @Test fun allReadFixturesDecode() {\n        val json = Json { ignoreUnknownKeys = true }\n        val objects = json.parseToJsonElement(File("../../../contracts/mobile-control/v1/fixtures.json").readText()).jsonObject["objects"]!!.jsonObject\n${Object.entries(
  schemas,
)
  .filter(([name, spec]) => !name.endsWith("Input") && spec.properties)
  .map(
    ([name]) =>
      `        json.decodeFromJsonElement<${name}>(objects["${name}"]!!)`,
  )
  .join("\n")}\n    }\n}\n`;
const outputs = {
  [`${base}/schema.json`]: JSON.stringify(schema, null, 2) + "\n",
  [`${base}/openapi.json`]: JSON.stringify(openapi, null, 2) + "\n",
  [`${base}/fixtures.json`]: JSON.stringify(fixtures, null, 2) + "\n",
  "apps/android/core/src/main/kotlin/one/agents/mobile/contract/MobileDtos.kt":
    kotlin,
  "apps/android/core/src/test/kotlin/one/agents/mobile/contract/GeneratedContractTest.kt":
    kotlinTests,
  "apps/android/core/src/main/kotlin/one/agents/mobile/contract/MobileSchemaDefinitions.kt": `// Generated by scripts/generate-mobile-contract.mjs. Do not edit.\npackage one.agents.mobile.contract\n\nimport kotlinx.serialization.json.Json\nimport kotlinx.serialization.json.JsonObject\nimport kotlinx.serialization.json.jsonObject\n\ninternal val mobileSchemaDefinitions: JsonObject by lazy { Json.parseToJsonElement(${JSON.stringify(JSON.stringify(schemas)).replaceAll("$", "\\$")}).jsonObject }\n`,
};
let stale = false;
for (const [relative, content] of Object.entries(outputs)) {
  const file = path.join(root, relative);
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
      process.stderr.write(`Stale mobile contract: ${relative}\n`);
      stale = true;
    }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}
if (stale) process.exitCode = 1;
else
  process.stdout.write(
    `Mobile contract ${version}: ${routes.length} routes, ${Object.keys(schemas).length} schemas, ${Object.keys(outputs).length} synchronized outputs.\n`,
  );
