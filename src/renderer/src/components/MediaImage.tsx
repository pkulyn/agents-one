import { useState, useEffect } from "react";
import { Download, X } from "lucide-react";
import type { MediaToken } from "../screens/Chat/mediaUtils";

/**
 * Renders an agent-delivered image (issue #299). Data URLs and http(s)
 * URLs render directly; local filesystem paths are resolved to a data URL
 * through the main process. Clicking the image opens a zoom/lightbox
 * overlay with a "Save image" action.
 */
export function MediaImage({
  token,
}: {
  token: MediaToken;
}): React.JSX.Element {
  const isDirect =
    token.src.startsWith("data:") || /^https?:\/\//i.test(token.src);
  const [resolved, setResolved] = useState<string | null>(
    isDirect ? token.src : null,
  );
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (isDirect) return;
    let cancelled = false;
    window.hermesAPI
      .readMediaFile(token.src)
      .then((dataUrl) => {
        if (cancelled) return;
        if (dataUrl) setResolved(dataUrl);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token.src, isDirect]);

  if (failed) {
    return (
      <span className="chat-media-error">
        ⚠ Could not load {token.name}
      </span>
    );
  }

  if (!resolved) {
    return (
      <span className="chat-media-loading">Loading {token.name}…</span>
    );
  }

  return (
    <>
      <img
        className="chat-media-image"
        src={resolved}
        alt={token.name}
        onClick={() => setZoomed(true)}
        onError={() => setFailed(true)}
      />
      {zoomed && (
        <div
          className="chat-image-preview-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomed(false)}
        >
          <img
            className="chat-image-preview-image"
            src={resolved}
            alt={token.name}
            onClick={(e) => e.stopPropagation()}
          />
          <div
            className="chat-image-preview-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="chat-image-preview-btn"
              onClick={() =>
                window.hermesAPI.saveMediaFile(token.src, token.name)
              }
            >
              <Download size={14} />
              Save image
            </button>
            <button
              className="chat-image-preview-btn"
              onClick={() => setZoomed(false)}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default MediaImage;
