export type ArchiveItemKind = "task" | "project";

export interface ArchivedItem {
  id: string;
  kind: ArchiveItemKind;
  targetId: string;
  title: string;
  projectPath?: string;
  /** Opaque project capability for new project archives. */
  projectWorkspaceId?: string;
  runtimeId?: string;
  archivedAt: number;
}

export interface ArchiveItemInput {
  kind: ArchiveItemKind;
  targetId: string;
  title: string;
  projectPath?: string;
  /** Opaque project capability for new project archives. */
  projectWorkspaceId?: string;
  runtimeId?: string;
}
