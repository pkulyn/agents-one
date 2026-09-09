import { memo, useState, useEffect, useRef } from "react";
import { FolderOpen, FolderTree, X, Check } from "lucide-react";
import { useI18n } from "../../components/useI18n";

interface ContextFolderChipProps {
  /** Working folder bound to this conversation (issue #27), or null. */
  contextFolder: string | null;
  /** Hidden in remote mode, where the picker browses the wrong machine. */
  show: boolean;
  worktreeVisible: boolean;
  onPickFolder: () => void;
  onClearFolder: () => void;
  onToggleWorktree: () => void;
  onSelectRecentWorkspace?: (workspace: { workspaceId: string; name: string }) => void;
  /** Legacy callback kept only for old path-only session bindings. */
  onSelectRecentFolder?: (path: string) => void;
}

/** Last path segment, for the compact chip label (handles \ and /). */
function folderName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * Context-folder control rendered as a chip in the input footer, next to the
 * model picker (both share the `.chat-meta-chip` style). When clicked, opens a
 * dropdown popup showing recent project folders and an "Open folder..." option.
 */
export const ContextFolderChip = memo(function ContextFolderChip({
  contextFolder,
  show,
  worktreeVisible,
  onPickFolder,
  onClearFolder,
  onToggleWorktree,
  onSelectRecentWorkspace,
  onSelectRecentFolder,
}: ContextFolderChipProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [recentWorkspaces, setRecentWorkspaces] = useState<
    Array<{ workspaceId: string; name: string }>
  >([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    if (window.agentsOneAPI.listRecentSessionContextFolders) {
      void window.agentsOneAPI
        .listRecentSessionContextFolders(20)
        .then((list) => {
          if (!cancelled && Array.isArray(list)) setRecentFolders(list);
        })
        .catch(() => {
          /* ignore */
        });
    } else {
      setRecentFolders([]);
    }
    if (window.agentsOneAPI.listRecentSessionContextWorkspaces) {
      void window.agentsOneAPI
        .listRecentSessionContextWorkspaces(20)
        .then((list) => {
          if (!cancelled && Array.isArray(list)) setRecentWorkspaces(list);
        })
        .catch(() => {
          /* ignore */
        });
    } else {
      setRecentWorkspaces([]);
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  if (!show) return null;

  const renderDropdown = (): React.JSX.Element => (
    <div className="chat-ctxfolder-dropdown">
      <div className="chat-ctxfolder-dropdown-header">最近使用</div>
      <div className="chat-ctxfolder-dropdown-list">
        {recentWorkspaces.length === 0 && recentFolders.length === 0 ? (
          <div className="chat-ctxfolder-dropdown-empty">暂无最近文件夹</div>
        ) : (
          <>
            {recentWorkspaces.map((workspace) => {
            const isSelected = workspace.name === contextFolder;
            return (
              <button
                key={workspace.workspaceId}
                type="button"
                className={`chat-ctxfolder-dropdown-item${
                  isSelected ? " chat-ctxfolder-dropdown-item--active" : ""
                }`}
                onClick={() => {
                  onSelectRecentWorkspace?.(workspace);
                  setIsOpen(false);
                }}
                title={workspace.name}
              >
                <span className="chat-ctxfolder-dropdown-item-name">{workspace.name}</span>
                {isSelected && <Check size={14} className="chat-ctxfolder-dropdown-item-check" />}
              </button>
            );
            })}
            {recentFolders.map((path) => {
            const isSelected = path === contextFolder;
            return (
              <button
                key={path}
                type="button"
                className={`chat-ctxfolder-dropdown-item${
                  isSelected ? " chat-ctxfolder-dropdown-item--active" : ""
                }`}
                onClick={() => {
                  onSelectRecentFolder?.(path);
                  setIsOpen(false);
                }}
                title={path}
              >
                <span className="chat-ctxfolder-dropdown-item-name">{folderName(path)}</span>
                {isSelected && (
                  <Check size={14} className="chat-ctxfolder-dropdown-item-check" />
                )}
              </button>
            );
            })}
          </>
        )}
      </div>
      <div className="chat-ctxfolder-dropdown-divider" />
      <button
        type="button"
        className="chat-ctxfolder-dropdown-item chat-ctxfolder-dropdown-item--open"
        onClick={() => {
          setIsOpen(false);
          onPickFolder();
        }}
      >
        <span>选择文件夹…</span>
      </button>
    </div>
  );

  if (!contextFolder) {
    return (
      <div className="chat-ctxfolder-picker" ref={containerRef}>
        <button
          className="chat-meta-chip chat-meta-chip--icon-only"
          onClick={() => setIsOpen((v) => !v)}
          title={t("chat.setContextFolder")}
          aria-label={t("chat.setContextFolder")}
          type="button"
        >
          <FolderOpen size={13} />
        </button>
        {isOpen && renderDropdown()}
      </div>
    );
  }

  return (
    <div className="chat-ctxfolder-group" ref={containerRef}>
      <button
        className="chat-meta-chip chat-meta-chip--active"
        onClick={() => setIsOpen((v) => !v)}
        title={t("chat.contextFolderActive", { path: contextFolder })}
        type="button"
      >
        <FolderOpen size={13} />
        <span className="chat-ctxfolder-name">{folderName(contextFolder)}</span>
      </button>
      <button
        className="chat-meta-chip-icon"
        onClick={onClearFolder}
        title={t("chat.removeContextFolder")}
        type="button"
      >
        <X size={11} />
      </button>
      <button
        className={`chat-meta-chip-icon${
          worktreeVisible ? " chat-meta-chip-icon--active" : ""
        }`}
        onClick={onToggleWorktree}
        title={
          worktreeVisible ? t("chat.hideWorktree") : t("chat.showWorktree")
        }
        type="button"
      >
        <FolderTree size={13} />
      </button>
      {isOpen && renderDropdown()}
    </div>
  );
});
