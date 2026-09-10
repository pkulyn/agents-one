import { describe, expect, it } from "vitest";
import {
  createPairingSession,
  isGatewayV1TunnelPath,
  isPairingSessionUsable,
  markPairingSessionPaired,
  normalizeConnectEndpoint,
  normalizePairingCode,
  parseConnectTunnelFrame,
  pairingSessionState,
  revokePairingSession,
  verifyPairingCode,
  websocketEndpoint,
} from "../src/shared/agents-one-connect";

describe("Agents One Connect protocol core", () => {
  it("creates a short-lived single-use pairing session without storing plaintext code", async () => {
    const material = await createPairingSession({
      runtimeId: "hermes-home2",
      displayName: "Hers",
      now: 1_000,
    });

    expect(material.code).toMatch(/^[A-Z2-9]{10}$/);
    expect(material.session.codeDigest).not.toBe(material.code);
    expect(material.session.state).toBe("pending");
    expect(isPairingSessionUsable(material.session, 1_001)).toBe(true);
    await expect(
      verifyPairingCode(material.session, material.code, 1_001),
    ).resolves.toBe(true);
    await expect(
      verifyPairingCode(
        material.session,
        `${material.code.slice(0, 9)}${material.code.endsWith("A") ? "B" : "A"}`,
        1_001,
      ),
    ).resolves.toBe(false);
  });

  it("expires, pairs, and revokes sessions fail-closed", async () => {
    const material = await createPairingSession({
      runtimeId: "hers-home2",
      displayName: "Hers",
      now: 10_000,
      ttlMs: 30_000,
    });

    expect(pairingSessionState(material.session, 40_000)).toBe("expired");
    expect(isPairingSessionUsable(material.session, 40_000)).toBe(false);
    expect(() => markPairingSessionPaired(material.session, 40_000)).toThrow(
      /no longer usable/i,
    );
    expect(revokePairingSession(material.session).state).toBe("revoked");
    expect(
      await verifyPairingCode(
        revokePairingSession(material.session),
        material.code,
        10_001,
      ),
    ).toBe(false);
  });

  it("normalizes codes and only permits secure Connect endpoints", () => {
    expect(normalizePairingCode("abcde-fghij")).toBe("ABCDEFGHIJ");
    expect(normalizeConnectEndpoint("https://connect.example.test/")).toBe(
      "https://connect.example.test",
    );
    expect(
      websocketEndpoint("https://connect.example.test", "/connect/v1/tunnel"),
    ).toBe("wss://connect.example.test/connect/v1/tunnel");
    expect(() =>
      normalizeConnectEndpoint("http://connect.example.test"),
    ).toThrow(/HTTPS/i);
    expect(normalizeConnectEndpoint("http://127.0.0.1:8787/")).toBe(
      "http://127.0.0.1:8787",
    );
  });

  it("validates Gateway v1 tunnel paths and frames", () => {
    expect(isGatewayV1TunnelPath("/capabilities")).toBe(true);
    expect(isGatewayV1TunnelPath("/commands/catalog")).toBe(true);
    expect(isGatewayV1TunnelPath("/commands/execute")).toBe(true);
    expect(isGatewayV1TunnelPath("/runs/run_1/events")).toBe(true);
    expect(isGatewayV1TunnelPath("/runs/run_1/../../etc/passwd")).toBe(false);
    expect(isGatewayV1TunnelPath("/admin/shell")).toBe(false);

    expect(
      parseConnectTunnelFrame({
        type: "request",
        requestId: "req_1",
        method: "GET",
        path: "/capabilities",
      }),
    ).toMatchObject({ type: "request", path: "/capabilities" });
    expect(
      parseConnectTunnelFrame({
        type: "event",
        runId: "run_1",
        sequence: 4,
        event: { type: "assistant.completed" },
      }),
    ).toMatchObject({ type: "event", sequence: 4 });
    expect(() =>
      parseConnectTunnelFrame({
        type: "request",
        requestId: "req_1",
        method: "POST",
        path: "/admin/shell",
      }),
    ).toThrow(/invalid/i);
    expect(() =>
      parseConnectTunnelFrame({
        type: "request",
        requestId: "req_1",
        method: "POST",
        path: "/commands/execute/../../shell",
      }),
    ).toThrow(/invalid/i);
  });
});
