export type WorkspaceDocumentFormat = "pdf" | "docx" | "xlsx" | "pptx";

export function workspaceDocumentFormat(
  path: string,
): WorkspaceDocumentFormat | undefined {
  if (typeof path !== "string") return undefined;
  const extension = /\.([^.\\/]+)$/.exec(path)?.[1].toLowerCase();
  if (
    extension === "pdf" ||
    extension === "docx" ||
    extension === "xlsx" ||
    extension === "pptx"
  ) {
    return extension;
  }
  return undefined;
}

export type WorkspaceDocumentRead =
  | { status: "ok"; bytes: Uint8Array<ArrayBuffer> }
  | { status: "unavailable" | "tooLarge" };
