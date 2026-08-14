export interface ProjectFolderRecord {
  path: string;
  name: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UpdateProjectFolderInput {
  path: string;
  name?: string;
  pinned?: boolean;
}
