import { useEffect, useMemo, useState } from "react";
import { Bot, Folder, Plus, Send, Trash2, Users, X } from "lucide-react";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type {
  TaskCollaborationAssignment,
  TaskCollaborationRole,
} from "../../../../shared/task-collaboration";

const DEFAULT_ROLES: Array<{
  role: TaskCollaborationRole;
  responsibility: string;
  context: string;
}> = [
  {
    role: "项目负责人",
    responsibility: "拆分、协调、验收",
    context: "全部",
  },
  {
    role: "实施",
    responsibility: "实施与交付",
    context: "任务说明、项目文件",
  },
  {
    role: "测试",
    responsibility: "测试与复核",
    context: "任务说明、产物",
  },
  {
    role: "复核",
    responsibility: "验收与建议",
    context: "任务说明、产物",
  },
];

export interface CollaborationTaskDraft {
  runId?: string;
  taskId?: string;
  title: string;
  projectFolder?: string | null;
  sourceRuntimeId?: string;
  assignments?: TaskCollaborationAssignment[];
  /** Optional brief prefilled from a runtime proposal, still editable by the user. */
  message?: string;
}

function projectName(path?: string | null): string {
  return path?.split(/[\\/]/).filter(Boolean).at(-1) || "未关联项目";
}

function defaultAssignments(
  draft: CollaborationTaskDraft,
): TaskCollaborationAssignment[] {
  if (draft.assignments?.length) {
    return draft.assignments.map((item) => ({
      ...item,
      id: item.id || crypto.randomUUID(),
    }));
  }
  return DEFAULT_ROLES.slice(0, 3).map((definition) => {
    return {
      role: definition.role,
      ...(definition.role === "项目负责人" && draft.sourceRuntimeId
        ? {
            runtimeId: draft.sourceRuntimeId,
          }
        : {}),
      id: crypto.randomUUID(),
      responsibility: definition.responsibility,
      context: definition.context,
      workspaceAccess: definition.role === "项目负责人" ? "evidence_bundle" : undefined,
    };
  });
}

export default function TaskCollaborationDialog({
  draft,
  runtimes,
  onClose,
  onStart,
}: {
  draft: CollaborationTaskDraft;
  runtimes: AgentRuntimeDefinition[];
  onClose: () => void;
  /** Starts the existing task dialogue after the user explicitly sends the brief. */
  onStart: (assignments: TaskCollaborationAssignment[], message: string) => void;
}): React.JSX.Element {
  const available = useMemo(
    () => runtimes.filter((runtime) => runtime.enabled),
    [runtimes],
  );
  const [assignments, setAssignments] = useState<TaskCollaborationAssignment[]>(
    () => defaultAssignments(draft),
  );
  const [message, setMessage] = useState(() => draft.message || "");

  useEffect(() => {
    setAssignments(defaultAssignments(draft));
    setMessage(draft.message || "");
  }, [draft]);

  const updateAssignment = (
    id: string | undefined,
    patch: Partial<TaskCollaborationAssignment>,
  ): void => {
    setAssignments((current) =>
      current.map((item, index) =>
        (id ? item.id === id : index === 0) ? { ...item, ...patch } : item,
      ),
    );
  };

  const addRole = (): void => {
    setAssignments((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "新角色",
        responsibility: "",
        context: "任务说明",
      },
    ]);
  };

  const removeRole = (id: string | undefined): void => {
    setAssignments((current) =>
      current.filter((item) => (id ? item.id !== id : false)),
    );
  };

  const workspaceAccessFor = (assignment: TaskCollaborationAssignment): "local_direct" | "remote_mapping" | "evidence_bundle" => {
    if (assignment.workspaceAccess) return assignment.workspaceAccess;
    const selected = available.find((item) => item.id === assignment.runtimeId);
    return selected?.location === "remote" ? "evidence_bundle" : "local_direct";
  };

  const start = (): void => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const configured = assignments
      .map((item) => ({ ...item, role: item.role.trim() }))
      .filter((item) => item.role && item.runtimeId);
    if (!configured.length) return;
    onStart(configured, trimmed);
  };

  return (
    <div className="task-collaboration-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="task-collaboration-dialog task-collaboration-setup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-collaboration-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="task-collaboration-title"><Users size={20} /> 多智能体协作</h2>
            <p>{draft.title || "当前任务的协作方案"}</p>
          </div>
          <button type="button" className="icon-btn" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="task-collaboration-body">
          <div className="task-collaboration-project">
            <span><Folder size={15} /> 关联项目</span>
            <strong title={draft.projectFolder || undefined}>{projectName(draft.projectFolder)}</strong>
          </div>

          <section className="task-collaboration-role-table" aria-label="协作角色设置">
            <div className="task-collaboration-role-head" aria-hidden="true">
              <span>角色</span><span>智能体</span><span>职责</span><span>共享上下文</span><span>工作区访问</span><span />
            </div>
            {assignments.map((assignment) => {
              const selectedRuntime = available.find((item) => item.id === assignment.runtimeId);
              return (
                <div className="task-collaboration-role-row" key={assignment.id || assignment.role}>
                  <input
                    aria-label="角色"
                    value={assignment.role}
                    onChange={(event) => updateAssignment(assignment.id, { role: event.target.value })}
                  />
                  <label className="task-collaboration-agent-picker">
                    <span
                      className="task-collaboration-agent-avatar"
                      style={selectedRuntime?.color ? { background: selectedRuntime.color } : undefined}
                    >
                      {selectedRuntime?.avatar ? <img src={selectedRuntime.avatar} alt="" /> : <Bot size={15} />}
                    </span>
                    <select
                    aria-label={`${assignment.role || "协作角色"}智能体`}
                    value={assignment.runtimeId || ""}
                    onChange={(event) => updateAssignment(assignment.id, { runtimeId: event.target.value || undefined })}
                  >
                    <option value="">暂不指定</option>
                    {available.map((runtime) => <option value={runtime.id} key={runtime.id}>{runtime.name}</option>)}
                  </select>
                  </label>
                  <input
                    aria-label={`${assignment.role || "协作角色"}职责`}
                    value={assignment.responsibility || ""}
                    onChange={(event) => updateAssignment(assignment.id, { responsibility: event.target.value })}
                  />
                  <input
                    aria-label={`${assignment.role || "协作角色"}共享上下文`}
                    value={assignment.context || ""}
                    onChange={(event) => updateAssignment(assignment.id, { context: event.target.value })}
                  />
                  <div className="task-collaboration-workspace-access">
                    <select
                      aria-label={`${assignment.role || "协作角色"}工作区访问方式`}
                      value={workspaceAccessFor(assignment)}
                      onChange={(event) => updateAssignment(assignment.id, {
                        workspaceAccess: event.target.value as TaskCollaborationAssignment["workspaceAccess"],
                        ...(event.target.value !== "remote_mapping" ? { workspaceRef: undefined } : {}),
                      })}
                    >
                      {selectedRuntime?.location !== "remote" ? <option value="local_direct">本地直连</option> : null}
                      {selectedRuntime?.location === "remote" ? <option value="remote_mapping">远程映射</option> : null}
                      <option value="evidence_bundle">只读证据包</option>
                    </select>
                    {workspaceAccessFor(assignment) === "remote_mapping" ? (
                      <input
                        aria-label={`${assignment.role || "协作角色"}远程工作区映射`}
                        placeholder="远程目录、git: 引用或共享路径"
                        value={assignment.workspaceRef || ""}
                        onChange={(event) => updateAssignment(assignment.id, { workspaceRef: event.target.value })}
                      />
                    ) : null}
                  </div>
                  <button type="button" className="icon-btn task-collaboration-remove-role" title="移除角色" aria-label="移除角色" onClick={() => removeRole(assignment.id)}><Trash2 size={15} /></button>
                </div>
              );
            })}
          </section>
          <button type="button" className="btn btn-secondary btn-sm task-collaboration-add-role" onClick={addRole}>
            <Plus size={15} /> 添加角色
          </button>
        </div>

        <footer className="task-collaboration-composer">
          <textarea
            autoFocus
            aria-label="任务说明"
            placeholder="输入任务说明...（Shift+Enter 换行）"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                start();
              }
            }}
          />
          <div className="task-collaboration-composer-tools">
            <span title={draft.projectFolder || "未关联项目"}><Folder size={16} /> {projectName(draft.projectFolder)}</span>
            <span>确认分工后，发送任务说明才会启动协作</span>
            <button type="button" className="primary-btn" onClick={start} disabled={!message.trim()}>
              <Send size={16} /> 发送并启动
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
