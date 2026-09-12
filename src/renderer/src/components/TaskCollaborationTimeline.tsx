import {
  ChevronDown,
  CircleAlert,
  FileText,
  Play,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import type {
  TaskCollaborationExecution,
  TaskCollaborationTimelineEvent,
} from "../../../shared/task-collaboration";
import { useI18n } from "./useI18n";

const ICONS = {
  preflight: ShieldCheck,
  started: Play,
  handoff: Users,
  artifact: FileText,
  acceptance: ShieldCheck,
  blocked: CircleAlert,
  recovery: Wrench,
} as const;

function derivedTimeline(
  execution: TaskCollaborationExecution,
  t: (key: string, options?: Record<string, unknown>) => string,
): TaskCollaborationTimelineEvent[] {
  const events = [...(execution.timeline || [])];
  if (events.length) return events;
  for (const run of execution.roleRuns) {
    if (run.startedAt)
      events.push({
        id: `${run.assignmentId}:started`,
        type: "started",
        label: t("collaboration.timeline.started", { role: run.role }),
        assignmentId: run.assignmentId,
        createdAt: run.startedAt,
      });
    if (run.completedAt)
      events.push({
        id: `${run.assignmentId}:done`,
        type: run.status === "succeeded" ? "handoff" : "blocked",
        label:
          run.status === "succeeded"
            ? t("collaboration.timeline.handedOff", { role: run.role })
            : t("collaboration.timeline.waiting", { role: run.role }),
        assignmentId: run.assignmentId,
        detail: run.error,
        createdAt: run.completedAt,
      });
  }
  for (const artifact of execution.artifacts || [])
    events.push({
      id: `${artifact.id}:artifact`,
      type: "artifact",
      label: t("collaboration.timeline.evidencePublished", {
        role: artifact.role,
      }),
      assignmentId: artifact.assignmentId,
      artifactId: artifact.id,
      detail: artifact.label,
      createdAt: artifact.createdAt,
    });
  if (execution.acceptance)
    events.push({
      id: "acceptance",
      type: "acceptance",
      label:
        execution.acceptance.status === "passed"
          ? t("collaboration.timeline.acceptancePassed")
          : t("collaboration.timeline.acceptancePending"),
      assignmentId: execution.acceptance.assignmentId,
      detail: execution.acceptance.conclusion,
      createdAt: execution.acceptance.createdAt,
    });
  return events;
}

export function TaskCollaborationTimeline({
  execution,
}: {
  execution?: TaskCollaborationExecution;
}): React.JSX.Element | null {
  const { t } = useI18n();
  if (!execution) return null;
  const events = derivedTimeline(execution, t)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-80);
  if (!events.length) return null;
  return (
    <details className="task-collaboration-timeline-panel">
      <summary>
        <span>
          <ListIcon /> {t("collaboration.timelineTitle")}
        </span>
        <small>{t("collaboration.eventCount", { count: events.length })}</small>
        <ChevronDown size={14} />
      </summary>
      <ol>
        {events.map((event) => {
          const Icon = ICONS[event.type];
          return (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => {
                  if (!event.assignmentId) return;
                  document
                    .querySelector<HTMLElement>(
                      `[data-collaboration-assignment="${event.assignmentId}"]`,
                    )
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                <Icon size={14} />
                <span>
                  <strong>{event.label}</strong>
                  {event.detail ? <small>{event.detail}</small> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function ListIcon(): React.JSX.Element {
  return <Users size={15} />;
}
