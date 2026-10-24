import { getConfigValue } from "../config";
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
  return getConfigValue(key, profile);
}
