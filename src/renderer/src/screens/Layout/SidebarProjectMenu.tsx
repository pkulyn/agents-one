import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Archive, FolderOpen, Pencil, Pin, PinOff, X } from "lucide-react";
import { useI18n } from "../../components/useI18n";

export interface SidebarProjectMenuTarget {
  workspaceId: string;
  name: string;
  pinned: boolean;
  x: number;
  y: number;
}

const MENU_WIDTH = 220;
const MARGIN = 8;

export default function SidebarProjectMenu({
  target,
  scrollContainer,
  onClose,
  onTogglePin,
  onReveal,
  onRename,
  onArchive,
  onRemove,
}: {
  target: SidebarProjectMenuTarget;
  scrollContainer?: HTMLElement | null;
  onClose: () => void;
  onTogglePin: () => void;
  onReveal: () => void;
  onRename: () => void;
  onArchive: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  const requestClose = (): void => setOpen(false);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const width = element.offsetWidth || MENU_WIDTH;
    const height = element.offsetHeight;
    setPosition({
      left: Math.max(MARGIN, Math.min(target.x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(target.y, window.innerHeight - height - MARGIN)),
    });
  }, [target.x, target.y]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) requestClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        requestClose();
      }
    };
    const onScroll = (): void => requestClose();
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", requestClose);
    scrollContainer?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", requestClose);
      scrollContainer?.removeEventListener("scroll", onScroll);
    };
  }, [scrollContainer]);

  const action = (callback: () => void): void => {
    callback();
    requestClose();
  };

  return createPortal(
    <AnimatePresence onExitComplete={onClose}>
      {open ? (
        <motion.div
          ref={menuRef}
          className="sidebar-session-menu"
          style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          initial={{ opacity: 0, scale: 0.95, y: -6, filter: "blur(4px)" }}
          animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.97, y: -4, filter: "blur(3px)" }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="sidebar-session-menu-body">
            <div className="sidebar-session-menu-page">
              <button type="button" role="menuitem" className="sidebar-session-menu-item" onClick={() => action(onTogglePin)}>
                {target.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                <span>{target.pinned ? t("navigation.projectMenu.unpin") : t("navigation.projectMenu.pin")}</span>
              </button>
              <button type="button" role="menuitem" className="sidebar-session-menu-item" onClick={() => action(onReveal)}>
                <FolderOpen size={15} /><span>{t("navigation.projectMenu.reveal")}</span>
              </button>
              <button type="button" role="menuitem" className="sidebar-session-menu-item" onClick={() => action(onRename)}>
                <Pencil size={15} /><span>{t("navigation.projectMenu.rename")}</span>
              </button>
              <div className="sidebar-session-menu-divider" />
              <button type="button" role="menuitem" className="sidebar-session-menu-item" onClick={() => action(onArchive)}>
                <Archive size={15} /><span>{t("navigation.projectMenu.archive")}</span>
              </button>
              <button type="button" role="menuitem" className="sidebar-session-menu-item sidebar-session-menu-item--danger" onClick={() => action(onRemove)}>
                <X size={15} /><span>{t("navigation.projectMenu.remove")}</span>
              </button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
