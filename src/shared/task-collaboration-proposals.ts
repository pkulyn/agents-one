import type { TaskCollaborationAssignment } from "./task-collaboration";

/**
 * A runtime may suggest a team, but only the Agents One client can validate
 * and dispatch registered runtime ids. This prevents a CLI from presenting
 * terminal sub-processes as platform collaboration.
 */
export interface TaskCollaborationProposal {
  title?: string;
  reason?: string;
  brief?: string;
  assignments: TaskCollaborationAssignment[];
}

function isCoordinatorResponsibility(
  assignment: TaskCollaborationAssignment,
): boolean {
  const role = assignment.role.trim();
  if (/项目负责人|主负责|主智能体|lead|coordinator|orchestrat/i.test(role)) {
    return true;
  }
  return (
    /协调|统筹|编排|规划|计划|拆解|汇合|planner?/i.test(role) &&
    !/前端|后端|实施|开发|编写|测试|复核|审核|验收|review|test|implement|develop/i.test(
      role,
    )
  );
}

function isAcceptanceResponsibility(
  assignment: TaskCollaborationAssignment,
): boolean {
  return /验收|终验|accept/i.test(assignment.role);
}

/**
 * The Runtime that owns the conversation is the collaboration coordinator.
 * A model may suggest implementation and independent review roles, but it
 * cannot silently delegate the user's "you plan/merge/accept" duties to a
 * different Runtime. Keeping this invariant at the dispatch boundary also
 * makes an initial coordinator proposal reusable as the first DAG handoff.
 */
export function anchorTaskCollaborationCoordinator(
  assignments: TaskCollaborationAssignment[],
  coordinatorRuntimeId: string,
): TaskCollaborationAssignment[] {
  const coordinatorIndex = assignments.findIndex(isCoordinatorResponsibility);
  const anchored = assignments.map((assignment, index) => {
    if (
      isCoordinatorResponsibility(assignment) ||
      isAcceptanceResponsibility(assignment)
    ) {
      return {
        ...assignment,
        runtimeId: coordinatorRuntimeId,
        ...(index === coordinatorIndex ? { role: "项目负责人" } : {}),
      };
    }
    return { ...assignment };
  });
  if (coordinatorIndex >= 0) return anchored;
  return [
    {
      role: "项目负责人",
      runtimeId: coordinatorRuntimeId,
      responsibility: "在当前对话中完成编排、协调与最终验收",
      context: "用户原始任务、全部角色交接与验收证据",
      ...(assignments.some((assignment) => assignment.dependsOn !== undefined)
        ? { dependsOn: [] }
        : {}),
    },
    ...anchored,
  ];
}

/**
 * Keep a collaboration pipeline executable even when the Runtime catalog is
 * not in the same order as the user's requested roles.  The catalog is a
 * registry, not a workflow definition: a review role must not run before an
 * implementation role that is expected to produce its evidence.
 */
export function orderTaskCollaborationAssignments(
  assignments: TaskCollaborationAssignment[],
): TaskCollaborationAssignment[] {
  const priority = (assignment: TaskCollaborationAssignment): number => {
    const text = `${assignment.role} ${assignment.responsibility || ""}`;
    if (
      /项目负责人|主负责|主智能体|协调|拆分|规划|lead|coordinator|orchestrat/i.test(
        text,
      )
    ) {
      return 0;
    }
    if (
      /实施|执行|生成|创建|编写|开发|修改|implement|execute|write|create/i.test(
        text,
      )
    ) {
      return 10;
    }
    if (/复核|验收|测试|审核|审查|review|accept|qa|test/i.test(text)) {
      return 20;
    }
    return 15;
  };

  return assignments
    .map((assignment, index) => ({ assignment, index }))
    .sort(
      (left, right) =>
        priority(left.assignment) - priority(right.assignment) ||
        left.index - right.index,
    )
    .map(({ assignment }) => assignment);
}

const OPEN = "<agents-one-collaboration-proposal>";
const CLOSE = "</agents-one-collaboration-proposal>";

interface TaskCollaborationProposalRuntime {
  id: string;
  name: string;
  kind: string;
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return normalized || undefined;
}

export function parseTaskCollaborationProposal(
  content: string,
  availableRuntimeIds: Iterable<string>,
): { displayContent: string; proposal?: TaskCollaborationProposal } {
  const start = content.indexOf(OPEN);
  const end = content.indexOf(CLOSE, start + OPEN.length);
  if (start < 0 || end < 0) return { displayContent: content };

  const displayContent =
    `${content.slice(0, start)}${content.slice(end + CLOSE.length)}`
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const permittedRuntimeIds = new Set(availableRuntimeIds);

  try {
    const raw = JSON.parse(content.slice(start + OPEN.length, end)) as {
      title?: unknown;
      reason?: unknown;
      brief?: unknown;
      assignments?: unknown;
    };
    if (!Array.isArray(raw.assignments)) return { displayContent };
    const candidateAssignments = raw.assignments.slice(0, 6);
    const assignments = candidateAssignments
      .map((item): TaskCollaborationAssignment | null => {
        if (!item || typeof item !== "object") return null;
        const candidate = item as Record<string, unknown>;
        const runtimeId = cleanText(candidate.runtimeId, 96);
        const role = cleanText(candidate.role, 80);
        if (!runtimeId || !role || !permittedRuntimeIds.has(runtimeId))
          return null;
        const id = cleanText(candidate.id, 96);
        const dependsOn = Array.isArray(candidate.dependsOn)
          ? candidate.dependsOn
              .map((value) => cleanText(value, 96))
              .filter((value): value is string => Boolean(value))
          : undefined;
        return {
          ...(id ? { id } : {}),
          role,
          runtimeId,
          responsibility: cleanText(candidate.responsibility, 320),
          context: cleanText(candidate.context, 180),
          ...(dependsOn ? { dependsOn: [...new Set(dependsOn)] } : {}),
        };
      })
      .filter((item): item is TaskCollaborationAssignment => item !== null);
    if (
      !assignments.length ||
      assignments.length !== candidateAssignments.length
    ) {
      return { displayContent };
    }

    return {
      displayContent,
      proposal: {
        title: cleanText(raw.title, 120),
        reason: cleanText(raw.reason, 360),
        brief: cleanText(raw.brief, 4_000),
        assignments,
      },
    };
  } catch {
    return { displayContent };
  }
}

/** A proposal is a valid platform control outcome only after runtime allow-list validation. */
export function hasValidTaskCollaborationProposal(
  content: string,
  availableRuntimeIds: Iterable<string>,
): boolean {
  return Boolean(
    parseTaskCollaborationProposal(content, availableRuntimeIds).proposal,
  );
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runtimeAliases(runtime: TaskCollaborationProposalRuntime): string[] {
  const values = new Set<string>([
    runtime.id,
    runtime.name,
    runtime.kind,
    runtime.id.split("-")[0],
    runtime.name.split(/[\s-]/)[0],
    runtime.kind.split("-")[0],
  ]);
  if (runtime.kind === "claude-code") values.add("claude");
  if (runtime.kind === "hermes") values.add("hers");
  return [...values]
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
    .sort((left, right) => right.length - left.length);
}

function responsibilityAfter(
  prompt: string,
  assignees: string[],
): string | undefined {
  for (const assignee of assignees) {
    const escaped = escapedRegExp(assignee);
    const boundary = /^[a-z0-9]/i.test(assignee)
      ? `(?:^|[^a-z0-9])${escaped}`
      : escaped;
    const match = prompt.match(
      new RegExp(`${boundary}\\s*(?:负责|承担)\\s*([^，,。；;\\n]+)`, "i"),
    );
    const responsibility = cleanText(match?.[1], 320);
    if (responsibility) return responsibility;
  }
  return undefined;
}

function collaborationRole(
  responsibility: string,
  coordinator: boolean,
): string {
  if (coordinator) return "项目负责人";
  if (/复核|审核|审查|review|qa/i.test(responsibility)) return "复核";
  if (/验收|accept/i.test(responsibility)) return "验收";
  if (
    /执行|实施|生成|创建|编写|开发|implement|execute|write|create/i.test(
      responsibility,
    )
  ) {
    return "实施";
  }
  return "协作角色";
}

/**
 * Collaboration is an explicit user choice. A Runtime must not turn an
 * ordinary single-agent request into a platform collaboration merely because
 * the work could benefit from extra roles.
 */
export function hasExplicitTaskCollaborationIntent(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;

  const hasAssignedRoles =
    (text.match(/(?:负责|承担)/gi)?.length || 0) >= 2 &&
    /(?:编排|协作|多智能(?:体|协助)?|并行|串行|分工)/i.test(text);
  if (hasAssignedRoles) return true;

  const asksForCollaboration = [
    /(?:请|让|需要|使用|采用|通过|启动|发起|进行|安排|组织|希望|想要|想测试).{0,24}(?:多智能(?:体|协助)?|智能体协作|协作|协同|编排|角色分工)/i,
    /(?:多智能(?:体|协助)?|智能体协作|协同).{0,24}(?:完成|执行|处理|测试|实施|开发|生成|创建|复核|验收|并行|串行)/i,
  ].some((pattern) => pattern.test(text));
  if (!asksForCollaboration) return false;

  // Informational questions about collaboration are still single-agent turns.
  return !/(?:什么是|介绍|解释|说明|研究|分析).{0,18}(?:多智能(?:体)?|智能体协作|协作)(?:的)?(?:概念|机制|协议|原理|可行性)/i.test(
    text,
  );
}

/**
 * Turn an explicit "A 负责…，B 负责…" request into a local proposal. This
 * keeps the automatic start boundary deterministic without guessing unnamed
 * agents or trusting runtime ids supplied by model/user output.
 */
export function createExplicitTaskCollaborationProposal(
  prompt: string,
  coordinator: TaskCollaborationProposalRuntime,
  runtimes: TaskCollaborationProposalRuntime[],
): TaskCollaborationProposal | undefined {
  if (!hasExplicitTaskCollaborationIntent(prompt)) return undefined;

  const assignments: TaskCollaborationAssignment[] = [];
  const coordinatorResponsibility = responsibilityAfter(prompt, ["你"]);
  if (coordinatorResponsibility) {
    assignments.push({
      role: collaborationRole(coordinatorResponsibility, true),
      runtimeId: coordinator.id,
      responsibility: coordinatorResponsibility,
      context: "用户原始任务与已确认分工",
    });
  }

  for (const runtime of runtimes) {
    if (runtime.id === coordinator.id && coordinatorResponsibility) continue;
    const responsibility = responsibilityAfter(prompt, runtimeAliases(runtime));
    if (!responsibility) continue;
    assignments.push({
      role: collaborationRole(responsibility, runtime.id === coordinator.id),
      runtimeId: runtime.id,
      responsibility,
      context: "用户原始任务与已确认分工",
    });
  }

  if (new Set(assignments.map((assignment) => assignment.runtimeId)).size < 2) {
    return undefined;
  }
  return {
    title: "多智能体协作",
    reason:
      "你已明确指定多个已接入智能体及其职责，由 Agents One 按分工自动派发。",
    brief: cleanText(prompt, 4_000),
    assignments: orderTaskCollaborationAssignments(assignments),
  };
}

export function formatTaskCollaborationProposal(
  proposal: TaskCollaborationProposal,
): string {
  return [
    "已根据你指定的角色生成协作方案，平台将按分工自动启动。",
    OPEN,
    JSON.stringify(proposal),
    CLOSE,
  ].join("\n");
}

export function taskCollaborationProposalProtocol(
  runtimes: Array<{ id: string; name: string; kind: string }>,
): string {
  const available = runtimes
    .map(
      (runtime) =>
        `- ${runtime.name} (runtimeId: ${runtime.id}, 类型: ${runtime.kind})`,
    )
    .join("\n");
  return [
    "Agents One 平台协作规则：",
    "- 你不能通过终端、Shell、CLI、脚本或工具自行启动 claude、codex、pi、openclaw、hermes 等其他智能体，也不能把这种本地子进程当作平台协作。",
    "- 只有 Agents One 客户端在校验已接入 runtimeId 后，才会真实派发智能体；它们的运行过程和答复会自动写入当前任务对话。",
    "- 协作必须由用户在当前请求中明确提出。普通任务、继续执行、开始执行、任务较复杂或你认为分工更高效，都不构成协作授权；此时必须由你单独完成，不得输出协作提案标签。",
    "- 用户明确要求多个智能体、指定多个智能体或角色分工时，无论任务是否简单，本轮都必须先提交协作提案；不得先调用工具、检查或修改工作区，也不得先执行任务。",
    "- 用户询问为何没有出现协作确认界面或要求重试编排时，直接重新提交协作提案，不要只解释协议。",
    "- 提交时先用简短文字说明分工原因，再在答复末尾只输出一个以下格式的 JSON 块；随后立即停止，由 Agents One 自动启动已登记角色。不要自行代替其他角色执行。",
    OPEN,
    '{"title":"协作任务标题","reason":"为何需要协作","brief":"可直接执行的任务说明","assignments":[{"id":"plan","role":"项目负责人","runtimeId":"已接入智能体 ID","responsibility":"职责","context":"共享上下文范围","dependsOn":[]},{"id":"build","role":"实施","runtimeId":"已接入智能体 ID","responsibility":"职责","context":"共享上下文范围","dependsOn":["plan"]}]}',
    CLOSE,
    "- dependsOn 填写前置角色 id；无依赖节点可并行启动，依赖多个节点表示等待所有分支汇合。完全省略 dependsOn 时沿用列表串行。",
    "- 只能使用下列已接入智能体的 runtimeId：",
    available || "（当前没有其他可派发的智能体）",
  ].join("\n");
}
