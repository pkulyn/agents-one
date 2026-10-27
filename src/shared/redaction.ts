const SECRET_KEY =
  "authorization|api[_-]?key|(?:access|refresh|session|id)[_-]?token|token|secret(?:[_-]?key)?|secretaccesskey|passphrase|password|credential|cookie";
// Match each quote style independently, including escaped quote characters.
const QUOTED_SECRET_ASSIGNMENT = new RegExp(
  "((?:[\"']?(?:" +
    SECRET_KEY +
    ")[\"']?)\\s*[:=]\\s*)(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*')",
  "gi",
);
const SECRET_ASSIGNMENT = new RegExp(
  "((?:[\"']?(?:" +
    SECRET_KEY +
    ")[\"']?)\\s*[:=]\\s*)(?![\"']|\\[redacted\\])([^\\s\"'}\\]]+)",
  "gi",
);
const AUTHORIZATION_HEADER = /(authorization\s*:\s*)(?:bearer\s+)?[^\r\n]+/gi;
const COOKIE_HEADER = /(cookie\s*:\s*)[^\r\n]+/gi;
const BEARER_TOKEN = /(bearer\s+)([a-z0-9._~+/=-]{8,})/gi;
const URL_SECRET = new RegExp("([?&](?:" + SECRET_KEY + ")=)([^&#\\s]+)", "gi");
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/gi;

function redactPlainText(value: string): string {
  return value
    .replace(URL_USERINFO, "$1[redacted]@")
    .replace(URL_SECRET, "$1[redacted]")
    .replace(
      QUOTED_SECRET_ASSIGNMENT,
      (_match, prefix: string, quoted: string) =>
        prefix + quoted[0] + "[redacted]" + quoted[0],
    )
    .replace(AUTHORIZATION_HEADER, "$1[redacted]")
    .replace(COOKIE_HEADER, "$1[redacted]")
    .replace(BEARER_TOKEN, "$1[redacted]")
    .replace(SECRET_ASSIGNMENT, (_match, prefix: string, secret: string) => {
      // Keep a trailing field separator, but never a secret's inner
      // punctuation: password=a,b must redact both a and b.
      const separator = secret.match(/[,;&]+$/)?.[0] || "";
      return prefix + "[redacted]" + separator;
    });
}

const STRUCTURED_SECRET_KEY = new RegExp("(?:" + SECRET_KEY + ")$", "i");

function redactStructuredValue(value: unknown, depth = 0): unknown {
  if (depth >= 64) return "[redacted]";
  if (typeof value === "string") return redactPlainText(value);
  if (Array.isArray(value))
    return value.map((item) => redactStructuredValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        STRUCTURED_SECRET_KEY.test(key)
          ? "[redacted]"
          : redactStructuredValue(item, depth + 1),
      ]),
    );
  }
  return value;
}

export function redactSensitiveText(value: string): string {
  // Diagnostic JSONL is parsed after redaction. Work with its values so a
  // secret containing quotes or a URL cannot consume the frame delimiters.
  const first = value.trimStart()[0];
  if (first === "{" || first === "[") {
    try {
      return JSON.stringify(redactStructuredValue(JSON.parse(value)));
    } catch {
      // Partial frames and ordinary diagnostic text still need redaction.
    }
  }
  return redactPlainText(value);
}
