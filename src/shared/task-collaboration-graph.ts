import type { TaskCollaborationAssignment } from "./task-collaboration";

export interface TaskCollaborationGraph {
  assignmentIds: string[];
  dependenciesById: Map<string, string[]>;
  downstreamById: Map<string, string[]>;
  layers: string[][];
  sinkIds: string[];
  explicit: boolean;
}

export function taskCollaborationAssignmentId(
  assignment: TaskCollaborationAssignment,
  index: number,
): string {
  return assignment.id || `legacy:${index}:${assignment.role}`;
}

export function hasExplicitTaskCollaborationDependencies(
  assignments: TaskCollaborationAssignment[],
): boolean {
  return assignments.some((assignment) =>
    Object.prototype.hasOwnProperty.call(assignment, "dependsOn"),
  );
}

/**
 * Validate and layer a collaboration DAG. Legacy records without any
 * `dependsOn` field are interpreted as the existing serial list.
 */
export function buildTaskCollaborationGraph(
  assignments: TaskCollaborationAssignment[],
): TaskCollaborationGraph {
  const assignmentIds = assignments.map(taskCollaborationAssignmentId);
  const known = new Set(assignmentIds);
  if (known.size !== assignmentIds.length) {
    throw new Error("协作角色 ID 必须唯一");
  }

  const explicit = hasExplicitTaskCollaborationDependencies(assignments);
  const dependenciesById = new Map<string, string[]>();
  const downstreamById = new Map<string, string[]>(
    assignmentIds.map((id) => [id, []]),
  );

  assignments.forEach((assignment, index) => {
    const id = assignmentIds[index];
    const dependencies = explicit
      ? [...new Set(assignment.dependsOn || [])]
      : index > 0
        ? [assignmentIds[index - 1]]
        : [];
    for (const dependencyId of dependencies) {
      if (!known.has(dependencyId)) {
        throw new Error(`角色 ${assignment.role} 依赖了不存在的角色`);
      }
      if (dependencyId === id) {
        throw new Error(`角色 ${assignment.role} 不能依赖自身`);
      }
      downstreamById.get(dependencyId)?.push(id);
    }
    dependenciesById.set(id, dependencies);
  });

  const remaining = new Map(
    assignmentIds.map((id) => [id, dependenciesById.get(id)?.length || 0]),
  );
  let ready = assignmentIds.filter((id) => remaining.get(id) === 0);
  const layers: string[][] = [];
  let visited = 0;
  while (ready.length > 0) {
    const layer = ready;
    layers.push(layer);
    visited += layer.length;
    const next: string[] = [];
    for (const id of layer) {
      for (const downstreamId of downstreamById.get(id) || []) {
        const count = (remaining.get(downstreamId) || 0) - 1;
        remaining.set(downstreamId, count);
        if (count === 0) next.push(downstreamId);
      }
    }
    ready = assignmentIds.filter((id) => next.includes(id));
  }
  if (visited !== assignmentIds.length) {
    throw new Error("协作依赖存在循环，无法启动任务");
  }

  return {
    assignmentIds,
    dependenciesById,
    downstreamById,
    layers,
    sinkIds: assignmentIds.filter(
      (id) => (downstreamById.get(id)?.length || 0) === 0,
    ),
    explicit,
  };
}

export function taskCollaborationDescendants(
  graph: TaskCollaborationGraph,
  assignmentId: string,
): string[] {
  const found = new Set<string>();
  const queue = [...(graph.downstreamById.get(assignmentId) || [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (found.has(id)) continue;
    found.add(id);
    queue.push(...(graph.downstreamById.get(id) || []));
  }
  return graph.assignmentIds.filter((id) => found.has(id));
}
