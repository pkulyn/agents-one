import { expect, it } from "vitest";
import {
  restorePiNativeTools,
  piNativeToolsExtensionSource,
  type PiNativeToolsApi,
} from "../src/main/pi-native-tools";
function restore(
  defaultTools?: unknown,
  active = ["extension"],
  override = false,
): string[] {
  let result: string[] = [];
  const snapshot = JSON.stringify(defaultTools);
  const api: PiNativeToolsApi = {
    getSettings: () => ({ defaultTools }),
    getActiveTools: () => active,
    getAllTools: () => [
      ...["read", "bash", "edit", "write", "grep", "find", "ls"].map(
        (name) => ({
          name,
          sourceInfo: {
            path:
              override && name === "write"
                ? "user-extension"
                : "builtin:" + name,
          },
        }),
      ),
      { name: "extension", sourceInfo: { path: "user-extension" } },
    ],
    setActiveTools: (names) => {
      result = names;
    },
  };
  restorePiNativeTools(api);
  expect(JSON.stringify(defaultTools)).toBe(snapshot);
  return result;
}
it("restores native defaults with already active extensions", () =>
  expect(restore()).toEqual(["read", "bash", "edit", "write", "extension"]));
it("honors an empty default list", () =>
  expect(restore([])).toEqual(["extension"]));
it("does not force write into a read-only native preference", () =>
  expect(restore(["read"])).toEqual(["read", "extension"]));
it("resolves native modifier-only defaults in order", () =>
  expect(restore(["-bash", "+grep"])).toEqual([
    "read",
    "edit",
    "write",
    "grep",
    "extension",
  ]));
it("resolves explicit defaults followed by modifiers without mutating them", () =>
  expect(restore(Object.freeze(["read", "+write", "-read", "+read"]))).toEqual([
    "write",
    "read",
    "extension",
  ]));
it("follows native malformed-setting and nonstring semantics", () => {
  expect(restore({ unknown: true })).toEqual(["extension"]);
  expect(restore([null, "read", 1])).toEqual(["read", "extension"]);
});
it("removes inherited builtin readers that are absent from current defaults", () =>
  expect(
    restore(["read"], ["read", "grep", "find", "ls", "extension"]),
  ).toEqual(["read", "extension"]));
it("retains a default-active user tool that overrides a builtin name", () =>
  expect(restore([], ["write", "extension"], true)).toEqual([
    "write",
    "extension",
  ]));
it("does not activate extensions that are not already active", () =>
  expect(restore(["read"], [])).toEqual(["read"]));
it("serializes an independent native session-start handler", () => {
  let handler: (() => void) | undefined;
  let result: string[] = [];
  const install = new Function(
    "return " + piNativeToolsExtensionSource().replace("export default ", ""),
  )();
  install({
    on: (event: string, callback: () => void) => {
      expect(event).toBe("session_start");
      handler = callback;
    },
    getSettings: () => ({ defaultTools: ["read"] }),
    getAllTools: () => [],
    getActiveTools: () => [],
    setActiveTools: (names: string[]) => {
      result = names;
    },
  });
  handler!();
  expect(result).toEqual(["read"]);
});
