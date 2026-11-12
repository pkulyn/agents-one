import { expect, it } from "vitest";
import { oneTaskContext } from "./task-context";
it("supplies only model/date facts and chat intent without a platform workflow", () => {
  const prompt = oneTaskContext({
    name: "Research",
    modelId: "doubao-seed-2.0-mini",
    endpoint: "https://ark.cn-beijing.volces.com/api/plan/v3",
    now: new Date("2026-11-12T12:00:00Z"),
  });
  expect(prompt).toContain("doubao-seed-2.0-mini");
  expect(prompt).toContain("ark.cn-beijing.volces.com");
  expect(prompt).toContain("Respond in chat");
  expect(prompt).not.toContain("Host shell");
  expect(prompt).not.toContain("Available tools");
  expect(prompt.length).toBeLessThan(500);
  expect(prompt).not.toContain("SHA-256");
  expect(prompt).not.toContain("[交付物]");
});
