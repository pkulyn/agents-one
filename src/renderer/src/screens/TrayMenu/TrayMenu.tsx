import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type {
  TrayMenuAction,
  TrayMenuData,
  TrayMenuTask,
} from "../../../../shared/tray-menu";
import { useI18n } from "../../components/useI18n";
import {
  TRAY_MENU_COLLAPSED_WIDTH,
  TRAY_MENU_EXPANDED_WIDTH,
} from "../../../../shared/tray-menu";

const EMPTY_DATA: TrayMenuData = {
  running: [],
  recent: [],
  more: [],
  runningCount: 0,
};

function TaskRow({ task }: { task: TrayMenuTask }): React.JSX.Element {
  const action: TrayMenuAction = task.openTaskId
    ? { type: "open-task", taskId: task.openTaskId }
    : { type: "open-main" };
  return (
    <button
      type="button"
      className="tray-task-menu-task"
      onClick={() => window.agentsOneAPI.sendTrayMenuAction(action)}
      title={[task.title, task.projectName].filter(Boolean).join(" · ")}
    >
      <span className="tray-task-menu-title">{task.title}</span>
      <span className="tray-task-menu-project">{task.projectName}</span>
    </button>
  );
}

function EmptyRow({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return <div className="tray-task-menu-empty">{children}</div>;
}

export default function TrayMenu(): React.JSX.Element {
  const { t } = useI18n();
  const [data, setData] = useState<TrayMenuData>(EMPTY_DATA);
  const [moreExpanded, setMoreExpanded] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    void window.agentsOneAPI.getTrayMenuData().then((next) => {
      if (!disposed) setData(next);
    });
    const unsubscribe = window.agentsOneAPI.onTrayMenuData((next) => {
      setMoreExpanded(false);
      setData(next);
    });
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      window.agentsOneAPI.sendTrayMenuAction({ type: "close" });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const height = shellRef.current?.scrollHeight || 0;
      if (height > 0) {
        window.agentsOneAPI.resizeTrayMenu(
          moreExpanded ? TRAY_MENU_EXPANDED_WIDTH : TRAY_MENU_COLLAPSED_WIDTH,
          height,
        );
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data, moreExpanded]);

  const unknownRunningCount = Math.max(
    0,
    data.runningCount - data.running.length,
  );

  return (
    <div
      ref={shellRef}
      className={`tray-task-menu-shell${moreExpanded ? " is-more-open" : ""}`}
      onMouseLeave={() => setMoreExpanded(false)}
    >
      {moreExpanded ? (
        <aside
          className="tray-task-menu-history-panel"
          aria-label={t("tray.menu.moreCompleted")}
          onMouseEnter={() => setMoreExpanded(true)}
        >
          {data.more.length > 0 ? (
            data.more.map((task) => <TaskRow key={task.id} task={task} />)
          ) : (
            <EmptyRow>{t("tray.menu.noMoreCompleted")}</EmptyRow>
          )}
        </aside>
      ) : null}

      <main className="tray-task-menu" aria-label={t("tray.menu.label")}>
        <section
          className="tray-task-menu-section"
          aria-labelledby="tray-running-label"
        >
          <h2 id="tray-running-label" className="tray-task-menu-heading">
            {t("tray.menu.running")}
          </h2>
          {data.running.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
          {data.running.length === 0 && unknownRunningCount === 0 ? (
            <EmptyRow>{t("tray.menu.noRunning")}</EmptyRow>
          ) : null}
          {unknownRunningCount > 0 ? (
            <EmptyRow>
              {data.running.length === 0
                ? t("tray.menu.runningCount", { count: unknownRunningCount })
                : t("tray.menu.moreRunningCount", {
                    count: unknownRunningCount,
                  })}
            </EmptyRow>
          ) : null}
        </section>

        <section
          className="tray-task-menu-section"
          aria-labelledby="tray-recent-label"
        >
          <h2 id="tray-recent-label" className="tray-task-menu-heading">
            {t("tray.menu.recent")}
          </h2>
          {data.recent.length > 0 ? (
            data.recent.map((task) => <TaskRow key={task.id} task={task} />)
          ) : (
            <EmptyRow>{t("tray.menu.noCompleted")}</EmptyRow>
          )}
          <button
            type="button"
            className="tray-task-menu-more"
            aria-expanded={moreExpanded}
            aria-haspopup="menu"
            onMouseEnter={() => setMoreExpanded(true)}
            onFocus={() => setMoreExpanded(true)}
            onClick={() => setMoreExpanded((value) => !value)}
          >
            <span>{t("tray.menu.more")}</span>
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </section>

        <nav
          className="tray-task-menu-actions"
          aria-label={t("tray.menu.appActions")}
        >
          <button
            type="button"
            onClick={() =>
              window.agentsOneAPI.sendTrayMenuAction({ type: "new-task" })
            }
          >
            {t("tray.menu.newTask")}
          </button>
          <button
            type="button"
            onClick={() =>
              window.agentsOneAPI.sendTrayMenuAction({ type: "open-main" })
            }
          >
            {t("tray.menu.openApp")}
          </button>
          <button
            type="button"
            onClick={() =>
              window.agentsOneAPI.sendTrayMenuAction({ type: "quit" })
            }
          >
            {t("tray.menu.quit")}
          </button>
        </nav>
      </main>
    </div>
  );
}
