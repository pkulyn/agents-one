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

const SCHEDULE_RUN_STATUS_KEY: Record<TaskScheduleRunStatus, string> = {
  queued: "schedules.statusQueued",
  running: "schedules.statusRunning",
  succeeded: "schedules.statusSucceeded",
  failed: "schedules.statusFailed",
  cancelled: "schedules.statusCancelled",
  timed_out: "schedules.statusTimedOut",
  skipped: "schedules.statusSkipped",
};

const RUNTIME_CATEGORY_KEY: Record<TaskScheduleRuntimeCategory, string> = {
  local: "schedules.categoryLocal",
  web: "schedules.categoryWeb",
  remote: "schedules.categoryRemote",
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

  const resetForm = useCallback((): void => {
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
  }, []);

  const closeCreateModal = useCallback((): void => {
    setShowCreate(false);
    setEditingScheduleId(null);
    resetForm();
  }, [resetForm]);

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
  }, [showCreate, editingScheduleId, confirmDelete, closeCreateModal]);

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
      setError(t("schedules.selectRuntimeRequired"));
      return;
    }
    const webRuntime = taskScheduleRuntimeCategory(runtime) === "web";
    setActionInProgress("creating");
    setError("");
    try {
      const input = {
        name: newName.trim() || t("schedules.unnamedTask"),
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
      setError(
        error instanceof Error ? error.message : t("schedules.saveFailed"),
      );
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
      setError(
        error instanceof Error ? error.message : t("schedules.updateFailed"),
      );
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
      setError(
        error instanceof Error ? error.message : t("schedules.triggerFailed"),
      );
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
      setError(
        error instanceof Error ? error.message : t("schedules.deleteFailed"),
      );
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
    if (interval) {
      return t("schedules.everyInterval", {
        count: interval[1],
        unit: t(
          interval[2].toLowerCase() === "h"
            ? "schedules.unitHour"
            : "schedules.unitMinute",
        ),
      });
    }
    const parts = value.trim().split(/\s+/);
    if (parts.length !== 5) return t("schedules.customSchedule");
    const [minute, hour, day, month, weekday] = parts;
    const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    if (day === "*" && month === "*" && weekday === "*") {
      return t("schedules.dailyAt", { time });
    }
    if (day === "*" && month === "*") {
      const weekdayLabel: Record<string, string> = {
        "0": t("schedules.sunday"),
        "1": t("schedules.monday"),
        "2": t("schedules.tuesday"),
        "3": t("schedules.wednesday"),
        "4": t("schedules.thursday"),
        "5": t("schedules.friday"),
        "6": t("schedules.saturday"),
        "1-5": t("schedules.workdays"),
        "0,6": t("schedules.weekend"),
        "6,0": t("schedules.weekend"),
      };
      const label =
        weekdayLabel[weekday] ||
        (/^[0-6](,[0-6])+$/.test(weekday)
          ? weekday
              .split(",")
              .map((value) => weekdayLabel[value])
              .join(t("schedules.weekdayListSeparator"))
          : "");
      if (label) return t("schedules.weeklyAt", { day: label, time });
    }
    if (/^\d+$/.test(day) && month === "*" && weekday === "*") {
      return t("schedules.monthlyAt", { day, time });
    }
    if (/^\d+$/.test(day) && /^\d+$/.test(month) && weekday === "*") {
      return t("schedules.yearlyAt", { month, day, time });
    }
    return t("schedules.customSchedule");
  }

  function formatRunDuration(run: TaskScheduleRun): string | null {
    if (!run.completedAt || run.completedAt < run.triggeredAt) return null;
    const seconds = (run.completedAt - run.triggeredAt) / 1000;
    if (seconds < 1) return t("schedules.durationUnderSecond");
    if (seconds < 60) {
      return t("schedules.durationSeconds", {
        seconds: seconds.toFixed(seconds < 10 ? 1 : 0),
      });
    }
    const minutes = Math.floor(seconds / 60);
    return t("schedules.durationMinutesSeconds", {
      minutes,
      seconds: Math.round(seconds % 60),
    });
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
                {editingScheduleId
                  ? t("schedules.editTask")
                  : t("schedules.newTask")}
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
                <label className="schedules-field-label">
                  {t("schedules.runtime")}
                </label>
                <select
                  className="input"
                  aria-label={t("schedules.runtime")}
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
                  <option value="">{t("schedules.selectRuntime")}</option>
                  {editingScheduleId &&
                    selectedRuntime &&
                    !isTaskScheduleRuntimeEligible(selectedRuntime) && (
                      <option value={selectedRuntime.id} disabled>
                        {t("schedules.runtimeUnavailableOption", {
                          name: selectedRuntime.name,
                        })}
                      </option>
                    )}
                  {runtimeGroups.map(
                    (group) =>
                      group.runtimes.length > 0 && (
                        <optgroup
                          key={group.category}
                          label={t(RUNTIME_CATEGORY_KEY[group.category])}
                        >
                          {group.runtimes.map((runtime) => (
                            <option key={runtime.id} value={runtime.id}>
                              {t("schedules.runtimeOption", {
                                name: runtime.name,
                                kind: runtime.kind,
                              })}
                            </option>
                          ))}
                        </optgroup>
                      ),
                  )}
                </select>
                <div className="schedules-field-hint">
                  {t("schedules.runtimeHint")}
                </div>
              </div>
              {selectedRuntimeIsWeb ? (
                <div className="schedules-field-hint">
                  {t("schedules.webRuntimeHint")}
                </div>
              ) : (
                <>
                  <div className="schedules-field">
                    <label className="schedules-field-label">
                      {t("schedules.projectFolderOptional")}
                    </label>
                    <div className="schedules-workspace-row">
                      <input
                        className="input"
                        type="text"
                        placeholder={t("schedules.workspacePlaceholder")}
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
                        {t("schedules.choose")}
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
                          {t("schedules.clear")}
                        </button>
                      )}
                    </div>
                    <div className="schedules-field-hint">
                      {t("schedules.workspaceHint")}
                    </div>
                  </div>
                  <div className="schedules-field">
                    <label className="schedules-field-label">
                      {t("schedules.fileAccess")}
                    </label>
                    <select
                      className="input"
                      aria-label={t("schedules.fileAccess")}
                      value={newMode}
                      onChange={(event) =>
                        setNewMode(event.target.value as typeof newMode)
                      }
                    >
                      <option value="auto">{t("schedules.modeAuto")}</option>
                      <option value="analysis">
                        {t("schedules.modeAnalysis")}
                      </option>
                      <option value="full_access">
                        {t("schedules.modeFullAccess")}
                      </option>
                    </select>
                  </div>
                </>
              )}
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("schedules.timeout")}
                </label>
                <select
                  className="input"
                  aria-label={t("schedules.timeout")}
                  value={newTimeoutMs}
                  onChange={(event) => setNewTimeoutMs(event.target.value)}
                >
                  <option value="600000">{t("schedules.timeout10m")}</option>
                  <option value="1800000">{t("schedules.timeout30m")}</option>
                  <option value="3600000">{t("schedules.timeout1h")}</option>
                  <option value="7200000">
                    {t("schedules.timeout2hRecommended")}
                  </option>
                  <option value="21600000">{t("schedules.timeout6h")}</option>
                  <option value="43200000">{t("schedules.timeout12h")}</option>
                  <option value="86400000">{t("schedules.timeout24h")}</option>
                </select>
                <div className="schedules-field-hint">
                  {t("schedules.timeoutHint")}
                </div>
              </div>
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("schedules.concurrency")}
                </label>
                <select
                  className="input"
                  aria-label={t("schedules.concurrency")}
                  value={newConcurrencyPolicy}
                  onChange={(e) =>
                    setNewConcurrencyPolicy(
                      e.target.value as TaskScheduleConcurrencyPolicy,
                    )
                  }
                >
                  <option value="skip">{t("schedules.concurrencySkip")}</option>
                  <option value="queue">
                    {t("schedules.concurrencyQueue")}
                  </option>
                  <option value="replace">
                    {t("schedules.concurrencyReplace")}
                  </option>
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
                    ? t("schedules.save")
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

      <div
        className="schedules-summary"
        aria-label={t("schedules.summaryLabel")}
      >
        <div className="schedules-summary-card">
          <div className="schedules-summary-icon schedules-summary-icon-total">
            <Clock size={18} />
          </div>
          <div>
            <span>{t("schedules.allTasks")}</span>
            <strong>{scheduleCounts.total}</strong>
          </div>
        </div>
        <div className="schedules-summary-card">
          <div className="schedules-summary-icon schedules-summary-icon-enabled">
            <Check size={18} />
          </div>
          <div>
            <span>{t("schedules.enabled")}</span>
            <strong>{scheduleCounts.enabled}</strong>
          </div>
        </div>
        <div className="schedules-summary-card">
          <div className="schedules-summary-icon schedules-summary-icon-paused">
            <Pause size={18} />
          </div>
          <div>
            <span>{t("schedules.paused")}</span>
            <strong>{scheduleCounts.paused}</strong>
          </div>
        </div>
        <div className="schedules-summary-card">
          <div className="schedules-summary-icon schedules-summary-icon-attention">
            <Alert size={18} />
          </div>
          <div>
            <span>{t("schedules.attention")}</span>
            <strong>{scheduleCounts.attention}</strong>
          </div>
        </div>
      </div>

      <section
        className="schedules-source"
        aria-label={t("schedules.sourceLabel")}
      >
        <div className="schedules-source-heading">
          <div>
            <h3>{t("schedules.sourceTitle")}</h3>
            <small>{t("schedules.sourceSubtitle")}</small>
          </div>
          <div className="schedules-tools">
            <label className="schedules-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={t("schedules.searchPlaceholder")}
                aria-label={t("schedules.searchLabel")}
              />
            </label>
            <select
              className="schedules-filter"
              value={scheduleFilter}
              onChange={(event) =>
                setScheduleFilter(event.target.value as ScheduleFilter)
              }
              aria-label={t("schedules.filterLabel")}
            >
              <option value="all">{t("schedules.filterAll")}</option>
              <option value="enabled">{t("schedules.enabled")}</option>
              <option value="paused">{t("schedules.paused")}</option>
              <option value="attention">{t("schedules.attention")}</option>
            </select>
          </div>
        </div>
        {schedules.length === 0 ? (
          <div className="schedules-empty">
            <div className="schedules-empty-icon">
              <Clock size={20} />
            </div>
            <p className="schedules-empty-text">{t("schedules.empty")}</p>
            <p className="schedules-empty-hint">
              {t("schedules.emptyRunningHint")}
            </p>
          </div>
        ) : (
          <div className="schedules-table-wrap">
            <div
              className="schedules-table"
              role="table"
              aria-label={t("schedules.listLabel")}
            >
              <div className="schedules-table-header" role="row">
                <span role="columnheader">{t("schedules.columnTask")}</span>
                <span role="columnheader">{t("schedules.columnSchedule")}</span>
                <span role="columnheader">{t("schedules.columnRuntime")}</span>
                <span role="columnheader">{t("schedules.columnNext")}</span>
                <span role="columnheader">{t("schedules.columnLatest")}</span>
                <span role="columnheader">{t("schedules.columnStatus")}</span>
                <span role="columnheader">{t("schedules.columnActions")}</span>
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
                          <span>
                            {t(RUNTIME_CATEGORY_KEY[runtimeCategory])}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="schedules-time-cell" role="cell">
                      {formatTime(
                        schedule.nextRunAt
                          ? new Date(schedule.nextRunAt).toISOString()
                          : null,
                      )}
                      {schedule.activeRuntimeRunId && (
                        <span>{t("schedules.currentlyRunning")}</span>
                      )}
                      {schedule.pendingRuns > 0 && (
                        <span>
                          {t("schedules.queuedCount", {
                            count: schedule.pendingRuns,
                          })}
                        </span>
                      )}
                    </div>
                    <div className="schedules-result-cell" role="cell">
                      {latest ? (
                        <div
                          className={`schedules-result-row schedules-result-${latestResultClass(schedule)}`}
                          aria-label={t("schedules.recentResult", {
                            status: t(SCHEDULE_RUN_STATUS_KEY[latest.status]),
                          })}
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
                              {t(SCHEDULE_RUN_STATUS_KEY[latest.status])}
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
                          {t("schedules.noRunHistory")}
                        </span>
                      )}
                    </div>
                    <div className="schedules-state-cell" role="cell">
                      <span
                        className={`schedules-badge schedules-badge-${schedule.enabled ? "active" : "paused"}`}
                      >
                        {schedule.enabled
                          ? t("schedules.enabled")
                          : t("schedules.paused")}
                      </span>
                      {!runtimeAvailable && (
                        <span className="schedules-unavailable">
                          {t("schedules.runtimeUnavailable")}
                        </span>
                      )}
                    </div>
                    <div className="schedules-table-actions" role="cell">
                      <button
                        className="btn-ghost schedules-action-btn"
                        type="button"
                        title={t("schedules.editAction")}
                        aria-label={t("schedules.editAction")}
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
                          schedule.enabled
                            ? t("schedules.pauseAction")
                            : t("schedules.resumeAction")
                        }
                        aria-label={
                          schedule.enabled
                            ? t("schedules.pauseAction")
                            : t("schedules.resumeAction")
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
                        title={t("schedules.runNowAction")}
                        aria-label={t("schedules.runNowAction")}
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
                          title={t("schedules.openRecentAction")}
                          aria-label={t("schedules.openRecentAction")}
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
                        title={t("schedules.deleteAction")}
                        aria-label={t("schedules.deleteAction")}
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
                  {t("schedules.noMatches")}
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
