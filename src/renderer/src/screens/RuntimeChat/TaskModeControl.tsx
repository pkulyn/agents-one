import { useState } from "react";
import { Check, ChevronDown, X } from "../../assets/icons";
import { ListTodo, Workflow } from "lucide-react";
import { useI18n } from "../../components/useI18n";

export function TaskModeControl({
  collaborative,
  count,
  busy,
  runtimeId,
  runtimes,
  onConfigure,
  onSingle,
}: {
  collaborative: boolean;
  count: number;
  busy: boolean;
  runtimeId: string;
  runtimes: Array<{ id: string; name: string }>;
  onConfigure?: () => void;
  onSingle?: (runtimeId: string) => Promise<void>;
}): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false),
    [confirm, setConfirm] = useState(false),
    [selected, setSelected] = useState(runtimeId),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function switchSingle(): Promise<void> {
    if (busy || saving || !onSingle) return;
    setSaving(true);
    setError("");
    try {
      await onSingle(selected);
      setConfirm(false);
      setOpen(false);
    } catch (e) {
      setError(
        e instanceof Error && e.message === "collaboration_running"
          ? t("runtimeChat.taskMode.busy")
          : t("runtimeChat.taskMode.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      className="task-mode-control"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) {
          setOpen(false);
          setConfirm(false);
        }
      }}
    >
      <button
        type="button"
        className={`chat-model-trigger task-mode-trigger${collaborative ? " task-mode-trigger--collaborative" : ""}`}
        aria-label={t("runtimeChat.taskMode.label")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {collaborative ? (
          <Workflow size={14} aria-hidden="true" />
        ) : (
          <ListTodo size={14} aria-hidden="true" />
        )}
        <span>
          {t(
            collaborative
              ? "runtimeChat.taskMode.collaboration"
              : "runtimeChat.taskMode.single",
          )}
          {collaborative && count > 0 ? (
            <span className="task-mode-count">{` · ${t("runtimeChat.taskMode.participants", { count })}`}</span>
          ) : null}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          className="task-mode-menu"
          role="menu"
          aria-label={t("runtimeChat.taskMode.label")}
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!collaborative}
            disabled={busy || saving}
            onClick={() => {
              if (collaborative) {
                setSelected(runtimeId);
                setConfirm(true);
              }
              setOpen(false);
            }}
          >
            <span>{t("runtimeChat.taskMode.single")}</span>
            {!collaborative && <Check size={14} />}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={collaborative}
            disabled={busy || !onConfigure || saving}
            onClick={() => {
              setOpen(false);
              onConfigure?.();
            }}
          >
            <span>{t("runtimeChat.taskMode.collaboration")}</span>
            {collaborative && <Check size={14} />}
          </button>
          {collaborative && (
            <button
              type="button"
              role="menuitem"
              disabled={busy || !onConfigure || saving}
              onClick={() => {
                setOpen(false);
                onConfigure?.();
              }}
            >
              {t("runtimeChat.taskMode.editTeam")}
            </button>
          )}
          {busy && <p role="status">{t("runtimeChat.taskMode.busy")}</p>}
        </div>
      )}
      {confirm && (
        <div
          className="task-mode-overlay"
          role="presentation"
          onMouseDown={() => {
            if (!saving) setConfirm(false);
          }}
        >
          <section
            className="task-mode-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("runtimeChat.taskMode.switchSingle")}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <strong>{t("runtimeChat.taskMode.switchSingle")}</strong>
              <button
                type="button"
                className="btn-ghost"
                disabled={saving}
                aria-label={t("runtimeChat.close")}
                onClick={() => setConfirm(false)}
              >
                <X size={16} />
              </button>
            </header>
            <p>{t("runtimeChat.taskMode.preserveHistory")}</p>
            <label>
              {t("runtimeChat.taskMode.replyAgent")}
              <select
                aria-label={t("runtimeChat.taskMode.replyAgent")}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {runtimes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {error && <p role="alert">{error}</p>}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || saving || !onSingle}
              onClick={() => void switchSingle()}
            >
              {t("runtimeChat.taskMode.switchSingle")}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
