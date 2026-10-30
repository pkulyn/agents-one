export {
  isToolDeletion,
  toolPermissionDecision,
} from "../../plugins/agents-one-plugin/src/tool-permission-policy.mjs";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeTaskInput,
} from "./agent-runtimes";

export type RuntimeTaskMode = NonNullable<AgentRuntimeTaskInput["mode"]>;

/** Automatic is the UI default; transport capabilities still bound execution. */
// @lat: [[runtime-chat#Automatic permission defaults]]
export function automaticRuntimeTaskMode(
  runtime: Pick<AgentRuntimeDefinition, "kind" | "location">,
  _hasWorkspace = false,
): "analysis" | "safe_write" {
  if (runtime.kind === "web-agent") return "analysis";
  return "safe_write";
}

/** Explain the actual authority every turn, including resumed native sessions. */
// @lat: [[runtime-chat#Permission conflict feedback]]
export function runtimePermissionInstruction(mode: RuntimeTaskMode): string {
  const policy =
    mode === "analysis"
      ? "当前权限：只读。可以调用读取、列举、搜索、查询工具；禁止创建、编辑、覆盖、移动和删除文件，也禁止产生其他写入副作用。需要编辑或创建时，请明确告知用户切换为“自动”；需要删除时，请明确告知用户切换为“自动”并确认本次删除，或选择“完全访问”。"
      : mode === "safe_write"
        ? "当前权限：自动。可读取、查询、创建和编辑文件，也可使用终端、脚本、MCP 和文档生成工具完成这些工作。删除文件或文档前必须请求用户确认本次删除；用户拒绝时不得执行，也不得通过脚本或其他工具绕过确认。"
        : mode === "implementation"
          ? "当前权限：隔离工作区。修改仅在隔离工作区生效，不得把隔离工作区中的改动声称为已修改用户的原项目。"
          : "当前权限：完全访问。可读取、创建和编辑，删除文件或文档不需要再次授权确认。不要求关联项目目录，可按用户提供的绝对路径操作执行主机上的文件。仅执行用户要求的工作，尊重运行时和操作系统返回的实际权限限制。";
  return [
    "[Agents One 本轮权限]",
    policy,
    "先核对任务所需能力和本轮权限。权限不足或工具被拒绝时，请用用户的语言具体说明：哪个操作未执行、阻止原因、需要切换的权限或补充的授权。不要尝试绕过权限，不要声称已经完成。",
    "能够执行时应实际调用工具并完成任务；不要只回复“稍等”“马上读取”“现在执行”就结束。没有可用工具时明确说明缺少的能力。",
  ].join("\n");
}

export function withRuntimePermissionContext(
  prompt: string,
  mode: RuntimeTaskMode,
): string {
  return `${prompt}\n\n${runtimePermissionInstruction(mode)}`;
}

/** Keep deletion restoration visible even when a provider exits successfully. */
export function runtimeRemovalBlockedMessage(
  paths: string[],
): string | undefined {
  if (!paths.length) return undefined;
  return `[Agents One 权限不足] 当前“自动”权限不允许移动或删除原有文件，已恢复：${paths.slice(0, 8).join("、")}${paths.length > 8 ? "等" : ""}。该移动或删除操作未完成；如需执行，请切换为“完全访问”后重新发送任务。`;
}

export function isRuntimePermissionFailure(error?: string): boolean {
  return Boolean(error?.includes("[Agents One 权限不足]"));
}

/** Detect explicit removal operations without treating ordinary edits as deletes. */
export function isRuntimeRemovalOperation(
  name: string,
  input: Record<string, unknown> = {},
): boolean {
  if (
    /(?:^|[_\s-])(?:delete|remove|unlink|move|rename)(?:$|[_\s-])/i.test(name)
  )
    return true;
  if (/^(?:删除|移动|重命名)/.test(name)) return true;
  if (
    ["delete", "remove", "unlink", "move", "rename"].includes(
      String(input.operation || input.action || "").toLowerCase(),
    )
  )
    return true;
  const command = typeof input.command === "string" ? input.command : "";
  return (
    /(?:^|[\s;&|()])(?:rm|rmdir|rd|del|erase|Remove-Item|Move-Item|Rename-Item)(?:$|[\s;&|()])/i.test(
      command,
    ) ||
    /\.(?:unlink(?:Sync)?|rmdir(?:Sync)?|rm(?:Sync)?|rename(?:Sync)?|remove)\s*\(/.test(
      command,
    )
  );
}
