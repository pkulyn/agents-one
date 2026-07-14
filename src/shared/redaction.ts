const SECRET_ASSIGNMENT =
  /((?:authorization|api[_-]?key|token|secret|password|credential|cookie)\s*[:=]\s*)(["']?)([^\s"',;}\]]+)/gi;
const AUTHORIZATION_HEADER = /(authorization\s*:\s*)(?:bearer\s+)?[^\r\n]+/gi;
const COOKIE_HEADER = /(cookie\s*:\s*)[^\r\n]+/gi;
const BEARER_TOKEN = /(bearer\s+)([a-z0-9._~+/=-]{8,})/gi;
const URL_SECRET = /([?&](?:api[_-]?key|token|secret|password|credential)=)([^&#\s]+)/gi;

export function redactSensitiveText(value: string): string {
  return value
    .replace(AUTHORIZATION_HEADER, "$1[redacted]")
    .replace(COOKIE_HEADER, "$1[redacted]")
    .replace(SECRET_ASSIGNMENT, "$1$2[redacted]")
    .replace(BEARER_TOKEN, "$1[redacted]")
    .replace(URL_SECRET, "$1[redacted]");
}
