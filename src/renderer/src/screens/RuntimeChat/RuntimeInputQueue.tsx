import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Pencil, Trash2, Check, RotateCcw } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { PendingRuntimeInput } from "./useRuntimeInputQueue";
import "./RuntimeInputQueue.css";

interface Props {
  items: PendingRuntimeInput[];
  change: (
    id: string,
    patch: Partial<Pick<PendingRuntimeInput, "text" | "mode" | "editing">>,
  ) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
}
export function RuntimeInputQueue(props: Props): React.JSX.Element | null {
  const { t } = useI18n();
  return props.items.length ? (
    <div
      className="runtime-input-queue"
      role="region"
      aria-label={t("runtimeChat.pendingInput.queue")}
    >
      {props.items.map((item) => (
        <PendingInputRow key={item.id} item={item} {...props} />
      ))}
    </div>
  ) : null;
}
function PendingInputRow({
  item,
  change,
  remove,
  retry,
}: Props & { item: PendingRuntimeInput }): React.JSX.Element {
  const { t } = useI18n();
  const [draft, setDraft] = useState(item.text);
  const [expanded, setExpanded] = useState(false);
  const busy = item.status === "sending";
  const immutable = busy || item.deliveredTo.size > 0;
  const label = (mode: PendingRuntimeInput["mode"]): string =>
    t(
      mode === "steer"
        ? "runtimeChat.feedback.adjustNow"
        : "runtimeChat.cancelResume.queue",
    );
  const modeControl = (
    <ModeControl
      mode={item.mode}
      disabled={immutable}
      label={label}
      onChange={(mode) => change(item.id, { mode })}
    />
  );
  return (
    <div
      className={
        "runtime-pending-input" +
        (item.editing ? " runtime-pending-input--editing" : "")
      }
      data-status={item.status}
    >
      {item.editing ? (
        <>
          <textarea
            autoFocus
            aria-label={t("runtimeChat.pendingInput.editText")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") change(item.id, { editing: false });
            }}
          />
          <div className="runtime-pending-edit-actions">
            {modeControl}
            <span className="runtime-pending-edit-note">
              {t("runtimeChat.pendingInput.paused")}
            </span>
            <button
              type="button"
              onClick={() => change(item.id, { editing: false })}
            >
              {t("runtimeChat.cancel")}
            </button>
            <button
              type="button"
              className="runtime-pending-save"
              disabled={!draft.trim()}
              onClick={() =>
                change(item.id, { text: draft.trim(), editing: false })
              }
            >
              {t("runtimeChat.pendingInput.save")}
            </button>
          </div>
        </>
      ) : (
        <div className="runtime-pending-row">
          <span className="runtime-pending-status" role="status">
            {t(
              busy
                ? "runtimeChat.pendingInput.sending"
                : item.status === "failed"
                  ? "runtimeChat.pendingInput.failed"
                  : "runtimeChat.pendingInput.pending",
            )}
          </span>
          <button
            type="button"
            className="runtime-pending-preview"
            title={item.text}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {item.text}
            {item.attachments.length
              ? " · " + item.attachments.map((a) => a.name).join(", ")
              : ""}
          </button>
          {modeControl}
          {item.status === "failed" && (
            <button
              type="button"
              className="runtime-pending-icon"
              title={t("runtimeChat.pendingInput.retry")}
              aria-label={t("runtimeChat.pendingInput.retry")}
              onClick={() => retry(item.id)}
            >
              <RotateCcw size={15} />
            </button>
          )}
          <button
            type="button"
            className="runtime-pending-icon"
            disabled={immutable}
            title={t("runtimeChat.pendingInput.edit")}
            aria-label={t("runtimeChat.pendingInput.edit")}
            onClick={() => {
              setDraft(item.text);
              change(item.id, { editing: true });
            }}
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            className="runtime-pending-icon"
            disabled={busy}
            title={t("runtimeChat.pendingInput.delete")}
            aria-label={t("runtimeChat.pendingInput.delete")}
            onClick={() => remove(item.id)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}
      {expanded && !item.editing && (
        <p className="runtime-pending-full">{item.text}</p>
      )}
      {item.error && (
        <p className="runtime-pending-error" role="alert">
          {item.error}
        </p>
      )}
    </div>
  );
}

function ModeControl({
  mode,
  disabled,
  label,
  onChange,
}: {
  mode: PendingRuntimeInput["mode"];
  disabled: boolean;
  label: (mode: PendingRuntimeInput["mode"]) => string;
  onChange: (mode: PendingRuntimeInput["mode"]) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!position) return;
    const close = (): void => setPosition(null);
    const outside = (e: PointerEvent): void => {
      if (
        e.target instanceof Node &&
        !trigger.current?.contains(e.target) &&
        !menu.current?.contains(e.target)
      )
        close();
    };
    const escape = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        close();
        trigger.current?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [position]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="runtime-pending-mode-trigger"
        disabled={disabled}
        aria-label={t("runtimeChat.feedback.inputMode")}
        aria-haspopup="menu"
        aria-expanded={!!position}
        onClick={() => {
          const rect = trigger.current!.getBoundingClientRect();
          setPosition(
            position
              ? null
              : {
                  left: Math.max(
                    8,
                    Math.min(window.innerWidth - 238, rect.right - 230),
                  ),
                  top: Math.max(8, rect.top - 96),
                },
          );
        }}
      >
        {label(mode)}
        <ChevronDown size={12} />
      </button>
      {position &&
        !disabled &&
        createPortal(
          <div
            ref={menu}
            className="runtime-pending-menu"
            style={position}
            role="menu"
            aria-label={t("runtimeChat.feedback.inputMode")}
          >
            {(["steer", "follow_up"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={mode === option}
                onClick={() => {
                  onChange(option);
                  setPosition(null);
                  trigger.current?.focus();
                }}
              >
                <span>{label(option)}</span>
                {mode === option && <Check size={13} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
