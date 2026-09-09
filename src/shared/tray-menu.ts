export interface TrayMenuTask {
  id: string;
  title: string;
  projectName: string;
  openTaskId?: string;
}

export interface TrayMenuData {
  running: TrayMenuTask[];
  recent: TrayMenuTask[];
  more: TrayMenuTask[];
  runningCount: number;
}

export const TRAY_MENU_COLLAPSED_WIDTH = 360;
export const TRAY_MENU_EXPANDED_WIDTH = 744;

export type TrayMenuAction =
  | { type: "close" }
  | { type: "open-task"; taskId: string }
  | { type: "new-task" }
  | { type: "open-main" }
  | { type: "quit" };
