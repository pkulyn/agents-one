import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Search, X } from "lucide-react";
import type { RuntimeModelOption } from "../../../../shared/runtime-commands";
import { useI18n } from "../../components/useI18n";

export function RuntimeModelPicker({
  models,
  selected,
  thinking,
  disabled,
  onSelect,
  onThinking,
  onClose,
}: {
  models: RuntimeModelOption[];
  selected: string;
  thinking: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onThinking: (level: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const current =
    models.find((m) => m.id === selected) || models.find((m) => m.isDefault);
  const groups = Array.from(
    new Set(models.map((m) => m.provider || t("runtimeChat.model.title"))),
  );
  const [group, setGroup] = useState(current?.provider || groups[0] || "");
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({
    left: 16,
    bottom: 90,
    maxHeight: 500,
  });
  useEffect(() => {
    const place = (): void => {
      const anchor = document
        .querySelector(".runtime-chat-model-trigger")
        ?.getBoundingClientRect();
      if (anchor)
        setPosition({
          left: Math.max(
            12,
            Math.min(
              anchor.left,
              window.innerWidth - Math.min(600, window.innerWidth - 24) - 12,
            ),
          ),
          bottom: window.innerHeight - anchor.top + 10,
          maxHeight: Math.max(180, anchor.top - 24),
        });
    };
    const dismiss = (event: PointerEvent): void => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !(event.target as Element).closest?.(".runtime-chat-model-trigger")
      )
        onClose();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    place();
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);
  const visible = models.filter(
    (m) =>
      (query || (m.provider || t("runtimeChat.model.title")) === group) &&
      [m.displayName, m.id, m.provider]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const levels = current?.reasoningEfforts || [];
  return createPortal(
    <div
      ref={panel}
      className="runtime-model-menu"
      style={position}
      role="dialog"
      aria-label={t("runtimeChat.model.picker")}
      onKeyDown={(event) => {
        if (
          !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
          event.target instanceof HTMLInputElement
        )
          return;
        const options = Array.from(
          panel.current?.querySelectorAll<HTMLButtonElement>(
            '[role="option"]:not(:disabled)',
          ) || [],
        );
        if (!options.length) return;
        event.preventDefault();
        const index = options.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        options[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  options.length) %
                options.length
        ]?.focus();
      }}
    >
      <header>
        <label>
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("runtimeChat.model.search")}
            aria-label={t("runtimeChat.model.search")}
          />
        </label>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("runtimeChat.cancel")}
        >
          <X size={16} />
        </button>
      </header>
      <div className="runtime-model-menu-body">
        {groups.length > 1 && (
          <nav aria-label={t("runtimeChat.model.providers")}>
            {groups.map((name) => (
              <button
                type="button"
                key={name}
                className={group === name ? "is-active" : ""}
                onClick={() => {
                  setGroup(name);
                  setQuery("");
                }}
              >
                {name}
                <ChevronRight size={14} />
              </button>
            ))}
          </nav>
        )}
        <div
          className="runtime-model-menu-options"
          role="listbox"
          aria-label={t("runtimeChat.model.list")}
        >
          {visible.map((model) => (
            <button
              type="button"
              role="option"
              aria-selected={
                model.id === selected ||
                (!models.some((m) => m.id === selected) &&
                  model.isDefault === true)
              }
              disabled={disabled}
              key={model.id}
              onClick={() => onSelect(model.id)}
            >
              <span>
                {model.displayName || model.id}
                {model.imageInput && (
                  <small>{t("runtimeChat.model.vision")}</small>
                )}
              </span>
              {(model.id === selected ||
                (!models.some((m) => m.id === selected) &&
                  model.isDefault)) && <Check size={16} />}
            </button>
          ))}
          {!visible.length && <p>{t("runtimeChat.model.empty")}</p>}
        </div>
      </div>
      <footer>
        <div>
          <span>{t("runtimeChat.thinking.title")}</span>
          <strong>
            {thinking
              ? t("runtimeChat.thinking.levels." + thinking) ===
                "runtimeChat.thinking.levels." + thinking
                ? thinking
                : t("runtimeChat.thinking.levels." + thinking)
              : t("runtimeChat.thinking.auto")}
          </strong>
        </div>
        {levels.length > 1 ? (
          <div
            className="runtime-thinking-segments"
            role="group"
            aria-label={t("runtimeChat.thinking.list")}
          >
            {levels.map((level) => (
              <button
                type="button"
                key={level}
                disabled={disabled}
                aria-pressed={thinking === level}
                onClick={() => onThinking(level)}
              >
                {t("runtimeChat.thinking.levels." + level) ===
                "runtimeChat.thinking.levels." + level
                  ? level
                  : t("runtimeChat.thinking.levels." + level)}
              </button>
            ))}
          </div>
        ) : (
          <small>{t("runtimeChat.thinking.nativeDefault")}</small>
        )}
        <small>{t("runtimeChat.model.scope")}</small>
        <button
          type="button"
          className="runtime-model-manage"
          onClick={() => {
            onClose();
            window.dispatchEvent(
              new CustomEvent("navigation:goto", { detail: "agents" }),
            );
          }}
        >
          {t("runtimeChat.model.manage")}
        </button>
      </footer>
    </div>,
    document.body,
  );
}
