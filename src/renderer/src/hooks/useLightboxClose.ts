import { useEffect } from "react";

/**
 * Close the image lightbox on Escape. The document-level listener is bound
 * only while `active`, so it exists just for the overlay's lifetime. Shared
 * by MediaImage and AttachmentChip so both lightboxes behave identically.
 */
export function useLightboxClose(active: boolean, close: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, close]);
}
