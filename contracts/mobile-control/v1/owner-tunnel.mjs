import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const OWNER_TUNNEL_PATH = "/agents-one/mobile/owner/v1/tunnel";
export const OWNER_TUNNEL_PROTOCOL = "mobile-owner/1.0";
export const definitions = JSON.parse(
  readFileSync(new URL("./schema.json", import.meta.url)),
).$defs;
const routes = JSON.parse(
  readFileSync(new URL("./openapi.json", import.meta.url)),
).paths;

/** Stable encoding binds every request field independently of JSON property order. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const bodyHash = (value) =>
  createHash("sha256")
    .update(canonical(value ?? null))
    .digest("hex");
export function validId(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) &&
    !value.includes("..")
  );
}
export function tunnelError(code, status = 422) {
  return Object.assign(new Error(code), { code, status });
}

/** Validate the generated schema without a second handwritten write contract. */
export function validate(name, value) {
  function visit(schema, item) {
    const fail = () => {
      throw tunnelError("invalid_input");
    };
    if (schema.$ref)
      return visit(definitions[schema.$ref.split("/").at(-1)], item);
    if (schema.anyOf) {
      for (const candidate of schema.anyOf) {
        try {
          visit(candidate, item);
          return;
        } catch {
          /* Next union branch. */
        }
      }
      return fail();
    }
    if (schema.enum && !schema.enum.includes(item)) fail();
    if (schema.type === "null") {
      if (item !== null) fail();
      return;
    }
    if (schema.type === "boolean") {
      if (typeof item !== "boolean") fail();
      return;
    }
    if (schema.type === "integer") {
      if (
        !Number.isSafeInteger(item) ||
        item < (schema.minimum ?? -Infinity) ||
        item > (schema.maximum ?? Infinity)
      )
        fail();
      return;
    }
    if (schema.type === "string") {
      if (
        typeof item !== "string" ||
        Array.from(item).length < (schema.minLength ?? 0) ||
        Array.from(item).length > (schema.maxLength ?? Infinity) ||
        (schema.pattern && !new RegExp(schema.pattern).test(item))
      )
        fail();
      if (
        schema.format === "utc-date-time" &&
        (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(item) ||
          !Number.isFinite(Date.parse(item)) ||
          new Date(item).toISOString().slice(0, 19) !== item.slice(0, 19))
      )
        fail();
      if (schema.format === "iana-time-zone") {
        try {
          new Intl.DateTimeFormat("en", { timeZone: item });
        } catch {
          fail();
        }
      }
      return;
    }
    if (schema.type === "array") {
      if (
        !Array.isArray(item) ||
        item.length < (schema.minItems ?? 0) ||
        item.length > (schema.maxItems ?? Infinity) ||
        (schema.uniqueItems &&
          new Set(item.map(canonical)).size !== item.length)
      )
        fail();
      item.forEach((entry) => visit(schema.items, entry));
      return;
    }
    if (schema.type === "object") {
      if (!item || typeof item !== "object" || Array.isArray(item)) fail();
      if ((schema.required ?? []).some((key) => !Object.hasOwn(item, key)))
        fail();
      for (const [key, entry] of Object.entries(item)) {
        if (schema.properties?.[key]) visit(schema.properties[key], entry);
        else if (schema.additionalProperties === false) fail();
      }
    }
  }
  if (!definitions[name]) throw Error("Unknown mobile schema");
  visit(definitions[name], value);
}

export function resolveBusinessRoute(method, path) {
  if (
    typeof path !== "string" ||
    path.length > 2048 ||
    path.includes("%") ||
    path.includes("..")
  )
    return null;
  for (const [template, operations] of Object.entries(routes)) {
    if (!template.includes("/owners/{ownerId}/spaces/{spaceId}/")) continue;
    const operation = operations[method.toLowerCase()];
    if (!operation) continue;
    const names = [...template.matchAll(/\{([^}]+)\}/g)].map(
      (match) => match[1],
    );
    const match = new RegExp(
      `^${template.replace(/\{[^}]+\}/g, "([A-Za-z0-9][A-Za-z0-9._:-]{0,159})")}$`,
    ).exec(path);
    if (!match) continue;
    const params = Object.fromEntries(
      names.map((key, i) => [key, match[i + 1]]),
    );
    if (Object.values(params).some((value) => !validId(value))) return null;
    const bodySchema = operation.requestBody?.content?.[
      "application/json"
    ]?.schema?.$ref
      ?.split("/")
      .at(-1);
    const responseSchema = Object.entries(operation.responses)
      .filter(([status]) => /^2[0-9][0-9]$/.test(status))
      .map(([, entry]) => entry)
      .find((entry) => entry.content?.["application/json"])
      ?.content?.["application/json"]?.schema?.$ref?.split("/")
      .at(-1);
    return {
      operationId: operation.operationId,
      params,
      bodySchema,
      responseSchema,
      mutation: operation.parameters?.some((p) => p.name === "Idempotency-Key"),
      revision: operation.parameters?.some((p) => p.name === "If-Match"),
      scope: operation["x-required-scope"],
      stream: operation.operationId === "streamEvents",
      query: Object.fromEntries(
        (operation.parameters ?? [])
          .filter((p) => p.in === "query")
          .map((p) => [p.name, p.schema]),
      ),
    };
  }
  return null;
}

export function validateRequest(route, headers, body, query) {
  for (const [key, value] of Object.entries(query)) {
    let schema = route.query[key];
    if (schema?.$ref) schema = definitions[schema.$ref.split("/").at(-1)];
    if (
      !schema ||
      typeof value !== "string" ||
      value.length > (schema.maxLength ?? 4096)
    )
      throw tunnelError("invalid_input");
    if (
      schema.type === "integer" &&
      (!/^[1-9][0-9]*$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < (schema.minimum ?? 0) ||
        Number(value) > (schema.maximum ?? Infinity))
    )
      throw tunnelError("invalid_input");
    if (schema.type === "boolean" && !["true", "false"].includes(value))
      throw tunnelError("invalid_input");
    if (schema.enum && !schema.enum.includes(value))
      throw tunnelError("invalid_input");
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      throw tunnelError("invalid_input");
  }
  if (route.bodySchema) validate(route.bodySchema, body);
  else if (body !== null && body !== undefined)
    throw tunnelError("invalid_input");
  if (route.mutation) {
    if (
      !validId(headers["idempotency-key"]) ||
      headers["idempotency-key"] !== headers["x-client-mutation-id"] ||
      (body?.clientMutationId !== undefined &&
        body.clientMutationId !== headers["idempotency-key"])
    )
      throw tunnelError("invalid_input");
    if (route.revision && !headers["if-match"])
      throw tunnelError("revision_required", 428);
    if (route.revision && !/^"(0|[1-9][0-9]{0,63})"$/.test(headers["if-match"]))
      throw tunnelError("invalid_input");
  }
}
