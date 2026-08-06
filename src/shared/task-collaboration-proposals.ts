import type { TaskCollaborationAssignment } from "./task-collaboration";

/**
 * A runtime may suggest a team, but only the user can confirm it in the
 * client. This prevents a CLI from presenting terminal sub-processes as
 * Agents One collaboration.
 */
export interface TaskCollaborationProposal {
  title?: string;
  reason?: string;
  brief?: string;
  assignments: TaskCollaborationAssignment[];
}

const OPEN = "<agents-one-collaboration-proposal>";
const CLOSE = "</agents-one-collaboration-proposal>";

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

  const displayContent = `${content.slice(0, start)}${content.slice(end + CLOSE.length)}`
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
        if (!runtimeId || !role || !permittedRuntimeIds.has(runtimeId)) return null;
        const id = cleanText(candidate.id, 96);
        return {
          ...(id ? { id } : {}),
          role,
          runtimeId,
          responsibility: cleanText(candidate.responsibility, 320),
          context: cleanText(candidate.context, 180),
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

export function taskCollaborationProposalProtocol(
  runtimes: Array<{ id: string; name: string; kind: string }>,
): string {
  const available = runtimes
    .map((runtime) => `- ${runtime.name} (runtimeId: ${runtime.id}, 类型: ${runtime.kind})`)
    .join("\n");
  return [
    "Agents One 平台协作规则：",
    "- 你不能通过终端、Shell、CLI、脚本或工具自行启动 claude、codex、pi、openclaw、hermes 等其他智能体，也不能把这种本地子进程当作平台协作。",
    "- 只有 Agents One 在用户确认后，才会真实派发已接入的智能体；它们的运行过程和答复会自动写入当前任务对话。",
    "- 用户明确要求多个智能体、指定多个智能体或角色分工时，无论任务是否简单，本轮都必须先提交协作提案；不得先调用工具、检查或修改工作区，也不得先执行任务。",
    "- 用户询问为何没有出现协作确认界面或要求重试编排时，直接重新提交协作提案，不要只解释协议。",
    "- 提交时先用简短文字说明分工原因，再在答复末尾只输出一个以下格式的 JSON 块；随后立即停止并等待用户在界面中确认。不要自行代替其他角色执行。",
    OPEN,
    '{"title":"协作任务标题","reason":"为何需要协作","brief":"可直接执行的任务说明","assignments":[{"role":"项目负责人","runtimeId":"已接入智能体 ID","responsibility":"职责","context":"共享上下文范围"}]}',
    CLOSE,
    "- 只能使用下列已接入智能体的 runtimeId：",
    available || "（当前没有其他可派发的智能体）",
  ].join("\n");
}
