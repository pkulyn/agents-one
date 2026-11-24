import { open } from "node:fs/promises";
import {
  workspaceDocumentFormat,
  type WorkspaceDocumentRead,
} from "../../shared/workspace-document-preview";

const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;

/** Accept only a path already resolved by the workspace authorization layer. */
export async function readWorkspaceDocument(
  filePath: string | null,
  requestedPath: string,
): Promise<WorkspaceDocumentRead> {
  const format = workspaceDocumentFormat(requestedPath);
  if (!filePath || !format || workspaceDocumentFormat(filePath) !== format) {
    return { status: "unavailable" };
  }
  try {
    const handle = await open(filePath, "r");
    try {
      const info = await handle.stat();
      if (!info.isFile()) return { status: "unavailable" };
      if (info.size > MAX_DOCUMENT_BYTES) return { status: "tooLarge" };
      const bytes = new Uint8Array(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (!bytesRead) return { status: "unavailable" };
        offset += bytesRead;
      }
      if ((await handle.stat()).size !== info.size)
        return { status: "unavailable" };
      return { status: "ok", bytes };
    } finally {
      await handle.close();
    }
  } catch {
    return { status: "unavailable" };
  }
}
