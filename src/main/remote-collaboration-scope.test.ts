import { describe, expect, it } from "vitest";
import type { TaskCollaborationRecord } from "../shared/task-collaboration";
import { remoteCollaborationArtifactScope } from "./remote-collaboration-scope";
function record(
  items: Array<{
    id: string;
    assignmentId: string;
    visibility: "role" | "shared";
    respondedAt?: number;
  }>,
): TaskCollaborationRecord {
  return { execution: { interventions: items } } as TaskCollaborationRecord;
}
describe("remote collaboration artifact scope", () => {
  it("permits ordinary roles only when no pending guidance exists for that role", () => {
    expect(
      remoteCollaborationArtifactScope({} as TaskCollaborationRecord, "worker"),
    ).toBe("private");
    expect(remoteCollaborationArtifactScope(record([]), "worker")).toBe(
      "shared",
    );
    expect(
      remoteCollaborationArtifactScope(
        record([{ id: "a", assignmentId: "other", visibility: "role" }]),
        "worker",
      ),
    ).toBe("shared");
    expect(
      remoteCollaborationArtifactScope(
        record([{ id: "a", assignmentId: "worker", visibility: "role" }]),
        "worker",
      ),
    ).toBe("private");
  });
  it("requires a matching sole explicitly shared intervention", () => {
    const item = {
      id: "a",
      assignmentId: "worker",
      visibility: "shared",
    } as const;
    expect(
      remoteCollaborationArtifactScope(record([item]), "worker", "a"),
    ).toBe("shared");
    expect(remoteCollaborationArtifactScope(record([item]), "worker")).toBe(
      "private",
    );
    expect(
      remoteCollaborationArtifactScope(record([item]), "worker", "wrong"),
    ).toBe("private");
    expect(
      remoteCollaborationArtifactScope(
        record([{ ...item, visibility: "role" }]),
        "worker",
        "a",
      ),
    ).toBe("private");
    expect(
      remoteCollaborationArtifactScope(
        record([item, { ...item, id: "b", visibility: "role" }]),
        "worker",
        "a",
      ),
    ).toBe("private");
    expect(
      remoteCollaborationArtifactScope(
        record([{ ...item, respondedAt: 42 }]),
        "worker",
        "a",
      ),
    ).toBe("private");
  });
});
