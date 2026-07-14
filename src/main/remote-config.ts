import { remoteRequestJson, type RemoteSessionConfig } from "./remote-sessions";

type RemoteRecord = Record<string, unknown>;

function asRecord(value: unknown): RemoteRecord {
  return value && typeof value === "object" ? (value as RemoteRecord) : {};
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      String(item ?? ""),
    ]),
  );
}

export async function remoteReadEnv(
  config: RemoteSessionConfig,
): Promise<Record<string, string>> {
  const response = await remoteRequestJson(config, "/api/env");
  const record = asRecord(response);
  return stringMap(record.env ?? record.values ?? response);
}

export async function remoteSetEnvValue(
  config: RemoteSessionConfig,
  key: string,
  value: string,
): Promise<boolean> {
  await remoteRequestJson(config, "/api/env", {
    method: "PUT",
    body: { key, value },
  });
  return true;
}

export async function remoteGetConfigValue(
  config: RemoteSessionConfig,
  key: string,
): Promise<string | null> {
  const response = await remoteRequestJson(
    config,
    `/api/config?key=${encodeURIComponent(key)}`,
  );
  const record = asRecord(response);
  const value = record.value ?? record[key];
  return value === null || value === undefined ? null : String(value);
}

export async function remoteSetConfigValue(
  config: RemoteSessionConfig,
  key: string,
  value: string,
): Promise<boolean> {
  await remoteRequestJson(config, "/api/config", {
    method: "PUT",
    body: { key, value },
  });
  return true;
}
