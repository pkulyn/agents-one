import type { OneModelApiType } from "../../shared/one-model-api";

function validateEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new Error("模型 API 地址无效。");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error("模型 API 地址必须为 HTTPS，或本机回环 HTTP 地址。");
  return url;
}

function endpointForModels(endpoint: URL, apiType: OneModelApiType): URL {
  const base = endpoint.toString().replace(/\/+$/, "");
  if (apiType === "anthropic-messages") {
    const path = endpoint.pathname.replace(/\/+$/, "");
    return new URL(`${base}${path.endsWith("/v1") ? "/models" : "/v1/models"}`);
  }
  if (apiType === "google-generative-ai") return new URL(`${base}/models`);
  return new URL(`${base}/models`);
}

export async function discoverOneProviderModels(
  endpointValue: string,
  apiType: OneModelApiType,
  apiKey: string,
): Promise<string[]> {
  const endpoint = validateEndpoint(endpointValue);
  const url = endpointForModels(endpoint, apiType);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) {
    if (apiType === "anthropic-messages") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (apiType === "google-generative-ai") {
      headers["x-goog-api-key"] = apiKey;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }
  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`模型列表接口返回 HTTP ${response.status}。`);
  }
  const maxBytes = 2 * 1024 * 1024;
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("模型列表响应超过 2 MB。");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("模型列表接口没有返回内容。");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("模型列表响应超过 2 MB。");
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(buffer);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("模型列表接口返回的 JSON 无效。");
  }
  if (!body || typeof body !== "object")
    throw new Error("模型列表接口返回格式无效。");
  const root = body as Record<string, unknown>;
  const items = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : [];
  const ids = items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const raw =
      typeof record.id === "string"
        ? record.id
        : typeof record.name === "string"
          ? record.name
          : "";
    const id = raw.replace(/^models\//, "").trim();
    return id && id.length <= 256 && !/[\0\r\n]/.test(id) ? [id] : [];
  });
  return Array.from(new Set(ids))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 512);
}
