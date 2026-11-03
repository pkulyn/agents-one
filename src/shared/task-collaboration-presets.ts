import type {
  TaskCollaborationAssignment,
  TaskCollaborationContextSource,
} from "./task-collaboration";
export const COLLABORATION_ROLE_PRESETS = [
  {
    key: "coordinator",
    names: ["项目负责人", "Project lead"],
    contextSources: ["project", "handoffs", "artifacts"],
  },
  {
    key: "researcher",
    names: ["资料研究", "Research"],
    contextSources: ["project", "handoffs"],
  },
  {
    key: "analyst",
    names: ["分析研判", "Analysis"],
    contextSources: ["project", "handoffs", "artifacts"],
  },
  {
    key: "designer",
    names: ["方案设计", "Design"],
    contextSources: ["project", "handoffs"],
  },
  {
    key: "writer",
    names: ["内容编写", "Writing"],
    contextSources: ["project", "handoffs", "artifacts"],
  },
  {
    key: "implementer",
    names: ["实施", "Implementation"],
    contextSources: ["project", "handoffs", "artifacts"],
  },
  {
    key: "tester",
    names: ["测试", "Testing"],
    contextSources: ["project", "handoffs", "artifacts"],
  },
  {
    key: "reviewer",
    names: ["复核验收", "Review and acceptance"],
    contextSources: ["project", "handoffs", "artifacts"],
  },
] as const;
export const COLLABORATION_CONTEXT_SOURCES: TaskCollaborationContextSource[] = [
  "project",
  "handoffs",
  "artifacts",
];
export function collaborationSharesContext(
  assignment: TaskCollaborationAssignment,
  source: TaskCollaborationContextSource,
): boolean {
  return (
    !assignment.contextSources || assignment.contextSources.includes(source)
  );
}

export function findCollaborationRolePreset(
  role: string,
): (typeof COLLABORATION_ROLE_PRESETS)[number] | undefined {
  return COLLABORATION_ROLE_PRESETS.find((preset) =>
    preset.names.some((name) => name === role),
  );
}
