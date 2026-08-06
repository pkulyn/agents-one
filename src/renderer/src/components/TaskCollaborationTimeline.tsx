import { ChevronDown, CircleAlert, FileText, Play, ShieldCheck, Users, Wrench } from "lucide-react";
import type { TaskCollaborationExecution, TaskCollaborationTimelineEvent } from "../../../shared/task-collaboration";

const ICONS = {
  preflight: ShieldCheck,
  started: Play,
  handoff: Users,
  artifact: FileText,
  acceptance: ShieldCheck,
  blocked: CircleAlert,
  recovery: Wrench,
} as const;

function derivedTimeline(execution: TaskCollaborationExecution): TaskCollaborationTimelineEvent[] {
  const events = [...(execution.timeline || [])];
  if (events.length) return events;
  for (const run of execution.roleRuns) {
    if (run.startedAt) events.push({ id: `${run.assignmentId}:started`, type: "started", label: `${run.role} 已启动`, assignmentId: run.assignmentId, createdAt: run.startedAt });
    if (run.completedAt) events.push({ id: `${run.assignmentId}:done`, type: run.status === "succeeded" ? "handoff" : "blocked", label: run.status === "succeeded" ? `${run.role} 已交接` : `${run.role} 等待处理`, assignmentId: run.assignmentId, detail: run.error, createdAt: run.completedAt });
  }
  for (const artifact of execution.artifacts || []) events.push({ id: `${artifact.id}:artifact`, type: "artifact", label: `${artifact.role} 发布证据`, assignmentId: artifact.assignmentId, artifactId: artifact.id, detail: artifact.label, createdAt: artifact.createdAt });
  if (execution.acceptance) events.push({ id: "acceptance", type: "acceptance", label: execution.acceptance.status === "passed" ? "终验通过" : "终验待处理", assignmentId: execution.acceptance.assignmentId, detail: execution.acceptance.conclusion, createdAt: execution.acceptance.createdAt });
  return events;
}

export function TaskCollaborationTimeline({ execution }: { execution?: TaskCollaborationExecution }): React.JSX.Element | null {
  if (!execution) return null;
  const events = derivedTimeline(execution).sort((a, b) => a.createdAt - b.createdAt).slice(-80);
  if (!events.length) return null;
  return (
    <details className="task-collaboration-timeline-panel">
      <summary><span><ListIcon /> 协作时间线</span><small>{events.length} 项事件</small><ChevronDown size={14} /></summary>
      <ol>
        {events.map((event) => {
          const Icon = ICONS[event.type];
          return <li key={event.id}>
            <button type="button" onClick={() => {
              if (!event.assignmentId) return;
              document.querySelector<HTMLElement>(`[data-collaboration-assignment="${event.assignmentId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}>
              <Icon size={14} />
              <span><strong>{event.label}</strong>{event.detail ? <small>{event.detail}</small> : null}</span>
            </button>
          </li>;
        })}
      </ol>
    </details>
  );
}

function ListIcon(): React.JSX.Element {
  return <Users size={15} />;
}
