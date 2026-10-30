export function isToolDeletion(
  name: string,
  input?: Record<string, unknown>,
): boolean;
export function toolPermissionDecision(
  mode: string | undefined,
  name: string,
  input?: Record<string, unknown>,
): "allow" | "deny" | "confirm";
