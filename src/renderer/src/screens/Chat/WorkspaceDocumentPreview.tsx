import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useI18n } from "../../components/useI18n";
import type { WorkspaceDocumentFormat } from "../../../../shared/workspace-document-preview";
import {
  loadOfficePreview,
  type OfficeBlock,
  type OfficePage,
  type OfficePreview,
} from "./officeDocumentPreview";

type Reason = "unavailable" | "tooLarge" | "password" | "invalid";

function failureReason(error: unknown): Reason {
  if (error instanceof Error) {
    if (error.name === "PasswordException" || error.message === "password")
      return "password";
    if (error.message === "tooLarge") return "tooLarge";
  }
  return "invalid";
}

function PreviewNotice({ reason }: { reason: Reason }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="file-viewer-binary" role="status">
      <strong>{t("chat.worktree.previewFailure." + reason)}</strong>
      <span className="file-viewer-binary-hint">
        {t("chat.worktree.defaultAppHint")}
      </span>
    </div>
  );
}

function Pager({
  index,
  count,
  onChange,
}: {
  index: number;
  count: number;
  onChange: (index: number) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <button
        type="button"
        disabled={index === 0}
        onClick={() => onChange(index - 1)}
      >
        {t("chat.worktree.previousPage")}
      </button>
      <span>
        {index + 1} / {count}
      </span>
      <button
        type="button"
        disabled={index + 1 >= count}
        onClick={() => onChange(index + 1)}
      >
        {t("chat.worktree.nextPage")}
      </button>
    </>
  );
}

function PdfPreview({
  document,
}: {
  document: PDFDocumentProxy;
}): React.JSX.Element {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [painting, setPainting] = useState(true);
  const [error, setError] = useState<Reason>();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    setPainting(true);
    setError(undefined);
    void (async () => {
      try {
        const page = await document.getPage(index + 1);
        const target = canvas.current;
        if (cancelled || !target) return;
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(
            (760 * zoom) / original.width,
            2400 / Math.max(original.width, original.height),
          ),
        });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        target.width = Math.ceil(viewport.width * pixelRatio);
        target.height = Math.ceil(viewport.height * pixelRatio);
        target.style.width = viewport.width + "px";
        target.style.height = viewport.height + "px";
        render = page.render({
          canvas: target,
          viewport,
          transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        await render.promise;
      } catch (cause) {
        if (!cancelled) setError(failureReason(cause));
      } finally {
        if (!cancelled) setPainting(false);
      }
    })();
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [document, index, zoom]);

  return (
    <div className="workspace-document">
      <div className="workspace-document-tools">
        <Pager index={index} count={document.numPages} onChange={setIndex} />
        <button
          type="button"
          aria-label={t("chat.worktree.zoomOut")}
          disabled={zoom <= 0.5}
          onClick={() => setZoom(zoom - 0.25)}
        >
          −
        </button>
        <span>{Math.round(100 * zoom)}%</span>
        <button
          type="button"
          aria-label={t("chat.worktree.zoomIn")}
          disabled={zoom >= 2}
          onClick={() => setZoom(zoom + 0.25)}
        >
          +
        </button>
      </div>
      {error ? (
        <PreviewNotice reason={error} />
      ) : (
        painting && (
          <div className="file-viewer-loading" role="status">
            {t("chat.worktree.loading")}
          </div>
        )
      )}
      <div
        className="workspace-document-pdf"
        aria-busy={painting}
        hidden={Boolean(error)}
      >
        <canvas
          key={index + ":" + zoom}
          ref={canvas}
          aria-label={t("chat.worktree.previewPage", { page: index + 1 })}
        />
      </div>
    </div>
  );
}

function OfficeBlocks({
  page,
  slide = false,
}: {
  page: OfficePage;
  slide?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <article
      className={
        "workspace-document-paper" + (slide ? " workspace-document-slide" : "")
      }
    >
      {page.blocks.length ? (
        page.blocks.map((block: OfficeBlock, index) => {
          if (block.kind === "image")
            return <img key={index} alt={block.alt} src={block.src} />;
          if (block.kind === "table")
            return (
              <div className="workspace-document-table" key={index}>
                <table>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, column) => (
                          <td key={column}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          const Tag = block.heading === 1 ? "h2" : block.heading ? "h3" : "p";
          return (
            <Tag key={index}>
              {block.runs.map((run, index) => (
                <span
                  key={index}
                  style={{
                    fontWeight: run.bold ? 700 : undefined,
                    fontStyle: run.italic ? "italic" : undefined,
                  }}
                >
                  {run.text}
                </span>
              ))}
            </Tag>
          );
        })
      ) : (
        <p>{t("chat.worktree.previewNoContent")}</p>
      )}
      {page.limited && (
        <p className="file-viewer-truncated">
          {t("chat.worktree.previewLimited")}
        </p>
      )}
    </article>
  );
}

function columnName(index: number): string {
  const prefix = Math.floor(index / 26);
  return (
    (prefix ? String.fromCharCode(64 + prefix) : "") +
    String.fromCharCode(65 + (index % 26))
  );
}

function PagedOfficePreview({
  document,
}: {
  document: Exclude<OfficePreview, { kind: "word" }>;
}): React.JSX.Element {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<
    | {
        index: number;
        page:
          | OfficePage
          | Awaited<
              ReturnType<Extract<OfficePreview, { kind: "sheet" }>["read"]>
            >;
      }
    | { index: number; error: Reason }
  >();

  useEffect(() => {
    let active = true;
    void document.read(index).then(
      (page) => {
        if (active) setState({ index, page });
      },
      (error: unknown) => {
        if (active) setState({ index, error: failureReason(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [document, index]);
  const data = state?.index === index ? state : undefined;
  const columns =
    data && "page" in data && "columns" in data.page ? data.page.columns : 0;

  return (
    <div className="workspace-document">
      <div className="workspace-document-tools">
        {document.kind === "slides" ? (
          <Pager index={index} count={document.count} onChange={setIndex} />
        ) : (
          <label>
            {t("chat.worktree.worksheet")}{" "}
            <select
              value={index}
              onChange={(event) => setIndex(Number(event.target.value))}
            >
              {document.names.map((name, sheet) => (
                <option value={sheet} key={sheet}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!data ? (
        <div className="file-viewer-loading" role="status">
          {t("chat.worktree.loading")}
        </div>
      ) : "error" in data ? (
        <PreviewNotice reason={data.error} />
      ) : "blocks" in data.page ? (
        <OfficeBlocks page={data.page} slide />
      ) : data.page.columns === 0 ? (
        <div className="file-viewer-loading">
          {t("chat.worktree.previewNoContent")}
        </div>
      ) : (
        <div className="workspace-document-table workspace-document-sheet">
          {data.page.limited && (
            <p className="file-viewer-truncated">
              {t("chat.worktree.previewLimited")}
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th />
                {Array.from({ length: columns }, (_, column) => (
                  <th key={column} scope="col">
                    {columnName(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.page.rows.map(({ number, values }, row) => (
                <tr key={row}>
                  <th scope="row">{number}</th>
                  {Array.from({ length: columns }, (_, column) => (
                    <td key={column}>{values[column] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function WorkspaceDocumentPreview({
  workspaceId,
  filePath,
  format,
}: {
  workspaceId: string;
  filePath: string;
  format: WorkspaceDocumentFormat;
}): React.JSX.Element {
  const { t } = useI18n();
  const [state, setState] = useState<
    { reason: Reason } | { pdf: PDFDocumentProxy } | { office: OfficePreview }
  >();

  useEffect(() => {
    let active = true;
    let stopPdf: (() => Promise<void>) | undefined;
    void (async () => {
      try {
        const result = await window.agentsOneAPI.readWorkspaceDocument(
          workspaceId,
          filePath,
        );
        if (!active) return;
        if (result.status !== "ok") {
          setState({ reason: result.status });
          return;
        }
        if (format !== "pdf") {
          const office = await loadOfficePreview(result.bytes, format);
          if (active) setState({ office });
          return;
        }
        const [{ getDocument, GlobalWorkerOptions }, worker] =
          await Promise.all([
            import("pdfjs-dist/legacy/build/pdf.mjs"),
            import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
          ]);
        if (!active) return;
        GlobalWorkerOptions.workerSrc = worker.default;
        const task = getDocument({
          data: result.bytes,
          isEvalSupported: false,
          enableXfa: false,
          maxImageSize: 16_000_000,
        });
        stopPdf = () => task.destroy();
        const pdf = await task.promise;
        if (active) setState({ pdf });
      } catch (error) {
        if (active) setState({ reason: failureReason(error) });
      }
    })();
    return () => {
      active = false;
      void stopPdf?.().catch(() => {});
    };
  }, [filePath, format, workspaceId]);

  if (!state)
    return (
      <div className="file-viewer-loading" role="status">
        {t("chat.worktree.loading")}
      </div>
    );
  if ("reason" in state) return <PreviewNotice reason={state.reason} />;
  if ("pdf" in state) return <PdfPreview document={state.pdf} />;
  if (state.office.kind === "word")
    return <OfficeBlocks page={state.office.page} />;
  return <PagedOfficePreview document={state.office} />;
}
