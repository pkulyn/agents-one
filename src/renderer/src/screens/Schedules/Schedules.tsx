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
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type {
  TaskSchedule,
  TaskScheduleConcurrencyPolicy,
  TaskScheduleRunStatus,
} from "../../../../shared/task-schedules";

type FrequencyType = "minutes" | "hourly" | "daily" | "weekly" | "custom";

const SCHEDULE_RUN_STATUS_LABEL: Record<TaskScheduleRunStatus, string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  timed_out: "已超时",
  skipped: "已跳过",
};

interface SchedulesProps {
  profile?: string;
}

function Schedules({ profile }: SchedulesProps): React.JSX.Element {
  const { t } = useI18n();
  const [localSchedules, setLocalSchedules] = useState<TaskSchedule[]>([]);
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newRuntimeId, setNewRuntimeId] = useState("");
  const [newWorkspace, setNewWorkspace] = useState("");
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
      const [schedules, availableRuntimes] = await Promise.all([
        window.hermesAPI.listTaskSchedules(profile),
        window.hermesAPI.listAgentRuntimes(),
      ]);
      const localCliRuntimes = availableRuntimes.filter(
        (runtime) =>
          runtime.enabled &&
          runtime.location === "local" &&
          runtime.config.transport === "cli",
      );
      const localRuntimeIds = new Set(
        localCliRuntimes.map((runtime) => runtime.id),
      );
      setLocalSchedules(
        schedules.filter((schedule) => localRuntimeIds.has(schedule.runtimeId)),
      );
      setRuntimes(localCliRuntimes);
      setNewRuntimeId((current) =>
        localRuntimeIds.has(current) ? current : localCliRuntimes[0]?.id || "",
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
    const disposeStarted = window.hermesAPI.onTaskScheduleRunStarted?.(
      (event) => {
        if (event.profile === (profile || "default")) refresh();
      },
    );
    const dispose = window.hermesAPI.onTaskScheduleRunCompleted?.((event) => {
      if (event.profile === (profile || "default")) refresh();
    });
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
    setEditingScheduleId(schedule.id);
    setNewName(schedule.name);
    setNewPrompt(schedule.prompt);
    setNewRuntimeId(schedule.runtimeId);
    setNewWorkspace(schedule.workspace || "");
    setNewMode(
      schedule.mode === "full_access" || schedule.mode === "analysis"
        ? schedule.mode
        : "auto",
    );
    setNewConcurrencyPolicy(schedule.concurrencyPolicy);
    applyScheduleValue(schedule.schedule);
  }

  async function chooseWorkspace(): Promise<void> {
    const selected = await window.hermesAPI.selectFolder();
    if (selected) setNewWorkspace(selected);
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
    setActionInProgress("creating");
    setError("");
    try {
      const input = {
        name: newName.trim() || "未命名计划任务",
        schedule: buildSchedule(),
        prompt: newPrompt.trim(),
        runtimeId: newRuntimeId,
        workspace: newWorkspace.trim() || undefined,
        mode: newMode,
        concurrencyPolicy: newConcurrencyPolicy,
      };
      if (editingScheduleId) {
        await window.hermesAPI.updateTaskSchedule(
          editingScheduleId,
          input,
          profile,
        );
      } else {
        await window.hermesAPI.createTaskSchedule(input, profile);
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
      await window.hermesAPI.setTaskScheduleEnabled(
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
      await window.hermesAPI.triggerTaskSchedule(schedule.id, profile);
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
      await window.hermesAPI.deleteTaskSchedule(scheduleId, profile);
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
    if (parts.length !== 5) return value;
    const [minute, hour, day, month, weekday] = parts;
    if (day === "*" && month === "*" && weekday === "*") {
      return `每天 ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    }
    return `Cron · ${value}`;
  }

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
                  onChange={(e) => setNewRuntimeId(e.target.value)}
                >
                  <option value="">选择本地 CLI 智能体</option>
                  {runtimes.map((runtime) => (
                    <option key={runtime.id} value={runtime.id}>
                      {runtime.name}（{runtime.kind}）
                    </option>
                  ))}
                </select>
                <div className="schedules-field-hint">
                  仅显示已启用的本地 CLI 智能体；执行期间桌面应用需保持运行。
                </div>
              </div>
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
                    onChange={(event) => setNewWorkspace(event.target.value)}
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
                      onClick={() => setNewWorkspace("")}
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

      <section className="schedules-source" aria-label="本地 CLI 定时任务">
        <div className="schedules-source-heading">
          <div>
            <h3>本地 CLI 任务</h3>
            <small>仅使用已启用的本地 CLI 智能体，保留每轮执行记录</small>
          </div>
          <span className="schedules-count">{localSchedules.length} 条</span>
        </div>
        {localSchedules.length === 0 ? (
          <div className="schedules-empty">
            <div className="schedules-empty-icon">
              <Clock size={20} />
            </div>
            <p className="schedules-empty-text">还没有本地定时任务</p>
            <p className="schedules-empty-hint">
              新建任务后，本地 CLI 智能体会在桌面应用运行期间按计划执行。
            </p>
          </div>
        ) : (
          <div className="schedules-list">
            {localSchedules.map((schedule) => {
              const latest = schedule.runs.at(-1);
              const runtimeName =
                runtimes.find((runtime) => runtime.id === schedule.runtimeId)
                  ?.name || schedule.runtimeId;
              return (
                <div key={schedule.id} className="schedules-card">
                  <div className="schedules-card-top">
                    <div className="schedules-card-info">
                      <div className="schedules-card-name">{schedule.name}</div>
                      <div className="schedules-card-schedule">
                        <Clock size={13} />
                        {formatSchedule(schedule.schedule)}
                        <span aria-hidden="true">·</span>
                        {runtimeName}
                      </div>
                    </div>
                    <div className="schedules-card-actions">
                      <span
                        className={`schedules-badge schedules-badge-${schedule.enabled ? "active" : "paused"}`}
                      >
                        {schedule.enabled ? "已启用" : "已暂停"}
                      </span>
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
                        disabled={actionInProgress === schedule.id}
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
                          !schedule.enabled || actionInProgress === schedule.id
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
                  <div className="schedules-card-prompt">{schedule.prompt}</div>
                  {latest?.summary && (
                    <div className="schedules-card-result">
                      {latest.summary}
                    </div>
                  )}
                  <div className="schedules-card-meta">
                    <span>
                      下次执行：
                      {formatTime(
                        schedule.nextRunAt
                          ? new Date(schedule.nextRunAt).toISOString()
                          : null,
                      )}
                    </span>
                    <span>
                      并发：
                      {schedule.concurrencyPolicy === "skip"
                        ? "跳过"
                        : schedule.concurrencyPolicy === "queue"
                          ? "排队"
                          : "替换"}
                    </span>
                    {schedule.activeRuntimeRunId && <span>正在执行</span>}
                    {schedule.pendingRuns > 0 && (
                      <span>等待 {schedule.pendingRuns} 次</span>
                    )}
                    {latest && (
                      <span>
                        最近结果：{SCHEDULE_RUN_STATUS_LABEL[latest.status]}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default Schedules;
