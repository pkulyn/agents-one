import { beforeEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("../src/main/config", () => ({
  getConfigValue: read,
  setConfigValue: vi.fn(),
}));
import { readRendererConfigValue } from "../src/main/ipc/public-config";
beforeEach(() => {
  read.mockReset();
  read.mockReturnValue("stored scalar");
});
// @lat: [[main-process#Renderer configuration read scope]]
it.each([
  "api_server.token",
  "API_SERVER_KEY",
  "model.api_key",
  "providers.custom.access_token",
  "auth.token",
  "agent",
  "unknown",
  null,
  {},
  42,
  "agent.service_tier ",
])(
  "rejects unapproved configuration path %j without reading secrets",
  (key) => {
    expect(readRendererConfigValue(key, "profile-a")).toBeNull();
    expect(read).not.toHaveBeenCalled();
  },
);
it.each(["agent.service_tier", "agent.reasoning_effort", "network.force_ipv4"])(
  "preserves supported Renderer setting %s and its profile",
  (key) => {
    expect(readRendererConfigValue(key, "profile-a")).toBe("stored scalar");
    expect(read).toHaveBeenCalledWith(key, "profile-a");
  },
);

it("keeps a plain proxy setting readable without changing its profile", () => {
  read.mockReturnValue("http://127.0.0.1:8080");
  expect(readRendererConfigValue("network.proxy", "profile-a")).toBe(
    "http://127.0.0.1:8080",
  );
  expect(read).toHaveBeenCalledWith("network.proxy", "profile-a");
});

it("does not expose secret-bearing proxy read failures", () => {
  read.mockImplementation(() => {
    throw Error("fixture-private-password in parser diagnostic");
  });
  expect(() => readRendererConfigValue("network.proxy")).toThrow(
    "Proxy configuration could not be read",
  );
  try {
    readRendererConfigValue("network.proxy");
  } catch (error) {
    expect(String(error)).not.toContain("fixture-private-password");
  }
});
