import { getConfigValue, setConfigValue } from "../config";
const SAVED_URL_PART = "__saved__";
const PROXY_PROTOCOLS = new Set([
  "http:",
  "https:",
  "socks:",
  "socks4:",
  "socks4a:",
  "socks5:",
  "socks5h:",
]);
/** Public proxy identity includes only scheme/host/port; all routing/auth parts stay in Main. */
function rendererProxyValue(value: string | null): string | null {
  if (!value?.trim()) return value;
  try {
    if (value.length > 16384) return SAVED_URL_PART;
    const url = new URL(value);
    if (!PROXY_PROTOCOLS.has(url.protocol) || !url.hostname)
      return SAVED_URL_PART;
    let hidden = false;
    if (url.username) {
      url.username = SAVED_URL_PART;
      hidden = true;
    }
    if (url.password) {
      url.password = SAVED_URL_PART;
      hidden = true;
    }
    if (url.pathname && url.pathname !== "/") {
      url.pathname = "/" + SAVED_URL_PART;
      hidden = true;
    }
    if (url.search) {
      url.search = "?" + SAVED_URL_PART;
      hidden = true;
    }
    if (url.hash) {
      url.hash = "#" + SAVED_URL_PART;
      hidden = true;
    }
    return hidden ? url.href : value;
  } catch {
    return SAVED_URL_PART;
  }
}

function readProxyConfig(profile?: string): string | null {
  try {
    return getConfigValue("network.proxy", profile);
  } catch {
    throw Error(
      "代理配置无法读取，未更改原配置。 / Proxy configuration could not be read; the original configuration was not changed.",
    );
  }
}
function containsRetainedMarker(value: string): boolean {
  let decoded = value;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (decoded.toLowerCase().includes(SAVED_URL_PART)) return true;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return false;
}

const READABLE_KEYS = new Set([
  "agent.service_tier",
  "agent.reasoning_effort",
  "network.force_ipv4",
  "network.proxy",
]);
/** Keep arbitrary credential-bearing YAML paths inside the Main process. */
export function readRendererConfigValue(
  key: unknown,
  profile?: string,
): string | null {
  if (typeof key !== "string" || !READABLE_KEYS.has(key)) return null;
  if (key === "network.proxy")
    return rendererProxyValue(readProxyConfig(profile));
  return getConfigValue(key, profile);
}

/** A returned projection can be kept unchanged, but can never become live connection data. */
export function writeRendererConfigValue(
  key: string,
  value: string,
  profile?: string,
): void {
  if (typeof key !== "string" || typeof value !== "string")
    throw Error("Invalid configuration update.");
  if (key.split(".").filter(Boolean).join(".") === "network.proxy") {
    const visible = rendererProxyValue(readProxyConfig(profile));
    if (value.trim() === (visible || "").trim()) return;
    if (containsRetainedMarker(value))
      throw Error(
        "已保存的代理参数不会回显。修改地址时请重新输入完整 URL，或移除认证部分；隐藏标记不能保存。 / Re-enter the complete proxy URL or remove authentication when changing it; retained markers cannot be saved.",
      );
    try {
      setConfigValue(key, value, profile);
    } catch {
      throw Error(
        "代理配置保存失败，未报告保存成功。 / Proxy configuration could not be saved.",
      );
    }
    return;
  }
  setConfigValue(key, value, profile);
}
