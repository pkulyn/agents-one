import { describe, expect, it } from "vitest";
import { consumeNativeSessionPage } from "./sidebarSessionPagination";

describe("sidebar native-session pagination", () => {
  it("uses only native rows for lookahead and the next offset", () => {
    const first = consumeNativeSessionPage(
      Array.from({ length: 31 }, (_, index) => `native-${index}`),
      0,
      30,
    );
    expect(first.rows).toHaveLength(30);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(30);

    const last = consumeNativeSessionPage(
      ["native-30", "native-31"],
      first.nextOffset,
      30,
    );
    expect(last).toEqual({
      rows: ["native-30", "native-31"],
      hasMore: false,
      nextOffset: 32,
    });
  });
});
