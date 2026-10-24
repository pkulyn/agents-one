import { beforeEach, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("../src/main/config", () => ({ getConfigValue: read }));
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
it.each([
  "agent.service_tier",
  "agent.reasoning_effort",
  "network.force_ipv4",
  "network.proxy",
])("preserves supported Renderer setting %s and its profile", (key) => {
  expect(readRendererConfigValue(key, "profile-a")).toBe("stored scalar");
  expect(read).toHaveBeenCalledWith(key, "profile-a");
});
