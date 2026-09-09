import {
  CheckCircle2,
  CircleDotDashed,
  Play,
  Settings2,
  Users,
  X,
} from "lucide-react";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type {
  TaskCollaborationAssignment,
  TaskCollaborationRole,
  TaskCollaborationStatus,
} from "../../../../shared/task-collaboration";
import type { CollaborationTaskDraft } from "./TaskCollaborationDialog";

const ROLES: Array<{ role: TaskCollaborationRole; label: string }> = [
  { role: "coordinator", label: "协调者" },
  { role: "implementer", label: "实施" },
  { role: "tester", label: "测试" },
  { role: "reviewer", label: "复核" },
];

export interface CollaborationWorkspaceState extends CollaborationTaskDraft {
  assignments: TaskCollaborationAssignment[];
  status: "draft" | TaskCollaborationStatus;
}

function projectName(path?: string | null): string {
  return path?.split(/[\\/]/).filter(Boolean).at(-1) || "未关联项目";
}

export default function TaskCollaborationWorkspace({
  state,
  runtimes,
  onClose,
  onConfigure,
  onStart,
  onOpenTask,
}: {
  state: CollaborationWorkspaceState;
  runtimes: AgentRuntimeDefinition[];
  onClose: () => void;
  onConfigure: () => void;
  onStart: () => void;
  onOpenTask: () => void;
}): React.JSX.Element {
  const runtimeNames = new Map(
    runtimes.map((runtime) => [runtime.id, runtime.name]),
  );
  const assignments = new Map(
    state.assignments.map((item) => [item.role, item.runtimeId]),
  );
  const isDraft = state.status === "draft";
  const isActive = state.status === "active";

  return (
    <div
      className="task-collaboration-overlay"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="task-collaboration-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-collaboration-workspace-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="task-collaboration-workspace-header">
          <div>
            <span className="task-collaboration-eyebrow">
              <Users size={15} /> 多智能体协作
            </span>
            <h2 id="task-collaboration-workspace-title">
              {state.title || "协作任务"}
            </h2>
            <p>{state.projectName || projectName(state.projectFolder)}</p>
          </div>
          <div className="task-collaboration-workspace-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onConfigure}
            >
              <Settings2 size={15} /> 协作配置
            </button>
            <button
              type="button"
              className="icon-btn"
              title="关闭协作看板"
              aria-label="关闭协作看板"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="task-collaboration-workspace-body">
          <section
            className="task-collaboration-roles-board"
            aria-label="协作角色"
          >
            <div className="task-collaboration-section-heading">
              <h3>协作角色</h3>
              <span>
                {isDraft
                  ? "等待创建任务"
                  : isActive
                    ? "协作进行中"
                    : "等待启动"}
              </span>
            </div>
            <div className="task-collaboration-role-grid">
              {ROLES.map(({ role, label }) => {
                const runtimeId = assignments.get(role);
                const isCoordinator = role === "coordinator";
                const status = !runtimeId
                  ? "未指定"
                  : isDraft
                    ? "待创建"
                    : isCoordinator
                      ? "等待任务说明"
                      : "等待协调者分配";
                return (
                  <article key={role}>
                    <span>{label}</span>
                    <strong>
                      {runtimeId
                        ? runtimeNames.get(runtimeId) || runtimeId
                        : "暂不指定"}
                    </strong>
                    <small>{status}</small>
                  </article>
                );
              })}
            </div>
          </section>

          <section
            className="task-collaboration-progress-board"
            aria-label="协作进展"
          >
            <div className="task-collaboration-section-heading">
              <h3>协作进展</h3>
            </div>
            <ol>
              <li className="done">
                <CheckCircle2 size={16} />
                <span>已保存协作分工</span>
              </li>
              <li className={isDraft ? "current" : "done"}>
                {isDraft ? (
                  <CircleDotDashed size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                <span>
                  {isDraft ? "向协调者发送首条任务说明" : "协作已由用户启动"}
                </span>
              </li>
              <li className={isActive ? "current" : ""}>
                <CircleDotDashed size={16} />
                <span>协调者拆解任务并由你确认派发</span>
              </li>
              <li>
                <CircleDotDashed size={16} />
                <span>实施、测试、复核按需执行与验收</span>
              </li>
            </ol>
          </section>
        </div>

        <footer className="task-collaboration-workspace-footer">
          <p>
            {isDraft
              ? "首条任务消息会建立可恢复的协作任务；配置和项目文件夹已保留。"
              : "协作由主智能体在任务对话中自动推进；这里仅用于查看状态或人工调整。"}
          </p>
          <div>
            {!isDraft && !isActive ? (
              <button type="button" className="primary-btn" onClick={onStart}>
                <Play size={16} /> 开始协作
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onOpenTask}
            >
              {isDraft ? "打开协调者任务对话" : "打开任务对话"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
