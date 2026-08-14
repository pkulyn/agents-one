export type ArchiveItemKind = "task" | "project";

export interface ArchivedItem {
  id: string;
  kind: ArchiveItemKind;
  targetId: string;
  title: string;
  projectPath?: string;
  runtimeId?: string;
  archivedAt: number;
}

export interface ArchiveItemInput {
  kind: ArchiveItemKind;
  targetId: string;
  title: string;
  projectPath?: string;
  runtimeId?: string;
}
