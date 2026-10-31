import {
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ChevronDown, FileText } from "lucide-react";
import type {
  ConversationFileRef,
  ConversationFileInfo,
  ConversationFileAction,
} from "../../../shared/conversation-files";
import {
  documentPath,
  findDocumentReferences,
} from "../../../shared/conversation-files";
import type { ChatBubbleMessage } from "../screens/Chat/types";
import { parseRuntimeArtifactMediaUri } from "../screens/Chat/mediaUtils";
import { MediaImage } from "./MediaImage";
import { useI18n } from "./useI18n";

type Delivery = NonNullable<ChatBubbleMessage["fileDelivery"]>;
interface FileEntry {
  ref: ConversationFileRef;
  info: ConversationFileInfo | null;
  name: string;
  summary?: string;
}
const Files = createContext<FileEntry[]>([]);
const FileScope = createContext(false);
const nameOf = (path: string): string => path.split(/[\\/]/).pop() || path;
function samePath(a: string, b: string): boolean {
  return (
    a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase()
  );
}

function useFileAction(entry: FileEntry): {
  act: (action: ConversationFileAction) => void;
  error: string;
} {
  const { t } = useI18n();
  const [error, setError] = useState("");
  return {
    error,
    act: (action) => {
      setError("");
      void window.agentsOneAPI
        .conversationFileAction(entry.ref, action, {
          open: t("chat.fileMenu.open"),
          openWith: t("chat.files.openWith"),
          saveAs: t("chat.media.saveAs"),
          copyPath: t("chat.files.copyAbsolute"),
          copyRelative: t("chat.files.copyRelative"),
          reveal: t("chat.fileMenu.reveal"),
        })
        .then((ok) => {
          if (!ok && action !== "save") setError(t("chat.files.unavailable"));
        })
        .catch(() => setError(t("chat.files.unavailable")));
    },
  };
}

/** The same verified capability backs inline links, cards and the native menu. */
export function ConversationFileLink({
  path,
  children,
}: {
  path: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const entries = useContext(Files);
  const artifact = parseRuntimeArtifactMediaUri(path);
  const named = entries.filter(
    (item) => item.ref.artifactId && item.name === nameOf(path),
  );
  const entry =
    entries.find((item) =>
      artifact
        ? item.ref.artifactId === artifact.artifactId
        : item.ref.path && samePath(item.ref.path, path),
    ) || (named.length === 1 ? named[0] : undefined);
  const literal =
    typeof children === "string"
      ? children
      : isValidElement<{ children?: unknown }>(children) &&
          typeof children.props.children === "string"
        ? children.props.children
        : "";
  return entry?.info ? (
    <VerifiedLink entry={entry}>
      {documentPath(literal) ? entry.name : children}
    </VerifiedLink>
  ) : (
    <>{children}</>
  );
}
function VerifiedLink({
  entry,
  children,
}: {
  entry: FileEntry;
  children: React.ReactNode;
}): React.JSX.Element {
  const { act, error } = useFileAction(entry);
  return (
    <>
      <button
        type="button"
        className="chat-document-link"
        title={entry.info!.path}
        onClick={() => act("open")}
        onContextMenu={(event) => {
          event.preventDefault();
          act("menu");
        }}
      >
        <FileText size={14} />
        {children}
      </button>
      {error && (
        <span role="alert" className="chat-media-error">
          {error}
        </span>
      )}
    </>
  );
}
function FileCard({ entry }: { entry: FileEntry }): React.JSX.Element {
  const { t } = useI18n();
  const { act, error } = useFileAction(entry);
  const [image, setImage] = useState<string>();
  useEffect(() => {
    if (!entry.info?.image) return;
    let cancelled = false;
    void window.agentsOneAPI
      .conversationFileAction(entry.ref, "image")
      .then((value) => {
        if (!cancelled && typeof value === "string") setImage(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entry.ref, entry.info?.image]);
  if (!entry.info)
    return (
      <div className="chat-document-unavailable">
        <FileText size={16} />
        <span>{entry.name}</span>
        <small>{t("chat.files.unavailable")}</small>
      </div>
    );
  const ext = entry.name.split(".").pop()?.toUpperCase() || "FILE";
  return (
    <div
      className="chat-delivered-file"
      title={entry.info.path}
      onContextMenu={(event) => {
        event.preventDefault();
        act("menu");
      }}
    >
      {image ? (
        <MediaImage
          token={{ src: image, name: entry.name, isImage: true, isUrl: true }}
          title={entry.info.path}
          onContextMenuOverride={(event) => {
            event.preventDefault();
            event.stopPropagation();
            act("menu");
          }}
        />
      ) : null}
      <div className="chat-document-card">
        <button
          type="button"
          className="chat-document-main"
          onClick={() => act("open")}
        >
          <span className="chat-document-icon">
            <FileText size={24} />
          </span>
          <span className="chat-document-description">
            <strong>{entry.name}</strong>
            <small>
              {t("chat.files.document")} · {ext} ·{" "}
              {entry.info.size < 1024
                ? entry.info.size + " B"
                : (entry.info.size / 1024).toFixed(1) + " KB"}
            </small>
            {entry.summary && <small>{entry.summary}</small>}
          </span>
        </button>
        <div className="chat-document-actions">
          <button type="button" onClick={() => act("open")}>
            {t("chat.fileMenu.open")}
          </button>
          <button
            type="button"
            onClick={() => act("menu")}
            aria-label={t("chat.files.actions")}
          >
            <ChevronDown size={15} />
          </button>
        </div>
      </div>
      {error && (
        <span role="alert" className="chat-media-error">
          {error}
        </span>
      )}
    </div>
  );
}

export function ConversationFiles({
  delivery,
  content,
  children,
}: {
  delivery: Delivery;
  content: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const candidates = useMemo(() => {
    const base = {
      conversationId: delivery.conversationId,
      messageId: delivery.messageId,
    };
    const entries: FileEntry[] = delivery.artifacts
      .filter((a) => a.kind === "file" && a.id)
      .map((a) => ({
        ref: { ...base, artifactId: a.id },
        name: a.label,
        info: null,
        summary: a.changeSummary,
      }));
    for (const match of findDocumentReferences(content)) {
      if (entries.some((e) => e.ref.path && samePath(e.ref.path, match.path)))
        continue;
      // Artifact ids are authoritative for remote files; never resolve their prose against this PC.
      if (
        entries.filter((e) => e.ref.artifactId && e.name === nameOf(match.path))
          .length === 1
      )
        continue;
      entries.push({
        ref: { ...base, path: match.path },
        name: nameOf(match.path),
        info: null,
      });
    }
    return entries.slice(0, 40);
  }, [delivery, content]);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void Promise.all(
      candidates.map(async (entry) => ({
        ...entry,
        info: await window.agentsOneAPI
          .conversationFileInfo(entry.ref)
          .catch(() => null),
      })),
    ).then((items) => {
      if (!cancelled) {
        setEntries(items);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [candidates]);
  const diffs = delivery.artifacts.filter(
    (a) => a.kind === "diff" && a.content,
  );
  return (
    <FileScope.Provider value={true}>
      <Files.Provider value={ready ? entries : []}>
        {children}
        {ready && entries.some((e) => e.info || e.ref.artifactId) && (
          <div className="chat-document-list">
            {entries
              .filter((e) => e.info || e.ref.artifactId)
              .map((entry, index) => (
                <FileCard
                  key={entry.ref.artifactId || entry.ref.path || index}
                  entry={entry}
                />
              ))}
          </div>
        )}
        {diffs.map((diff, index) => {
          const lines = diff.content!.split(/\r?\n/);
          const hasLineDiff = /^@@ /m.test(diff.content!);
          const added = lines.filter(
            (l) => l.startsWith("+") && !l.startsWith("+++"),
          ).length;
          const removed = lines.filter(
            (l) => l.startsWith("-") && !l.startsWith("---"),
          ).length;
          return (
            <details className="chat-document-revision" key={index}>
              <summary>
                <FileText size={15} />
                <span>{diff.label}</span>
                {hasLineDiff && (
                  <>
                    <span className="chat-file-added">+{added}</span>
                    <span className="chat-file-removed">−{removed}</span>
                  </>
                )}
              </summary>
              {diff.changeSummary && <p>{diff.changeSummary}</p>}
              <pre>
                {lines.map((line, i) => (
                  <span
                    key={i}
                    className={
                      line.startsWith("+")
                        ? "chat-diff-add"
                        : line.startsWith("-")
                          ? "chat-diff-remove"
                          : ""
                    }
                  >
                    {line}
                    {"\n"}
                  </span>
                ))}
              </pre>
            </details>
          );
        })}
      </Files.Provider>
    </FileScope.Provider>
  );
}

/** Local images appear once in the verified delivery panel; HTTP images stay inline. */
export function ConversationMarkdownImage({
  token,
}: {
  token: import("../screens/Chat/mediaUtils").MediaToken;
}): React.JSX.Element {
  const scoped = useContext(FileScope);
  return scoped && !token.isUrl ? (
    <ConversationFileLink path={token.src}>{token.name}</ConversationFileLink>
  ) : (
    <MediaImage token={token} />
  );
}

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}
/** Transform text nodes only so lists/tables retain their Markdown structure. */
export function remarkDocumentLinks(): (tree: MarkdownNode) => void {
  return (tree) => {
    const visit = (node: MarkdownNode): void => {
      if (node.type === "link") {
        const path = documentPath(node.url || "");
        if (path) node.url = "agents-one-file:" + encodeURIComponent(path);
        return;
      }
      if (
        ["code", "inlineCode", "image", "html"].includes(node.type) ||
        !node.children
      )
        return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value) {
          visit(child);
          return [child];
        }
        const matches = findDocumentReferences(child.value);
        if (!matches.length) return [child];
        const nodes: MarkdownNode[] = [];
        let last = 0;
        for (const match of matches) {
          if (match.start > last)
            nodes.push({
              type: "text",
              value: child.value.slice(last, match.start),
            });
          nodes.push({
            type: "link",
            url: "agents-one-file:" + encodeURIComponent(match.path),
            children: [{ type: "text", value: match.path }],
          });
          last = match.end;
        }
        if (last < child.value.length)
          nodes.push({ type: "text", value: child.value.slice(last) });
        return nodes;
      });
    };
    visit(tree);
  };
}
