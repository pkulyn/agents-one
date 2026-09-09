/** Read-only metadata for skills discovered in user-managed directories. */
export interface RuntimeSkillDescriptor {
  id: string;
  name: string;
  description?: string;
  source: "user" | "project" | "runtime";
  location: string;
  enabled: boolean;
  trust: "local-user" | "project-unreviewed" | "runtime-managed";
  /** Discovery never grants executable Electron-main privileges. */
  executionBoundary: "runtime-subprocess" | "documentation-only";
}

export interface RuntimeConnectorDescriptor {
  id: string;
  version?: string;
  source: string;
  capabilities: string[];
  executionBoundary: "process-external";
}
