import { expect, it, vi } from "vitest";
import { ensureWorkspace } from "../scripts/check-launcher-renderer.mjs";
const ready = {
  result: { value: { rootChildren: 1, workspace: true, api: true } },
};
const blank = {
  result: { value: { rootChildren: 0, workspace: false, api: true } },
};
const wait = async (): Promise<void> => {};

it("accepts a rendered workspace without reloading drafts", async () => {
  const call = vi.fn().mockResolvedValue(ready);
  expect(await ensureWorkspace(call, { wait })).toEqual({
    ok: true,
    recovered: false,
  });
  expect(call.mock.calls.map((c) => c[0])).toEqual(["Runtime.evaluate"]);
});

it("reloads a blank page once with cache disabled and restores the cache setting", async () => {
  let reloaded = false;
  const call = vi.fn(async (method: string) => {
    if (method === "Page.reload") reloaded = true;
    return reloaded ? ready : blank;
  });
  expect(await ensureWorkspace(call, { wait })).toEqual({
    ok: true,
    recovered: true,
  });
  expect(call.mock.calls.filter((c) => c[0] === "Page.reload")).toHaveLength(1);
  expect(call).toHaveBeenCalledWith("Page.reload", { ignoreCache: true });
  expect(call.mock.calls.at(-1)).toEqual([
    "Network.setCacheDisabled",
    { cacheDisabled: false },
  ]);
});

it("fails without reloading a nonempty page that did not reach the workspace", async () => {
  const call = vi.fn().mockResolvedValue({
    result: { value: { rootChildren: 1, workspace: false, api: true } },
  });
  await expect(ensureWorkspace(call, { wait })).rejects.toThrow(
    "did not display",
  );
  expect(call.mock.calls.some((c) => c[0] === "Page.reload")).toBe(false);
});
