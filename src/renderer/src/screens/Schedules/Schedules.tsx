import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash,
  Refresh,
  X,
  Play,
  Pause,
  Zap,
  Alert,
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type {
  TaskSchedule,
  TaskScheduleConcurrencyPolicy,
  TaskScheduleRunStatus,
} from "../../../../shared/task-schedules";

const DELIVER_TARGETS = [
  { value: "local", label: "Local" },
  { value: "origin", label: "Origin" },
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
  { value: "slack", label: "Slack" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "signal", label: "Signal" },
  { value: "matrix", label: "Matrix" },
  { value: "mattermost", label: "Mattermost" },
  { value: "email", label: "Email" },
  { value: "webhook", label: "Webhook" },
  { value: "sms", label: "SMS" },
  { value: "homeassistant", label: "Home Assistant" },
  { value: "dingtalk", label: "DingTalk" },
  { value: "feishu", label: "Feishu" },
  { value: "wecom", label: "WeCom" },
];

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  state: "active" | "paused" | "completed";
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  repeat: { times: number | null; completed: number } | null;
  deliver: string[];
  skills: string[];
  script: string | null;
}

type FrequencyType = "minutes" | "hourly" | "daily" | "weekly" | "custom";
type ScheduleTarget = "agents-one" | "hermes-cron";

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
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [localSchedules, setLocalSchedules] = useState<TaskSchedule[]>([]);
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget>("agents-one");

  // Create form state
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newDeliver, setNewDeliver] = useState("local");
  const [newRuntimeId, setNewRuntimeId] = useState("");
  const [newMode, setNewMode] = useState<"analysis" | "implementation">("analysis");
  const [newConcurrencyPolicy, setNewConcurrencyPolicy] = useState<TaskScheduleConcurrencyPolicy>("skip");

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
      const [legacyJobs, schedules, availableRuntimes] = await Promise.all([
        window.hermesAPI.listCronJobs(true, profile),
        window.hermesAPI.listTaskSchedules(profile),
        window.hermesAPI.listAgentRuntimes(),
      ]);
      setJobs(legacyJobs);
      setLocalSchedules(schedules);
      setRuntimes(availableRuntimes.filter((runtime) => runtime.enabled));
      setNewRuntimeId((current) => current || availableRuntimes.find((runtime) => runtime.enabled)?.id || "");
    } catch {
      setError(t("schedules.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Escape key to close modals
  useEffect(() => {
    if (!showCreate && !confirmDelete) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        if (confirmDelete) setConfirmDelete(null);
        else if (showCreate) setShowCreate(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showCreate, confirmDelete]);

  function resetForm(): void {
    setNewName("");
    setNewPrompt("");
    setNewDeliver("local");
    setNewMode("analysis");
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
    resetForm();
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

  async function handleCreate(): Promise<void> {
    if (!isScheduleValid()) return;
    setActionInProgress("creating");
    setError("");
    try {
      if (scheduleTarget === "agents-one") {
        await window.hermesAPI.createTaskSchedule({
          name: newName.trim() || "未命名计划任务",
          schedule: buildSchedule(),
          prompt: newPrompt.trim(),
          runtimeId: newRuntimeId,
          mode: newMode,
          concurrencyPolicy: newConcurrencyPolicy,
        }, profile);
        closeCreateModal();
        await loadJobs();
      } else {
        const result = await window.hermesAPI.createCronJob(
          buildSchedule(),
          newPrompt.trim() || undefined,
          newName.trim() || undefined,
          newDeliver !== "local" ? newDeliver : undefined,
          profile,
        );
        if (result.success) {
          closeCreateModal();
          await loadJobs();
        } else {
          setError(result.error || "Failed to create job");
        }
      }
    } catch {
      setError("Failed to create job");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleRemove(jobId: string): Promise<void> {
    setActionInProgress(jobId);
    setError("");
    try {
      const result = await window.hermesAPI.removeCronJob(jobId, profile);
      setConfirmDelete(null);
      if (result.success) {
        await loadJobs();
      } else {
        setError(result.error || "Failed to remove job");
      }
    } catch {
      setError("Failed to remove job");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleToggle(job: CronJob): Promise<void> {
    setActionInProgress(job.id);
    setError("");
    try {
      const result =
        job.state === "paused"
          ? await window.hermesAPI.resumeCronJob(job.id, profile)
          : await window.hermesAPI.pauseCronJob(job.id, profile);
      if (result.success) {
        await loadJobs();
      } else {
        setError(result.error || "Failed to update job");
      }
    } catch {
      setError("Failed to update job");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleTrigger(jobId: string): Promise<void> {
    setActionInProgress(jobId);
    setError("");
    try {
      const result = await window.hermesAPI.triggerCronJob(jobId, profile);
      if (result.success) {
        await loadJobs();
      } else {
        setError(result.error || "Failed to trigger job");
      }
    } catch {
      setError("Failed to trigger job");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleLocalToggle(schedule: TaskSchedule): Promise<void> {
    setActionInProgress(schedule.id);
    setError("");
    try {
      await window.hermesAPI.setTaskScheduleEnabled(schedule.id, !schedule.enabled, profile);
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

  async function handleLocalRemove(schedule: TaskSchedule): Promise<void> {
    setActionInProgress(schedule.id);
    setError("");
    try {
      await window.hermesAPI.deleteTaskSchedule(schedule.id, profile);
      await loadJobs();
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法删除计划任务");
    } finally {
      setActionInProgress(null);
    }
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
      {showCreate && (
        <div className="skills-detail-overlay" onClick={closeCreateModal}>
          <div className="schedules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="schedules-modal-header">
              <h3>{t("schedules.newTask")}</h3>
              <button className="btn-ghost" onClick={closeCreateModal}>
                <X size={18} />
              </button>
            </div>
            <div className="schedules-modal-body">
              <div className="schedules-field">
                <label className="schedules-field-label">执行位置</label>
                <div className="schedules-freq-pills">
                  <button type="button" className={`schedules-freq-pill ${scheduleTarget === "agents-one" ? "active" : ""}`} onClick={() => setScheduleTarget("agents-one")}>本地智能体</button>
                  <button type="button" className={`schedules-freq-pill ${scheduleTarget === "hermes-cron" ? "active" : ""}`} onClick={() => setScheduleTarget("hermes-cron")}>远程 Hermes</button>
                </div>
                <div className="schedules-field-hint">本地智能体可选择任意已接入的运行器，但桌面应用需保持运行；远程 Hermes 规则由服务端执行。</div>
              </div>
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
              {scheduleTarget === "agents-one" ? <>
                <div className="schedules-field">
                  <label className="schedules-field-label">执行智能体</label>
                  <select className="input" value={newRuntimeId} onChange={(e) => setNewRuntimeId(e.target.value)}>
                    <option value="">选择智能体</option>
                    {runtimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}（{runtime.kind}）</option>)}
                  </select>
                </div>
                <div className="schedules-field">
                  <label className="schedules-field-label">执行方式</label>
                  <select className="input" value={newMode} onChange={(e) => setNewMode(e.target.value as "analysis" | "implementation")}>
                    <option value="analysis">分析</option>
                    <option value="implementation">实现（仅 Codex / Claude Code）</option>
                  </select>
                </div>
                <div className="schedules-field">
                  <label className="schedules-field-label">并发策略</label>
                  <select className="input" value={newConcurrencyPolicy} onChange={(e) => setNewConcurrencyPolicy(e.target.value as TaskScheduleConcurrencyPolicy)}>
                    <option value="skip">跳过：上一轮未结束时忽略本次</option>
                    <option value="queue">排队：上一轮结束后依次执行</option>
                    <option value="replace">替换：取消上一轮后执行本次</option>
                  </select>
                </div>
              </> : <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("schedules.deliverTo")}
                </label>
                <select
                  className="input"
                  value={newDeliver}
                  onChange={(e) => setNewDeliver(e.target.value)}
                >
                  {DELIVER_TARGETS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <div className="schedules-field-hint">
                  {t("schedules.deliverHint")}
                </div>
              </div>}
            </div>
            <div className="schedules-modal-footer">
              <button className="btn btn-secondary" onClick={closeCreateModal}>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!isScheduleValid() || !newPrompt.trim() || (scheduleTarget === "agents-one" && !newRuntimeId) || actionInProgress === "creating"}
              >
                {actionInProgress === "creating"
                  ? t("schedules.creating")
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
                onClick={() => handleRemove(confirmDelete)}
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

      <section className="schedules-source" aria-label="本地智能体定时任务">
        <div className="schedules-source-heading"><h3>本地智能体定时任务</h3><small>保留每轮执行记录和关联产物</small></div>
        {localSchedules.length === 0 ? <p className="schedules-source-empty">暂无本地计划任务。</p> : <div className="schedules-list">
          {localSchedules.map((schedule) => {
            const latest = schedule.runs.at(-1);
            return <div key={schedule.id} className="schedules-card">
              <div className="schedules-card-top">
                <div className="schedules-card-info"><div className="schedules-card-name">{schedule.name}</div><div className="schedules-card-schedule">{schedule.schedule} | {schedule.runtimeId} | {schedule.mode === "implementation" ? "实现" : "分析"}</div></div>
                <div className="schedules-card-actions">
                  <span className={`schedules-badge schedules-badge-${schedule.enabled ? "active" : "paused"}`}>{schedule.enabled ? "已启用" : "已暂停"}</span>
                  <button className="btn-ghost schedules-action-btn" type="button" title={schedule.enabled ? "暂停计划任务" : "继续计划任务"} aria-label={schedule.enabled ? "暂停计划任务" : "继续计划任务"} onClick={() => void handleLocalToggle(schedule)} disabled={actionInProgress === schedule.id}>{schedule.enabled ? <Pause size={14} /> : <Play size={14} />}</button>
                  <button className="btn-ghost schedules-action-btn" type="button" title="立即执行计划任务" aria-label="立即执行计划任务" onClick={() => void handleLocalTrigger(schedule)} disabled={!schedule.enabled || actionInProgress === schedule.id}><Zap size={14} /></button>
                  <button className="btn-ghost schedules-action-btn schedules-action-danger" type="button" title="删除计划任务" aria-label="删除计划任务" onClick={() => void handleLocalRemove(schedule)} disabled={Boolean(schedule.activeTaskCenterTaskId) || actionInProgress === schedule.id}><Trash size={14} /></button>
                </div>
              </div>
              <div className="schedules-card-prompt">{schedule.prompt}</div>
              <div className="schedules-card-meta"><span>并发：{schedule.concurrencyPolicy === "skip" ? "跳过" : schedule.concurrencyPolicy === "queue" ? "排队" : "替换"}</span><span>下次：{formatTime(schedule.nextRunAt ? new Date(schedule.nextRunAt).toISOString() : null)}</span>{schedule.activeTaskCenterTaskId && <span>当前运行：{schedule.activeTaskCenterTaskId}</span>}{schedule.pendingRuns > 0 && <span>等待：{schedule.pendingRuns}</span>}{latest && <span>最近：{SCHEDULE_RUN_STATUS_LABEL[latest.status]}</span>}</div>
            </div>;
          })}
        </div>}
      </section>

      <section className="schedules-source" aria-label="远程 Hermes 定时任务">
        <div className="schedules-source-heading"><h3>远程 Hermes 定时任务</h3><small>兼容已有远端规则，由 Hermes 服务端执行</small></div>
      {jobs.length === 0 ? (
        <div className="schedules-empty">
          <p className="schedules-empty-text">暂无远程 Hermes 定时任务</p>
          <p className="schedules-empty-hint">已有远端规则会继续保留在此处。</p>
        </div>
      ) : (
        <div className="schedules-list">
          {jobs.map((job) => (
            <div key={job.id} className="schedules-card">
              <div className="schedules-card-top">
                <div className="schedules-card-info">
                  <div className="schedules-card-name">{job.name}</div>
                  <div className="schedules-card-schedule">{job.schedule}</div>
                </div>
                <div className="schedules-card-actions">
                  <span
                    className={`schedules-badge schedules-badge-${job.state}`}
                  >
                    {job.state === "active"
                      ? t("schedules.active")
                      : job.state === "paused"
                        ? t("schedules.paused")
                        : t("schedules.completed")}
                  </span>
                  {job.state !== "completed" && (
                    <button
                      className="btn-ghost schedules-action-btn"
                      data-tooltip={
                        job.state === "paused"
                          ? t("schedules.resume")
                          : t("schedules.pause")
                      }
                      onClick={() => handleToggle(job)}
                      disabled={actionInProgress === job.id}
                    >
                      {job.state === "paused" ? (
                        <Play size={14} />
                      ) : (
                        <Pause size={14} />
                      )}
                    </button>
                  )}
                  {job.state === "active" && (
                    <button
                      className="btn-ghost schedules-action-btn"
                      data-tooltip={t("schedules.triggerNow")}
                      onClick={() => handleTrigger(job.id)}
                      disabled={actionInProgress === job.id}
                    >
                      <Zap size={14} />
                    </button>
                  )}
                  <button
                    className="btn-ghost schedules-action-btn schedules-action-danger"
                    data-tooltip={t("schedules.delete")}
                    onClick={() => setConfirmDelete(job.id)}
                    disabled={actionInProgress === job.id}
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </div>

              {job.prompt && (
                <div className="schedules-card-prompt">{job.prompt}</div>
              )}

              <div className="schedules-card-meta">
                <span>
                  {t("schedules.nextRun")}: {formatTime(job.next_run_at)}
                </span>
                {job.last_run_at && (
                  <span>
                    {t("schedules.lastRun")}: {formatTime(job.last_run_at)}
                    {job.last_status && job.last_status !== "ok" && (
                      <span className="schedules-card-error-icon">
                        <Alert size={12} />
                      </span>
                    )}
                  </span>
                )}
                {job.repeat && job.repeat.times && (
                  <span>
                    {t("schedules.runCount")}: {job.repeat.completed}/
                    {job.repeat.times}
                  </span>
                )}
                {job.deliver.length > 0 &&
                  !(job.deliver.length === 1 && job.deliver[0] === "local") && (
                    <span>
                      {t("schedules.deliveredTo")}: {job.deliver.join(", ")}
                    </span>
                  )}
                {job.skills.length > 0 && (
                  <span>
                    {t("schedules.skills")}: {job.skills.join(", ")}
                  </span>
                )}
              </div>

              {job.last_error && (
                <div className="schedules-card-error">{job.last_error}</div>
              )}
            </div>
          ))}
        </div>
      )}
      </section>
    </div>
  );
}

export default Schedules;
