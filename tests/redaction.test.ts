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
