import { useState, useEffect, memo } from "react";
import { X, FileCode } from "lucide-react";
import { useI18n } from "../../components/useI18n";

interface FileViewerProps {
  filePath: string;
  onClose: () => void;
}

// Common file extensions for syntax highlighting detection
const CODE_EXTENSIONS = new Set([
  "js", "ts", "jsx", "tsx", "json", "html", "css", "scss", "less",
  "py", "rb", "php", "java", "go", "rs", "c", "cpp", "h", "hpp",
  "swift", "kt", "dart", "lua", "sh", "bash", "zsh", "ps1",
  "yaml", "yml", "toml", "ini", "conf", "config", "xml", "sql",
  "md", "markdown", "txt", "log",
]);

function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

function isCodeFile(filename: string): boolean {
  return CODE_EXTENSIONS.has(getFileExtension(filename));
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function formatFileSize(content: string): string {
  const bytes = new Blob([content]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FileViewer = memo(function FileViewer({
  filePath,
  onClose,
}: FileViewerProps): React.JSX.Element {
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const loadFile = async (): Promise<void> => {
      const result = await window.hermesAPI.readFile(filePath, 102400);
      if (cancelled) return;
      if (result === null) {
        setError(t("worktree.errorLoading"));
      } else {
        setContent(result.content);
        setTruncated(result.truncated);
      }
      setIsLoading(false);
    };

    void loadFile();
    return () => {
      cancelled = true;
    };
  }, [filePath, t]);

  const fileName = getFileName(filePath);
  const isCode = isCodeFile(fileName);

  return (
    <div className="file-viewer-overlay" onClick={onClose}>
      <div className="file-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="file-viewer-header">
          <div className="file-viewer-title">
            <FileCode size={16} className="file-viewer-icon" />
            <span className="file-viewer-filename" title={filePath}>
              {fileName}
            </span>
            {content && (
              <span className="file-viewer-size">
                {formatFileSize(content)}
                {truncated && ` (${t("worktree.fileTruncated")})`}
              </span>
            )}
          </div>
          <button
            className="btn-ghost file-viewer-close"
            onClick={onClose}
            title={t("worktree.closeFile")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="file-viewer-content">
          {isLoading ? (
            <div className="file-viewer-loading">{t("worktree.loading")}...</div>
          ) : error ? (
            <div className="file-viewer-error">{error}</div>
          ) : content === null ? (
            <div className="file-viewer-error">{t("worktree.errorLoading")}</div>
          ) : (
            <>
              {truncated && (
                <div className="file-viewer-truncated">
                  {t("worktree.fileTruncatedWarning")}
                </div>
              )}
              <pre className={`file-viewer-code ${isCode ? "file-viewer-code-syntax" : ""}`}>
                <code>{content}</code>
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
