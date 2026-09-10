import { describe, expect, it } from "vitest";
import {
  buildTaskCollaborationGraph,
  taskCollaborationDescendants,
} from "./task-collaboration-graph";

describe("task collaboration graph", () => {
  it("keeps legacy assignments serial", () => {
    const graph = buildTaskCollaborationGraph([
      { id: "plan", role: "规划" },
      { id: "build", role: "实施" },
      { id: "review", role: "复核" },
    ]);
    expect(graph.explicit).toBe(false);
    expect(graph.layers).toEqual([["plan"], ["build"], ["review"]]);
  });

  it("supports parallel branches and a join", () => {
    const graph = buildTaskCollaborationGraph([
      { id: "plan", role: "规划", dependsOn: [] },
      { id: "frontend", role: "前端", dependsOn: ["plan"] },
      { id: "backend", role: "后端", dependsOn: ["plan"] },
      { id: "accept", role: "验收", dependsOn: ["frontend", "backend"] },
    ]);
    expect(graph.layers).toEqual([
      ["plan"],
      ["frontend", "backend"],
      ["accept"],
    ]);
    expect(graph.sinkIds).toEqual(["accept"]);
    expect(taskCollaborationDescendants(graph, "plan")).toEqual([
      "frontend",
      "backend",
      "accept",
    ]);
  });

  it("rejects missing dependencies and cycles", () => {
    expect(() =>
      buildTaskCollaborationGraph([
        { id: "a", role: "A", dependsOn: ["missing"] },
      ]),
    ).toThrow(/不存在/);
    expect(() =>
      buildTaskCollaborationGraph([
        { id: "a", role: "A", dependsOn: ["b"] },
        { id: "b", role: "B", dependsOn: ["a"] },
      ]),
    ).toThrow(/循环/);
  });
});
