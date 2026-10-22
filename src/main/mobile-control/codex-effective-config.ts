import { spawn } from "child_process";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { codexInvocation, type CodexRuntimeConfig } from "../codex-runtime";
import { terminateProcessTree } from "../process-control";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function fail(): never {
  // Config/RPC errors can contain headers, paths and credentials. Keep them in Main.
  throw new Error(
    "Mobile Codex model/provider configuration is unsupported or unavailable.",
  );
}
function identifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value)
  )
    fail();
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
function endpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) fail();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail();
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    fail();
  return value;
}

/** Private launch projection. No credentials or arbitrary config keys become arguments. */
export interface CodexMobileConfiguration {
  model: string;
  providerId: string;
  args: string[];
  configurationHash: string;
}

export function projectCodexMobileConfiguration(
  response: unknown,
  explicitModel?: string,
): CodexMobileConfiguration {
  if (!record(response) || !record(response.config)) fail();
  const config = response.config;
  const model = identifier(explicitModel?.trim() || config.model);
  const providerId = identifier(config.model_provider ?? "openai");
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(providerId)) fail();
  if (config.model_catalog_json != null) fail();
  const providers = config.model_providers;
  if (providers != null && !record(providers)) fail();
  const provider = record(providers) ? providers[providerId] : undefined;
  if (provider != null && !record(provider)) fail();
  if (providerId !== "openai" && !record(provider)) fail();
  const allowed = [
    "name",
    "base_url",
    "env_key",
    "env_key_instructions",
    "wire_api",
    "requires_openai_auth",
  ];
  const projected: RecordValue = {};
  if (record(provider)) {
    for (const [key, value] of Object.entries(provider)) {
      if (value == null) continue;
      if (!allowed.includes(key)) fail();
      if (key === "env_key_instructions") continue;
      if (key === "name") {
        if (
          typeof value !== "string" ||
          value.length < 1 ||
          value.length > 80 ||
          Array.from(value).some((character) => character.charCodeAt(0) < 32)
        )
          fail();
        projected[key] = value;
      } else if (key === "base_url") projected[key] = endpoint(value);
      else if (key === "env_key") {
        if (
          typeof value !== "string" ||
          !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)
        )
          fail();
        projected[key] = value;
      } else if (key === "wire_api") {
        if (value !== "responses") fail();
        projected[key] = value;
      } else {
        if (typeof value !== "boolean") fail();
        projected[key] = value;
      }
    }
  }
  if (
    providerId !== "openai" &&
    (!projected.name ||
      !projected.base_url ||
      projected.wire_api !== "responses")
  )
    fail();
  const args: string[] = ["-c", `model_provider=${JSON.stringify(providerId)}`];
  if (Object.keys(projected).length) {
    // JSON objects are not TOML inline tables: serialize each validated scalar separately.
    for (const [key, value] of Object.entries(projected))
      args.push(
        "-c",
        `model_providers.${providerId}.${key}=${JSON.stringify(value)}`,
      );
  }
  for (const key of ["openai_base_url", "chatgpt_base_url"])
    if (config[key] != null)
      args.push("-c", `${key}=${JSON.stringify(endpoint(config[key]))}`);
  for (const key of ["model_reasoning_effort", "service_tier"])
    if (config[key] != null)
      args.push("-c", `${key}=${JSON.stringify(identifier(config[key]))}`);
  return {
    model,
    providerId,
    args,
    configurationHash: createHash("sha256")
      .update(canonical({ response, model }))
      .digest("hex"),
  };
}

/** Read effective original configuration without starting a thread, tool or model turn. */
export async function readCodexMobileConfiguration(
  config: CodexRuntimeConfig,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs = 10_000,
): Promise<CodexMobileConfiguration> {
  const child = (() => {
    try {
      const invocation = codexInvocation(
        config.executablePath?.trim() || "codex",
      );
      return spawn(
        invocation.command,
        [...invocation.prefix, "app-server", "--stdio"],
        {
          cwd,
          env: { ...environment },
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch {
      return fail();
    }
  })();
  let sequence = 0,
    bytes = 0,
    buffer = "",
    stopped = false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  const abort = (): void => {
    stopped = true;
    for (const entry of pending.values())
      entry.reject(new Error("config_unavailable"));
    pending.clear();
  };
  child.once("error", abort);
  child.once("close", abort);
  child.stderr?.resume();
  child.stdin?.on("error", abort);
  child.stdout?.on("data", (chunk: Buffer) => {
    if (stopped) return;
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) {
      abort();
      return;
    }
    try {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const frame: unknown = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (!record(frame)) {
          abort();
          return;
        }
        const entry =
          typeof frame.id === "number" ? pending.get(frame.id) : undefined;
        if (entry) {
          pending.delete(frame.id as number);
          if (frame.error !== undefined) {
            entry.reject(new Error("config_unavailable"));
            abort();
            return;
          }
          entry.resolve(frame.result);
        }
      }
    } catch {
      abort();
    }
  });
  const request = (method: string, params: RecordValue): Promise<unknown> => {
    if (stopped) return Promise.reject(new Error("config_unavailable"));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin?.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  };
  const timer = setTimeout(abort, timeoutMs);
  try {
    await request("initialize", {
      clientInfo: { name: "agents_one_mobile_config", version: "0.1.0" },
    });
    if (stopped) fail();
    child.stdin?.write(
      `${JSON.stringify({ method: "initialized", params: {} })}\n`,
    );
    const response = await request("config/read", { cwd, includeLayers: true });
    if (stopped) fail();
    return projectCodexMobileConfiguration(response, config.model);
  } catch {
    return fail();
  } finally {
    clearTimeout(timer);
    child.stdin?.end();
    await terminateProcessTree(child).catch(() => undefined);
  }
}
