export interface TrayTaskItem {
  id: string;
  title: string;
  projectName?: string;
  updatedAt: number;
  running: boolean;
  openTaskId?: string;
}

export interface TrayTaskGroups {
  running: TrayTaskItem[];
  recent: TrayTaskItem[];
  more: TrayTaskItem[];
}

const RECENT_COMPLETED_LIMIT = 3;

function compactText(
  value: string | null | undefined,
  fallback: string,
  limit: number,
): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Display only a folder/project name, never a full path or placeholder. */
export function trayProjectName(value: string | null | undefined): string {
  const clean = (value || "").trim().replace(/[\\/]+$/, "");
  const name = clean.split(/[\\/]/).pop();
  return compactText(name, "", 20);
}

export interface TrayTaskDisplay {
  title: string;
  projectName: string;
}

/** Keep title and project as separate fields so the renderer can align them. */
export function trayTaskDisplay(task: TrayTaskItem): TrayTaskDisplay {
  return {
    title: compactText(task.title, "未命名任务", 80),
    projectName: trayProjectName(task.projectName),
  };
}

export function groupTrayTasks(tasks: TrayTaskItem[]): TrayTaskGroups {
  const sorted = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt);
  const unique = new Map<string, TrayTaskItem>();
  for (const task of sorted) {
    const existing = unique.get(task.id);
    if (!existing || (!existing.running && task.running)) {
      unique.set(task.id, task);
    }
  }

  const ordered = [...unique.values()];
  const running = ordered.filter((task) => task.running);
  const completed = ordered.filter((task) => !task.running);
  return {
    running,
    recent: completed.slice(0, RECENT_COMPLETED_LIMIT),
    more: completed.slice(RECENT_COMPLETED_LIMIT),
  };
}
