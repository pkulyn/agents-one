import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync(
  join(process.cwd(), "src/renderer/src/screens/Layout/Layout.tsx"),
  "utf8",
);

describe("Layout remote-mode feature gates", () => {
  it("no longer renders the removed Discover surface", () => {
    expect(layoutSource).not.toContain("<Discover");
  });

  it("does not block agent management behind the removed Profiles remote notice", () => {
    expect(layoutSource).not.toContain('RemoteNotice feature="Profiles"');
  });
});
