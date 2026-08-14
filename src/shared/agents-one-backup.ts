export interface AgentsOneBackupSummary {
  createdAt?: string;
  appVersion?: string;
  profileCount?: number;
  projectCount?: number;
  taskCount?: number;
  chatCount?: number;
  collaborationCount?: number;
  conflictCount?: number;
  warnings?: string[];
}

export interface AgentsOneBackupResult {
  success: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
}

export interface AgentsOneBackupInspection {
  success: boolean;
  error?: string;
  summary?: AgentsOneBackupSummary;
}

export interface AgentsOneRestoreResult {
  success: boolean;
  error?: string;
  restoredFiles?: number;
  warningCount?: number;
  warnings?: string[];
  requiresRestart?: boolean;
}
