export interface DesktopSourceReceipt {
  schema: number;
  sourceCommit: string;
  sourceTree: string;
  buildInputTreeSha256: string;
  inputPathsVersion: number;
  createdAt: string;
}
export const DESKTOP_BUILD_INPUTS: string[];
export function createDesktopSourceReceipt(
  source: string,
): DesktopSourceReceipt;
