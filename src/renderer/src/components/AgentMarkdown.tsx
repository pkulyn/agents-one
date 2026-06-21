import { useState, useEffect, memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy } from "lucide-react";
import { useI18n } from "./useI18n";
import { MediaImage, DownloadChip } from "./MediaImage";
import { describeImageSrc } from "../screens/Chat/mediaUtils";

// Lazy-load the heavy syntax highlighter — only imported when a code block renders
let _highlighterMod: typeof import("react-syntax-highlighter") | null = null;
let _oneDark: Record<string, React.CSSProperties> | null = null;
let _loadingPromise: Promise<void> | null = null;

const BOX_DRAWING_RE = /[\u2500-\u257F]/;
const PLAIN_PRE_STYLE: React.CSSProperties = {
  margin: 0,
  borderRadius: 0,
  fontSize: "13px",
  lineHeight: 1.5,
  padding: "12px",
  background: "transparent",
  color: "inherit",
  overflowX: "auto",
  whiteSpace: "pre",
  fontVariantLigatures: "none",
  unicodeBidi: "isolate",
};
const PLAIN_CODE_STYLE: React.CSSProperties = {
  background: "transparent",
  padding: 0,
  whiteSpace: "pre",
};

function loadHighlighter(): Promise<void> {
  if (_highlighterMod && _oneDark) return Promise.resolve();
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = Promise.all([
    import("react-syntax-highlighter"),
    import("react-syntax-highlighter/dist/esm/styles/prism/one-dark"),
  ]).then(([mod, style]) => {
    _highlighterMod = mod;
    _oneDark = style.default;
  });
  return _loadingPromise;
}

// Diff viewer with colored +/- lines
function DiffView({ code }: { code: string }): React.JSX.Element {
  const lines = code.split("\n");
  return (
    <div className="chat-diff-content">
      {lines.map((line, i) => {
        let cls = "chat-diff-line";
        if (line.startsWith("+")) cls += " chat-diff-add";
        else if (line.startsWith("-")) cls += " chat-diff-remove";
        else if (line.startsWith("@@")) cls += " chat-diff-hunk";
        return (
          <div key={i} className={cls}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

function PlainCodeView({ code }: { code: string }): React.JSX.Element {
  return (
    <pre className="chat-code-plain" style={PLAIN_PRE_STYLE}>
      <code style={PLAIN_CODE_STYLE}>{code}</code>
    </pre>
  );
}

// Source-position ids of code blocks the user has expanded. Kept at module
// scope so the choice survives the remounts react-markdown causes while a
// message is still streaming (index-based keys shift as the AST grows, which
// would otherwise reset a per-component useState back to collapsed).
const expandedCodeBlocks = new Set<string>();

// Code block with syntax highlighting and copy button (lazy-loaded highlighter)
function CodeBlock({
  className,
  children,
  blockId,
}: {
  className?: string;
  children?: React.ReactNode;
  blockId?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() =>
    blockId ? !expandedCodeBlocks.has(blockId) : true,
  );
  const [highlighterReady, setHighlighterReady] = useState(
    () => _highlighterMod !== null && _oneDark !== null,
  );
  const code = String(children).replace(/\n$/, "");
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const isDiff = language === "diff";
  const hasBoxDrawing = BOX_DRAWING_RE.test(code);

  const linesCount = code.split("\n").length;
  const isLong = linesCount > 15 || code.length > 800;

  // Trigger lazy load when code block mounts. Blocks containing Unicode
  // box-drawing characters render as plain text to avoid Electron/Prism span
  // fragmentation truncating tree diagrams such as ├──, └── and │.
  useEffect(() => {
    if (!hasBoxDrawing && !isDiff && !highlighterReady) {
      loadHighlighter().then(() => setHighlighterReady(true));
    }
  }, [hasBoxDrawing, highlighterReady, isDiff]);

  function handleCopy(): void {
    void window.hermesAPI.copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const codeContent = hasBoxDrawing ? (
    <PlainCodeView code={code} />
  ) : isDiff ? (
    <DiffView code={code} />
  ) : highlighterReady && _highlighterMod && _oneDark ? (
    <_highlighterMod.Prism
      style={_oneDark}
      language={language || "text"}
      PreTag="div"
      customStyle={{
        margin: 0,
        borderRadius: 0,
        fontSize: "13px",
        padding: "12px",
        background: "transparent",
      }}
    >
      {code}
    </_highlighterMod.Prism>
  ) : (
    <PlainCodeView code={code} />
  );

  return (
    <div className="chat-code-block">
      <div className="chat-code-header">
        <span className="chat-code-lang">
          {hasBoxDrawing ? "text" : isDiff ? "diff" : language || "code"}
        </span>
        <button className="chat-code-copy" onClick={handleCopy}>
          {copied ? t("common.copied") : <Copy size={13} />}
        </button>
      </div>
      <div className={isLong && isCollapsed ? "chat-code-collapsed" : ""}>
        {codeContent}
      </div>
      {isLong && (
        <button
          type="button"
          className="chat-code-expand-btn"
          onClick={() =>
            setIsCollapsed((prev) => {
              const next = !prev;
              if (blockId) {
                if (next) expandedCodeBlocks.delete(blockId);
                else expandedCodeBlocks.add(blockId);
              }
              return next;
            })
          }
        >
          {isCollapsed
            ? t("common.showMore") || "Show more"
            : t("common.showLess") || "Show less"}
        </button>
      )}
    </div>
  );
}

// Shared Markdown renderer that opens links externally
const AgentMarkdown = memo(function AgentMarkdown({
  children,
}: {
  children: string;
}): React.JSX.Element {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (!href) return;
              try {
                const url = new URL(href, "https://placeholder.invalid");
                if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
                  return;
                }
                if (url.protocol === "http:" || url.protocol === "https:") {
                  const event = new CustomEvent("web-preview:navigate", {
                    detail: href,
                  });
                  document.dispatchEvent(event);
                  return;
                }
              } catch {
                return;
              }
              window.hermesAPI.openExternal(href);
            }}
          >
            {children}
          </a>
        ),
        img: ({ src }) => {
          if (typeof src !== "string" || src.length === 0) return null;
          // ![alt](file.pdf) parses as a markdown image but isn't an image —
          // route those to the download chip instead of letting MediaImage
          // try to load a non-image MIME and fail. (Follow-up from #303.)
          const token = describeImageSrc(src);
          return token.isImage ? (
            <MediaImage token={token} />
          ) : (
            <DownloadChip token={token} />
          );
        },
        code: ({ className, children, node, ...props }) => {
          const isInline =
            !className &&
            typeof children === "string" &&
            !children.includes("\n");
          if (isInline) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
          // Source offset of the opening fence is stable as the block streams,
          // so it survives react-markdown's streaming remounts (unlike index
          // keys) and uniquely identifies this block within the message.
          const start = node?.position?.start;
          const blockId =
            start != null
              ? `${start.offset ?? start.line}:${className ?? ""}`
              : undefined;
          return (
            <CodeBlock className={className} blockId={blockId}>
              {children}
            </CodeBlock>
          );
        },
      }}
    >
      {children}
    </Markdown>
  );
});

export { AgentMarkdown };
export default AgentMarkdown;
