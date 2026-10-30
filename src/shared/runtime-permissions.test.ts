import { describe, expect, it } from "vitest";
import {
  automaticRuntimeTaskMode,
  runtimePermissionInstruction,
} from "./runtime-permissions";

describe("Runtime permission semantics", () => {
  // @lat: [[runtime-chat#Automatic permission defaults]]
  it("uses automatic native execution across local agents while retaining transport limits", () => {
    for (const kind of [
      "pi",
      "codex",
      "claude-code",
      "hermes",
      "opencode",
      "custom-agent",
    ]) {
      expect(automaticRuntimeTaskMode({ kind, location: "local" }, true)).toBe(
        "safe_write",
      );
    }
    expect(automaticRuntimeTaskMode({ kind: "pi", location: "local" })).toBe(
      "safe_write",
    );
    expect(
      automaticRuntimeTaskMode({ kind: "web-agent", location: "local" }),
    ).toBe("analysis");
    expect(
      automaticRuntimeTaskMode({ kind: "opencode", location: "local" }),
    ).toBe("safe_write");
    expect(
      automaticRuntimeTaskMode({ kind: "custom-agent", location: "remote" }),
    ).toBe("safe_write");
  });

  // @lat: [[runtime-chat#Permission conflict feedback]]
  it("tells every agent to identify blocked operations and the required permission before acting", () => {
    const readOnly = runtimePermissionInstruction("analysis");
    expect(readOnly).toContain("可以调用读取、列举、搜索、查询工具");
    expect(readOnly).toContain("禁止创建、编辑、覆盖、移动和删除");
    expect(readOnly).toContain("切换为“自动”");
    const automatic = runtimePermissionInstruction("safe_write");
    expect(automatic).toContain("终端、脚本、MCP 和文档生成工具");
    expect(automatic).toContain("删除文件或文档前必须请求用户确认本次删除");
    expect(automatic).toContain("用户拒绝时不得执行");
    for (const mode of [
      "analysis",
      "safe_write",
      "full_access",
      "implementation",
    ] as const) {
      expect(runtimePermissionInstruction(mode)).toContain("哪个操作未执行");
      expect(runtimePermissionInstruction(mode)).toContain("不要只回复");
    }
  });
});
