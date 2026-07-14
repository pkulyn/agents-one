import { beforeEach, describe, expect, it, vi } from "vitest";

const remoteRequestJsonMock = vi.hoisted(() => vi.fn());

vi.mock("../src/main/remote-sessions", () => ({
  remoteRequestJson: remoteRequestJsonMock,
}));

vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => ({
    mode: "remote",
    remoteUrl: "https://remote.example/hermes-api",
  }),
  getRemoteDashboardSessionConfig: () => ({
    remoteUrl: "https://remote.example/hermes-dashboard",
    apiKey: "dashboard-token",
    fallbackApiKey: "api-token",
  }),
}));

vi.mock("../src/main/hermes", () => ({
  getApiUrl: () => "http://127.0.0.1:8642",
  getRemoteAuthHeader: () => ({}),
}));

vi.mock("../src/main/utils", () => ({
  profileHome: () => "/tmp/hermes",
}));

import { fetchRemoteMessagingPlatforms } from "../src/main/messaging-platforms";

describe("remote messaging platforms", () => {
  beforeEach(() => {
    remoteRequestJsonMock.mockReset();
  });

  it("returns a read-only catalog when the remote dashboard falls back to HTML", async () => {
    remoteRequestJsonMock.mockRejectedValue(
      new Error(
        "Invalid JSON from https://remote.example/hermes-dashboard/api/messaging/platforms (status 200): <!doctype html><html>",
      ),
    );

    const response = await fetchRemoteMessagingPlatforms();

    expect(response.source).toBe("remote-api");
    expect(response.editable).toBe(false);
    expect(response.message).toMatch(/does not expose/i);
    expect(response.platforms.length).toBeGreaterThan(0);
    expect(response.platforms.every((platform) => !platform.gateway_running)).toBe(
      true,
    );
  });

  it("does not hide remote authentication failures", async () => {
    remoteRequestJsonMock.mockRejectedValue(new Error("401: unauthorized"));

    await expect(fetchRemoteMessagingPlatforms()).rejects.toThrow(
      "401: unauthorized",
    );
  });
});
