/** Shared tool intent policy for desktop and remote adapters. It is not an OS sandbox. */
export function isToolDeletion(name, input = {}) {
  const word =
    /(?:^|[_\s.-])(?:delete|remove|unlink|rmdir|trash)(?:$|[_\s.-])/i;
  if (
    /^(?:delete|remove|unlink|trash)(?:[A-Z]|$)/.test(name) ||
    word.test(name) ||
    /^(?:删除|移入回收站)/.test(name)
  )
    return true;
  const commandDeletes = (value) => {
    const command = Array.isArray(value)
      ? value.join(" ")
      : typeof value === "string"
        ? value
        : "";
    return (
      /(?:^|[\s;&|()"'])(?:rm|rmdir|rd|del|erase|Remove-Item|Clear-RecycleBin)(?:$|[\s;&|()"'])/i.test(
        command,
      ) ||
      /\.(?:unlink(?:Sync)?|rmdir(?:Sync)?|rm(?:Sync)?|rmtree|deleteFile|deleteDirectory)\s*\(/i.test(
        command,
      ) ||
      /\b(?:os|fs|shutil|File|Directory|Files)\s*\.\s*(?:remove|delete)\s*\(/i.test(
        command,
      ) ||
      /\*\*\* Delete File:/.test(command) ||
      /(?:^|[\s+_-])(?:delete|trash)(?:\s|$)/i.test(command)
    );
  };
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 12) return false;
    if (Array.isArray(value))
      return value.some((item) => visit(item, depth + 1));
    if (
      word.test(
        String(
          value.operation || value.action || value.kind || value.type || "",
        ),
      )
    )
      return true;
    for (const key of [
      "command",
      "cmd",
      "code",
      "script",
      "patch",
      "patchText",
      "diff",
    ]) {
      if (commandDeletes(value[key])) return true;
    }
    for (const key of [
      "input",
      "arguments",
      "tool_input",
      "rawInput",
      "changes",
      "fileChanges",
      "operations",
      "actions",
      "kind",
      "payload",
    ]) {
      if (visit(value[key], depth + 1)) return true;
      if (
        (key === "changes" || key === "fileChanges") &&
        value[key] &&
        typeof value[key] === "object" &&
        Object.values(value[key]).some((item) => visit(item, depth + 1))
      )
        return true;
    }
    return false;
  };
  return visit(input);
}

export function toolPermissionDecision(mode, name, input = {}) {
  if (mode === "full_access" || mode === "implementation") return "allow";
  if (mode === "safe_write")
    return isToolDeletion(name, input) ? "confirm" : "allow";
  const kind = String(input.kind || "").toLowerCase();
  return ["read", "search", "fetch", "think"].includes(kind) &&
    !isToolDeletion(name, input)
    ? "allow"
    : "deny";
}
