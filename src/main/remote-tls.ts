import {
  getConnectionConfig,
  getRemoteDashboardUrl,
  type ConnectionConfig,
} from "./config";

function urlHost(value: string): string {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.host.toLowerCase() : "";
  } catch {
    return "";
  }
}

function trustedRemoteHosts(config: ConnectionConfig): Set<string> {
  return new Set(
    [config.remoteUrl, getRemoteDashboardUrl(config)]
      .map(urlHost)
      .filter(Boolean),
  );
}

export function shouldAllowConfiguredRemoteCertificateError(
  rawUrl: string,
): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    return trustedRemoteHosts(getConnectionConfig()).has(
      url.host.toLowerCase(),
    );
  } catch {
    return false;
  }
}

export function configuredRemoteTlsOptions(rawUrl: string): {
  rejectUnauthorized?: boolean;
} {
  return shouldAllowConfiguredRemoteCertificateError(rawUrl)
    ? { rejectUnauthorized: false }
    : {};
}
