export interface ProjectFolderRecord {
  /** Stable opaque capability id. Renderer-facing APIs use this, not `path`. */
  id?: string;
  path: string;
  name: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Renderer-safe project reference. It deliberately carries no local path. */
export interface ProjectWorkspaceCapability {
  id: string;
  name: string;
  pinned?: boolean;
  updatedAt?: number;
}

export interface UpdateProjectFolderInput {
  /** Preferred identifier for a registered project. `path` is legacy-only. */
  id?: string;
  path?: string;
  name?: string;
  pinned?: boolean;
}
