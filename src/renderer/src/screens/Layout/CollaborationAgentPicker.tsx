import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Check, ChevronDown } from "lucide-react";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
export default function CollaborationAgentPicker({
  label,
  value,
  runtimes,
  placeholder,
  onChange,
}: {
  label: string;
  value?: string;
  runtimes: AgentRuntimeDefinition[];
  placeholder: string;
  onChange: (value?: string) => void;
}): React.JSX.Element {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
  }>();
  const selected = runtimes.find((runtime) => runtime.id === value);
  const options = [undefined, ...runtimes.filter((runtime) => runtime.enabled)];
  const close = (): void => {
    setPosition(undefined);
    trigger.current?.focus();
  };
  const open = (): void => {
    const rect = trigger.current!.getBoundingClientRect();
    const height = Math.min(260, options.length * 40 + 10);
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 24);
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top:
        rect.bottom + height + 8 <= window.innerHeight
          ? rect.bottom + 5
          : Math.max(12, rect.top - height - 5),
      width,
    });
  };
  useEffect(() => {
    if (!position) return;
    const active =
      menu.current?.querySelector<HTMLButtonElement>(
        '[aria-selected="true"]',
      ) || menu.current?.querySelector<HTMLButtonElement>('[role="option"]');
    active?.focus();
    const outside = (event: PointerEvent): void => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setPosition(undefined);
    };
    const dismiss = (): void => setPosition(undefined);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
    };
  }, [position]);
  const avatar = (runtime?: AgentRuntimeDefinition): React.JSX.Element => (
    <span
      className="task-collaboration-agent-avatar"
      style={runtime?.color ? { background: runtime.color } : undefined}
    >
      {runtime?.avatar ? (
        <img src={runtime.avatar} alt="" />
      ) : (
        <Bot size={15} />
      )}
    </span>
  );
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className="collaboration-agent-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={Boolean(position)}
        aria-controls={position ? id : undefined}
        onClick={() => (position ? close() : open())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            open();
          }
        }}
      >
        {avatar(selected)}
        <span>{selected?.name || value || placeholder}</span>
        <ChevronDown size={14} />
      </button>
      {position
        ? createPortal(
            <div
              ref={menu}
              id={id}
              role="listbox"
              aria-label={label}
              className="collaboration-agent-menu"
              style={position}
              onBlur={(event) => {
                if (
                  !event.currentTarget.contains(event.relatedTarget as Node) &&
                  event.relatedTarget !== trigger.current
                )
                  setPosition(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                }
                if (
                  ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const buttons = Array.from(
                    menu.current!.querySelectorAll<HTMLButtonElement>(
                      '[role="option"]',
                    ),
                  );
                  const current = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? buttons.length - 1
                        : (current +
                            (event.key === "ArrowDown" ? 1 : -1) +
                            buttons.length) %
                          buttons.length;
                  buttons[next]?.focus();
                }
              }}
            >
              {options.map((runtime) => (
                <button
                  key={runtime?.id || "unassigned"}
                  type="button"
                  role="option"
                  aria-selected={(runtime?.id || "") === (value || "")}
                  onClick={() => {
                    onChange(runtime?.id);
                    close();
                  }}
                >
                  {avatar(runtime)}
                  <span>{runtime?.name || placeholder}</span>
                  {runtime?.id === value || (!runtime && !value) ? (
                    <Check size={14} />
                  ) : null}
                </button>
              ))}
            </div>,
            trigger.current?.closest('[role="dialog"]') || document.body,
          )
        : null}
    </>
  );
}
