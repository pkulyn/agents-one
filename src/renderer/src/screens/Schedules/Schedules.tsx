import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash,
  Refresh,
  X,
  Play,
  Pause,
  Zap,
  Clock,
  ChatBubble,
  Pencil,
  Folder,
  Search,
  Check,
  Alert,
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type { ProjectFolderRecord } from "../../../../shared/project-folders";
import {
  isTaskScheduleRuntimeEligible,
  taskScheduleRuntimeCategory,
  type TaskSchedule,
  type TaskScheduleConcurrencyPolicy,
  type TaskScheduleRuntimeCategory,
  type TaskScheduleRunStatus,
  type TaskScheduleRun,
} from "../../../../shared/task-schedules";

type FrequencyType = "minutes" | "hourly" | "daily" | "weekly" | "custom";
type ScheduleFilter = "all" | "enabled" | "paused" | "attention";

const SCHEDULE_RUN_STATUS_LABEL: Record<TaskScheduleRunStatus, string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  timed_out: "已超时",
  skipped: "已跳过",
};

const RUNTIME_CATEGORY_LABEL: Record<TaskScheduleRuntimeCategory, string> = {
  local: "本地智能体",
  web: "网页智能体",
  remote: "远程智能体",
};

interface SchedulesProps {
  profile?: string;
}

// @lat: [[task-schedules#Renderer behavior]]
function Schedules({ profile }: SchedulesProps): React.JSX.Element {
  const { t } = useI18n();
  const [schedules, setSchedules] = useState<TaskSchedule[]>([]);
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>("all");

  // Create form state
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newRuntimeId, setNewRuntimeId] = useState("");
  const [newWorkspace, setNewWorkspace] = useState("");
  const [newWorkspaceId, setNewWorkspaceId] = useState("");
  const [projectFolders, setProjectFolders] = useState<ProjectFolderRecord[]>(
    [],
  );
  const [newTimeoutMs, setNewTimeoutMs] = useState("7200000");
  const [newMode, setNewMode] = useState<"auto" | "analysis" | "full_access">(
    "auto",
  );
  const [newConcurrencyPolicy, setNewConcurrencyPolicy] =
    useState<TaskScheduleConcurrencyPolicy>("skip");

  // Schedule builder state
  const [frequency, setFrequency] = useState<FrequencyType>("daily");
  const [minutesInterval, setMinutesInterval] = useState("30");
  const [hourlyInterval, setHourlyInterval] = useState("1");
  const [dailyTime, setDailyTime] = useState("09:00");
  const [weeklyDay, setWeeklyDay] = useState("1");
  const [weeklyTime, setWeeklyTime] = useState("09:00");
  const [customCron, setCustomCron] = useState("");

  const loadJobs = useCallback(async (): Promise<void> => {
    try {
      const [schedules, availableRuntimes, folders] = await Promise.all([
        window.agentsOneAPI.listTaskSchedules(profile),
        window.agentsOneAPI.listAgentRuntimes(),
        window.agentsOneAPI.listProjectFolders(),
      ]);
      const schedulableRuntimes = availableRuntimes.filter(
        isTaskScheduleRuntimeEligible,
      );
      const schedulableRuntimeIds = new Set(
        schedulableRuntimes.map((runtime) => runtime.id),
      );
      setSchedules(schedules);
      setRuntimes(availableRuntimes);
      setProjectFolders(folders);
      setNewRuntimeId((current) =>
        schedulableRuntimeIds.has(current)
          ? current
          : schedulableRuntimes[0]?.id || "",
      );
    } catch {
      setError(t("schedules.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [profile, t]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    const refresh = (): void => {
      void loadJobs();
    };
    const timer = window.setInterval(refresh, 10_000);
    const disposeStarted = window.agentsOneAPI.onTaskScheduleRunStarted?.(
      (event) => {
        if (event.profile === (profile || "default")) refresh();
      },
    );
    const dispose = window.agentsOneAPI.onTaskScheduleRunCompleted?.(
      (event) => {
        if (event.profile === (profile || "default")) refresh();
      },
    );
    return () => {
      window.clearInterval(timer);
      disposeStarted?.();
      dispose?.();
    };
  }, [loadJobs, profile]);

  // Escape key to close modals
  useEffect(() => {
    if (!showCreate && !editingScheduleId && !confirmDelete) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        if (confirmDelete) setConfirmDelete(null);
        else if (showCreate || editingScheduleId) closeCreateModal();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showCreate, editingScheduleId, confirmDelete]);

  function resetForm(): void {
    setNewName("");
    setNewPrompt("");
    setNewWorkspace("");
    setNewWorkspaceId("");
    setNewTimeoutMs("7200000");
    setNewMode("auto");
    setNewConcurrencyPolicy("skip");
    setFrequency("daily");
    setMinutesInterval("30");
    setHourlyInterval("1");
    setDailyTime("09:00");
    setWeeklyDay("1");
    setWeeklyTime("09:00");
    setCustomCron("");
  }

  function closeCreateModal(): void {
    setShowCreate(false);
    setEditingScheduleId(null);
    resetForm();
  }

  function applyScheduleValue(value: string): void {
    const interval = /^(\d+)([mh])$/i.exec(value);
    if (interval) {
      if (interval[2].toLowerCase() === "m") {
        setFrequency("minutes");
        setMinutesInterval(interval[1]);
      } else {
        setFrequency("hourly");
        setHourlyInterval(interval[1]);
      }
      return;
    }
    const parts = value.trim().split(/\s+/);
    if (parts.length === 5 && parts[2] === "*" && parts[3] === "*") {
      const time = `${parts[1].padStart(2, "0")}:${parts[0].padStart(2, "0")}`;
      if (parts[4] === "*") {
        setFrequency("daily");
        setDailyTime(time);
      } else if (/^[0-6]$/.test(parts[4])) {
        setFrequency("weekly");
        setWeeklyDay(parts[4]);
        setWeeklyTime(time);
      } else {
        setFrequency("custom");
        setCustomCron(value);
      }
      return;
    }
    setFrequency("custom");
    setCustomCron(value);
  }

  function openEditModal(schedule: TaskSchedule): void {
    resetForm();
    const runtime = runtimes.find((item) => item.id === schedule.runtimeId);
    const webRuntime = runtime
      ? taskScheduleRuntimeCategory(runtime) === "web"
      : false;
    setEditingScheduleId(schedule.id);
    setNewName(schedule.name);
    setNewPrompt(schedule.prompt);
    setNewRuntimeId(schedule.runtimeId);
    setNewWorkspace(
      webRuntime
        ? ""
        : schedule.workspace ||
            projectFolders.find((folder) => folder.id === schedule.workspaceId)
              ?.path ||
            "",
    );
    setNewWorkspaceId(webRuntime ? "" : schedule.workspaceId || "");
    setNewTimeoutMs(String(schedule.timeoutMs));
    setNewMode(
      webRuntime
        ? "analysis"
        : schedule.mode === "full_access" || schedule.mode === "analysis"
          ? schedule.mode
          : "auto",
    );
    setNewConcurrencyPolicy(schedule.concurrencyPolicy);
    applyScheduleValue(schedule.schedule);
  }

  async function chooseWorkspace(): Promise<void> {
    const selected = await window.agentsOneAPI.selectFolder();
    if (!selected) return;
    const registered =
      await window.agentsOneAPI.registerProjectFolder(selected);
    if (registered) {
      setNewWorkspace(selected);
      setNewWorkspaceId(registered.id || "");
    }
  }

  function buildSchedule(): string {
    switch (frequency) {
      case "minutes":
        return `${minutesInterval}m`;
      case "hourly":
        return `${hourlyInterval}h`;
      case "daily": {
        const [h, m] = dailyTime.split(":");
        return `${m} ${h} * * *`;
      }
      case "weekly": {
        const [h, m] = weeklyTime.split(":");
        return `${m} ${h} * * ${weeklyDay}`;
      }
      case "custom":
        return customCron.trim();
    }
  }

  function isScheduleValid(): boolean {
    if (frequency === "custom") return customCron.trim().length > 0;
    if (frequency === "minutes") return parseInt(minutesInterval) > 0;
    if (frequency === "hourly") return parseInt(hourlyInterval) > 0;
    return true;
  }

  async function handleSave(): Promise<void> {
    if (!isScheduleValid()) return;
    const runtime = runtimes.find((item) => item.id === newRuntimeId);
    if (!runtime || !isTaskScheduleRuntimeEligible(runtime)) {
      setError("请选择当前可用的执行智能体");
      return;
    }
    const webRuntime = taskScheduleRuntimeCategory(runtime) === "web";
    setActionInProgress("creating");
    setError("");
    try {
      const input = {
        name: newName.trim() || "未命名计划任务",
        schedule: buildSchedule(),
        prompt: newPrompt.trim(),
        runtimeId: newRuntimeId,
        workspace: webRuntime ? undefined : newWorkspace.trim() || undefined,
        workspaceId: webRuntime ? undefined : newWorkspaceId || undefined,
        mode: webRuntime ? "analysis" : newMode,
        concurrencyPolicy: newConcurrencyPolicy,
        timeoutMs: Number(newTimeoutMs),
      };
      if (editingScheduleId) {
        await window.agentsOneAPI.updateTaskSchedule(
          editingScheduleId,
          input,
          profile,
        );
      } else {
        await window.agentsOneAPI.createTaskSchedule(input, profile);
      }
      closeCreateModal();
      await loadJobs();
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法保存计划任务");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleLocalToggle(schedule: TaskSchedule): Promise<void> {
    setActionInProgress(schedule.id);
    setError("");
    try {
      await window.agentsOneAPI.setTaskScheduleEnabled(
        schedule.id,
        !schedule.enabled,
        profile,
      );
      await loadJobs();
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法更新计划任务");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleLocalTrigger(schedule: TaskSchedule): Promise<void> {
    setActionInProgress(schedule.id);
    setError("");
    try {
      await window.agentsOneAPI.triggerTaskSchedule(schedule.id, profile);
      await loadJobs();
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法触发计划任务");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleLocalRemove(scheduleId: string): Promise<void> {
    setActionInProgress(scheduleId);
    setError("");
    try {
      await window.agentsOneAPI.deleteTaskSchedule(scheduleId, profile);
      setConfirmDelete(null);
      await loadJobs();
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法删除计划任务");
    } finally {
      setActionInProgress(null);
    }
  }

  function handleOpenResult(conversationId: string): void {
    window.dispatchEvent(
      new CustomEvent("agents-one:open-runtime-conversation", {
        detail: conversationId,
      }),
    );
  }

  function formatTime(iso: string | null): string {
    if (!iso) return "--";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  function formatSchedule(value: string): string {
    const interval = /^(\d+)([mh])$/i.exec(value);
    if (interval)
      return `每 ${interval[1]} ${interval[2].toLowerCase() === "h" ? "小时" : "分钟"}`;
    const parts = value.trim().split(/\s+/);
    if (parts.length !== 5) return "自定义计划";
    const [minute, hour, day, month, weekday] = parts;
    const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    if (day === "*" && month === "*" && weekday === "*") {
      return `每天 ${time}`;
    }
    if (day === "*" && month === "*") {
      const weekdayLabel: Record<string, string> = {
        "0": "周日",
        "1": "周一",
        "2": "周二",
        "3": "周三",
        "4": "周四",
        "5": "周五",
        "6": "周六",
        "1-5": "工作日",
        "0,6": "周末",
        "6,0": "周末",
      };
      const label =
        weekdayLabel[weekday] ||
        (/^[0-6](,[0-6])+$/.test(weekday)
          ? weekday
              .split(",")
              .map((value) => weekdayLabel[value])
              .join("、")
          : "");
      if (label) return `每${label} ${time}`;
    }
    if (/^\d+$/.test(day) && month === "*" && weekday === "*") {
      return `每月${day}日 ${time}`;
    }
    if (/^\d+$/.test(day) && /^\d+$/.test(month) && weekday === "*") {
      return `每年${month}月${day}日 ${time}`;
    }
    return "自定义计划";
  }

  function formatRunDuration(run: TaskScheduleRun): string | null {
    if (!run.completedAt || run.completedAt < run.triggeredAt) return null;
    const seconds = (run.completedAt - run.triggeredAt) / 1000;
    if (seconds < 1) return "耗时 <1 秒";
    if (seconds < 60) return `耗时 ${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`;
    const minutes = Math.floor(seconds / 60);
    return `耗时 ${minutes} 分${Math.round(seconds % 60)} 秒`;
  }

  function resultIcon(status: TaskScheduleRunStatus): React.JSX.Element {
    if (status === "succeeded") return <Check size={14} />;
    if (
      status === "failed" ||
      status === "timed_out" ||
      status === "cancelled"
    ) {
      return <Alert size={14} />;
    }
    if (status === "running") return <Refresh size={14} />;
    return <Clock size={14} />;
  }

  function latestRunNeedsAttention(schedule: TaskSchedule): boolean {
    const status = schedule.runs.at(-1)?.status;
    return (
      status === "failed" || status === "timed_out" || status === "cancelled"
    );
  }

  function latestResultClass(schedule: TaskSchedule): string {
    const status = schedule.runs.at(-1)?.status;
    if (status === "succeeded") return "success";
    if (
      status === "failed" ||
      status === "timed_out" ||
      status === "cancelled"
    ) {
      return "danger";
    }
    if (status === "running" || status === "queued") return "active";
    return "muted";
  }

  const schedulableRuntimes = runtimes.filter(isTaskScheduleRuntimeEligible);
  const selectedRuntime = runtimes.find(
    (runtime) => runtime.id === newRuntimeId,
  );
  const selectedRuntimeCategory = selectedRuntime
    ? taskScheduleRuntimeCategory(selectedRuntime)
    : null;
  const selectedRuntimeIsWeb = selectedRuntimeCategory === "web";
  const runtimeGroups = (
    ["local", "web", "remote"] as TaskScheduleRuntimeCategory[]
  ).map((category) => ({
    category,
    runtimes: schedulableRuntimes.filter(
      (runtime) => taskScheduleRuntimeCategory(runtime) === category,
    ),
  }));
  const scheduleCounts = {
    total: schedules.length,
    enabled: schedules.filter((schedule) => schedule.enabled).length,
    paused: schedules.filter((schedule) => !schedule.enabled).length,
    attention: schedules.filter(latestRunNeedsAttention).length,
  };
  const visibleSchedules = schedules.filter((schedule) => {
    const query = searchTerm.trim().toLocaleLowerCase();
    const runtime = runtimes.find((item) => item.id === schedule.runtimeId);
    const matchesSearch =
      !query ||
      [schedule.name, schedule.prompt, schedule.schedule, runtime?.name]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(query));
    const matchesFilter =
      scheduleFilter === "all" ||
      (scheduleFilter === "enabled" && schedule.enabled) ||
      (scheduleFilter === "paused" && !schedule.enabled) ||
      (scheduleFilter === "attention" && latestRunNeedsAttention(schedule));
    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <div className="schedules-container">
        <div className="schedules-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="schedules-container">
      {/* Create Modal */}
      {(showCreate || editingScheduleId) && (
        <div className="skills-detail-overlay" onClick={closeCreateModal}>
          <div className="schedules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="schedules-modal-header">
              <h3>
                {editingScheduleId ? "编辑定时任务" : t("schedules.newTask")}
              </h3>
              <button className="btn-ghost" onClick={closeCreateModal}>
                <X size={18} />
              </button>
            </div>
            <div className="schedules-modal-body">
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("schedules.name")}
                </label>
                <input
                  className="input"
                  type="text"
                  placeholder={t("schedules.namePlaceholder")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("schedules.frequency")}{" "}
                  <span className="schedules-required">*</span>
                </label>
                <div className="schedules-freq-pills">
                  {(
                    [
                      ["minutes", t("schedules.frequencyMinutes")],
                      ["hourly", t("schedules.frequencyHourly")],
                      ["daily", t("schedules.frequencyDaily")],
                      ["weekly", t("schedules.frequencyWeekly")],
                      ["custom", t("schedules.frequencyCustom")],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      className={`schedules-freq-pill ${frequency === val ? "active" : ""}`}
                      onClick={() => setFrequency(val)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {frequency === "minutes" && (
                <div className="schedules-field">
                  <label className="schedules-field-label">
                    {t("schedules.minutesInterval")}
                  </label>
                  <select
                    className="input"
                    value={minutesInterval}
                    onChange={(e) => setMinutesInterval(e.target.value)}
                  >
                    {["5", "10", "15", "30", "45"].map((v) => (
                      <option key={v} value={v}>
                        {t("schedules.everyNMinutes", { n: v })}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {frequency === "hourly" && (
                <div className="schedules-field">
                  <label className="schedules-field-label">
                    {t("schedules.hoursInterval")}
                  </label>
                  <select
                    className="input"
                    value={hourlyInterval}
                    onChange={(e) => setHourlyInterval(e.target.value)}
                  >
                    {["1", "2", "3", "4", "6", "8", "12"].map((v) => (
                      <option key={v} value={v}>
                        {t("schedules.everyNHours", { n: v })}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {frequency === "daily" && (
                <div className="schedules-field">
                  <label className="schedules-field-label">
                    {t("schedules.executionTime")}
                  </label>
                  <input
                    className="input"
                    type="time"
                    value={dailyTime}
                    onChange={(e) => setDailyTime(e.target.value)}
                  />
                </div>
              )}

              {frequency === "weekly" && (
                <>
                  <div className="schedules-field">
                    <label className="schedules-field-label">
                      {t("schedules.weekday")}
                    </label>
                    <select
                      className="input"
                      value={weeklyDay}
                      onChange={(e) => setWeeklyDay(e.target.value)}
                    >
                      {[
                        ["1", t("schedules.monday")],
                        ["2", t("schedules.tuesday")],
                        ["3", t("schedules.wednesday")],
                        ["4", t("schedules.thursday")],
                        ["5", t("schedules.friday")],
                        ["6", t("schedules.saturday")],
                        ["0", t("schedules.sunday")],
                      ].map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="schedules-field">
                    <label className="schedules-field-label">
                      {t("schedules.executionTime")}
                    </label>
                    <input
                      className="input"
                      type="time"
                      value={weeklyTime}
                      onChange={(e) => setWeeklyTime(e.target.value)}
                    />
                  </div>
                </>
              )}

              {frequency === "custom" && (
                <div className="schedules-field">
                  <label className="schedules-field-label">
                    {t("schedules.cronExpression")}
                  </label>
                  <input
                    className="input"
                    type="text"
                    placeholder={t("schedules.cronPlaceholder")}
                    value={customCron}
                    onChange={(e) => setCustomCron(e.target.value)}
                  />
                  <div className="schedules-field-hint">
                    {t("schedules.cronHint")}
                  </div>
                </div>
              )}
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("schedules.prompt")}
                </label>
                <textarea
                  className="input schedules-textarea"
                  placeholder={t("schedules.promptPlaceholder")}
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="schedules-field">
                <label className="schedules-field-label">执行智能体</label>
                <select
                  className="input"
                  aria-label="执行智能体"
                  value={newRuntimeId}
                  onChange={(e) => {
                    const runtime = runtimes.find(
                      (item) => item.id === e.target.value,
                    );
                    setNewRuntimeId(e.target.value);
                    if (
                      runtime &&
                      taskScheduleRuntimeCategory(runtime) === "web"
                    ) {
                      setNewWorkspace("");
                      setNewWorkspaceId("");
                      setNewMode("analysis");
                    }
                  }}
                >
                  <option value="">选择执行智能体</option>
                  {editingScheduleId &&
                    selectedRuntime &&
                    !isTaskScheduleRuntimeEligible(selectedRuntime) && (
                      <option value={selectedRuntime.id} disabled>
                        {selectedRuntime.name}（当前不可用）
                      </option>
                    )}
                  {runtimeGroups.map(
                    (group) =>
                      group.runtimes.length > 0 && (
                        <optgroup
                          key={group.category}
                          label={RUNTIME_CATEGORY_LABEL[group.category]}
                        >
                          {group.runtimes.map((runtime) => (
                            <option key={runtime.id} value={runtime.id}>
                              {runtime.name}（{runtime.kind}）
                            </option>
                          ))}
                        </optgroup>
                      ),
                  )}
                </select>
                <div className="schedules-field-hint">
                  支持已启用的本地 CLI、网页智能体和远程 Gateway
                  智能体；执行期间桌面应用需保持运行。
                </div>
              </div>
              {selectedRuntimeIsWeb ? (
                <div className="schedules-field-hint">
                  网页智能体使用独立浏览器登录态执行，仅支持对话分析，不访问项目文件夹。
                </div>
              ) : (
                <>
                  <div className="schedules-field">
                    <label className="schedules-field-label">
                      项目文件夹（可选）
                    </label>
                    <div className="schedules-workspace-row">
                      <input
                        className="input"
                        type="text"
                        placeholder="留空进行普通对话；需要读写文件时再选择"
                        value={newWorkspace}
                        onChange={(event) => {
                          setNewWorkspace(event.target.value);
                          setNewWorkspaceId("");
                        }}
                      />
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() => void chooseWorkspace()}
                      >
                        <Folder size={14} />
                        选择
                      </button>
                      {newWorkspace && (
                        <button
                          className="btn btn-secondary"
                          type="button"
                          onClick={() => {
                            setNewWorkspace("");
                            setNewWorkspaceId("");
                          }}
                        >
                          清除
                        </button>
                      )}
                    </div>
                    <div className="schedules-field-hint">
                      不再继承智能体配置中的工作区。“自动”可读写所选目录，但不能移动或删除文件。
                    </div>
                  </div>
                  <div className="schedules-field">
                    <label className="schedules-field-label">文件访问</label>
                    <select
                      className="input"
                      aria-label="文件访问"
                      value={newMode}
                      onChange={(event) =>
                        setNewMode(event.target.value as typeof newMode)
                      }
                    >
                      <option value="auto">
                        自动：可读写，无移动、删除文件权限
                      </option>
                      <option value="analysis">只读：仅允许读取所选项目</option>
                      <option value="full_access">
                        完全访问：可创建、编辑、移动或删除项目文件
                      </option>
                    </select>
                  </div>
                </>
              )}
              <div className="schedules-field">
                <label className="schedules-field-label">最长执行时长</label>
                <select
                  className="input"
                  aria-label="最长执行时长"
                  value={newTimeoutMs}
                  onChange={(event) => setNewTimeoutMs(event.target.value)}
                >
                  <option value="600000">10 分钟</option>
                  <option value="1800000">30 分钟</option>
                  <option value="3600000">1 小时</option>
                  <option value="7200000">2 小时（推荐）</option>
                  <option value="21600000">6 小时</option>
                  <option value="43200000">12 小时</option>
                  <option value="86400000">24 小时</option>
                </select>
                <div className="schedules-field-hint">
                  到达时限会自动停止；执行中的任务仍可从对话界面手动停止。
                </div>
              </div>
              <div className="schedules-field">
                <label className="schedules-field-label">并发策略</label>
                <select
                  className="input"
                  aria-label="并发策略"
                  value={newConcurrencyPolicy}
                  onChange={(e) =>
                    setNewConcurrencyPolicy(
                      e.target.value as TaskScheduleConcurrencyPolicy,
                    )
                  }
                >
                  <option value="skip">跳过：上一轮未结束时忽略本次</option>
                  <option value="queue">排队：上一轮结束后依次执行</option>
                  <option value="replace">替换：取消上一轮后执行本次</option>
                </select>
              </div>
            </div>
            <div className="schedules-modal-footer">
              <button className="btn btn-secondary" onClick={closeCreateModal}>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={
                  !isScheduleValid() ||
                  !newPrompt.trim() ||
                  !newRuntimeId ||
                  (newMode === "full_access" && !newWorkspace.trim()) ||
                  actionInProgress === "creating"
                }
              >
                {actionInProgress === "creating"
                  ? t("schedules.creating")
                  : editingScheduleId
                    ? "保存"
                    : t("schedules.create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="skills-detail-overlay"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="schedules-modal schedules-modal-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="schedules-modal-header">
              <h3>{t("schedules.deleteTaskTitle")}</h3>
              <button
                className="btn-ghost"
                onClick={() => setConfirmDelete(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="schedules-modal-body">
              <p className="schedules-confirm-text">
                {t("schedules.deleteConfirmText")}
              </p>
            </div>
            <div className="schedules-modal-footer">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmDelete(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => handleLocalRemove(confirmDelete)}
                disabled={actionInProgress === confirmDelete}
              >
                {actionInProgress === confirmDelete
                  ? t("schedules.deleting")
                  : t("schedules.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="schedules-header">
        <div>
          <h2 className="schedules-title">{t("schedules.title")}</h2>
          <p className="schedules-subtitle">{t("schedules.subtitle")}</p>
        </div>
        <div className="schedules-header-actions">
          <button className="btn btn-secondary" onClick={loadJobs}>
            <Refresh size={14} />
            {t("schedules.refresh")}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} />
            {t("schedules.newTask")}
          </button>
        </div>
      </div>

      {error && (
        <div className="skills-error">
          {error}
          <button className="btn-ghost" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="schedules-summary" aria-label="任务概览">
        <div className="schedules-summary-card">
          <div className="schedules-summary-icon schedules-summary-icon-total">
            <Clock size={18} />
          </div>
          <div>
            <span>全部任务</span>
            <strong>{scheduleCounts.total}</strong>
          </div>
        </div>
        <div className="schedules-summary-card">
          <div className="schedules-summary-icon schedules-summary-icon-enabled">
            <Check size={18} />
          </div>
          <div>
            <span>已启用</span>
            <strong>{scheduleCounts.enabled}</strong>
          </div>
        </div>
        <div className="schedules-summary-card">
          <div className="schedules-summary-icon schedules-summary-icon-paused">
            <Pause size={18} />
          </div>
          <div>
            <span>已暂停</span>
            <strong>{scheduleCounts.paused}</strong>
          </div>
        </div>
        <div className="schedules-summary-card">
          <div className="schedules-summary-icon schedules-summary-icon-attention">
            <Alert size={18} />
          </div>
          <div>
            <span>需关注</span>
            <strong>{scheduleCounts.attention}</strong>
          </div>
        </div>
      </div>

      <section className="schedules-source" aria-label="智能体定时任务">
        <div className="schedules-source-heading">
          <div>
            <h3>智能体任务</h3>
            <small>按状态和执行结果快速定位需要处理的任务</small>
          </div>
          <div className="schedules-tools">
            <label className="schedules-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="搜索任务名称、描述或智能体"
                aria-label="搜索定时任务"
              />
            </label>
            <select
              className="schedules-filter"
              value={scheduleFilter}
              onChange={(event) =>
                setScheduleFilter(event.target.value as ScheduleFilter)
              }
              aria-label="筛选任务状态"
            >
              <option value="all">全部状态</option>
              <option value="enabled">已启用</option>
              <option value="paused">已暂停</option>
              <option value="attention">需关注</option>
            </select>
          </div>
        </div>
        {schedules.length === 0 ? (
          <div className="schedules-empty">
            <div className="schedules-empty-icon">
              <Clock size={20} />
            </div>
            <p className="schedules-empty-text">还没有定时任务</p>
            <p className="schedules-empty-hint">
              新建任务后，所选智能体会在桌面应用运行期间按计划执行。
            </p>
          </div>
        ) : (
          <div className="schedules-table-wrap">
            <div
              className="schedules-table"
              role="table"
              aria-label="定时任务列表"
            >
              <div className="schedules-table-header" role="row">
                <span role="columnheader">任务信息</span>
                <span role="columnheader">调度计划</span>
                <span role="columnheader">执行智能体</span>
                <span role="columnheader">下次执行</span>
                <span role="columnheader">最近结果</span>
                <span role="columnheader">状态</span>
                <span role="columnheader">操作</span>
              </div>
              {visibleSchedules.map((schedule) => {
                const latest = schedule.runs.at(-1);
                const runtime = runtimes.find(
                  (item) => item.id === schedule.runtimeId,
                );
                const runtimeName = runtime?.name || schedule.runtimeId;
                const runtimeCategory = runtime
                  ? taskScheduleRuntimeCategory(runtime)
                  : null;
                const runtimeAvailable = runtime
                  ? isTaskScheduleRuntimeEligible(runtime)
                  : false;
                return (
                  <div
                    key={schedule.id}
                    className="schedules-table-row"
                    role="row"
                  >
                    <div className="schedules-task-cell" role="cell">
                      <div className="schedules-card-name">{schedule.name}</div>
                      <div className="schedules-task-prompt">
                        {schedule.prompt}
                      </div>
                    </div>
                    <div className="schedules-plan-cell" role="cell">
                      <span>{formatSchedule(schedule.schedule)}</span>
                    </div>
                    <div className="schedules-agent-cell" role="cell">
                      <ProfileAvatar
                        name={runtimeName}
                        color={runtime?.color}
                        avatar={runtime?.avatar}
                        defaultLogo={false}
                        size={32}
                        className="schedules-agent-avatar"
                      />
                      <div className="schedules-agent-copy">
                        <strong>{runtimeName}</strong>
                        {runtimeCategory && (
                          <span>{RUNTIME_CATEGORY_LABEL[runtimeCategory]}</span>
                        )}
                      </div>
                    </div>
                    <div className="schedules-time-cell" role="cell">
                      {formatTime(
                        schedule.nextRunAt
                          ? new Date(schedule.nextRunAt).toISOString()
                          : null,
                      )}
                      {schedule.activeRuntimeRunId && <span>正在执行</span>}
                      {schedule.pendingRuns > 0 && (
                        <span>等待 {schedule.pendingRuns} 次</span>
                      )}
                    </div>
                    <div className="schedules-result-cell" role="cell">
                      {latest ? (
                        <div
                          className={`schedules-result-row schedules-result-${latestResultClass(schedule)}`}
                          aria-label={`最近结果：${SCHEDULE_RUN_STATUS_LABEL[latest.status]}`}
                          title={latest.summary}
                        >
                          <span
                            className="schedules-result-icon"
                            aria-hidden="true"
                          >
                            {resultIcon(latest.status)}
                          </span>
                          <div>
                            <strong>
                              {SCHEDULE_RUN_STATUS_LABEL[latest.status]}
                            </strong>
                            <span>
                              {formatTime(
                                new Date(latest.triggeredAt).toISOString(),
                              )}
                            </span>
                            {formatRunDuration(latest) && (
                              <small>{formatRunDuration(latest)}</small>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="schedules-result-muted">
                          暂无执行记录
                        </span>
                      )}
                    </div>
                    <div className="schedules-state-cell" role="cell">
                      <span
                        className={`schedules-badge schedules-badge-${schedule.enabled ? "active" : "paused"}`}
                      >
                        {schedule.enabled ? "已启用" : "已暂停"}
                      </span>
                      {!runtimeAvailable && (
                        <span className="schedules-unavailable">
                          智能体不可用
                        </span>
                      )}
                    </div>
                    <div className="schedules-table-actions" role="cell">
                      <button
                        className="btn-ghost schedules-action-btn"
                        type="button"
                        title="编辑计划任务"
                        aria-label="编辑计划任务"
                        onClick={() => openEditModal(schedule)}
                        disabled={
                          Boolean(schedule.activeRuntimeRunId) ||
                          actionInProgress === schedule.id
                        }
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="btn-ghost schedules-action-btn"
                        type="button"
                        title={
                          schedule.enabled ? "暂停计划任务" : "继续计划任务"
                        }
                        aria-label={
                          schedule.enabled ? "暂停计划任务" : "继续计划任务"
                        }
                        onClick={() => void handleLocalToggle(schedule)}
                        disabled={
                          actionInProgress === schedule.id ||
                          (!schedule.enabled && !runtimeAvailable)
                        }
                      >
                        {schedule.enabled ? (
                          <Pause size={14} />
                        ) : (
                          <Play size={14} />
                        )}
                      </button>
                      <button
                        className="btn-ghost schedules-action-btn"
                        type="button"
                        title="立即执行计划任务"
                        aria-label="立即执行计划任务"
                        onClick={() => void handleLocalTrigger(schedule)}
                        disabled={
                          !schedule.enabled ||
                          !runtimeAvailable ||
                          actionInProgress === schedule.id
                        }
                      >
                        <Zap size={14} />
                      </button>
                      {latest?.conversationId && (
                        <button
                          className="btn-ghost schedules-action-btn"
                          type="button"
                          title="打开最近执行对话"
                          aria-label="打开最近执行对话"
                          onClick={() =>
                            handleOpenResult(latest.conversationId as string)
                          }
                        >
                          <ChatBubble size={14} />
                        </button>
                      )}
                      <button
                        className="btn-ghost schedules-action-btn schedules-action-danger"
                        type="button"
                        title="删除计划任务"
                        aria-label="删除计划任务"
                        onClick={() => setConfirmDelete(schedule.id)}
                        disabled={
                          Boolean(schedule.activeRuntimeRunId) ||
                          actionInProgress === schedule.id
                        }
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {visibleSchedules.length === 0 && (
                <div className="schedules-no-results">
                  没有符合当前搜索或筛选条件的任务
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default Schedules;
