import { describe, expect, it, vi, type Mock } from "vitest";
import {
  checkLatestDesktopRelease,
  DESKTOP_RELEASE_API,
} from "./release-check";
const release = (
  tag_name: string,
): { tag_name: string; draft: boolean; prerelease: boolean } => ({
  tag_name,
  draft: false,
  prerelease: false,
});
const requestFor = (value: unknown, status = 200): Mock<typeof fetch> =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(value), { status }));
describe("manual public release checks", () => {
  it.each([
    ["v0.1.1", "0.1.0", "0.1.1"],
    ["v0.1.0", "0.1.0", null],
    ["v0.0.9", "0.1.0", null],
    ["v0.10.0", "0.9.0", "0.10.0"],
    ["v0.1.0", "0.1.0-alpha.1", "0.1.0"],
  ])("compares %s against %s", async (tag, current, expected) => {
    const request = requestFor(release(tag!));
    expect(await checkLatestDesktopRelease(current!, request)).toBe(expected);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toBe(DESKTOP_RELEASE_API);
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });
  it("treats a repository without a release as no update", async () => {
    expect(
      await checkLatestDesktopRelease("0.1.0", requestFor({}, 404)),
    ).toBeNull();
  });
  it.each([403, 429, 500])(
    "rejects HTTP %i rather than claiming the latest version",
    async (status) => {
      await expect(
        checkLatestDesktopRelease("0.1.0", requestFor({}, status)),
      ).rejects.toThrow("HTTP " + status);
    },
  );
  it.each([
    {},
    { ...release("v0.2.0"), prerelease: true },
    release("main"),
    release("v0.2.0-beta.1"),
  ])("rejects unusable release data", async (value) => {
    await expect(
      checkLatestDesktopRelease("0.1.0", requestFor(value)),
    ).rejects.toThrow();
  });
  it("passes a deadline signal and propagates network failure", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(Error("network unavailable"));
    await expect(checkLatestDesktopRelease("0.1.0", request)).rejects.toThrow(
      "network unavailable",
    );
    expect(request.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
