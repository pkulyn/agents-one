import { describe, expect, it } from "vitest";
import { gatewayEndpointForConnectPairing } from "./agents-one-connect";

describe("gatewayEndpointForConnectPairing", () => {
  // @lat: [[agent-onboarding#Remote connection profiles#Split Connect and Gateway addresses#Preserves same-origin pairing deployments]]
  it("keeps separately hosted Gateway and Connect endpoints distinct", () => {
    expect(
      gatewayEndpointForConnectPairing(
        " https://gateway.example.test/agents-one/v1 ",
        "https://connect.example.test",
      ),
    ).toBe("https://gateway.example.test/agents-one/v1");
    expect(
      gatewayEndpointForConnectPairing(
        undefined,
        "https://connect.example.test",
      ),
    ).toBe("https://connect.example.test");
  });
});
