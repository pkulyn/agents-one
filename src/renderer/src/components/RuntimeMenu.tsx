import { useEffect, useState, type HTMLAttributes } from "react";
import { Bot, Check } from "../assets/icons";
import { useI18n } from "./useI18n";
import type { AgentRuntimeDefinition } from "../../../shared/agent-runtimes";

const ORDER_KEY = "agents-one.runtime-display-order.v1";
const ORDER_EVENT = "agents-one:runtime-display-order";
const DRAG_TYPE = "application/x-agents-one-runtime";
const LABELS: Record<string, string> = {
  hermes: "Hermes Agent",
  codex: "Codex",
  "claude-code": "Claude Code",
  pi: "Pi Agent",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
};
function readOrder(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ORDER_KEY) || "[]");
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string"))]
      : [];
  } catch {
    return [];
  }
}
export function useRuntimeOrder(runtimes: AgentRuntimeDefinition[]): {
  sorted: AgentRuntimeDefinition[];
  dragProps: (id: string) => HTMLAttributes<HTMLElement>;
} {
  const [order, setOrder] = useState(readOrder);
  useEffect(() => {
    const update = (): void => setOrder(readOrder());
    const receive = (event: Event): void =>
      setOrder((event as CustomEvent<string[]>).detail);
    window.addEventListener("storage", update);
    window.addEventListener(ORDER_EVENT, receive);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener(ORDER_EVENT, receive);
    };
  }, []);
  const sorted = [...runtimes].sort((a, b) => {
    const ai = order.indexOf(a.id),
      bi = order.indexOf(b.id);
    return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
  });
  function dragProps(id: string): HTMLAttributes<HTMLElement> {
    return {
      draggable: true,
      onDragStart: (event) => {
        event.dataTransfer.setData(DRAG_TYPE, id);
        event.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (event) => {
        if (Array.from(event.dataTransfer.types).includes(DRAG_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      },
      onDrop: (event) => {
        const source = event.dataTransfer.getData(DRAG_TYPE);
        if (!sorted.some((runtime) => runtime.id === source) || source === id)
          return;
        event.preventDefault();
        event.stopPropagation();
        const next = sorted
          .map((runtime) => runtime.id)
          .filter((value) => value !== source);
        next.splice(
          sorted.findIndex((runtime) => runtime.id === id),
          0,
          source,
        );
        // Preserve IDs absent from a filtered picker (for example disabled agents).
        const known = new Set(next);
        let index = 0;
        const merged = [
          ...order,
          ...next.filter((id) => !order.includes(id)),
        ].map((id) => (known.has(id) ? next[index++] : id));
        try {
          localStorage.setItem(ORDER_KEY, JSON.stringify(merged));
        } catch {
          /* Keep the current UI usable if storage is unavailable. */
        }
        setOrder(merged);
        window.dispatchEvent(new CustomEvent(ORDER_EVENT, { detail: merged }));
      },
    };
  }
  return { sorted, dragProps };
}
export function runtimeDescription(
  runtime: AgentRuntimeDefinition,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const kind =
    LABELS[runtime.kind] ||
    (runtime.kind === "web-agent"
      ? t("navigation.profile.webAgent")
      : runtime.kind);
  return runtime.kind === "web-agent"
    ? kind
    : t("navigation.profile.runtimeMeta", {
        kind,
        location: t(
          runtime.location === "local"
            ? "navigation.profile.local"
            : "navigation.profile.remote",
        ),
      });
}
export function RuntimeAvatar({
  runtime,
  size = 32,
}: {
  runtime?: AgentRuntimeDefinition;
  size?: number;
}): React.JSX.Element {
  return (
    <span
      className={"profile-menu-runtime " + (runtime?.kind || "hermes")}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        ...(runtime?.color ? { background: runtime.color, color: "#fff" } : {}),
      }}
    >
      {runtime?.avatar ? (
        <img src={runtime.avatar} alt="" draggable={false} />
      ) : (
        <Bot size={size - 10} />
      )}
    </span>
  );
}
export function RuntimeMenuItems({
  runtimes,
  selectedId,
  onSelect,
}: {
  runtimes: AgentRuntimeDefinition[];
  selectedId?: string;
  onSelect: (runtime: AgentRuntimeDefinition) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const { sorted, dragProps } = useRuntimeOrder(runtimes);
  return (
    <div
      className="profile-menu-list"
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next].focus();
      }}
    >
      {sorted.map((runtime) => (
        <div
          key={runtime.id}
          {...dragProps(runtime.id)}
          className="runtime-sort-row"
        >
          <button
            type="button"
            className={
              "profile-menu-item " + (runtime.id === selectedId ? "active" : "")
            }
            role="menuitemradio"
            aria-checked={runtime.id === selectedId}
            disabled={!runtime.enabled}
            onClick={() => onSelect(runtime)}
          >
            <RuntimeAvatar runtime={runtime} />
            <span className="profile-menu-info">
              <span className="profile-menu-name">{runtime.name}</span>
              <span className="profile-menu-meta">
                {runtimeDescription(runtime, t)}
              </span>
            </span>
            {runtime.id === selectedId && (
              <Check className="profile-menu-check" size={14} />
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
