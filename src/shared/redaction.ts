const SECRET_KEY =
  "authorization|api[_-]?key|token|secret|password|credential|cookie";
// JSON and serialized objects commonly quote both keys and values. Redact
// the complete quoted value first so `"Authorization": "Bearer …"` cannot
// leak everything after the first whitespace.
const QUOTED_SECRET_ASSIGNMENT = new RegExp(
  `((?:["']?(?:${SECRET_KEY})["']?)\\s*[:=]\\s*["'])([^"']*)(["'])`,
  "gi",
);
const SECRET_ASSIGNMENT = new RegExp(
  `((?:["']?(?:${SECRET_KEY})["']?)\\s*[:=]\\s*)(["']?)(?!\\[redacted\\])([^\\s"',;}&\\]]+)`,
  "gi",
);
const AUTHORIZATION_HEADER = /(authorization\s*:\s*)(?:bearer\s+)?[^\r\n]+/gi;
const COOKIE_HEADER = /(cookie\s*:\s*)[^\r\n]+/gi;
const BEARER_TOKEN = /(bearer\s+)([a-z0-9._~+/=-]{8,})/gi;
const URL_SECRET =
  /([?&](?:authorization|api[_-]?key|token|secret|password|credential|cookie)=)([^&#\s]+)/gi;

export function redactSensitiveText(value: string): string {
  return value
    .replace(QUOTED_SECRET_ASSIGNMENT, "$1[redacted]$3")
    .replace(AUTHORIZATION_HEADER, "$1[redacted]")
    .replace(COOKIE_HEADER, "$1[redacted]")
    .replace(SECRET_ASSIGNMENT, "$1$2[redacted]")
    .replace(BEARER_TOKEN, "$1[redacted]")
    .replace(URL_SECRET, "$1[redacted]");
}
