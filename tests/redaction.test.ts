import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "../src/shared/redaction";

describe("redactSensitiveText", () => {
  it("redacts quoted JSON and key-value secrets, including values with spaces", () => {
    const raw =
      '{"token": "plain secret value", "Authorization": "Bearer abc.def.ghi", "cookie": "sid=very-secret"} api_key = local-key';

    const redacted = redactSensitiveText(raw);

    expect(redacted).toBe(
      '{"token": "[redacted]", "Authorization": "[redacted]", "cookie": "[redacted]"} api_key = [redacted]',
    );
  });

  it("redacts authorization, cookie, bearer, and URL query credentials", () => {
    const raw =
      "Authorization: Bearer gateway-secret\nCookie: sid=private; route=private\nBearer standalone-token\nhttps://example.test/run?token=query-secret&api_key=another-secret";

    const redacted = redactSensitiveText(raw);

    expect(redacted).not.toContain("gateway-secret");
    expect(redacted).not.toContain("sid=private");
    expect(redacted).not.toContain("standalone-token");
    expect(redacted).not.toContain("query-secret");
    expect(redacted).not.toContain("another-secret");
    expect(redacted).toContain("token=[redacted]");
    expect(redacted).toContain("api_key=[redacted]");
  });
});

describe("credential formats in diagnostics", () => {
  it.each([
    "secret_key",
    "secret-key",
    "SecretAccessKey",
    "access_token",
    "refreshToken",
    "passphrase",
  ])("redacts %s values", (key) => {
    const value = key + "=SYNTHETIC_PRIVATE_VALUE";
    expect(redactSensitiveText(value)).not.toContain("SYNTHETIC_PRIVATE_VALUE");
  });
  it.each(["https", "wss", "postgresql"])(
    "redacts URL user information for %s",
    (protocol) => {
      const value =
        protocol +
        "://synthetic-user:synthetic-password@example.test/path?mode=safe";
      const redacted = redactSensitiveText(value);
      expect(redacted).not.toContain("synthetic-user");
      expect(redacted).not.toContain("synthetic-password");
      expect(redacted).toContain("example.test/path?mode=safe");
    },
  );
  it.each(["abc,def", "abc;def", "abc&def"])(
    "redacts punctuation in a complete unquoted value: %s",
    (secret) => {
      expect(redactSensitiveText("password=" + secret + " status=failed")).toBe(
        "password=[redacted] status=failed",
      );
    },
  );
  it("redacts quoted secrets containing opposite and escaped quotes", () => {
    const raw = JSON.stringify({
      secret_key: "synthetic-'private'-value",
      password: 'synthetic-"private"-value',
      code: "E_TEST",
    });
    expect(JSON.parse(redactSensitiveText(raw))).toEqual({
      secret_key: "[redacted]",
      password: "[redacted]",
      code: "E_TEST",
    });
  });
  it("does not expose a bearer token after an equals assignment", () => {
    const redacted = redactSensitiveText(
      "authorization=Bearer SYNTHETIC_PRIVATE_VALUE",
    );
    expect(redacted).not.toContain("SYNTHETIC_PRIVATE_VALUE");
  });
  it("preserves nonsecret URL parameters and is idempotent", () => {
    const raw =
      "https://example.test/run?secret_key=private-value&mode=safe&api_key=other-value";
    const redacted = redactSensitiveText(raw);
    expect(redacted).toContain("mode=safe");
    expect(redacted).not.toContain("private-value");
    expect(redacted).not.toContain("other-value");
    expect(redactSensitiveText(redacted)).toBe(redacted);
  });
});

it("keeps structured diagnostic frames valid while redacting nested credentials and URL values", () => {
  const raw = {
    url: "https://example.test/run?token=SYNTHETIC_QUERY&mode=safe",
    detail: "Authorization: Bearer SYNTHETIC_BEARER",
    nested: { secret_key: { value: "SYNTHETIC_OBJECT" }, token: 12345 },
    status: "failed",
    usage: { inputTokens: 12 },
  };
  const redacted = JSON.parse(redactSensitiveText(JSON.stringify(raw)));
  expect(redacted).toMatchObject({
    nested: { secret_key: "[redacted]", token: "[redacted]" },
    status: "failed",
    usage: { inputTokens: 12 },
  });
  expect(redacted.url).toContain("mode=safe");
  expect(JSON.stringify(redacted)).not.toContain("SYNTHETIC_");
});
