import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../components/useI18n";
import {
  Check,
  ChevronRight,
  FolderInput,
  Pencil,
  Pin,
  PinOff,
  Trash,
} from "../../assets/icons";

export interface SidebarMenuProject {
  path: string;
  name: string;
}

export interface SidebarMenuTarget {
  id: string;
  title: string;
  contextFolder: string | null;
  /** Viewport coordinates the menu should anchor to (trigger / cursor). */
  x: number;
  y: number;
}

const MENU_WIDTH = 220;
const VIEWPORT_MARGIN = 8;

/**
 * ChatGPT-style context menu for a single sidebar session row. Rendered in a
 * portal at viewport coordinates so it escapes the sidebar's clipped scroll
 * container, and clamped to stay on screen. "Move to project" swaps the menu to
 * a second page (a project picker) instead of a hover flyout, which keeps
 * positioning trivial inside the portal.
 */
function SidebarSessionMenu({
  target,
  isPinned,
  projects,
  onClose,
  onTogglePin,
  onRename,
  onMoveToProject,
  onPickNewFolder,
  onDelete,
}: {
  target: SidebarMenuTarget;
  isPinned: boolean;
  projects: SidebarMenuProject[];
  onClose: () => void;
  onTogglePin: () => void;
  onRename: () => void;
  onMoveToProject: (path: string | null) => void;
  onPickNewFolder: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<"main" | "projects">("main");
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  // Clamp the menu inside the viewport once it has measured its real size.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = target.x;
    let top = target.y;
    if (left + rect.width > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - rect.width - VIEWPORT_MARGIN;
    }
    if (top + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
      top = window.innerHeight - rect.height - VIEWPORT_MARGIN;
    }
    setPos({
      left: Math.max(VIEWPORT_MARGIN, left),
      top: Math.max(VIEWPORT_MARGIN, top),
    });
  }, [target.x, target.y, page]);

  // Close on outside click, Escape, scroll, or window blur.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = (): void => onClose();
    // capture so a scroll inside the sidebar (which doesn't bubble to window)
    // still dismisses the floating menu.
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const currentFolder = target.contextFolder?.trim() || null;

  return createPortal(
    <div
      ref={menuRef}
      className="sidebar-session-menu"
      style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      {page === "main" ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="sidebar-session-menu-item"
            onClick={() => {
              onTogglePin();
              onClose();
            }}
          >
            {isPinned ? <PinOff size={15} /> : <Pin size={15} />}
            <span>
              {isPinned
                ? t("navigation.sessionMenu.unpin")
                : t("navigation.sessionMenu.pin")}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="sidebar-session-menu-item"
            onClick={() => {
              onRename();
              onClose();
            }}
          >
            <Pencil size={15} />
            <span>{t("navigation.sessionMenu.rename")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="sidebar-session-menu-item"
            onClick={() => setPage("projects")}
          >
            <FolderInput size={15} />
            <span>{t("navigation.sessionMenu.moveToProject")}</span>
            <ChevronRight size={14} className="sidebar-session-menu-chevron" />
          </button>
          <div className="sidebar-session-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="sidebar-session-menu-item sidebar-session-menu-item--danger"
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            <Trash size={15} />
            <span>{t("navigation.sessionMenu.delete")}</span>
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="sidebar-session-menu-back"
            onClick={() => setPage("main")}
          >
            <ChevronRight
              size={14}
              className="sidebar-session-menu-back-icon"
            />
            <span>{t("navigation.sessionMenu.moveToProject")}</span>
          </button>
          <div className="sidebar-session-menu-divider" />
          <div className="sidebar-session-menu-scroll">
            {projects.length === 0 ? (
              <div className="sidebar-session-menu-empty">
                {t("navigation.sessionMenu.noProjects")}
              </div>
            ) : (
              projects.map((project) => {
                const active = project.path === currentFolder;
                return (
                  <button
                    key={project.path}
                    type="button"
                    role="menuitem"
                    className="sidebar-session-menu-item"
                    title={project.path}
                    onClick={() => {
                      if (!active) onMoveToProject(project.path);
                      onClose();
                    }}
                  >
                    <span className="sidebar-session-menu-project-name">
                      {project.name}
                    </span>
                    {active && (
                      <Check size={14} className="sidebar-session-menu-check" />
                    )}
                  </button>
                );
              })
            )}
          </div>
          <div className="sidebar-session-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="sidebar-session-menu-item"
            onClick={() => {
              onPickNewFolder();
              onClose();
            }}
          >
            <FolderInput size={15} />
            <span>{t("navigation.sessionMenu.newProjectFolder")}</span>
          </button>
          {currentFolder && (
            <button
              type="button"
              role="menuitem"
              className="sidebar-session-menu-item"
              onClick={() => {
                onMoveToProject(null);
                onClose();
              }}
            >
              <PinOff size={15} />
              <span>{t("navigation.sessionMenu.removeFromProject")}</span>
            </button>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}

export default SidebarSessionMenu;
