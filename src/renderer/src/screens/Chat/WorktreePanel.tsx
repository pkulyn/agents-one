import { useState, useEffect, useCallback, memo } from "react";
import {
  Folder,
  ChevronRight,
  ChevronDown,
  FileCode,
  FileJson,
  FileText,
  FileImage,
  FileType2,
  FileTerminal,
  FileCog,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FileViewer } from "./FileViewer";

interface FileEntry {
  name: string;
  isDirectory: boolean;
}

interface WorktreePanelProps {
  folderPath: string;
}

interface TreeItemProps {
  entry: FileEntry;
  parentPath: string;
  depth: number;
  onFileClick?: (filePath: string) => void;
}

interface FileIconInfo {
  icon: LucideIcon;
  type: string;
}

function getFileIconInfo(filename: string): FileIconInfo {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  // Image files
  if (
    ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico"].includes(ext)
  ) {
    return { icon: FileImage, type: "image" };
  }

  // JSON files
  if (["json", "jsonc"].includes(ext)) {
    return { icon: FileJson, type: "json" };
  }

  // Config files
  if (["yml", "yaml", "toml", "ini", "conf", "config", "env"].includes(ext)) {
    return { icon: FileCog, type: "config" };
  }

  // Script/terminal files
  if (["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"].includes(ext)) {
    return { icon: FileTerminal, type: "script" };
  }

  // Documentation files
  if (["md", "txt", "log", "rst"].includes(ext)) {
    return { icon: FileText, type: "doc" };
  }

  // Code files (use FileCode for most programming languages)
  if (
    [
      "js",
      "ts",
      "jsx",
      "tsx",
      "html",
      "htm",
      "css",
      "scss",
      "less",
      "py",
      "rb",
      "php",
      "java",
      "go",
      "rs",
      "c",
      "cpp",
      "h",
      "hpp",
      "swift",
      "kt",
      "dart",
      "lua",
      "pl",
      "pm",
      "r",
      "m",
      "mm",
      "vue",
      "svelte",
      "sql",
      "xml",
    ].includes(ext)
  ) {
    return { icon: FileCode, type: "code" };
  }

  // Default
  return { icon: FileType2, type: "default" };
}

function TreeItem({
  entry,
  parentPath,
  depth,
  onFileClick,
}: TreeItemProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fullPath = `${parentPath}/${entry.name}`;

  const loadChildren = useCallback(async () => {
    if (!entry.isDirectory || children !== null) return;
    setIsLoading(true);
    const result = await window.hermesAPI.readDirectory(fullPath);
    if (result) {
      // Sort: directories first, then files, both alphabetically
      const sorted = result.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
          return a.name.localeCompare(b.name);
        }
        return a.isDirectory ? -1 : 1;
      });
      setChildren(sorted);
    }
    setIsLoading(false);
  }, [entry.isDirectory, fullPath, children]);

  const handleClick = (): void => {
    if (entry.isDirectory) {
      if (!isExpanded) {
        void loadChildren();
      }
      setIsExpanded(!isExpanded);
    } else {
      onFileClick?.(fullPath);
    }
  };

  const paddingLeft = 8 + depth * 12;

  return (
    <div className="worktree-item">
      <div
        className={`worktree-row ${!entry.isDirectory ? "worktree-row-file" : ""}`}
        onClick={handleClick}
        style={{ paddingLeft }}
        title={fullPath}
      >
        {entry.isDirectory ? (
          <>
            <span className="worktree-chevron">
              {isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </span>
            <Folder size={14} className="worktree-icon worktree-folder-icon" />
          </>
        ) : (
          <>
            <span className="worktree-chevron-placeholder" />
            {(() => {
              const { icon: FileIcon, type } = getFileIconInfo(entry.name);
              return (
                <FileIcon
                  size={14}
                  className="worktree-icon worktree-file-icon"
                  data-filetype={type}
                />
              );
            })()}
          </>
        )}
        <span className="worktree-name">{entry.name}</span>
      </div>
      {entry.isDirectory && isExpanded && (
        <div className="worktree-children">
          {isLoading ? (
            <div
              className="worktree-loading"
              style={{ paddingLeft: paddingLeft + 12 }}
            >
              Loading...
            </div>
          ) : children === null ? null : children.length === 0 ? (
            <div
              className="worktree-empty"
              style={{ paddingLeft: paddingLeft + 12 }}
            >
              Empty folder
            </div>
          ) : (
            children.map((child) => (
              <TreeItem
                key={`${fullPath}/${child.name}`}
                entry={child}
                parentPath={fullPath}
                depth={depth + 1}
                onFileClick={onFileClick}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export const WorktreePanel = memo(function WorktreePanel({
  folderPath,
}: WorktreePanelProps): React.JSX.Element {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const loadRoot = async (): Promise<void> => {
      const result = await window.hermesAPI.readDirectory(folderPath);
      if (cancelled) return;
      if (result === null) {
        setError("Failed to load folder contents");
      } else {
        // Sort: directories first, then files, both alphabetically
        const sorted = result.sort((a, b) => {
          if (a.isDirectory === b.isDirectory) {
            return a.name.localeCompare(b.name);
          }
          return a.isDirectory ? -1 : 1;
        });
        setEntries(sorted);
      }
      setIsLoading(false);
    };

    void loadRoot();
    return () => {
      cancelled = true;
    };
  }, [folderPath]);

  // Get the folder name from the path
  const folderName =
    folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;

  return (
    <div className="worktree-panel">
      <div className="worktree-header">
        <Folder size={16} className="worktree-header-icon" />
        <span className="worktree-header-title" title={folderPath}>
          {folderName}
        </span>
      </div>
      <div className="worktree-content">
        {isLoading ? (
          <div className="worktree-loading">Loading...</div>
        ) : error ? (
          <div className="worktree-error">{error}</div>
        ) : entries === null || entries.length === 0 ? (
          <div className="worktree-empty">Folder is empty</div>
        ) : (
          entries.map((entry) => (
            <TreeItem
              key={`${folderPath}/${entry.name}`}
              entry={entry}
              parentPath={folderPath}
              depth={0}
              onFileClick={setSelectedFile}
            />
          ))
        )}
      </div>
      {selectedFile && (
        <FileViewer
          filePath={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </div>
  );
});
