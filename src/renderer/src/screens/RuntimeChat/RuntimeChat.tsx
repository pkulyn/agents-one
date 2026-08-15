import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Globe } from "../../assets/icons";
import { ChevronDown, ShieldCheck, Users, X } from "lucide-react";
import { WebPreviewPanel } from "../Chat/WebPreviewPanel";
import { ChatInput, type ChatInputHandle } from "../Chat/ChatInput";
import type { ContextUsage } from "../Chat/ContextGauge";
import { ContextFolderChip } from "../Chat/ContextFolderChip";
import { WorktreePanel } from "../Chat/WorktreePanel";
import { contextWindowForModel } from "../Chat/contextWindows";
import { ChatEmptyState } from "../Chat/ChatEmptyState";
import { ConversationWorkspace } from "../Chat/ConversationWorkspace";
import { MessageList } from "../Chat/MessageList";
import {
  runtimeConversationToChatMessages,
  runtimeEventsToChatMessages,
} from "./runtimeChatMessageAdapter";
import { TaskCollaborationRolePanel } from "../../components/TaskCollaborationRolePanel";
import { TaskCollaborationArtifactPanel } from "../../components/TaskCollaborationArtifactPanel";
import { TaskCollaborationTimeline } from "../../components/TaskCollaborationTimeline";
import type { Attachment } from "../../../../shared/attachments";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeRun,
} from "../../../../shared/agent-runtimes";
import type {
  RuntimeConversationExecution,
  RuntimeConversationMessage,
} from "../../../../shared/runtime-conversations";
import type { ChatMessage } from "../Chat/types";
import type {
  TaskCollaborationAssignment,
  TaskCollaborationAcceptance,
  TaskCollaborationArtifact,
  TaskCollaborationExecution,
  TaskCollaborationIntervention,
  TaskCollaborationRoleRun,
  TaskCollaborationTimelineEvent,
} from "../../../../shared/task-collaboration";
import {
  createExplicitTaskCollaborationProposal,
  formatTaskCollaborationProposal,
  hasExplicitTaskCollaborationIntent,
  parseTaskCollaborationProposal,
  orderTaskCollaborationAssignments,
  taskCollaborationProposalProtocol,
  type TaskCollaborationProposal,
} from "../../../../shared/task-collaboration-proposals";
import { summarizeTaskOutput } from "../Chat/runtimeOutput";
import {
  buildTaskCollaborationGraph,
  hasExplicitTaskCollaborationDependencies,
  taskCollaborationDescendants,
} from "../../../../shared/task-collaboration-graph";

interface CollaborationLaunch {
  taskId?: string;
  assignments: TaskCollaborationAssignment[];
  projectFolder?: string;
  /** The coordinator already produced the visible proposal/plan turn. */
  initialCoordinatorHandoff?: string;
}

interface ActiveCollaborationRun {
  assignmentId: string;
  role: string;
  runtimeId: string;
  run: AgentRuntimeRun;
}

interface RuntimeChatProps {
  runId: string;
  runtime: AgentRuntimeDefinition;
  profile: string;
  active?: boolean;
  initialConversationId?: string | null;
  initialRuntimeRunId?: string | null;
  initialRuntimeSessionId?: string | null;
  initialMessages?: RuntimeConversationMessage[];
  initialWorkspace?: string;
  initialAccessMode?: "auto" | "analysis" | "full_access";
  collaboration?: {
    assignments: TaskCollaborationAssignment[];
    execution?: TaskCollaborationExecution;
    taskId?: string;
    projectFolder?: string;
  };
  runtimeCatalog?: Record<string, AgentRuntimeDefinition>;
  onLoadingChange?: (runId: string, loading: boolean) => void;
  onSessionIdChange?: (runId: string, sessionId: string | null) => void;
  onConversationIdChange?: (runId: string, conversationId: string) => void;
  onTitleChange?: (runId: string, title: string) => void;
  /** Opens the explicit collaboration proposal for this existing task. */
  onRequestCollaboration?: (proposal?: TaskCollaborationProposal) => void;
  /** Persists a validated proposal and returns the launch owned by this task. */
  onStartCollaboration?: (
    proposal: TaskCollaborationProposal,
    projectFolder?: string,
  ) => Promise<CollaborationLaunch | null>;
}

interface CollaborationResume {
  assignmentId: string;
  execution: TaskCollaborationExecution;
  /** Resume after an already completed guided role instead of rerunning it. */
  startAfter?: boolean;
  /** Stop the dependency chain after this role answers the user. */
  holdAfterAssignmentId?: string;
  /** Intervention turn whose reply should be persisted with shared context. */
  interventionId?: string;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newConversationId(): string {
  return `runtime-conv-${newId()}`;
}

function newMessage(
  role: RuntimeConversationMessage["role"],
  content: string,
  execution?: RuntimeConversationMessage["execution"],
): RuntimeConversationMessage {
  return { id: newId(), role, content, createdAt: Date.now(), execution };
}

function executionFromRun(
  run: AgentRuntimeRun,
): RuntimeConversationExecution | undefined {
  if (
    !run.events?.length &&
    !run.artifacts?.length &&
    !run.model &&
    !run.usage
  ) {
    return undefined;
  }
  return {
    runId: run.id,
    events: run.events || [],
    ...(run.artifacts?.length ? { artifacts: run.artifacts } : {}),
    ...(run.model ? { model: run.model } : {}),
    ...(run.usage ? { usage: run.usage } : {}),
  };
}

/**
 * A Gateway may expose the run shell first and append its durable event
 * snapshot on a later poll. Keep the observed event history monotonic so a
 * terminal response cannot overwrite the first turn's reasoning/tool rows
 * with a thinner status snapshot.
 */
function mergeRuntimeRunObservation(
  previous: AgentRuntimeRun | null,
  current: AgentRuntimeRun,
): AgentRuntimeRun {
  const eventsById = new Map<
    string,
    NonNullable<AgentRuntimeRun["events"]>[number]
  >();
  for (const event of previous?.events || []) eventsById.set(event.id, event);
  for (const event of current.events || []) eventsById.set(event.id, event);
  const events = [...eventsById.values()];
  return {
    ...(previous || {}),
    ...current,
    ...(events.length ? { events } : {}),
  };
}

function responseText(run: AgentRuntimeRun): string {
  if (run.error) {
    const error = run.error.trim();
    if (["failed", "error"].includes(error.toLowerCase())) {
      return "任务执行失败，但智能体未返回详细错误。";
    }
    return error;
  }
  const output = run.output?.trim() || "";
  if (!output) {
    return run.status === "failed"
      ? "任务执行失败，但智能体未返回详细错误。"
      : run.status;
  }
  const summary = summarizeTaskOutput(output);
  if (summary.finalText) return summary.finalText;
  if (summary.hasStructuredEvents) {
    return "智能体本轮没有返回可显示的最终答复，请继续提问或稍后重试。";
  }
  return output;
}

function promptWithTranscript(
  history: RuntimeConversationMessage[],
  prompt: string,
): string {
  if (history.length === 0) return prompt;

  const transcript = history
    .filter((message) => message.role === "user" || message.role === "agent")
    .slice(-8)
    .map((message) => {
      const role = message.role === "user" ? "用户" : "智能体";
      return `${role}：${message.content.slice(0, 1_500)}`;
    })
    .join("\n\n")
    .slice(-8_000);

  return [
    "以下是本次对话的近期上下文，请据此继续回应。",
    transcript,
    `当前用户消息：${prompt}`,
  ].join("\n\n");
}

function assignmentKey(
  assignment: TaskCollaborationAssignment,
  index: number,
): string {
  return assignment.id || `legacy:${index}:${assignment.role}`;
}

function roleCanModify(assignment: TaskCollaborationAssignment): boolean {
  // Role names are the authoritative intent. A testing/acceptance responsibility
  // may mention a delivery as evidence, but that must not make the role writable.
  const role = assignment.role || "";
  if (/测试|验收|复核|审核|审查|qa|review|accept/i.test(role)) return false;
  if (/项目负责人|主负责|主智能体|coordinator|orchestrat/i.test(role))
    return false;
  if (
    /实施|开发|编写|生成|修改|创建|implement|develop|write|create/i.test(role)
  )
    return true;
  return /实施|开发|编写|生成|修改|创建|implement|develop|write|create/i.test(
    assignment.responsibility || "",
  );
}

function isCoordinator(assignment: TaskCollaborationAssignment): boolean {
  return /项目负责人|主负责|主智能体|coordinator|orchestrat/i.test(
    `${assignment.role} ${assignment.responsibility || ""}`,
  );
}

function isFinalReview(assignment: TaskCollaborationAssignment): boolean {
  return Boolean(assignment.id?.endsWith("::final-review"));
}

function roleIsAcceptance(assignment: TaskCollaborationAssignment): boolean {
  return (
    isFinalReview(assignment) ||
    (!isCoordinator(assignment) &&
      /验收|复核|审核|审查|accept|review|qa/i.test(
        `${assignment.role} ${assignment.responsibility || ""}`,
      ))
  );
}

type EffectiveWorkspaceAccess =
  | NonNullable<TaskCollaborationAssignment["workspaceAccess"]>
  | "runtime_native";

function effectiveWorkspaceAccess(
  assignment: TaskCollaborationAssignment,
  runtime: AgentRuntimeDefinition | undefined,
  projectFolder: string | undefined,
): EffectiveWorkspaceAccess {
  if (assignment.workspaceAccess) return assignment.workspaceAccess;
  if (runtime?.location !== "remote") return "local_direct";
  return projectFolder ? "evidence_bundle" : "runtime_native";
}

function workspaceAccessLabel(
  assignment: TaskCollaborationAssignment,
  runtime?: AgentRuntimeDefinition,
  projectFolder?: string,
): string {
  switch (effectiveWorkspaceAccess(assignment, runtime, projectFolder)) {
    case "remote_mapping":
      return assignment.workspaceRef
        ? `远程映射（${assignment.workspaceRef}）`
        : "远程映射（未配置）";
    case "evidence_bundle":
      return "只读证据包";
    case "runtime_native":
      return "智能体所在设备";
    default:
      return "本地直连";
  }
}

export function collaborationWorkspacePreflight(
  assignments: TaskCollaborationAssignment[],
  runtimes: Record<string, AgentRuntimeDefinition>,
  projectFolder: string | undefined,
): Array<{ assignment: TaskCollaborationAssignment; reason: string }> {
  return assignments.flatMap((assignment) => {
    const assigned = assignment.runtimeId
      ? runtimes[assignment.runtimeId]
      : undefined;
    if (!assigned) return [];
    const workspaceAccess = effectiveWorkspaceAccess(
      assignment,
      assigned,
      projectFolder,
    );
    if (
      assigned.location === "remote" &&
      workspaceAccess === "evidence_bundle" &&
      !projectFolder
    ) {
      return [
        {
          assignment,
          reason: `${assignment.role} 选择了“只读证据包”，但任务尚未关联本地项目文件夹。请选择项目后再启动协作。`,
        },
      ];
    }
    if (assigned.location !== "remote") {
      return workspaceAccess === "local_direct"
        ? []
        : [
            {
              assignment,
              reason: `${assignment.role} 是本地智能体，请使用“本地直连”读取项目目录。`,
            },
          ];
    }
    if (
      workspaceAccess === "remote_mapping" &&
      !assignment.workspaceRef?.trim()
    ) {
      return [
        {
          assignment,
          reason: `${assignment.role} 选择了“远程映射”，但尚未填写远程目录、git 引用或共享工作区。`,
        },
      ];
    }
    if (workspaceAccess === "local_direct") {
      return [
        {
          assignment,
          reason: `${assignment.role} 是远程智能体，不能直接访问本机项目目录；请改为“远程映射”或“只读证据包”。`,
        },
      ];
    }
    if (workspaceAccess === "runtime_native") return [];
    if (workspaceAccess === "evidence_bundle" && roleCanModify(assignment)) {
      return [
        {
          assignment,
          reason: `${assignment.role} 需要实施交付，远程“只读证据包”不能写入本机项目；请改派本地智能体或配置远程映射。`,
        },
      ];
    }
    return [];
  });
}

function remoteRuntimeEnvironmentProtocol(): string {
  return [
    "Agents One 执行环境边界：",
    "- 你的原生工具、终端和绝对路径属于智能体所在设备；它们不是运行 Agents One 桌面客户端的用户电脑，也不是用户在客户端选择的项目文件夹。",
    "- 只有本轮明确附带 Workspace Grant 时，你才能通过 workspace_gateway 访问用户在 Agents One 中关联的本地项目；不得把原生文件系统访问说成 Workspace Grant，也不得反过来要求用户为远程主机上的任务关联本地项目。",
    "- 如果任务目标就是智能体所在设备或其可访问的服务器，请直接使用原生能力并如实标注来源机器。只有任务明确依赖用户电脑中的项目文件且本轮没有 Grant 时，才说明需要用户关联项目。",
  ].join("\n");
}

function roleAccessMode(
  assignment: TaskCollaborationAssignment,
  assignmentId: string,
  defaultAccessMode: "analysis" | "safe_write" | "full_access",
  interventions: TaskCollaborationIntervention[],
): "analysis" | "safe_write" | "full_access" {
  if (!roleCanModify(assignment)) return "analysis";
  const override = [...interventions]
    .reverse()
    .find(
      (item) => item.assignmentId === assignmentId && item.accessMode,
    )?.accessMode;
  return override || defaultAccessMode;
}

export function collaborationPermissionPreflight(
  assignments: TaskCollaborationAssignment[],
  defaultAccessMode: "analysis" | "safe_write" | "full_access",
  interventions: TaskCollaborationIntervention[] = [],
): Array<{ assignment: TaskCollaborationAssignment; reason: string }> {
  return assignments.flatMap((assignment, index) => {
    if (
      !roleCanModify(assignment) ||
      roleAccessMode(
        assignment,
        assignmentKey(assignment, index),
        defaultAccessMode,
        interventions,
      ) !== "analysis"
    ) {
      return [];
    }
    return [
      {
        assignment,
        reason: `${assignment.role} 是实施角色，但当前协作权限为“只读”，不能创建或修改文件。请将本轮权限切换为“自动”或“完全访问”后重新启动协作。`,
      },
    ];
  });
}

function hasConcreteDelivery(
  artifacts: TaskCollaborationArtifact[],
  assignmentId: string,
): boolean {
  return artifacts.some(
    (artifact) =>
      artifact.assignmentId === assignmentId &&
      ((artifact.kind === "code_diff" && Boolean(artifact.summary)) ||
        (artifact.kind === "file" &&
          Boolean(artifact.path && artifact.sha256) &&
          !/isolated worktree|项目工作目录|隔离工作目录/i.test(
            artifact.label,
          ))),
  );
}

function hasDeliveryContract(
  artifacts: TaskCollaborationArtifact[],
  assignmentId: string,
): boolean {
  return artifacts.some(
    (artifact) =>
      artifact.assignmentId === assignmentId &&
      ((artifact.kind === "file" &&
        Boolean(
          artifact.path &&
          artifact.sha256 &&
          artifact.sourceMachine &&
          artifact.changeSummary,
        )) ||
        (artifact.kind === "code_diff" &&
          Boolean(
            artifact.summary &&
            artifact.sourceMachine &&
            artifact.changeSummary,
          ))),
  );
}

function collectRuntimeArtifacts(
  assignment: TaskCollaborationAssignment,
  assignmentId: string,
  run: AgentRuntimeRun,
  runtime: AgentRuntimeDefinition,
): TaskCollaborationArtifact[] {
  const createdAt = run.completedAt || Date.now();
  const artifacts: TaskCollaborationArtifact[] = [];
  for (const [index, artifact] of (run.artifacts || []).entries()) {
    // A workspace root and a final model response are not deliveries. Only a
    // Runtime-verified file or an adapter-produced diff can cross this gate.
    if (artifact.kind !== "diff" && artifact.kind !== "file") continue;
    artifacts.push({
      id: `${assignmentId}:${run.id}:artifact:${index}`,
      assignmentId,
      role: assignment.role,
      ...(assignment.runtimeId ? { runtimeId: assignment.runtimeId } : {}),
      kind: artifact.kind === "diff" ? "code_diff" : "file",
      label:
        artifact.label ||
        (artifact.kind === "diff" ? "Git diff" : "项目工作目录"),
      ...(artifact.path ? { path: artifact.path } : {}),
      ...(typeof artifact.size === "number" ? { size: artifact.size } : {}),
      ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
      ...(artifact.sourceMachine
        ? { sourceMachine: artifact.sourceMachine }
        : {}),
      ...(artifact.changeSummary
        ? { changeSummary: artifact.changeSummary }
        : {}),
      ...(artifact.content
        ? { summary: artifact.content.slice(0, 8_000) }
        : {}),
      source: "runtime_artifact",
      sourceRunId: run.id,
      sourceMachine:
        artifact.sourceMachine ||
        (runtime.location === "local"
          ? "本机工作区"
          : `${runtime.name} 远程运行环境`),
      ...(artifact.kind === "diff"
        ? { changeSummary: artifact.content?.slice(0, 8_000) || artifact.label }
        : {}),
      createdAt,
    });
  }
  if (
    run.diffSummary &&
    !artifacts.some((artifact) => artifact.kind === "code_diff")
  ) {
    artifacts.push({
      id: `${assignmentId}:${run.id}:diff-summary`,
      assignmentId,
      role: assignment.role,
      ...(assignment.runtimeId ? { runtimeId: assignment.runtimeId } : {}),
      kind: "code_diff",
      label: "Git diff 摘要",
      summary: run.diffSummary.slice(0, 8_000),
      source: "runtime_artifact",
      sourceRunId: run.id,
      sourceMachine:
        runtime.location === "local"
          ? "本机工作区"
          : `${runtime.name} 远程运行环境`,
      changeSummary: run.diffSummary.slice(0, 8_000),
      createdAt,
    });
  }
  const testEvents = (run.events || []).filter(
    (event) =>
      (event.type === "tool_result" || event.type === "completed") &&
      /(?:test|测试|vitest|jest|pytest|mocha|playwright|验收)/i.test(
        event.summary,
      ),
  );
  for (const [index, event] of testEvents.entries()) {
    artifacts.push({
      id: `${assignmentId}:${run.id}:test:${event.id || index}`,
      assignmentId,
      role: assignment.role,
      ...(assignment.runtimeId ? { runtimeId: assignment.runtimeId } : {}),
      kind: "test_result",
      label: "运行测试结果",
      summary: event.summary.slice(0, 4_000),
      source: "runtime_event",
      sourceRunId: run.id,
      sourceMachine:
        runtime.location === "local"
          ? "本机工作区"
          : `${runtime.name} 远程运行环境`,
      createdAt: event.createdAt || createdAt,
    });
  }
  return artifacts;
}

function appendArtifacts(
  existing: TaskCollaborationArtifact[],
  incoming: TaskCollaborationArtifact[],
): TaskCollaborationArtifact[] {
  const byId = new Map(existing.map((artifact) => [artifact.id, artifact]));
  for (const artifact of incoming) byId.set(artifact.id, artifact);
  return [...byId.values()].slice(-200);
}

function redactLocalWorkspaceReference(
  value: string,
  projectFolder?: string,
  hideAllLocalPaths = false,
): string {
  let redacted = value;
  if (projectFolder) {
    const normalizedRoot = projectFolder.replace(/[\\/]+$/, "");
    if (normalizedRoot) {
      const escapedRoot = normalizedRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      redacted = redacted.replace(
        new RegExp(escapedRoot.replace(/\\\\/g, "[\\\\/]"), "gi"),
        "<本地项目>",
      );
    }
  }
  // A handoff can carry an implementation contract generated before the
  // evidence bundle. Never forward a Windows local path to a remote role.
  return hideAllLocalPaths
    ? redacted.replace(/\b[A-Za-z]:[\\/][^\r\n<>|?*"]+/g, "<本地路径>")
    : redacted;
}

function artifactEvidence(
  artifacts: TaskCollaborationArtifact[],
  options?: { redactProjectFolder?: string; hideAllLocalPaths?: boolean },
): string {
  if (!artifacts.length)
    return "当前没有 Runtime 已确认的文件、代码变更或测试结果。不得仅凭口头回复判定通过。";
  const redact = (value: string): string =>
    redactLocalWorkspaceReference(
      value,
      options?.redactProjectFolder,
      options?.hideAllLocalPaths,
    );
  return artifacts
    .map((artifact, index) =>
      [
        `产物 #${index + 1}（${artifact.kind === "file" ? "文件" : artifact.kind === "code_diff" ? "代码变更" : "测试结果"}）`,
        `角色：${artifact.role}`,
        `说明：${artifact.label}`,
        artifact.path ? `路径：${redact(artifact.path)}` : "",
        typeof artifact.size === "number" ? `大小：${artifact.size} 字节` : "",
        artifact.sourceMachine ? `来源机器：${artifact.sourceMachine}` : "",
        artifact.sha256 ? `SHA-256：${artifact.sha256}` : "",
        artifact.changeSummary
          ? `变更摘要：${redact(artifact.changeSummary.slice(0, 1_500))}`
          : "",
        artifact.summary
          ? `证据：${redact(artifact.summary.slice(0, 1_500))}`
          : "",
      ]
        .filter(Boolean)
        .join("；"),
    )
    .join("\n");
}

function acceptanceFromOutput(
  assignmentId: string,
  output: string,
  artifacts: TaskCollaborationArtifact[],
): TaskCollaborationAcceptance {
  const markerIndex = output.indexOf("[验收结论]");
  const marker =
    markerIndex >= 0
      ? output
          .slice(markerIndex + "[验收结论]".length, markerIndex + 6_000)
          .trim()
      : "";
  if (!marker) {
    return {
      assignmentId,
      status: "needs_review",
      conclusion: "验收角色未按约定输出 [验收结论]，需人工复核。",
      reviewedArtifactIds: [],
      createdAt: Date.now(),
    };
  }
  const declared = /状态\s*[：:]?\s*(通过|不通过|需人工复核)/.exec(marker)?.[1];
  const status =
    declared === "通过"
      ? "passed"
      : declared === "不通过"
        ? "failed"
        : "needs_review";
  const numbers = [...marker.matchAll(/#\s*(\d{1,3})/g)]
    .map((match) => Number(match[1]) - 1)
    .filter((index) => index >= 0 && index < artifacts.length);
  const reviewedArtifactIds = [
    ...new Set(numbers.map((index) => artifacts[index].id)),
  ];
  const deliveryIds = new Set(
    artifacts
      .filter((artifact) => artifact.kind !== "test_result")
      .map((artifact) => artifact.id),
  );
  const reviewedDeliveries = reviewedArtifactIds.filter((id) =>
    deliveryIds.has(id),
  );
  if (
    !artifacts.length ||
    !reviewedArtifactIds.length ||
    !reviewedDeliveries.length
  ) {
    return {
      assignmentId,
      status: "needs_review",
      conclusion:
        "验收结论必须引用至少一项实施角色发布的文件或代码变更，不能只引用测试文字或口头答复。",
      reviewedArtifactIds,
      createdAt: Date.now(),
    };
  }
  const incompleteContract = artifacts
    .filter((artifact) => reviewedDeliveries.includes(artifact.id))
    .some((artifact) =>
      artifact.kind === "file"
        ? !artifact.path ||
          !artifact.sha256 ||
          !artifact.sourceMachine ||
          !artifact.changeSummary
        : !artifact.summary ||
          !artifact.sourceMachine ||
          !artifact.changeSummary,
    );
  if (status === "passed" && incompleteContract) {
    return {
      assignmentId,
      status: "needs_review",
      conclusion:
        "验收角色引用的交付物缺少路径、SHA-256、来源机器或变更摘要，不能自动判定通过。请由实施角色补齐交付物信息后重新验收。",
      reviewedArtifactIds,
      createdAt: Date.now(),
    };
  }
  return {
    assignmentId,
    status,
    conclusion: marker.slice(0, 6_000),
    reviewedArtifactIds,
    createdAt: Date.now(),
  };
}

function collaborationRolePrompt(
  brief: string,
  assignments: TaskCollaborationAssignment[],
  runtimes: Record<string, AgentRuntimeDefinition>,
  recipient: TaskCollaborationAssignment,
  recipientIndex: number,
  projectFolder: string | undefined,
  completedHandoffs: TaskCollaborationRoleRun[],
  interventions: TaskCollaborationIntervention[],
  artifacts: TaskCollaborationArtifact[],
  reviewFeedback?: string,
): string {
  const roleLabel = recipient.role || "未命名角色";
  const responsibility = recipient.responsibility || "按任务说明完成本角色工作";
  const recipientKey = assignmentKey(recipient, recipientIndex);
  const recipientRuntime = recipient.runtimeId
    ? runtimes[recipient.runtimeId]
    : undefined;
  const recipientIsRemote = recipientRuntime?.location === "remote";
  const recipientWorkspaceAccess = effectiveWorkspaceAccess(
    recipient,
    recipientRuntime,
    projectFolder,
  );
  const humanGuidance = interventions
    .filter(
      (item) =>
        item.visibility === "shared" || item.assignmentId === recipientKey,
    )
    .map((item) => {
      const ownerRole =
        assignments.find(
          (assignment, index) =>
            assignmentKey(assignment, index) === item.assignmentId,
        )?.role || "目标角色";
      const instruction =
        item.visibility === "shared"
          ? `【用户已同步给协作组】${item.content}`
          : `【仅给本角色的人工指令】${item.content}`;
      return item.response
        ? `${instruction}\n【${ownerRole} 的介入回复】${item.response}`
        : instruction;
    })
    .join("\n\n")
    .slice(-8_000);
  const completed = completedHandoffs
    .filter((item) => item.status === "succeeded" && item.handoff)
    .map(
      (item) =>
        `【${item.role} 已完成】\n${
          recipientIsRemote
            ? redactLocalWorkspaceReference(
                item.handoff as string,
                projectFolder,
                true,
              )
            : item.handoff
        }`,
    )
    .join("\n\n")
    .slice(-12_000);
  return [
    "这是 Agents One 平台受控编排的多智能体协作任务。",
    `你当前只执行“${roleLabel}”角色。职责：${responsibility}。`,
    "严格边界：只报告和完成本角色职责；不要代替其他已登记角色，不要创建 subagent，也不要把未收到的他人结果写成已完成。平台会在你完成后自动派发下一角色。",
    roleCanModify(recipient)
      ? `${
          recipientWorkspaceAccess === "runtime_native"
            ? "本角色在智能体所在设备的原生环境中执行；不要要求用户关联 Agents One 本地项目，也不要把原生路径声称为用户电脑路径。"
            : "本角色可按当前任务权限在关联项目目录内交付文件或代码。"
        }完成时必须发布以下完整格式，路径和 SHA-256 必须来自实际写入后的工具输出：\n[交付物]\n路径：<实际绝对路径>\nSHA-256：<64 位哈希>\n来源机器：<执行机器或远程环境>\n变更摘要：<实际改动>\n没有完整交付物信息时，平台不会启动后续验收。`
      : "本角色为非实施阶段：不得创建、修改或删除项目文件；请基于已经收到的交接材料做规划、测试、复核或验收。",
    "\n完整协作分工：\n" +
      assignments
        .filter((assignment) => assignment.runtimeId)
        .map((assignment) => {
          const assignedRuntime = runtimes[assignment.runtimeId as string];
          return `- ${assignment.role}：${assignedRuntime?.name || assignment.runtimeId}；职责：${assignment.responsibility || "未说明"}；上下文：${assignment.context || "任务说明"}；工作区：${workspaceAccessLabel(assignment, assignedRuntime, projectFolder)}`;
        })
        .join("\n"),
    projectFolder && !recipientIsRemote
      ? `\n关联项目目录：${projectFolder}`
      : "",
    recipient.workspaceAccess === "remote_mapping" && recipient.workspaceRef
      ? `\n本角色远程映射工作区：${recipient.workspaceRef}`
      : "",
    recipient.workspaceAccess === "evidence_bundle"
      ? "\n关联项目：已选择本地项目；本角色仅以平台转交的只读证据包为准。不得声称直接读取或验证本机项目路径；如需独立文件系统验收，必须要求用户改派本地角色或配置远程映射。"
      : "",
    completed ? `\n已完成角色的真实交接材料：\n${completed}` : "",
    roleIsAcceptance(recipient)
      ? `\n待验收的真实产物（只可据此验收）：\n${artifactEvidence(artifacts, recipientIsRemote ? { redactProjectFolder: projectFolder, hideAllLocalPaths: true } : undefined)}${
          recipientIsRemote
            ? "\n\n远程终验规则：这是平台证据审查，不是远程文件系统复查。禁止调用 read_file、bash、SSH 或任何工具重新访问本机路径；本机路径已被隐藏。带有路径、SHA-256、来源机器和变更摘要的文件产物，已经由 Agents One 桌面主进程在本机独立核验，必须直接作为可信证据使用。若实施交付和本地复核均已完成且证据契约完整，应据此输出“通过”；只有缺少平台证据或证据明确不一致时才输出“不通过”或“需人工复核”。"
            : ""
        }\n\n完成验收时必须用以下格式：\n[验收结论]\n状态：通过 / 不通过 / 需人工复核\n依据：#1、#2（只能引用上述真实产物编号）\n结论：简明说明。`
      : "",
    humanGuidance ? `\n用户人工指令：\n${humanGuidance}` : "",
    reviewFeedback
      ? `\n上一轮复核未通过，必须先修正以下问题再重新交付：\n${reviewFeedback.slice(0, 4_000)}`
      : "",
    `\n任务说明：\n${brief}`,
  ].join("\n");
}

function RuntimeAvatar({
  runtime,
  size,
}: {
  runtime: AgentRuntimeDefinition;
  size: number;
}): React.JSX.Element {
  return (
    <span
      className={`runtime-message-avatar ${runtime.kind}`}
      style={
        runtime.color ? { background: runtime.color, color: "#fff" } : undefined
      }
    >
      {runtime.avatar ? (
        <img src={runtime.avatar} alt="" />
      ) : (
        <Bot size={size} />
      )}
    </span>
  );
}

function RuntimeCollaborationProposalCards({
  messages,
  runtime,
  runtimeCatalog,
  collaboration,
  onRequestCollaboration,
}: {
  messages: RuntimeConversationMessage[];
  runtime: AgentRuntimeDefinition;
  runtimeCatalog: Record<string, AgentRuntimeDefinition>;
  collaboration?: RuntimeChatProps["collaboration"];
  onRequestCollaboration?: (proposal?: TaskCollaborationProposal) => void;
}): React.JSX.Element | null {
  if (collaboration) return null;
  const proposals = messages.flatMap((message) => {
    if (message.role !== "agent") return [];
    const result = parseTaskCollaborationProposal(message.content, [
      runtime.id,
      ...Object.keys(runtimeCatalog),
    ]);
    return result?.proposal
      ? [{ id: message.id, proposal: result.proposal }]
      : [];
  });
  if (proposals.length === 0) return null;

  return (
    <>
      {proposals.map(({ id, proposal }) => (
        <section
          key={id}
          className="task-collaboration-proposal"
          aria-label="智能体协作建议"
        >
          <div>
            <Users size={15} />
            <strong>建议启用多智能体协作</strong>
          </div>
          {proposal.reason ? <p>{proposal.reason}</p> : null}
          <ul>
            {proposal.assignments.map((assignment) => {
              const assignedRuntime =
                runtimeCatalog[assignment.runtimeId || ""];
              return (
                <li key={`${assignment.role}:${assignment.runtimeId}`}>
                  <RuntimeAvatar
                    runtime={assignedRuntime || runtime}
                    size={13}
                  />
                  <span>{assignment.role}</span>
                  <small>{assignedRuntime?.name || assignment.runtimeId}</small>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onRequestCollaboration?.(proposal)}
          >
            调整协作安排
          </button>
        </section>
      ))}
    </>
  );
}

export default function RuntimeChat({
  runId,
  runtime,
  profile,
  active = true,
  initialConversationId = null,
  initialRuntimeRunId = null,
  initialRuntimeSessionId = null,
  initialMessages = [],
  initialWorkspace,
  initialAccessMode = "auto",
  collaboration,
  runtimeCatalog: providedRuntimeCatalog = {},
  onLoadingChange,
  onSessionIdChange,
  onConversationIdChange,
  onTitleChange,
  onRequestCollaboration,
  onStartCollaboration,
}: RuntimeChatProps): React.JSX.Element {
  const runtimeCatalog = useMemo(
    () => ({ [runtime.id]: runtime, ...providedRuntimeCatalog }),
    [providedRuntimeCatalog, runtime],
  );
  const unifiedRemoteGatewayRuntime =
    runtime.location === "remote" &&
    runtime.config.remoteGateway?.protocol === "agents-one-v1";
  const collaborationWriteRuntimeAvailable =
    Boolean(onStartCollaboration || collaboration) &&
    Object.values(runtimeCatalog).some(
      (candidate) =>
        candidate.enabled &&
        candidate.location === "local" &&
        (candidate.kind === "codex" ||
          candidate.kind === "claude-code" ||
          candidate.kind === "pi"),
    );
  const [messages, setMessages] =
    useState<RuntimeConversationMessage[]>(initialMessages);
  const [workspace, setWorkspace] = useState(initialWorkspace || "");
  const [currentRunId, setCurrentRunId] = useState<string | null>(
    initialRuntimeRunId,
  );
  const [loading, setLoading] = useState(Boolean(initialRuntimeRunId));
  const [webPreviewUrl, setWebPreviewUrl] = useState("about:blank");
  const [webPreviewVisible, setWebPreviewVisible] = useState(false);
  const [worktreeVisible, setWorktreeVisible] = useState(false);
  const [accessMode, setAccessMode] = useState<
    "auto" | "analysis" | "full_access"
  >(initialAccessMode);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [taskRun, setTaskRun] = useState<AgentRuntimeRun | null>(null);
  const [activeCollaborationRuntimeId, setActiveCollaborationRuntimeId] =
    useState<string | null>(null);
  const [activeCollaborationRuns, setActiveCollaborationRuns] = useState<
    Record<string, ActiveCollaborationRun>
  >({});
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const [remoteArtifactsSupported, setRemoteArtifactsSupported] =
    useState(false);
  const [remoteWorkspaceSupported, setRemoteWorkspaceSupported] =
    useState(false);
  const [collaborationExecution, setCollaborationExecution] = useState<
    TaskCollaborationExecution | undefined
  >(collaboration?.execution);
  const [collaborationAssignments, setCollaborationAssignments] = useState<
    TaskCollaborationAssignment[]
  >(() => collaboration?.assignments || []);
  const [collaborationDashboardVisible, setCollaborationDashboardVisible] =
    useState(true);
  const cancelledRef = useRef(false);
  const pauseAssignmentRef = useRef<string | null>(null);
  const [interventionTarget, setInterventionTarget] = useState<{
    assignment: TaskCollaborationAssignment;
    assignmentId: string;
  } | null>(null);
  const [interventionText, setInterventionText] = useState("");
  const [interventionShared, setInterventionShared] = useState(false);
  const [interventionAccessMode, setInterventionAccessMode] = useState<
    "inherit" | "analysis" | "full_access"
  >("inherit");
  const [interventionRuntimeId, setInterventionRuntimeId] = useState("");
  const conversationIdRef = useRef<string | null>(initialConversationId);
  const runtimeSessionIdRef = useRef<string | null>(initialRuntimeSessionId);
  const messagesRef = useRef<RuntimeConversationMessage[]>(initialMessages);
  const taskRunRef = useRef<AgentRuntimeRun | null>(null);
  const activeCollaborationRunsRef = useRef<
    Record<string, ActiveCollaborationRun>
  >({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const appearanceRuntime = runtimeCatalog[runtime.id] ?? runtime;
  const activeTraceRuntime =
    loading && activeCollaborationRuntimeId
      ? runtimeCatalog[activeCollaborationRuntimeId] || appearanceRuntime
      : appearanceRuntime;

  useEffect(() => {
    if (
      appearanceRuntime.avatar ||
      appearanceRuntime.kind !== "hermes" ||
      typeof window.hermesAPI.listProfiles !== "function"
    ) {
      setProfileAvatar(null);
      return;
    }
    let cancelled = false;
    void window.hermesAPI
      .listProfiles()
      .then((profiles) => {
        if (cancelled) return;
        const match = profiles.find(
          (item) => item.id === profile || item.name === appearanceRuntime.name,
        );
        setProfileAvatar(match?.avatar ?? null);
      })
      .catch(() => {
        if (!cancelled) setProfileAvatar(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    appearanceRuntime.avatar,
    appearanceRuntime.kind,
    appearanceRuntime.name,
    profile,
  ]);

  // The parent conversation keeps its configured appearance while child
  // collaboration runtimes execute. Per-message/live trace identity is added
  // separately below and must never replace old parent turns globally.
  const agentAvatar = appearanceRuntime.avatar ?? profileAvatar;

  const updateActiveCollaborationRun = useCallback(
    (assignmentId: string, active?: ActiveCollaborationRun): void => {
      setActiveCollaborationRuns((previous) => {
        const next = { ...previous };
        if (active) next[assignmentId] = active;
        else delete next[assignmentId];
        activeCollaborationRunsRef.current = next;
        return next;
      });
    },
    [],
  );

  const getAgentContent = useCallback(
    (message: RuntimeConversationMessage): string => {
      if (message.role !== "agent") return message.content;
      return (
        parseTaskCollaborationProposal(message.content, [
          runtime.id,
          ...Object.keys(runtimeCatalog),
        ])?.displayContent || message.content
      );
    },
    [runtime.id, runtimeCatalog],
  );

  const nativeMessages = useMemo(() => {
    const history = runtimeConversationToChatMessages(messages, {
      getAgentContent,
    });
    const parallelRuns = Object.values(activeCollaborationRuns);
    if (loading && parallelRuns.length) {
      const liveMessages = parallelRuns.flatMap((active) => {
        const liveRuntime =
          runtimeCatalog[active.runtimeId] || appearanceRuntime;
        const liveIdentity = {
          agentRuntimeId: liveRuntime.id,
          agentName: liveRuntime.name,
          agentAvatar: liveRuntime.avatar ?? null,
          agentColor: liveRuntime.color ?? null,
          collaborationRole: active.role,
          collaborationAssignmentId: active.assignmentId,
        };
        const live = runtimeEventsToChatMessages(active.run.events || [], {
          live: true,
          idPrefix: `live:${active.run.id}`,
          agentIdentity: liveIdentity,
        });
        return live.some((message) => message.kind === "reasoning")
          ? live
          : [
              {
                id: `live:${active.run.id}:thinking`,
                kind: "reasoning" as const,
                role: "agent" as const,
                text: `${liveRuntime.name} 正在思考并准备执行……`,
                ...liveIdentity,
              },
              ...live,
            ];
      });
      return [...history, ...liveMessages];
    }
    if (!loading || !currentRunId) return history;
    const liveAssignmentId = collaborationExecution?.activeAssignmentId;
    const liveRole = collaborationExecution?.roleRuns.find(
      (item) => item.assignmentId === liveAssignmentId,
    )?.role;
    const liveIdentity = {
      agentRuntimeId: activeTraceRuntime.id,
      agentName: activeTraceRuntime.name,
      agentAvatar:
        activeTraceRuntime.id === runtime.id
          ? agentAvatar
          : (activeTraceRuntime.avatar ?? null),
      agentColor: activeTraceRuntime.color ?? null,
      ...(liveRole ? { collaborationRole: liveRole } : {}),
      ...(liveAssignmentId
        ? { collaborationAssignmentId: liveAssignmentId }
        : {}),
    };
    const live = runtimeEventsToChatMessages(taskRun?.events || [], {
      live: true,
      idPrefix: `live:${currentRunId}`,
      agentIdentity: liveIdentity,
    });
    const hasReasoning = live.some((message) => message.kind === "reasoning");
    const liveMessages: ChatMessage[] = hasReasoning
      ? live
      : [
          {
            id: `live:${currentRunId}:thinking`,
            kind: "reasoning",
            role: "agent",
            text: "正在思考并准备执行……",
            ...liveIdentity,
          },
          ...live,
        ];
    return [...history, ...liveMessages];
  }, [
    agentAvatar,
    activeCollaborationRuns,
    appearanceRuntime,
    collaborationExecution,
    currentRunId,
    getAgentContent,
    activeTraceRuntime,
    loading,
    messages,
    runtime.id,
    runtimeCatalog,
    taskRun,
  ]);

  const handleNativeApprove = useCallback(() => undefined, []);
  const handleNativeDeny = useCallback(() => undefined, []);
  const handleNativeClarifyResolved = useCallback(
    (_requestId: string, _answer: string) => undefined,
    [],
  );

  useEffect(() => {
    setCollaborationAssignments(collaboration?.assignments || []);
  }, [collaboration?.assignments]);

  useEffect(() => {
    onLoadingChange?.(runId, loading);
  }, [loading, onLoadingChange, runId]);

  useEffect(() => {
    let cancelled = false;
    if (!unifiedRemoteGatewayRuntime) {
      setRemoteArtifactsSupported(false);
      setRemoteWorkspaceSupported(false);
      return () => {
        cancelled = true;
      };
    }
    void window.hermesAPI
      .probeAgentRuntime(runtime.id)
      .then((probe) => {
        if (!cancelled) {
          setRemoteArtifactsSupported(
            probe.state === "healthy" &&
              (probe.capabilities.artifactUpload ??
                probe.capabilities.artifacts),
          );
          const workspaceAvailable =
            unifiedRemoteGatewayRuntime &&
            probe.state === "healthy" &&
            probe.capabilities.workspaceAccess;
          setRemoteWorkspaceSupported(workspaceAvailable);
          if (
            unifiedRemoteGatewayRuntime &&
            !workspaceAvailable &&
            !collaborationWriteRuntimeAvailable
          ) {
            setAccessMode("analysis");
            setPermissionMenuOpen(false);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteArtifactsSupported(false);
          setRemoteWorkspaceSupported(false);
          if (
            unifiedRemoteGatewayRuntime &&
            !collaborationWriteRuntimeAvailable
          ) {
            setAccessMode("analysis");
            setPermissionMenuOpen(false);
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    collaborationWriteRuntimeAvailable,
    runtime.id,
    runtime.kind,
    unifiedRemoteGatewayRuntime,
  ]);

  useEffect(() => {
    if (!active) return;
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [active, loading, messages]);

  // Runtime chats use the same markdown renderer as the native Chat screen.
  // Forward its link event to the shared split-screen web preview so remote
  // and local runtimes do not lose this mature interaction.
  useEffect(() => {
    if (!active) return;
    const handleNavigate = (event: Event): void => {
      const url = (event as CustomEvent<string>).detail;
      if (!url) return;
      setWebPreviewUrl(url);
      setWebPreviewVisible(true);
    };
    document.addEventListener("web-preview:navigate", handleNavigate);
    return () => {
      document.removeEventListener("web-preview:navigate", handleNavigate);
    };
  }, [active]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    let disposed = false;
    const refreshPersistedConversation = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail as
        | { profile?: unknown; conversationId?: unknown }
        | undefined;
      const conversationId = detail?.conversationId;
      if (
        detail?.profile !== profile ||
        typeof conversationId !== "string" ||
        conversationId !== conversationIdRef.current
      ) {
        return;
      }
      void window.hermesAPI
        .getRuntimeConversation(conversationId, profile)
        .then((conversation) => {
          if (
            disposed ||
            !conversation ||
            conversation.id !== conversationIdRef.current
          ) {
            return;
          }
          messagesRef.current = conversation.messages;
          setMessages(conversation.messages);
          setAccessMode(conversation.accessMode || "auto");
          if (conversation.activeRuntimeRunId) {
            setCurrentRunId(
              (current) => current || conversation.activeRuntimeRunId || null,
            );
            setLoading(true);
          } else if (currentRunId && taskRunRef.current?.status !== "running") {
            setCurrentRunId(null);
            setLoading(false);
          }
          if (conversation.runtimeSessionId) {
            runtimeSessionIdRef.current = conversation.runtimeSessionId;
            onSessionIdChange?.(runId, conversation.runtimeSessionId);
          }
        })
        .catch(() => {
          // Keep the already visible transcript when a background refresh fails.
        });
    };
    window.addEventListener(
      "agents-one:runtime-conversation-updated",
      refreshPersistedConversation,
    );
    if (conversationIdRef.current) {
      refreshPersistedConversation(
        new CustomEvent("agents-one:runtime-conversation-updated", {
          detail: {
            profile,
            conversationId: conversationIdRef.current,
          },
        }),
      );
    }
    return () => {
      disposed = true;
      window.removeEventListener(
        "agents-one:runtime-conversation-updated",
        refreshPersistedConversation,
      );
    };
  }, [currentRunId, onSessionIdChange, profile, runId]);

  const persistConversation = useCallback(
    async (
      nextMessages: RuntimeConversationMessage[],
      options: {
        runtimeSessionId?: string | null;
        activeRuntimeRunId?: string | null;
      } = {},
    ): Promise<string> => {
      const id = conversationIdRef.current || newConversationId();
      if (conversationIdRef.current !== id) {
        conversationIdRef.current = id;
        onConversationIdChange?.(runId, id);
      }
      const nextRuntimeSessionId =
        options.runtimeSessionId ?? runtimeSessionIdRef.current;
      if (nextRuntimeSessionId !== runtimeSessionIdRef.current) {
        runtimeSessionIdRef.current = nextRuntimeSessionId;
      }
      const title =
        nextMessages.find((message) => message.role === "user")?.content ||
        runtime.name;
      await window.hermesAPI.saveRuntimeConversation({
        profile,
        id,
        title,
        runtimeId: runtime.id,
        runtimeName: runtime.name,
        runtimeKind: runtime.kind,
        runtimeLocation: runtime.location,
        runtimeColor: runtime.color,
        runtimeAvatar: runtime.avatar,
        runtimeSessionId: nextRuntimeSessionId || undefined,
        activeRuntimeRunId:
          options.activeRuntimeRunId === undefined
            ? currentRunId || null
            : options.activeRuntimeRunId,
        // This is local UI metadata used to keep the conversation under its
        // project. Runtime dispatch decides separately whether any workspace
        // content or grant may be shared with the selected agent.
        workspace: workspace || undefined,
        accessMode,
        messages: nextMessages,
      });
      window.dispatchEvent(
        new CustomEvent("hermes-session-transcript-changed"),
      );
      return id;
    },
    [
      accessMode,
      currentRunId,
      onConversationIdChange,
      profile,
      runId,
      runtime,
      workspace,
    ],
  );

  const linkCollaborationToConversation = useCallback(
    async (taskId?: string): Promise<void> => {
      if (
        !taskId ||
        !conversationIdRef.current ||
        typeof window.hermesAPI.linkTaskCollaboration !== "function"
      ) {
        return;
      }
      await window.hermesAPI.linkTaskCollaboration(
        { taskId, conversationId: conversationIdRef.current },
        profile,
      );
      window.dispatchEvent(new Event("agents-one:task-collaboration-changed"));
    },
    [profile],
  );

  const pollRun = useCallback(
    async (runtimeRunId: string): Promise<void> => {
      while (!cancelledRef.current) {
        const current = await window.hermesAPI.getAgentRuntimeRun(runtimeRunId);
        if (!current) {
          const nextMessages = [
            ...messagesRef.current,
            newMessage(
              "system",
              "当前运行已不可恢复，可能是桌面应用在执行期间重启。请在本对话中重新发送任务。",
            ),
          ];
          messagesRef.current = nextMessages;
          setMessages(nextMessages);
          await persistConversation(nextMessages, {
            activeRuntimeRunId: null,
          });
          setLoading(false);
          setCurrentRunId(null);
          return;
        }
        const observed = mergeRuntimeRunObservation(
          taskRunRef.current,
          current,
        );
        taskRunRef.current = observed;
        setTaskRun(observed);
        if (observed.sessionId) {
          runtimeSessionIdRef.current = observed.sessionId;
          onSessionIdChange?.(runId, observed.sessionId);
          void persistConversation(messagesRef.current, {
            runtimeSessionId: observed.sessionId,
          });
        }
        if (observed.status === "running") {
          await new Promise((resolve) => setTimeout(resolve, 900));
          continue;
        }
        const persistedConversation = conversationIdRef.current
          ? await window.hermesAPI.getRuntimeConversation(
              conversationIdRef.current,
              profile,
            )
          : null;
        if (
          persistedConversation?.messages.some(
            (message) => message.execution?.runId === observed.id,
          )
        ) {
          messagesRef.current = persistedConversation.messages;
          setMessages(persistedConversation.messages);
          setLoading(false);
          setCurrentRunId(null);
          return;
        }
        const execution = executionFromRun(observed);
        // A terminal runtime result belongs to the selected agent, including
        // failures. Keeping it as a system bubble hides the agent avatar and
        // prevents the durable event timeline from being rendered.
        const terminalRole =
          execution || current.status === "succeeded" ? "agent" : "system";
        const summarizedTerminalText = responseText(current);
        const availableRuntimeIds = [
          runtime.id,
          ...Object.keys(runtimeCatalog),
        ];
        const latestUserRequest = [...messagesRef.current]
          .reverse()
          .find((message) => message.role === "user")?.content;
        const collaborationAuthorized = hasExplicitTaskCollaborationIntent(
          latestUserRequest || "",
        );
        const summarizedProposalResult =
          current.status === "succeeded"
            ? parseTaskCollaborationProposal(
                summarizedTerminalText,
                availableRuntimeIds,
              )
            : { displayContent: summarizedTerminalText };
        const rawProposalResult =
          current.status === "succeeded" && current.output
            ? parseTaskCollaborationProposal(
                current.output,
                availableRuntimeIds,
              )
            : undefined;
        const summarizedProposal = summarizedProposalResult.proposal;
        const rawProposal = rawProposalResult?.proposal;
        const parsedProposal = collaborationAuthorized
          ? summarizedProposal || rawProposal
          : undefined;
        const unrequestedProposal =
          !collaborationAuthorized &&
          Boolean(summarizedProposal || rawProposal);
        const terminalText = unrequestedProposal
          ? (summarizedProposal
              ? summarizedProposalResult.displayContent
              : rawProposalResult?.displayContent) ||
            "本轮按单智能体任务处理，未启动协作。"
          : rawProposal && !summarizedProposal && current.output
            ? current.output
            : summarizedTerminalText;
        const nextMessages = [
          ...messagesRef.current,
          newMessage(terminalRole, terminalText, execution),
        ];
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        await persistConversation(nextMessages, {
          runtimeSessionId: observed.sessionId || runtimeSessionIdRef.current,
          activeRuntimeRunId: null,
        });
        setLoading(false);
        setCurrentRunId(null);
        if (parsedProposal && onStartCollaboration) {
          try {
            const launch = await onStartCollaboration(
              parsedProposal,
              workspace || undefined,
            );
            if (launch) {
              await linkCollaborationToConversation(launch.taskId);
              setCollaborationAssignments(launch.assignments);
              const brief =
                parsedProposal.brief ||
                [...nextMessages]
                  .reverse()
                  .find((message) => message.role === "user")?.content ||
                "按协作安排完成任务。";
              requestAnimationFrame(() => {
                window.dispatchEvent(
                  new CustomEvent("agents-one:submit-task-message", {
                    detail: {
                      runId,
                      content: brief,
                      reuseExistingUserMessage: true,
                      collaboration: {
                        ...launch,
                        initialCoordinatorHandoff: terminalText,
                      },
                    },
                  }),
                );
              });
            }
          } catch {
            // The validated proposal stays visible and can still be adjusted
            // manually if persistence is temporarily unavailable.
          }
        }
        return;
      }
    },
    [
      onSessionIdChange,
      onStartCollaboration,
      linkCollaborationToConversation,
      persistConversation,
      profile,
      runId,
      runtime,
      runtimeCatalog,
      workspace,
    ],
  );

  useEffect(() => {
    if (!currentRunId || taskRunRef.current?.id === currentRunId) return;
    cancelledRef.current = false;
    setLoading(true);
    void pollRun(currentRunId);
  }, [currentRunId, pollRun]);

  const appendCollaborationMessage = useCallback(
    async (
      assignedRuntime: AgentRuntimeDefinition,
      assignment: TaskCollaborationAssignment,
      role: "agent" | "system",
      content: string,
      execution?: {
        runId: string;
        events: NonNullable<AgentRuntimeRun["events"]>;
      },
    ): Promise<void> => {
      const reply = newMessage(role, content, execution);
      reply.agentRuntimeId = assignedRuntime.id;
      reply.agentName = assignedRuntime.name;
      reply.agentAvatar = assignedRuntime.avatar;
      reply.agentColor = assignedRuntime.color;
      reply.collaborationRole = assignment.role;
      // Assignment ids are persisted with new collaboration rows.  The
      // legacy fallback keeps old records navigable without reading a stale
      // collaboration prop from this callback closure.
      reply.collaborationAssignmentId =
        assignment.id || assignmentKey(assignment, 0);
      const nextMessages = [...messagesRef.current, reply];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      await persistConversation(nextMessages);
    },
    [persistConversation],
  );

  const runCollaboration = useCallback(
    async (
      brief: string,
      launch: CollaborationLaunch,
      selectedWorkspace?: string,
      resume?: CollaborationResume,
    ): Promise<void> => {
      const dispatchableAssignments = launch.assignments.filter(
        (assignment) => assignment.runtimeId,
      );
      const explicitDag = hasExplicitTaskCollaborationDependencies(
        dispatchableAssignments,
      );
      const configuredBase = explicitDag
        ? dispatchableAssignments
        : orderTaskCollaborationAssignments(dispatchableAssignments);
      const baseGraph = buildTaskCollaborationGraph(configuredBase);
      const coordinator = configuredBase.find(isCoordinator);
      const coordinatorOwnsAcceptance = configuredBase.some(
        (assignment) =>
          roleIsAcceptance(assignment) &&
          assignment.runtimeId === coordinator?.runtimeId,
      );
      // The lead plans first, then returns only after every assigned role has
      // handed off. This final pass is the sole automatic acceptance decision.
      const finalReview: TaskCollaborationAssignment | undefined =
        coordinator?.runtimeId && !coordinatorOwnsAcceptance
          ? {
              ...coordinator,
              id: `${assignmentKey(coordinator, configuredBase.indexOf(coordinator))}::final-review`,
              role: `${coordinator.role} · 终验汇总`,
              responsibility:
                "基于平台已登记的交付物与验收证据进行终验汇总；不得自行补做其他角色的工作。",
              context: "全部交接、交付物、验收证据",
              ...(explicitDag ? { dependsOn: baseGraph.sinkIds } : {}),
            }
          : undefined;
      const configured = finalReview
        ? [...configuredBase, finalReview]
        : configuredBase;
      const collaborationGraph = buildTaskCollaborationGraph(configured);
      const previousRuns = new Map(
        (resume?.execution.roleRuns ?? []).map((item) => [
          item.assignmentId,
          item,
        ]),
      );
      const roleRuns: TaskCollaborationRoleRun[] = configured.map(
        (assignment, index) => {
          const assignmentId = assignmentKey(assignment, index);
          const previous = previousRuns.get(assignmentId);
          return previous
            ? {
                ...previous,
                role: assignment.role,
                runtimeId: assignment.runtimeId,
              }
            : {
                assignmentId,
                role: assignment.role,
                ...(assignment.runtimeId
                  ? { runtimeId: assignment.runtimeId }
                  : {}),
                status: "pending",
                attempt: 0,
                ...(isFinalReview(assignment)
                  ? { phase: "final_review" as const }
                  : {}),
              };
        },
      );
      const plannedCoordinatorIndex =
        !resume && launch.initialCoordinatorHandoff
          ? configured.findIndex(isCoordinator)
          : -1;
      if (plannedCoordinatorIndex === 0) {
        roleRuns[0] = {
          ...roleRuns[0],
          status: "succeeded",
          attempt: Math.max(1, roleRuns[0].attempt || 0),
          startedAt: Date.now(),
          completedAt: Date.now(),
          handoff: launch.initialCoordinatorHandoff!.slice(0, 6_000),
        };
      }
      const resumeIndex = resume
        ? roleRuns.findIndex(
            (item) => item.assignmentId === resume.assignmentId,
          )
        : plannedCoordinatorIndex === 0
          ? 1
          : 0;
      if (resume && resumeIndex < 0) {
        throw new Error("要继续的协作角色已不存在，请重新配置协作分工。");
      }
      const startIndex = resume?.startAfter ? resumeIndex + 1 : resumeIndex;
      const interventions = [...(resume?.execution.interventions ?? [])];
      let artifacts = [...(resume?.execution.artifacts ?? [])];
      let acceptance = resume?.execution.acceptance;
      const timeline = [...(resume?.execution.timeline ?? [])];
      const retryFeedback = new Map<string, string>();
      const recordTimeline = (
        type: TaskCollaborationTimelineEvent["type"],
        label: string,
        options: Omit<
          TaskCollaborationTimelineEvent,
          "id" | "type" | "label" | "createdAt"
        > = {},
      ): void => {
        timeline.push({
          id: newId(),
          type,
          label,
          createdAt: Date.now(),
          ...options,
        });
        if (timeline.length > 250) timeline.splice(0, timeline.length - 250);
      };
      if (
        !collaborationGraph.explicit &&
        startIndex > 0 &&
        roleRuns
          .slice(0, startIndex)
          .some((item) => item.status !== "succeeded")
      ) {
        throw new Error("前置角色尚未完成，不能跳过交接直接继续此角色。");
      }
      const dagInvalidatedAssignments =
        resume && collaborationGraph.explicit
          ? new Set([
              ...(resume.startAfter ? [] : [resume.assignmentId]),
              ...taskCollaborationDescendants(
                collaborationGraph,
                resume.assignmentId,
              ),
            ])
          : undefined;
      if (
        resume &&
        (dagInvalidatedAssignments || startIndex < roleRuns.length)
      ) {
        const invalidatedAssignments =
          dagInvalidatedAssignments ||
          new Set(roleRuns.slice(startIndex).map((item) => item.assignmentId));
        artifacts = artifacts.filter(
          (artifact) => !invalidatedAssignments.has(artifact.assignmentId),
        );
        if (
          acceptance?.assignmentId &&
          invalidatedAssignments.has(acceptance.assignmentId)
        ) {
          acceptance = undefined;
        }
      }
      if (resume) {
        for (let index = 0; index < roleRuns.length; index += 1) {
          if (
            dagInvalidatedAssignments
              ? !dagInvalidatedAssignments.has(roleRuns[index].assignmentId)
              : index < startIndex
          )
            continue;
          roleRuns[index] = {
            ...roleRuns[index],
            status: "pending",
            error: undefined,
            completedAt: undefined,
            handoff: undefined,
          };
        }
      }
      const persistExecution = async (
        status: TaskCollaborationExecution["status"],
        options: {
          completed?: boolean;
          activeAssignmentId?: string;
          activeAssignmentIds?: string[];
        } = {},
      ): Promise<void> => {
        const nextExecution: TaskCollaborationExecution = {
          status,
          roleRuns,
          brief: brief.slice(0, 12_000),
          ...(interventions.length ? { interventions } : {}),
          ...(artifacts.length ? { artifacts } : {}),
          ...(acceptance ? { acceptance } : {}),
          ...(timeline.length ? { timeline } : {}),
          ...(options.activeAssignmentId
            ? { activeAssignmentId: options.activeAssignmentId }
            : {}),
          ...(options.activeAssignmentIds?.length
            ? { activeAssignmentIds: options.activeAssignmentIds }
            : {}),
          updatedAt: Date.now(),
          ...(options.completed ? { completedAt: Date.now() } : {}),
        };
        setCollaborationExecution(nextExecution);
        if (
          !launch.taskId ||
          typeof window.hermesAPI.updateTaskCollaborationExecution !==
            "function"
        ) {
          return;
        }
        await window.hermesAPI.updateTaskCollaborationExecution(
          {
            taskId: launch.taskId,
            execution: nextExecution,
          },
          profile,
        );
        window.dispatchEvent(
          new Event("agents-one:task-collaboration-changed"),
        );
      };
      const blockRemaining = (from: number, reason: string): void => {
        for (let index = from; index < roleRuns.length; index += 1) {
          if (roleRuns[index].status === "pending") {
            roleRuns[index] = {
              ...roleRuns[index],
              status: "blocked",
              error: reason,
            };
          }
        }
      };

      if (configured.length === 0) {
        throw new Error("协作任务至少需要一个已指定智能体的角色。");
      }
      const collaborationAccessMode =
        accessMode === "auto"
          ? runtime.location === "local" || selectedWorkspace
            ? "safe_write"
            : "analysis"
          : accessMode;
      const permissionPreflightIssues = collaborationPermissionPreflight(
        configuredBase,
        collaborationAccessMode,
        interventions,
      );
      if (permissionPreflightIssues.length) {
        const reason = permissionPreflightIssues
          .map((item) => item.reason)
          .join("\n");
        for (const issue of permissionPreflightIssues) {
          const index = configured.findIndex(
            (assignment) => assignment.id === issue.assignment.id,
          );
          if (index >= 0) {
            roleRuns[index] = {
              ...roleRuns[index],
              status: "waiting_for_user",
              error: issue.reason,
            };
          }
          recordTimeline(
            "preflight",
            `${issue.assignment.role} 权限预检未通过`,
            { assignmentId: issue.assignment.id, detail: issue.reason },
          );
        }
        blockRemaining(0, "实施角色权限不足，等待人工调整协作配置。");
        await persistExecution("waiting_for_user", {
          activeAssignmentId: permissionPreflightIssues[0].assignment.id,
        });
        await appendCollaborationMessage(
          runtime,
          permissionPreflightIssues[0].assignment,
          "system",
          `协作未启动：\n${reason}`,
        );
        return;
      }
      const preflightIssues = collaborationWorkspacePreflight(
        configuredBase,
        runtimeCatalog,
        launch.projectFolder || selectedWorkspace,
      );
      if (preflightIssues.length) {
        const reason = preflightIssues.map((item) => item.reason).join("\n");
        for (const issue of preflightIssues) {
          const index = configured.findIndex(
            (assignment) => assignment.id === issue.assignment.id,
          );
          if (index >= 0)
            roleRuns[index] = {
              ...roleRuns[index],
              status: "waiting_for_user",
              error: issue.reason,
            };
          recordTimeline(
            "preflight",
            `${issue.assignment.role} 工作区预检未通过`,
            { assignmentId: issue.assignment.id, detail: issue.reason },
          );
        }
        blockRemaining(0, "工作区可达性预检未通过，等待人工调整协作配置。");
        await persistExecution("waiting_for_user", {
          activeAssignmentId: preflightIssues[0].assignment.id,
        });
        await appendCollaborationMessage(
          runtime,
          preflightIssues[0].assignment,
          "system",
          `协作未启动：\n${reason}`,
        );
        return;
      }
      const projectFolder = launch.projectFolder || selectedWorkspace;
      const evidenceRecipients = configuredBase.filter((assignment) => {
        const assignedRuntime = assignment.runtimeId
          ? runtimeCatalog[assignment.runtimeId]
          : undefined;
        return (
          assignedRuntime?.location === "remote" &&
          assignment.workspaceAccess === "evidence_bundle"
        );
      });
      let evidenceBundle: Attachment | undefined;
      if (evidenceRecipients.length > 0) {
        try {
          const preparedEvidence = await window.hermesAPI.prepareProjectContext(
            projectFolder!,
          );
          if (!preparedEvidence) throw new Error("未能生成项目只读证据包。");
          evidenceBundle = preparedEvidence;
          recordTimeline("preflight", "已生成只读项目证据包", {
            detail: `${evidenceBundle.name}；仅发送给 ${evidenceRecipients.map((item) => item.role).join("、")}`,
          });
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : "无法生成项目只读证据包。";
          for (const recipient of evidenceRecipients) {
            const roleIndex = configured.findIndex(
              (item) => item.id === recipient.id,
            );
            if (roleIndex >= 0) {
              roleRuns[roleIndex] = {
                ...roleRuns[roleIndex],
                status: "waiting_for_user",
                error: reason,
              };
            }
            recordTimeline("preflight", `${recipient.role} 证据包准备失败`, {
              assignmentId: recipient.id,
              detail: reason,
            });
          }
          blockRemaining(0, "项目只读证据包准备失败，等待人工处理。");
          await persistExecution("waiting_for_user", {
            activeAssignmentId: evidenceRecipients[0]?.id,
          });
          await appendCollaborationMessage(
            runtime,
            evidenceRecipients[0],
            "system",
            `协作未启动：无法安全生成远程角色所需的只读项目证据包。${reason}`,
          );
          return;
        }
      }
      recordTimeline("preflight", "工作区可达性预检通过", {
        detail: configuredBase
          .map(
            (item) =>
              `${item.role}：${workspaceAccessLabel(
                item,
                item.runtimeId ? runtimeCatalog[item.runtimeId] : undefined,
                projectFolder,
              )}`,
          )
          .join("；"),
      });
      await persistExecution("running");

      // Explicit dependency records use topological waves. Every role in a
      // wave starts together; a join is eligible only after all dependencies
      // have succeeded. Legacy records continue through the serial loop below.
      if (collaborationGraph.explicit) {
        let firstProblemId: string | undefined;
        let holdAfterGuidedTurn = false;
        for (const layer of collaborationGraph.layers) {
          if (cancelledRef.current) break;
          const runnableIndexes: number[] = [];
          for (const assignmentId of layer) {
            const roleIndex = roleRuns.findIndex(
              (item) => item.assignmentId === assignmentId,
            );
            if (roleIndex < 0 || roleRuns[roleIndex].status === "succeeded")
              continue;
            const dependencies =
              collaborationGraph.dependenciesById.get(assignmentId) || [];
            const blockedBy = dependencies.find((dependencyId) => {
              const dependency = roleRuns.find(
                (item) => item.assignmentId === dependencyId,
              );
              return dependency?.status !== "succeeded";
            });
            if (blockedBy) {
              roleRuns[roleIndex] = {
                ...roleRuns[roleIndex],
                status: "blocked",
                error: "前置分支未成功，汇合角色未启动。",
              };
            } else {
              runnableIndexes.push(roleIndex);
            }
          }
          if (runnableIndexes.length === 0) continue;

          pauseAssignmentRef.current = null;
          for (const roleIndex of runnableIndexes) {
            const assignment = configured[roleIndex];
            const roleRun = roleRuns[roleIndex];
            const assignedRuntime =
              runtimeCatalog[assignment.runtimeId as string];
            if (!assignedRuntime?.enabled) {
              roleRuns[roleIndex] = {
                ...roleRun,
                status: "waiting_for_user",
                completedAt: Date.now(),
                error: `${assignment.role} 未配置可用智能体。`,
              };
              firstProblemId ??= roleRun.assignmentId;
              continue;
            }
            roleRuns[roleIndex] = {
              ...roleRun,
              status: (roleRun.attempt || 0) > 0 ? "retrying" : "running",
              attempt: (roleRun.attempt || 0) + 1,
              startedAt: Date.now(),
              completedAt: undefined,
              error: undefined,
            };
            recordTimeline("started", `${assignment.role} 已并行启动`, {
              assignmentId: roleRun.assignmentId,
              detail: `${assignedRuntime.name} · ${workspaceAccessLabel(
                assignment,
                assignedRuntime,
                projectFolder,
              )}`,
            });
          }
          const activeIds = runnableIndexes
            .map((roleIndex) => roleRuns[roleIndex])
            .filter(
              (item) => item.status === "running" || item.status === "retrying",
            )
            .map((item) => item.assignmentId);
          await persistExecution("running", { activeAssignmentIds: activeIds });

          await Promise.all(
            runnableIndexes.map(async (roleIndex) => {
              const assignment = configured[roleIndex];
              const roleRun = roleRuns[roleIndex];
              const assignedRuntime =
                runtimeCatalog[assignment.runtimeId as string];
              if (
                !assignedRuntime?.enabled ||
                roleRun.status === "waiting_for_user"
              )
                return;
              const roleMode = roleAccessMode(
                assignment,
                roleRun.assignmentId,
                collaborationAccessMode,
                interventions,
              );
              try {
                const started = await window.hermesAPI.startAgentRuntimeTask(
                  assignedRuntime.id,
                  {
                    prompt: collaborationRolePrompt(
                      brief,
                      configured,
                      runtimeCatalog,
                      assignment,
                      roleIndex,
                      projectFolder,
                      roleRuns.filter((item) =>
                        (
                          collaborationGraph.dependenciesById.get(
                            roleRun.assignmentId,
                          ) || []
                        ).includes(item.assignmentId),
                      ),
                      interventions,
                      artifacts,
                    ),
                    mode: roleMode,
                    fullAccessConfirmed: roleMode === "full_access",
                    workspace:
                      assignedRuntime.location === "local"
                        ? selectedWorkspace || launch.projectFolder
                        : assignment.workspaceAccess === "remote_mapping"
                          ? assignment.workspaceRef
                          : undefined,
                    workspaceRef:
                      assignedRuntime.location === "remote" &&
                      assignment.workspaceAccess === "remote_mapping"
                        ? assignment.workspaceRef
                        : undefined,
                    attachments:
                      !isFinalReview(assignment) &&
                      assignedRuntime.location === "remote" &&
                      assignment.workspaceAccess === "evidence_bundle" &&
                      evidenceBundle
                        ? [evidenceBundle]
                        : undefined,
                  },
                );
                roleRuns[roleIndex] = {
                  ...roleRuns[roleIndex],
                  runtimeRunId: started.id,
                };
                setCurrentRunId(started.id);
                setActiveCollaborationRuntimeId(assignedRuntime.id);
                updateActiveCollaborationRun(roleRun.assignmentId, {
                  assignmentId: roleRun.assignmentId,
                  role: assignment.role,
                  runtimeId: assignedRuntime.id,
                  run: started,
                });
                let observed: AgentRuntimeRun | null = started;
                while (!cancelledRef.current) {
                  const current = await window.hermesAPI.getAgentRuntimeRun(
                    started.id,
                  );
                  if (current) {
                    observed = mergeRuntimeRunObservation(observed, current);
                    updateActiveCollaborationRun(roleRun.assignmentId, {
                      assignmentId: roleRun.assignmentId,
                      role: assignment.role,
                      runtimeId: assignedRuntime.id,
                      run: observed,
                    });
                    if (current.sessionId) {
                      roleRuns[roleIndex] = {
                        ...roleRuns[roleIndex],
                        runtimeSessionId: current.sessionId,
                      };
                    }
                  }
                  if (observed.status !== "running") break;
                  await new Promise((resolve) => setTimeout(resolve, 900));
                }
                if (pauseAssignmentRef.current === roleRun.assignmentId) {
                  roleRuns[roleIndex] = {
                    ...roleRuns[roleIndex],
                    status: "paused",
                    completedAt: Date.now(),
                    error: "用户已暂停此角色，等待人工处理。",
                  };
                  firstProblemId ??= roleRun.assignmentId;
                  return;
                }
                if (!observed || observed.status !== "succeeded") {
                  const reason = observed
                    ? responseText(observed)
                    : "协作任务已取消。";
                  const guidedTurn = resume?.interventionId
                    ? interventions.find(
                        (item) => item.id === resume.interventionId,
                      )
                    : undefined;
                  if (guidedTurn) {
                    guidedTurn.response = reason.slice(0, 6_000);
                    guidedTurn.respondedAt = Date.now();
                  }
                  roleRuns[roleIndex] = {
                    ...roleRuns[roleIndex],
                    status: "waiting_for_user",
                    completedAt: Date.now(),
                    error: (reason || `${assignment.role} 未完成。`).slice(
                      0,
                      1_000,
                    ),
                  };
                  firstProblemId ??= roleRun.assignmentId;
                  if (observed)
                    await appendCollaborationMessage(
                      assignedRuntime,
                      assignment,
                      "system",
                      `${assignment.role} 未完成，正在等待人工处理：${reason}`,
                      executionFromRun(observed),
                    );
                  return;
                }
                const output = responseText(observed);
                const producedArtifacts = collectRuntimeArtifacts(
                  assignment,
                  roleRun.assignmentId,
                  observed,
                  assignedRuntime,
                );
                artifacts = appendArtifacts(artifacts, producedArtifacts);
                for (const artifact of producedArtifacts) {
                  recordTimeline(
                    "artifact",
                    `${assignment.role} 发布交付证据`,
                    {
                      assignmentId: roleRun.assignmentId,
                      artifactId: artifact.id,
                      detail: artifact.label,
                    },
                  );
                }
                if (
                  roleCanModify(assignment) &&
                  !hasConcreteDelivery(producedArtifacts, roleRun.assignmentId)
                ) {
                  const reason = `${assignment.role} 未发布可核验的文件或代码变更。`;
                  roleRuns[roleIndex] = {
                    ...roleRuns[roleIndex],
                    status: "waiting_for_user",
                    completedAt: Date.now(),
                    error: reason,
                  };
                  firstProblemId ??= roleRun.assignmentId;
                  await appendCollaborationMessage(
                    assignedRuntime,
                    assignment,
                    "system",
                    reason,
                    executionFromRun(observed),
                  );
                  return;
                }
                roleRuns[roleIndex] = {
                  ...roleRuns[roleIndex],
                  status: "succeeded",
                  completedAt: Date.now(),
                  handoff: output.slice(0, 6_000),
                };
                const guidedTurn = resume?.interventionId
                  ? interventions.find(
                      (item) => item.id === resume.interventionId,
                    )
                  : undefined;
                if (guidedTurn) {
                  guidedTurn.response = output.slice(0, 6_000);
                  guidedTurn.respondedAt = Date.now();
                }
                if (resume?.holdAfterAssignmentId === roleRun.assignmentId) {
                  holdAfterGuidedTurn = true;
                  recordTimeline(
                    "recovery",
                    `${assignment.role} 已回复人工介入`,
                    {
                      assignmentId: roleRun.assignmentId,
                      detail: output.slice(0, 500),
                    },
                  );
                }
                if (roleIsAcceptance(assignment)) {
                  acceptance = acceptanceFromOutput(
                    roleRun.assignmentId,
                    output,
                    artifacts,
                  );
                  recordTimeline(
                    "acceptance",
                    acceptance.status === "passed" ? "终验通过" : "终验未通过",
                    {
                      assignmentId: roleRun.assignmentId,
                      detail: acceptance.conclusion.slice(0, 500),
                    },
                  );
                }
                await appendCollaborationMessage(
                  assignedRuntime,
                  assignment,
                  "agent",
                  output,
                  executionFromRun(observed),
                );
                recordTimeline("handoff", `${assignment.role} 已交接`, {
                  assignmentId: roleRun.assignmentId,
                  detail: output.slice(0, 500),
                });
              } catch (error) {
                const reason =
                  error instanceof Error ? error.message : "任务请求失败。";
                roleRuns[roleIndex] = {
                  ...roleRuns[roleIndex],
                  status: "waiting_for_user",
                  completedAt: Date.now(),
                  error: reason.slice(0, 1_000),
                };
                firstProblemId ??= roleRun.assignmentId;
                await appendCollaborationMessage(
                  assignedRuntime,
                  assignment,
                  "system",
                  `${assignment.role} 无法启动，正在等待人工处理：${reason}`,
                );
              } finally {
                updateActiveCollaborationRun(roleRun.assignmentId);
              }
            }),
          );

          for (const roleIndex of runnableIndexes) {
            const failed = roleRuns[roleIndex];
            if (failed.status === "succeeded") continue;
            for (const descendantId of taskCollaborationDescendants(
              collaborationGraph,
              failed.assignmentId,
            )) {
              const descendantIndex = roleRuns.findIndex(
                (item) => item.assignmentId === descendantId,
              );
              if (
                descendantIndex >= 0 &&
                roleRuns[descendantIndex].status === "pending"
              ) {
                roleRuns[descendantIndex] = {
                  ...roleRuns[descendantIndex],
                  status: "blocked",
                  error: `${failed.role} 未成功，依赖分支未启动。`,
                };
              }
            }
          }
          await persistExecution(
            firstProblemId ? "waiting_for_user" : "running",
            {
              ...(firstProblemId ? { activeAssignmentId: firstProblemId } : {}),
            },
          );
          if (holdAfterGuidedTurn) {
            await persistExecution("paused", {
              activeAssignmentId: resume?.holdAfterAssignmentId,
            });
            return;
          }
        }

        setCurrentRunId(null);
        setActiveCollaborationRuntimeId(null);
        activeCollaborationRunsRef.current = {};
        setActiveCollaborationRuns({});
        if (cancelledRef.current) {
          await persistExecution("cancelled", { completed: true });
          return;
        }
        if (firstProblemId) {
          await persistExecution("waiting_for_user", {
            activeAssignmentId: firstProblemId,
          });
          return;
        }
        if (!acceptance) {
          acceptance = {
            status: "needs_review",
            conclusion: "未指定验收角色，平台未自动判定交付是否满足要求。",
            reviewedArtifactIds: [],
            createdAt: Date.now(),
          };
        }
        await persistExecution(
          acceptance.status === "passed"
            ? "succeeded"
            : acceptance.status === "failed"
              ? "failed"
              : "needs_review",
          { completed: true },
        );
        return;
      }

      let index = startIndex;
      while (index < configured.length) {
        if (cancelledRef.current) {
          roleRuns[index] = {
            ...roleRuns[index],
            status: "cancelled",
            completedAt: Date.now(),
            error: "协作任务已取消。",
          };
          blockRemaining(index + 1, "协作任务已取消。");
          await persistExecution("cancelled", { completed: true });
          return;
        }
        const assignment = configured[index];
        const assignedRuntime = runtimeCatalog[assignment.runtimeId as string];
        const roleRun = roleRuns[index];
        if (!assignedRuntime || !assignedRuntime.enabled) {
          const reason = `${assignment.role} 未配置可用智能体，后续角色未启动。`;
          roleRuns[index] = {
            ...roleRun,
            status: "waiting_for_user",
            completedAt: Date.now(),
            error: reason,
          };
          blockRemaining(index + 1, reason);
          await persistExecution("waiting_for_user", {
            activeAssignmentId: roleRun.assignmentId,
          });
          const fallbackRuntime = assignedRuntime || runtime;
          await appendCollaborationMessage(
            fallbackRuntime,
            assignment,
            "system",
            reason,
          );
          return;
        }

        pauseAssignmentRef.current = null;
        setActiveCollaborationRuntimeId(assignedRuntime.id);
        const attempt = (roleRun.attempt || 0) + 1;
        roleRuns[index] = {
          ...roleRun,
          status:
            attempt > 1 || (resume && index === startIndex)
              ? "retrying"
              : "running",
          attempt,
          startedAt: Date.now(),
          completedAt: undefined,
          error: undefined,
        };
        recordTimeline("started", `${assignment.role} 已启动`, {
          assignmentId: roleRun.assignmentId,
          detail: `${assignedRuntime.name} · ${workspaceAccessLabel(
            assignment,
            assignedRuntime,
            projectFolder,
          )}`,
        });
        await persistExecution("running", {
          activeAssignmentId: roleRun.assignmentId,
        });
        const roleMode = roleAccessMode(
          assignment,
          roleRun.assignmentId,
          collaborationAccessMode,
          interventions,
        );
        try {
          const started = await window.hermesAPI.startAgentRuntimeTask(
            assignedRuntime.id,
            {
              prompt: collaborationRolePrompt(
                brief,
                configured,
                runtimeCatalog,
                assignment,
                index,
                launch.projectFolder || selectedWorkspace,
                roleRuns.slice(0, index),
                interventions,
                artifacts,
                retryFeedback.get(roleRun.assignmentId),
              ),
              mode: roleMode,
              fullAccessConfirmed: roleMode === "full_access",
              workspace:
                assignedRuntime.location === "local"
                  ? selectedWorkspace || launch.projectFolder
                  : assignment.workspaceAccess === "remote_mapping"
                    ? assignment.workspaceRef
                    : undefined,
              workspaceRef:
                assignedRuntime.location === "remote" &&
                assignment.workspaceAccess === "remote_mapping"
                  ? assignment.workspaceRef
                  : undefined,
              attachments:
                !isFinalReview(assignment) &&
                assignedRuntime.location === "remote" &&
                assignment.workspaceAccess === "evidence_bundle" &&
                evidenceBundle
                  ? [evidenceBundle]
                  : undefined,
              ...(roleRun.runtimeSessionId
                ? { sessionId: roleRun.runtimeSessionId }
                : {}),
            },
          );
          roleRuns[index] = { ...roleRuns[index], runtimeRunId: started.id };
          setCurrentRunId(started.id);
          taskRunRef.current = started;
          setTaskRun(started);

          let completed: AgentRuntimeRun | null = null;
          while (!cancelledRef.current) {
            const current = await window.hermesAPI.getAgentRuntimeRun(
              started.id,
            );
            if (current) {
              completed = mergeRuntimeRunObservation(
                taskRunRef.current?.id === started.id
                  ? taskRunRef.current
                  : null,
                current,
              );
              taskRunRef.current = completed;
              setTaskRun(completed);
              if (
                current.sessionId &&
                roleRuns[index].runtimeSessionId !== current.sessionId
              ) {
                roleRuns[index] = {
                  ...roleRuns[index],
                  runtimeSessionId: current.sessionId,
                };
              }
            }
            if (completed?.status && completed.status !== "running") break;
            await new Promise((resolve) => setTimeout(resolve, 900));
          }
          if (pauseAssignmentRef.current === roleRun.assignmentId) {
            roleRuns[index] = {
              ...roleRuns[index],
              status: "paused",
              completedAt: Date.now(),
              error: "用户已暂停此角色，等待人工处理。",
            };
            await persistExecution("paused", {
              activeAssignmentId: roleRun.assignmentId,
            });
            return;
          }
          if (!completed || cancelledRef.current) {
            const reason = "协作任务在当前角色完成前被取消。";
            roleRuns[index] = {
              ...roleRuns[index],
              status: "failed",
              completedAt: Date.now(),
              error: reason,
            };
            blockRemaining(index + 1, reason);
            await persistExecution("cancelled", { completed: true });
            return;
          }
          const output = responseText(completed);
          const runExecution = executionFromRun(completed);
          if (completed.status !== "succeeded") {
            const reason =
              output ||
              `${assignedRuntime.name} 未完成“${assignment.role}”角色。`;
            const guidedTurn = resume?.interventionId
              ? interventions.find((item) => item.id === resume.interventionId)
              : undefined;
            if (guidedTurn) {
              guidedTurn.response = reason.slice(0, 6_000);
              guidedTurn.respondedAt = Date.now();
            }
            roleRuns[index] = {
              ...roleRuns[index],
              status: "waiting_for_user",
              completedAt: Date.now(),
              error: reason.slice(0, 1_000),
            };
            blockRemaining(
              index + 1,
              `${assignment.role} 失败，等待人工处理。`,
            );
            await appendCollaborationMessage(
              assignedRuntime,
              assignment,
              "system",
              `${assignment.role} 未完成，正在等待人工处理：${reason}`,
              runExecution,
            );
            await persistExecution("waiting_for_user", {
              activeAssignmentId: roleRun.assignmentId,
            });
            return;
          }

          const producedArtifacts = collectRuntimeArtifacts(
            assignment,
            roleRun.assignmentId,
            completed,
            assignedRuntime,
          );
          artifacts = appendArtifacts(artifacts, producedArtifacts);
          for (const artifact of producedArtifacts) {
            recordTimeline(
              "artifact",
              `${assignment.role} 发布${artifact.kind === "test_result" ? "验证证据" : "交付证据"}`,
              {
                assignmentId: roleRun.assignmentId,
                artifactId: artifact.id,
                detail: artifact.label,
              },
            );
          }
          if (
            roleCanModify(assignment) &&
            !hasConcreteDelivery(producedArtifacts, roleRun.assignmentId)
          ) {
            const reason = `${assignment.role} 未发布可核验的文件或代码变更，后续角色不会启动。请通过“介入”补充交付要求，必要时将本角色权限改为“完全访问”后重试。`;
            roleRuns[index] = {
              ...roleRuns[index],
              status: "waiting_for_user",
              completedAt: Date.now(),
              error: reason,
            };
            blockRemaining(
              index + 1,
              `${assignment.role} 未交付真实产物，等待人工处理。`,
            );
            await appendCollaborationMessage(
              assignedRuntime,
              assignment,
              "system",
              reason,
              runExecution,
            );
            recordTimeline("blocked", `${assignment.role} 未发布完整交付物`, {
              assignmentId: roleRun.assignmentId,
              detail: reason,
            });
            await persistExecution("waiting_for_user", {
              activeAssignmentId: roleRun.assignmentId,
            });
            return;
          }
          if (
            roleCanModify(assignment) &&
            !hasDeliveryContract(producedArtifacts, roleRun.assignmentId)
          ) {
            recordTimeline(
              "artifact",
              `${assignment.role} 的交付物信息待补充`,
              {
                assignmentId: roleRun.assignmentId,
                detail:
                  "缺少路径、SHA-256、来源机器或变更摘要；验收会将此标记为低可信证据。",
              },
            );
          }

          roleRuns[index] = {
            ...roleRuns[index],
            status: "succeeded",
            completedAt: Date.now(),
            handoff: output.slice(0, 6_000),
          };
          const guidedTurn = resume?.interventionId
            ? interventions.find((item) => item.id === resume.interventionId)
            : undefined;
          if (guidedTurn) {
            guidedTurn.response = output.slice(0, 6_000);
            guidedTurn.respondedAt = Date.now();
          }
          if (roleIsAcceptance(assignment)) {
            acceptance = acceptanceFromOutput(
              roleRun.assignmentId,
              output,
              artifacts,
            );
            recordTimeline(
              "acceptance",
              acceptance.status === "passed"
                ? "终验通过"
                : acceptance.status === "failed"
                  ? "终验不通过"
                  : "终验需要人工复核",
              {
                assignmentId: roleRun.assignmentId,
                detail: acceptance.conclusion.slice(0, 500),
              },
            );
          }
          await appendCollaborationMessage(
            assignedRuntime,
            assignment,
            "agent",
            output,
            runExecution,
          );
          recordTimeline("handoff", `${assignment.role} 已交接`, {
            assignmentId: roleRun.assignmentId,
            detail: output.slice(0, 500),
          });
          if (resume?.holdAfterAssignmentId === roleRun.assignmentId) {
            blockRemaining(
              index + 1,
              `${assignment.role} 已完成定向沟通，等待用户确认后继续。`,
            );
            recordTimeline("recovery", `${assignment.role} 已回复人工介入`, {
              assignmentId: roleRun.assignmentId,
              detail: output.slice(0, 500),
            });
            await persistExecution("paused", {
              activeAssignmentId: roleRun.assignmentId,
            });
            return;
          }
          if (acceptance?.status === "failed") {
            let implementationIndex = index - 1;
            while (
              implementationIndex >= 0 &&
              !roleCanModify(configured[implementationIndex])
            ) {
              implementationIndex -= 1;
            }
            const implementationRun = roleRuns[implementationIndex];
            if (
              implementationIndex >= 0 &&
              (implementationRun.attempt || 0) < 3
            ) {
              const implementationId = implementationRun.assignmentId;
              retryFeedback.set(implementationId, acceptance.conclusion);
              artifacts = artifacts.filter((artifact) => {
                const ownerIndex = roleRuns.findIndex(
                  (item) => item.assignmentId === artifact.assignmentId,
                );
                return ownerIndex < implementationIndex || ownerIndex > index;
              });
              for (
                let retryIndex = implementationIndex;
                retryIndex <= index;
                retryIndex += 1
              ) {
                roleRuns[retryIndex] = {
                  ...roleRuns[retryIndex],
                  status:
                    retryIndex === implementationIndex ? "retrying" : "pending",
                  completedAt: undefined,
                  error: undefined,
                  handoff: undefined,
                };
              }
              recordTimeline(
                "recovery",
                `${assignment.role} 未通过，已自动回派 ${configured[implementationIndex].role}`,
                {
                  assignmentId: implementationId,
                  detail: acceptance.conclusion.slice(0, 500),
                },
              );
              acceptance = undefined;
              await persistExecution("running", {
                activeAssignmentId: implementationId,
              });
              index = implementationIndex;
              continue;
            }
            roleRuns[index] = {
              ...roleRuns[index],
              status: "waiting_for_user",
              error: "自动修正已达到上限，等待人工介入。",
            };
            await persistExecution("waiting_for_user", {
              activeAssignmentId: implementationRun?.assignmentId,
            });
            return;
          }
          await persistExecution("running");
          index += 1;
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : "任务请求失败。";
          roleRuns[index] = {
            ...roleRuns[index],
            status: "waiting_for_user",
            completedAt: Date.now(),
            error: reason.slice(0, 1_000),
          };
          blockRemaining(
            index + 1,
            `${assignment.role} 无法启动，等待人工处理。`,
          );
          await appendCollaborationMessage(
            assignedRuntime,
            assignment,
            "system",
            `${assignment.role} 无法启动，正在等待人工处理：${reason}`,
          );
          await persistExecution("waiting_for_user", {
            activeAssignmentId: roleRun.assignmentId,
          });
          return;
        }
      }
      setCurrentRunId(null);
      setActiveCollaborationRuntimeId(null);
      if (!acceptance) {
        acceptance = {
          status: "needs_review",
          conclusion: "未指定验收角色，平台未自动判定交付是否满足要求。",
          reviewedArtifactIds: [],
          createdAt: Date.now(),
        };
      }
      await persistExecution(
        acceptance.status === "passed"
          ? "succeeded"
          : acceptance.status === "failed"
            ? "failed"
            : "needs_review",
        { completed: true },
      );
    },
    [
      accessMode,
      appendCollaborationMessage,
      profile,
      runtime,
      runtimeCatalog,
      updateActiveCollaborationRun,
    ],
  );

  const persistIntervention = useCallback(
    async (runTarget: boolean, holdAfterReply = false): Promise<void> => {
      if (!interventionTarget || !collaboration?.taskId) return;
      const content = interventionText.trim();
      if (!content) return;
      const existing = collaborationExecution;
      const brief =
        existing?.brief ||
        messagesRef.current.find((item) => item.role === "user")?.content;
      if (!brief) return;
      const now = Date.now();
      const intervention: TaskCollaborationIntervention = {
        id: newId(),
        assignmentId: interventionTarget.assignmentId,
        content,
        visibility: interventionShared ? "shared" : "role",
        ...(interventionAccessMode === "inherit"
          ? {}
          : { accessMode: interventionAccessMode }),
        createdAt: now,
      };
      const configured = collaborationAssignments.filter(
        (assignment) => assignment.runtimeId,
      );
      const roleRuns = configured.map((assignment, index) => {
        const assignmentId = assignmentKey(assignment, index);
        const previous = existing?.roleRuns.find(
          (item) => item.assignmentId === assignmentId,
        );
        if (assignmentId !== interventionTarget.assignmentId)
          return (
            previous || {
              assignmentId,
              role: assignment.role,
              runtimeId: assignment.runtimeId,
              status: "pending" as const,
            }
          );
        return {
          ...(previous || {
            assignmentId,
            role: assignment.role,
            runtimeId: assignment.runtimeId,
            status: "pending" as const,
          }),
          status: runTarget
            ? ("retrying" as const)
            : ("waiting_for_user" as const),
          error: undefined,
        };
      });
      const nextExecution: TaskCollaborationExecution = {
        ...(existing || {}),
        status: runTarget ? "running" : "waiting_for_user",
        roleRuns,
        brief: brief.slice(0, 12_000),
        interventions: [...(existing?.interventions || []), intervention].slice(
          -100,
        ),
        activeAssignmentId: interventionTarget.assignmentId,
        updatedAt: now,
      };
      setCollaborationExecution(nextExecution);
      await window.hermesAPI.updateTaskCollaborationExecution(
        { taskId: collaboration.taskId, execution: nextExecution },
        profile,
      );
      const targetRuntime = interventionTarget.assignment.runtimeId
        ? runtimeCatalog[interventionTarget.assignment.runtimeId]
        : undefined;
      const directedMessage = newMessage(
        "user",
        `@${targetRuntime?.name || interventionTarget.assignment.role}${
          interventionShared ? "（共享给协作组）" : "（仅此角色）"
        }\n${content}`,
      );
      directedMessage.collaborationRole = interventionTarget.assignment.role;
      directedMessage.collaborationAssignmentId =
        interventionTarget.assignmentId;
      const nextMessages = [...messagesRef.current, directedMessage];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      await persistConversation(nextMessages);
      setInterventionText("");
      setInterventionAccessMode("inherit");
      if (!runTarget) return;
      setLoading(true);
      cancelledRef.current = false;
      try {
        await runCollaboration(
          brief,
          {
            taskId: collaboration.taskId,
            assignments: collaborationAssignments,
            projectFolder: collaboration.projectFolder,
          },
          workspace || undefined,
          {
            assignmentId: interventionTarget.assignmentId,
            execution: nextExecution,
            ...(holdAfterReply
              ? { holdAfterAssignmentId: interventionTarget.assignmentId }
              : {}),
            interventionId: intervention.id,
          },
        );
      } finally {
        setLoading(false);
        setCurrentRunId(null);
        if (!holdAfterReply) setInterventionTarget(null);
      }
    },
    [
      collaboration,
      collaborationAssignments,
      collaborationExecution,
      interventionShared,
      interventionAccessMode,
      interventionTarget,
      interventionText,
      persistConversation,
      profile,
      runCollaboration,
      runtimeCatalog,
      workspace,
    ],
  );

  const pauseCollaborationRole = useCallback(
    async (assignmentId: string): Promise<void> => {
      const roleRun = collaborationExecution?.roleRuns.find(
        (item) => item.assignmentId === assignmentId,
      );
      if (
        !roleRun ||
        !["running", "retrying"].includes(roleRun.status) ||
        !roleRun.runtimeRunId
      )
        return;
      pauseAssignmentRef.current = assignmentId;
      await window.hermesAPI.cancelAgentRuntimeTask(roleRun.runtimeRunId);
    },
    [collaborationExecution],
  );

  const openRoleDialogue = useCallback(
    (assignment: TaskCollaborationAssignment, assignmentId: string): void => {
      setInterventionTarget({ assignment, assignmentId });
      setInterventionText("");
      setInterventionShared(true);
      setInterventionAccessMode("inherit");
      setInterventionRuntimeId(assignment.runtimeId || "");
      const roleRun = collaborationExecution?.roleRuns.find((item) =>
        ["running", "retrying"].includes(item.status),
      );
      if (roleRun) {
        void pauseCollaborationRole(roleRun.assignmentId);
      }
    },
    [collaborationExecution, pauseCollaborationRole],
  );

  const continueAfterIntervention = useCallback(async (): Promise<void> => {
    if (
      !interventionTarget ||
      !collaboration?.taskId ||
      !collaborationExecution?.brief
    ) {
      return;
    }
    const targetRun = collaborationExecution.roleRuns.find(
      (item) => item.assignmentId === interventionTarget.assignmentId,
    );
    if (targetRun?.status !== "succeeded") return;
    setLoading(true);
    cancelledRef.current = false;
    try {
      await runCollaboration(
        collaborationExecution.brief,
        {
          taskId: collaboration.taskId,
          assignments: collaborationAssignments,
          projectFolder: collaboration.projectFolder,
        },
        workspace || undefined,
        {
          assignmentId: interventionTarget.assignmentId,
          execution: collaborationExecution,
          startAfter: true,
        },
      );
    } finally {
      setLoading(false);
      setCurrentRunId(null);
      setInterventionTarget(null);
    }
  }, [
    collaboration,
    collaborationAssignments,
    collaborationExecution,
    interventionTarget,
    runCollaboration,
    workspace,
  ]);

  const reassignInterventionRole = useCallback(async (): Promise<void> => {
    if (
      !interventionTarget ||
      !interventionRuntimeId ||
      !collaboration?.taskId ||
      !collaborationExecution ||
      interventionRuntimeId === interventionTarget.assignment.runtimeId
    ) {
      return;
    }
    const assignmentIndex = collaborationAssignments.findIndex(
      (assignment, index) =>
        assignmentKey(assignment, index) === interventionTarget.assignmentId,
    );
    if (assignmentIndex < 0) return;
    const now = Date.now();
    const nextAssignment = {
      ...collaborationAssignments[assignmentIndex],
      runtimeId: interventionRuntimeId,
    };
    const nextAssignments = collaborationAssignments.map((assignment, index) =>
      index === assignmentIndex ? nextAssignment : assignment,
    );
    const roleIndex = collaborationExecution.roleRuns.findIndex(
      (item) => item.assignmentId === interventionTarget.assignmentId,
    );
    if (roleIndex < 0) return;
    const invalidatedIds = new Set(
      collaborationExecution.roleRuns
        .slice(roleIndex)
        .map((item) => item.assignmentId),
    );
    const nextRoleRuns = collaborationExecution.roleRuns.map((item, index) => {
      if (index < roleIndex) return item;
      if (index === roleIndex) {
        return {
          ...item,
          runtimeId: interventionRuntimeId,
          status: "waiting_for_user" as const,
          runtimeRunId: undefined,
          runtimeSessionId: undefined,
          completedAt: undefined,
          handoff: undefined,
          error: undefined,
        };
      }
      return {
        ...item,
        status: "blocked" as const,
        completedAt: undefined,
        handoff: undefined,
        error: `${nextAssignment.role} 已改派，等待其重新完成后继续。`,
      };
    });
    const nextExecution: TaskCollaborationExecution = {
      ...collaborationExecution,
      status: "waiting_for_user",
      roleRuns: nextRoleRuns,
      artifacts: (collaborationExecution.artifacts || []).filter(
        (artifact) => !invalidatedIds.has(artifact.assignmentId),
      ),
      acceptance: undefined,
      activeAssignmentId: interventionTarget.assignmentId,
      timeline: [
        ...(collaborationExecution.timeline || []),
        {
          id: newId(),
          type: "recovery" as const,
          label: `${nextAssignment.role} 已改派`,
          assignmentId: interventionTarget.assignmentId,
          detail: `改派至 ${runtimeCatalog[interventionRuntimeId]?.name || interventionRuntimeId}，等待用户发送新的定向指令。`,
          createdAt: now,
        },
      ].slice(-250),
      updatedAt: now,
    };
    await window.hermesAPI.saveTaskCollaboration(
      {
        taskId: collaboration.taskId,
        title:
          messagesRef.current
            .find((item) => item.role === "user")
            ?.content.slice(0, 80) || "协作任务",
        projectFolder: collaboration.projectFolder,
        sourceRuntimeId: runtime.id,
        assignments: nextAssignments,
        status: "active",
      },
      profile,
    );
    await window.hermesAPI.updateTaskCollaborationExecution(
      { taskId: collaboration.taskId, execution: nextExecution },
      profile,
    );
    setCollaborationAssignments(nextAssignments);
    setCollaborationExecution(nextExecution);
    setInterventionTarget({
      assignment: nextAssignment,
      assignmentId: interventionTarget.assignmentId,
    });
    setInterventionAccessMode("inherit");
    window.dispatchEvent(new Event("agents-one:task-collaboration-changed"));
  }, [
    collaboration,
    collaborationAssignments,
    collaborationExecution,
    interventionRuntimeId,
    interventionTarget,
    profile,
    runtime.id,
    runtimeCatalog,
  ]);

  const reassignAcceptance = useCallback(
    async (runtimeId: string): Promise<void> => {
      if (!collaboration?.taskId || !collaborationExecution?.brief) return;
      const acceptanceIndex =
        collaborationAssignments.findIndex(roleIsAcceptance);
      if (acceptanceIndex < 0) {
        // Legacy collaborations without a distinct acceptance row still need
        // an explicit user choice instead of silently repurposing the lead.
        onRequestCollaboration?.();
        return;
      }
      const target = collaborationAssignments[acceptanceIndex];
      const targetId = assignmentKey(target, acceptanceIndex);
      const nextAssignments = collaborationAssignments.map(
        (assignment, index) =>
          index === acceptanceIndex ? { ...assignment, runtimeId } : assignment,
      );
      const timeline: TaskCollaborationTimelineEvent[] = [
        ...(collaborationExecution.timeline || []),
        {
          id: newId(),
          type: "recovery" as const,
          label: `${target.role} 已改派`,
          assignmentId: targetId,
          detail: `改派至 ${runtimeCatalog[runtimeId]?.name || runtimeId}，将从验收阶段继续。`,
          createdAt: Date.now(),
        },
      ].slice(-250);
      const nextExecution: TaskCollaborationExecution = {
        ...collaborationExecution,
        status: "running",
        acceptance: undefined,
        timeline,
        activeAssignmentId: targetId,
        updatedAt: Date.now(),
      };
      try {
        await window.hermesAPI.saveTaskCollaboration(
          {
            taskId: collaboration.taskId,
            title:
              messagesRef.current
                .find((item) => item.role === "user")
                ?.content.slice(0, 80) || "协作任务",
            projectFolder: collaboration.projectFolder,
            sourceRuntimeId: runtime.id,
            assignments: nextAssignments,
            status: "active",
          },
          profile,
        );
        setCollaborationAssignments(nextAssignments);
        setCollaborationExecution(nextExecution);
        window.dispatchEvent(
          new Event("agents-one:task-collaboration-changed"),
        );
        setLoading(true);
        cancelledRef.current = false;
        await runCollaboration(
          collaborationExecution.brief,
          {
            taskId: collaboration.taskId,
            assignments: nextAssignments,
            projectFolder: collaboration.projectFolder,
          },
          workspace || undefined,
          { assignmentId: targetId, execution: nextExecution },
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "改派验收失败。";
        await appendCollaborationMessage(
          runtimeCatalog[runtimeId] || runtime,
          target,
          "system",
          `改派验收失败，原协作记录未被覆盖：${reason}`,
        );
      } finally {
        setLoading(false);
        setCurrentRunId(null);
      }
    },
    [
      appendCollaborationMessage,
      collaboration,
      collaborationAssignments,
      collaborationExecution,
      onRequestCollaboration,
      profile,
      runCollaboration,
      runtime,
      runtimeCatalog,
      workspace,
    ],
  );

  useEffect(() => {
    if (
      !collaboration?.taskId ||
      typeof window.hermesAPI.getTaskCollaboration !== "function"
    )
      return;
    let disposed = false;
    const loadExecution = (): void => {
      void window.hermesAPI
        .getTaskCollaboration(collaboration.taskId as string, profile)
        .then((record) => {
          if (!disposed && record?.execution)
            setCollaborationExecution(record.execution);
        })
        .catch(() => {
          // The current transcript remains usable if optional collaboration
          // metadata cannot be read. Do not replace it with an empty record.
        });
    };
    loadExecution();
    window.addEventListener(
      "agents-one:task-collaboration-changed",
      loadExecution,
    );
    return () => {
      disposed = true;
      window.removeEventListener(
        "agents-one:task-collaboration-changed",
        loadExecution,
      );
    };
  }, [collaboration?.taskId, profile]);

  async function send(
    text: string,
    attachments: Attachment[] = [],
    collaborationLaunch?: CollaborationLaunch,
  ): Promise<void> {
    const prompt = text.trim();
    if (!prompt || loading) return;
    const selectedWorkspace = workspace || undefined;
    const resolvedAccessMode =
      accessMode === "auto"
        ? runtime.location === "local" || selectedWorkspace
          ? "safe_write"
          : "analysis"
        : accessMode;
    cancelledRef.current = false;
    const nextMessages = [...messages, newMessage("user", prompt)];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setTaskRun(null);
    setActiveCollaborationRuntimeId(null);
    taskRunRef.current = null;
    onTitleChange?.(runId, prompt.slice(0, 48));
    void persistConversation(nextMessages);
    setLoading(true);
    try {
      if (
        resolvedAccessMode === "full_access" &&
        !selectedWorkspace &&
        !collaborationLaunch &&
        runtime.location === "local"
      ) {
        const failedMessages = [
          ...nextMessages,
          newMessage("system", "完全访问需要先选择一个项目目录。"),
        ];
        setMessages(failedMessages);
        void persistConversation(failedMessages);
        setLoading(false);
        return;
      }
      if (collaborationLaunch) {
        await runCollaboration(prompt, collaborationLaunch, selectedWorkspace);
        setLoading(false);
        return;
      }
      const collaborationCandidates = [
        ...new Map(
          [runtime, ...Object.values(runtimeCatalog)].map((candidate) => [
            candidate.id,
            candidate,
          ]),
        ).values(),
      ]
        .filter((candidate) => candidate.enabled)
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          kind: candidate.kind,
        }));
      const collaborationRequested = hasExplicitTaskCollaborationIntent(prompt);
      const explicitProposal =
        collaborationRequested &&
        (onStartCollaboration || onRequestCollaboration)
          ? createExplicitTaskCollaborationProposal(
              prompt,
              { id: runtime.id, name: runtime.name, kind: runtime.kind },
              collaborationCandidates,
            )
          : undefined;
      if (explicitProposal) {
        if (onStartCollaboration) {
          const launch = await onStartCollaboration(
            explicitProposal,
            selectedWorkspace,
          );
          if (!launch) throw new Error("无法保存协作安排，请稍后重试。");
          await linkCollaborationToConversation(launch.taskId);
          setCollaborationAssignments(launch.assignments);
          await runCollaboration(prompt, launch, selectedWorkspace);
          setLoading(false);
          setCurrentRunId(null);
          return;
        }
        const proposalMessages = [
          ...nextMessages,
          newMessage(
            "agent",
            formatTaskCollaborationProposal(explicitProposal),
          ),
        ];
        messagesRef.current = proposalMessages;
        setMessages(proposalMessages);
        await persistConversation(proposalMessages);
        setLoading(false);
        setCurrentRunId(null);
        return;
      }
      const resumableSessionId = runtimeSessionIdRef.current || undefined;
      const basePrompt = resumableSessionId
        ? prompt
        : promptWithTranscript(messages, prompt);
      const platformRules = [
        runtime.location === "remote"
          ? remoteRuntimeEnvironmentProtocol()
          : undefined,
        collaborationRequested && collaborationCandidates.length > 1
          ? taskCollaborationProposalProtocol(collaborationCandidates)
          : undefined,
      ].filter((rule): rule is string => Boolean(rule));
      const runtimePrompt = platformRules.length
        ? `${platformRules.join("\n\n")}\n\n当前用户请求：\n${basePrompt}`
        : basePrompt;
      const run = await window.hermesAPI.startAgentRuntimeTask(runtime.id, {
        prompt: runtimePrompt,
        mode:
          collaborationCandidates.length > 1 &&
          resolvedAccessMode !== "analysis" &&
          runtime.location === "remote" &&
          unifiedRemoteGatewayRuntime &&
          !remoteWorkspaceSupported
            ? "analysis"
            : resolvedAccessMode,
        fullAccessConfirmed:
          resolvedAccessMode === "full_access" &&
          !(
            collaborationCandidates.length > 1 &&
            runtime.location === "remote" &&
            unifiedRemoteGatewayRuntime &&
            !remoteWorkspaceSupported
          ),
        // Keep the first turn in conversation mode even before the Gateway
        // returns a resumable session id.
        conversation: true,
        // The current OpenClaw Bridge creates a subagent session ID which it
        // cannot safely resume. Send a bounded transcript instead, so a
        // follow-up keeps its context without leaving the run stuck in running.
        sessionId: resumableSessionId,
        workspace: selectedWorkspace,
        attachments,
      });
      taskRunRef.current = run;
      setTaskRun(run);
      setCurrentRunId(run.id);
      void pollRun(run.id);
    } catch (err) {
      const failedMessages = [
        ...nextMessages,
        newMessage("system", (err as Error).message || "任务请求失败。"),
      ];
      setMessages(failedMessages);
      void persistConversation(failedMessages);
      setLoading(false);
      setCurrentRunId(null);
    }
  }

  async function stop(): Promise<void> {
    cancelledRef.current = true;
    const activeRunIds = [
      ...new Set([
        ...Object.values(activeCollaborationRunsRef.current).map(
          (active) => active.run.id,
        ),
        ...(currentRunId ? [currentRunId] : []),
      ]),
    ];
    if (activeRunIds.length) {
      await Promise.all(
        activeRunIds.map((runId) =>
          window.hermesAPI.cancelAgentRuntimeTask(runId),
        ),
      );
    }
    if (currentRunId) {
      const cancelledRun =
        await window.hermesAPI.getAgentRuntimeRun(currentRunId);
      if (cancelledRun) {
        setTaskRun(cancelledRun);
      }
    }
    setLoading(false);
    setCurrentRunId(null);
    activeCollaborationRunsRef.current = {};
    setActiveCollaborationRuns({});
  }

  async function chooseWorkspace(): Promise<void> {
    const selected = await window.hermesAPI.selectFolder();
    if (selected) setWorkspace(selected);
  }

  function clearWorkspace(): void {
    setWorkspace("");
  }

  function selectRecentWorkspace(path: string): void {
    setWorkspace(path);
  }

  function toggleWorktreeVisible(): void {
    setWorktreeVisible((visible) => !visible);
  }

  const localFileInputs =
    runtime.location === "local" &&
    (runtime.kind === "codex" ||
      runtime.kind === "claude-code" ||
      runtime.kind === "pi");
  // Remote runtimes receive a short-lived outbound workspace grant instead of
  // a local path. Gateway v1 advertises that support through its probe.
  const remoteWorkspaceGatewayRuntime =
    runtime.location === "remote" && remoteWorkspaceSupported;
  const attachmentInputs = localFileInputs || remoteArtifactsSupported;
  const accessControlAvailable =
    localFileInputs ||
    remoteWorkspaceGatewayRuntime ||
    collaborationWriteRuntimeAvailable;
  const configuredLocalModel =
    runtime.location === "local" ? runtime.config.model?.trim() : undefined;
  const lastReportedExecution = [...messages]
    .reverse()
    .find(
      (message) => message.execution?.model || message.execution?.usage,
    )?.execution;
  const lastReportedModel = taskRun?.model || lastReportedExecution?.model;
  const lastReportedUsage = taskRun?.usage || lastReportedExecution?.usage;
  const configuredModelParts = configuredLocalModel?.includes("/")
    ? configuredLocalModel.split("/")
    : [];
  const runtimeModelProvider =
    lastReportedModel?.provider?.trim() ||
    configuredModelParts[0]?.trim() ||
    "";
  const runtimeModelId =
    lastReportedModel?.id?.trim() ||
    (configuredModelParts.length > 1
      ? configuredModelParts.slice(1).join("/").trim()
      : configuredLocalModel || "");
  const [resolvedRuntimeContextWindow, setResolvedRuntimeContextWindow] =
    useState<number | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (
      runtime.location !== "local" ||
      !runtimeModelProvider ||
      !runtimeModelId
    ) {
      setResolvedRuntimeContextWindow(null);
      return () => {
        cancelled = true;
      };
    }

    setResolvedRuntimeContextWindow(undefined);
    void window.hermesAPI
      .getAgentRuntimeModelContextWindow(
        runtime.id,
        runtimeModelProvider,
        runtimeModelId,
        profile,
      )
      .then((contextWindow) => {
        if (!cancelled) setResolvedRuntimeContextWindow(contextWindow);
      })
      .catch(() => {
        if (!cancelled) setResolvedRuntimeContextWindow(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    profile,
    runtime.id,
    runtime.location,
    runtimeModelId,
    runtimeModelProvider,
  ]);

  const runtimeModelLabel =
    [lastReportedModel?.provider, lastReportedModel?.id]
      .filter((value): value is string => Boolean(value))
      .join(" / ") ||
    configuredLocalModel ||
    "未提供模型";
  const runtimeContextWindow =
    lastReportedUsage?.contextWindowTokens ??
    lastReportedModel?.contextWindowTokens ??
    (runtime.location === "local" && resolvedRuntimeContextWindow !== undefined
      ? (resolvedRuntimeContextWindow ?? contextWindowForModel(runtimeModelId))
      : undefined);
  const runtimeContextUsed = lastReportedUsage?.contextUsedTokens;
  const runtimeContextUsage: ContextUsage | null =
    typeof runtimeContextWindow === "number" &&
    runtimeContextWindow > 0 &&
    typeof runtimeContextUsed === "number" &&
    runtimeContextUsed >= 0
      ? {
          used: runtimeContextUsed,
          window: runtimeContextWindow,
        }
      : null;
  const handleSuggestion = useCallback((text: string) => {
    chatInputRef.current?.setText(text);
  }, []);

  useEffect(() => {
    const handleAddChatToTask = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (
        !detail ||
        typeof detail !== "object" ||
        !("runId" in detail) ||
        !("content" in detail)
      ) {
        return;
      }
      const payload = detail as { runId?: unknown; content?: unknown };
      if (payload.runId !== runId || typeof payload.content !== "string") {
        return;
      }
      chatInputRef.current?.setText(payload.content);
    };
    window.addEventListener("agents-one:add-chat-to-task", handleAddChatToTask);
    return () =>
      window.removeEventListener(
        "agents-one:add-chat-to-task",
        handleAddChatToTask,
      );
  }, [runId]);

  // See Chat: collaboration launches reuse the normal runtime send path so
  // the first brief is persisted as an ordinary user message.
  useEffect(() => {
    const handleCollaborationSubmit = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object") return;
      const payload = detail as {
        runId?: unknown;
        content?: unknown;
        collaboration?: CollaborationLaunch;
        reuseExistingUserMessage?: unknown;
      };
      if (payload.runId !== runId || typeof payload.content !== "string")
        return;
      const text = payload.content.trim();
      if (!text || !payload.collaboration) return;
      if (payload.reuseExistingUserMessage === true) {
        cancelledRef.current = false;
        setLoading(true);
        void runCollaboration(
          text,
          payload.collaboration,
          workspace || undefined,
        ).finally(() => {
          setLoading(false);
          setCurrentRunId(null);
        });
        return;
      }
      void send(text, [], payload.collaboration);
    };
    window.addEventListener(
      "agents-one:submit-task-message",
      handleCollaborationSubmit,
    );
    return () =>
      window.removeEventListener(
        "agents-one:submit-task-message",
        handleCollaborationSubmit,
      );
  }, [runId, runCollaboration, send, workspace]);

  return (
    <div className="runtime-chat chat-container" aria-hidden={!active}>
      <ConversationWorkspace
        panelOpen={webPreviewVisible}
        panel={
          <WebPreviewPanel
            initialUrl={webPreviewUrl}
            onClose={() => setWebPreviewVisible(false)}
          />
        }
        composer={
          <div className="chat-input-area">
            <ChatInput
              ref={chatInputRef}
              isLoading={loading}
              hasSession={Boolean(runtimeSessionIdRef.current)}
              sessionId={conversationIdRef.current}
              contextUsage={runtimeContextUsage}
              attachmentsEnabled={attachmentInputs}
              placeholder="输入消息...（Shift+Enter 换行）"
              onSubmit={(text, attachments) => void send(text, attachments)}
              onQuickAsk={() => undefined}
              onAbort={() => void stop()}
              slashCommands={[]}
              toolbarExtras={
                <>
                  <ContextFolderChip
                    contextFolder={workspace || null}
                    show={localFileInputs || remoteWorkspaceGatewayRuntime}
                    worktreeVisible={worktreeVisible}
                    onPickFolder={() => void chooseWorkspace()}
                    onClearFolder={clearWorkspace}
                    onToggleWorktree={toggleWorktreeVisible}
                    onSelectRecentFolder={selectRecentWorkspace}
                  />
                  {accessControlAvailable ? (
                    <span className="runtime-permission-control">
                      <button
                        type="button"
                        className="runtime-permission-trigger"
                        aria-haspopup="menu"
                        aria-expanded={permissionMenuOpen}
                        aria-label="管理本轮任务权限"
                        title="管理本轮任务权限"
                        onClick={() => setPermissionMenuOpen((open) => !open)}
                      >
                        <ShieldCheck size={14} />
                        <span className="runtime-permission-label">
                          {accessMode === "auto"
                            ? "自动"
                            : accessMode === "analysis"
                              ? "只读"
                              : "完全访问"}
                        </span>
                        <ChevronDown size={13} />
                      </button>
                      {permissionMenuOpen ? (
                        <span className="runtime-permission-menu" role="menu">
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={accessMode === "auto"}
                            onClick={() => {
                              setAccessMode("auto");
                              setPermissionMenuOpen(false);
                            }}
                          >
                            <strong>自动</strong>
                            <small>可读写，无移动、删除文件权限</small>
                          </button>
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={accessMode === "analysis"}
                            onClick={() => {
                              setAccessMode("analysis");
                              setPermissionMenuOpen(false);
                            }}
                          >
                            <strong>只读</strong>
                            <small>可查看项目和附件，不会修改文件</small>
                          </button>
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={accessMode === "full_access"}
                            disabled={
                              unifiedRemoteGatewayRuntime &&
                              !remoteWorkspaceSupported &&
                              !collaborationWriteRuntimeAvailable
                            }
                            title={
                              unifiedRemoteGatewayRuntime &&
                              !remoteWorkspaceSupported &&
                              !collaborationWriteRuntimeAvailable
                                ? "完成 Gateway v1 Workspace Grant 接入后开放"
                                : undefined
                            }
                            onClick={() => {
                              if (
                                unifiedRemoteGatewayRuntime &&
                                !remoteWorkspaceSupported &&
                                !collaborationWriteRuntimeAvailable
                              ) {
                                return;
                              }
                              setAccessMode("full_access");
                              setPermissionMenuOpen(false);
                            }}
                          >
                            <strong>完全访问</strong>
                            <small>
                              {unifiedRemoteGatewayRuntime &&
                              !remoteWorkspaceSupported
                                ? "Workspace Grant 接入后开放"
                                : "可创建、编辑、移动或删除项目文件"}
                            </small>
                          </button>
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  <button
                    className="chat-model-trigger runtime-chat-model-trigger"
                    type="button"
                    disabled
                    aria-label={`模型：${runtimeModelLabel}`}
                    title={
                      runtimeModelLabel !== "未提供模型"
                        ? `模型：${runtimeModelLabel}`
                        : "远程智能体未提供模型元数据"
                    }
                  >
                    <span className="chat-model-name" title={runtimeModelLabel}>
                      {runtimeModelLabel}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`btn-ghost chat-tool-btn ${webPreviewVisible ? "chat-tool-btn-active" : ""}`}
                    onClick={() => setWebPreviewVisible((visible) => !visible)}
                    title={webPreviewVisible ? "隐藏网页预览" : "显示网页预览"}
                    aria-label={
                      webPreviewVisible ? "隐藏网页预览" : "显示网页预览"
                    }
                  >
                    <Globe size={14} />
                  </button>
                </>
              }
            />
          </div>
        }
      >
        <div className="chat-body">
          <div className="chat-messages" ref={scrollRef}>
            {collaboration && collaborationDashboardVisible ? (
              <aside
                className="task-collaboration-dashboard"
                aria-label="智能体协作看板"
              >
                <header className="task-collaboration-dashboard-header">
                  <span>
                    <Users size={15} /> 协作看板
                  </span>
                  <button
                    type="button"
                    className="btn-ghost task-collaboration-dashboard-close"
                    onClick={() => setCollaborationDashboardVisible(false)}
                    aria-label="隐藏协作看板"
                    title="隐藏协作看板"
                  >
                    <X size={15} />
                  </button>
                </header>
                <TaskCollaborationRolePanel
                  assignments={collaborationAssignments}
                  runtimes={runtimeCatalog}
                  execution={collaborationExecution}
                  onIntervene={openRoleDialogue}
                />
                <TaskCollaborationArtifactPanel
                  execution={collaborationExecution}
                  onIntervene={() => {
                    const target =
                      collaborationExecution?.roleRuns.find((item) =>
                        [
                          "waiting_for_user",
                          "failed",
                          "blocked",
                          "needs_review",
                        ].includes(item.status),
                      ) ||
                      collaborationExecution?.roleRuns.find(
                        (item) =>
                          item.assignmentId ===
                          collaborationExecution.acceptance?.assignmentId,
                      );
                    const assignment = target
                      ? collaborationAssignments.find(
                          (item, index) =>
                            assignmentKey(item, index) === target.assignmentId,
                        )
                      : undefined;
                    if (target && assignment) {
                      openRoleDialogue(assignment, target.assignmentId);
                    }
                  }}
                  onReassignImplementation={() => {
                    const blockedRun = collaborationExecution?.roleRuns.find(
                      (item) =>
                        ["waiting_for_user", "failed", "blocked"].includes(
                          item.status,
                        ),
                    );
                    const assignment = blockedRun
                      ? collaborationAssignments.find(
                          (item, index) =>
                            assignmentKey(item, index) ===
                            blockedRun.assignmentId,
                        )
                      : collaborationAssignments.find(roleCanModify);
                    if (assignment) {
                      const assignmentId =
                        blockedRun?.assignmentId ||
                        assignmentKey(
                          assignment,
                          collaborationAssignments.indexOf(assignment),
                        );
                      openRoleDialogue(assignment, assignmentId);
                      setInterventionText(
                        "请根据验收结论重新实施并发布完整交付物：路径、SHA-256、来源机器与变更摘要。",
                      );
                      setInterventionShared(true);
                    }
                  }}
                  acceptanceRuntimeOptions={Object.values(runtimeCatalog)
                    .filter((candidate) => candidate.enabled)
                    .map((candidate) => ({
                      id: candidate.id,
                      name: candidate.name,
                    }))}
                  onReassignAcceptance={(runtimeId) =>
                    void reassignAcceptance(runtimeId)
                  }
                />
                <TaskCollaborationTimeline execution={collaborationExecution} />
              </aside>
            ) : collaboration ? (
              <button
                type="button"
                className="task-collaboration-dashboard-trigger"
                onClick={() => setCollaborationDashboardVisible(true)}
                aria-label="显示协作看板"
                title="显示协作看板"
              >
                <Users size={16} />
                <span>协作看板</span>
              </button>
            ) : null}
            {interventionTarget
              ? (() => {
                  const targetRun = collaborationExecution?.roleRuns.find(
                    (item) =>
                      item.assignmentId === interventionTarget.assignmentId,
                  );
                  const canContinue = Boolean(
                    targetRun &&
                    [
                      "waiting_for_user",
                      "paused",
                      "failed",
                      "succeeded",
                    ].includes(targetRun.status),
                  );
                  const priorInstructions = (
                    collaborationExecution?.interventions || []
                  ).filter(
                    (item) =>
                      item.assignmentId === interventionTarget.assignmentId,
                  );
                  return (
                    <aside
                      className="collaboration-intervention-drawer"
                      aria-label="角色人工介入"
                    >
                      <header>
                        <div>
                          <strong>
                            介入：{interventionTarget.assignment.role}
                          </strong>
                          <span>
                            {runtimeCatalog[
                              interventionTarget.assignment.runtimeId || ""
                            ]?.name || interventionTarget.assignment.runtimeId}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => {
                            setInterventionTarget(null);
                            setInterventionAccessMode("inherit");
                          }}
                          aria-label="关闭人工介入"
                        >
                          ×
                        </button>
                      </header>
                      <p className="collaboration-intervention-status">
                        当前状态：
                        {["running", "retrying"].includes(
                          targetRun?.status || "",
                        )
                          ? "执行中"
                          : targetRun?.status === "paused"
                            ? "已暂停"
                            : targetRun?.status === "waiting_for_user"
                              ? "等待人工处理"
                              : targetRun?.status === "succeeded"
                                ? "已交接"
                                : "待处理"}
                      </p>
                      {priorInstructions.length ? (
                        <ol className="collaboration-intervention-history">
                          {priorInstructions.slice(-6).map((item) => (
                            <li key={item.id}>
                              <strong>
                                你 ·{" "}
                                {item.visibility === "shared"
                                  ? "已共享"
                                  : "仅本角色"}
                              </strong>
                              <span>{item.content}</span>
                              {item.response ? (
                                <>
                                  <strong>
                                    {runtimeCatalog[
                                      interventionTarget.assignment.runtimeId ||
                                        ""
                                    ]?.name ||
                                      interventionTarget.assignment.role}
                                  </strong>
                                  <span>{item.response}</span>
                                </>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      <textarea
                        value={interventionText}
                        onChange={(event) =>
                          setInterventionText(event.target.value)
                        }
                        placeholder="说明需要修正的方向、可用资料或处理要求…"
                        aria-label="给当前角色的人工指令"
                        disabled={loading}
                      />
                      {roleCanModify(interventionTarget.assignment) ? (
                        <label className="collaboration-intervention-access">
                          本角色权限
                          <select
                            value={interventionAccessMode}
                            onChange={(event) =>
                              setInterventionAccessMode(
                                event.target.value as
                                  | "inherit"
                                  | "analysis"
                                  | "full_access",
                              )
                            }
                            aria-label="本角色权限"
                          >
                            <option value="inherit">
                              继承任务权限（当前：
                              {accessMode === "auto"
                                ? "自动"
                                : accessMode === "full_access"
                                  ? "完全访问"
                                  : "只读"}
                              ）
                            </option>
                            <option value="analysis">只读</option>
                            <option value="full_access">
                              完全访问（可创建、编辑，删除需确认）
                            </option>
                          </select>
                        </label>
                      ) : null}
                      <label className="collaboration-intervention-share">
                        <input
                          type="checkbox"
                          checked={interventionShared}
                          onChange={(event) =>
                            setInterventionShared(event.target.checked)
                          }
                        />
                        共享给协作组，供后续角色读取本轮问答
                      </label>
                      <div className="collaboration-intervention-reassign">
                        <label>
                          当前智能体
                          <select
                            value={interventionRuntimeId}
                            onChange={(event) =>
                              setInterventionRuntimeId(event.target.value)
                            }
                            aria-label="改派当前角色"
                            disabled={loading}
                          >
                            {Object.values(runtimeCatalog)
                              .filter((candidate) => candidate.enabled)
                              .map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={
                            loading ||
                            !interventionRuntimeId ||
                            interventionRuntimeId ===
                              interventionTarget.assignment.runtimeId
                          }
                          onClick={() => void reassignInterventionRole()}
                        >
                          改派当前角色
                        </button>
                      </div>
                      <footer>
                        {["running", "retrying"].includes(
                          targetRun?.status || "",
                        ) ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() =>
                              void pauseCollaborationRole(
                                interventionTarget.assignmentId,
                              )
                            }
                          >
                            暂停此角色
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={!interventionText.trim() || loading}
                          onClick={() => void persistIntervention(false)}
                        >
                          保存指令
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={
                            !interventionText.trim() || !canContinue || loading
                          }
                          onClick={() => void persistIntervention(true, true)}
                        >
                          {loading ? "正在沟通…" : "发送给此智能体"}
                        </button>
                        {targetRun?.status === "succeeded" &&
                        collaborationExecution?.status === "paused" ? (
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={loading}
                            onClick={() => void continueAfterIntervention()}
                          >
                            继续后续任务
                          </button>
                        ) : null}
                      </footer>
                      {!collaborationExecution?.brief ? (
                        <small>
                          请先发送首条任务说明，平台才能安全恢复角色执行。
                        </small>
                      ) : null}
                    </aside>
                  );
                })()
              : null}
            {messages.length === 0 ? (
              <ChatEmptyState onSelectSuggestion={handleSuggestion} />
            ) : (
              <>
                <MessageList
                  messages={nativeMessages}
                  isLoading={loading}
                  // Runtime events already provide the native thinking/tool
                  // rows. Do not add a second generic progress bubble.
                  toolProgress={null}
                  agentName={appearanceRuntime.name}
                  onAgentAvatarClick={
                    collaboration
                      ? (identity) => {
                          const identityId = identity.collaborationAssignmentId;
                          const baseIdentityId = identityId?.replace(
                            /::final-review$/,
                            "",
                          );
                          const index = collaborationAssignments.findIndex(
                            (assignment, assignmentIndex) => {
                              const key = assignmentKey(
                                assignment,
                                assignmentIndex,
                              );
                              return (
                                key === identityId ||
                                key === baseIdentityId ||
                                (assignment.runtimeId ===
                                  identity.agentRuntimeId &&
                                  assignment.role ===
                                    identity.collaborationRole)
                              );
                            },
                          );
                          if (index >= 0) {
                            const assignment = collaborationAssignments[index];
                            openRoleDialogue(
                              assignment,
                              assignmentKey(assignment, index),
                            );
                          }
                        }
                      : undefined
                  }
                  agentAvatar={agentAvatar}
                  agentColor={appearanceRuntime.color}
                  onApprove={handleNativeApprove}
                  onDeny={handleNativeDeny}
                  onClarifyResolved={handleNativeClarifyResolved}
                />
                <RuntimeCollaborationProposalCards
                  messages={messages}
                  runtime={runtime}
                  runtimeCatalog={runtimeCatalog}
                  collaboration={collaboration}
                  onRequestCollaboration={onRequestCollaboration}
                />
              </>
            )}
          </div>
          {workspace && worktreeVisible && localFileInputs ? (
            <WorktreePanel folderPath={workspace} />
          ) : null}
        </div>
      </ConversationWorkspace>
    </div>
  );
}
