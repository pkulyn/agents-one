import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import TaskCollaborationDialog from "./TaskCollaborationDialog";

function runtime(id: string, name: string): AgentRuntimeDefinition {
  return {
    id,
    name,
    kind: id === "hermes" ? "hermes" : "codex",
    location: id === "hermes" ? "remote" : "local",
    enabled: true,
    managed: "user",
    config: {},
  };
}

describe("TaskCollaborationDialog", () => {
  it("keeps editable role rows and sends an explicit shared brief", () => {
    const onStart = vi.fn();
    render(
      <TaskCollaborationDialog
        draft={{
          title: "整理项目文档",
          projectFolder: "D:\\work\\docs",
          sourceRuntimeId: "hermes",
        }}
        runtimes={[runtime("hermes", "Hermes"), runtime("codex", "Codex")]}
        onClose={() => {}}
        onStart={onStart}
      />,
    );

    expect(screen.getAllByText("docs").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("项目负责人智能体")).toHaveValue("hermes");

    fireEvent.change(screen.getByLabelText("实施智能体"), {
      target: { value: "codex" },
    });
    fireEvent.change(screen.getByLabelText("任务说明"), {
      target: { value: "整理项目文档并给出验收结果" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送并启动" }));

    expect(onStart).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "项目负责人", runtimeId: "hermes" }),
        expect.objectContaining({ role: "实施", runtimeId: "codex" }),
      ]),
      "整理项目文档并给出验收结果",
    );
  });

  it("allows custom roles to be added and removed", () => {
    render(
      <TaskCollaborationDialog
        draft={{ title: "自定义协作" }}
        runtimes={[runtime("hermes", "Hermes")]}
        onClose={() => {}}
        onStart={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "添加角色" }));
    expect(screen.getByDisplayValue("新角色")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("新角色"), {
      target: { value: "资料整理" },
    });
    expect(screen.getByDisplayValue("资料整理")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "移除角色" }).at(-1)!);
    expect(screen.queryByDisplayValue("资料整理")).not.toBeInTheDocument();
  });
});
