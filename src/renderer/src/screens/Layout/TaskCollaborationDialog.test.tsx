import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import { t as translate } from "../../../../shared/i18n";

const i18nTestState = vi.hoisted(() => ({
  locale: "zh-CN" as "en" | "zh-CN",
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    locale: i18nTestState.locale,
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, i18nTestState.locale, options),
  }),
}));

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

function selectAgent(label: string, name: string): void {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name }));
}

describe("TaskCollaborationDialog", () => {
  beforeEach(() => {
    i18nTestState.locale = "zh-CN";
  });

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
    expect(screen.getByLabelText("项目负责人智能体")).toHaveTextContent(
      "Hermes",
    );

    selectAgent("实施智能体", "Codex");
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

  it("creates new default assignments in English without rewriting draft data", () => {
    i18nTestState.locale = "en";
    const onStart = vi.fn();
    render(
      <TaskCollaborationDialog
        draft={{
          title: "发布检查",
          sourceRuntimeId: "hermes",
          message: "Review the release",
        }}
        runtimes={[runtime("hermes", "Hermes"), runtime("codex", "Codex")]}
        onClose={() => {}}
        onStart={onStart}
      />,
    );

    expect(screen.getByText("Multi-agent collaboration")).toBeVisible();
    expect(screen.getByText("发布检查")).toBeVisible();
    expect(screen.getByDisplayValue("Project lead")).toBeVisible();
    expect(screen.getByLabelText("Project lead agent")).toHaveTextContent(
      "Hermes",
    );
    selectAgent("Implementation agent", "Codex");
    fireEvent.click(screen.getByRole("button", { name: "Send and start" }));

    expect(onStart).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "Project lead", runtimeId: "hermes" }),
        expect.objectContaining({ role: "Implementation", runtimeId: "codex" }),
      ]),
      "Review the release",
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
    fireEvent.click(
      screen.getAllByRole("button", { name: "移除角色" }).at(-1)!,
    );
    expect(screen.queryByDisplayValue("资料整理")).not.toBeInTheDocument();
  });

  it("uses the remote runtime's own device when no local project is attached", () => {
    const onStart = vi.fn();
    render(
      <TaskCollaborationDialog
        draft={{
          title: "远程主机维护",
          sourceRuntimeId: "hermes",
        }}
        runtimes={[runtime("hermes", "Hers")]}
        onClose={() => {}}
        onStart={onStart}
      />,
    );

    expect(screen.getByLabelText("项目负责人工作区访问方式")).toHaveValue("");
    expect(screen.getByLabelText("项目负责人工作区访问方式")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("任务说明"), {
      target: { value: "在智能体所在设备执行备份任务" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送并启动" }));

    expect(onStart).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          role: "项目负责人",
          runtimeId: "hermes",
        }),
      ],
      "在智能体所在设备执行备份任务",
    );
  });
});

describe("Configure task mode without dispatch", () => {
  it("requires a complete team and enables collaboration without a brief", () => {
    const onStart = vi.fn();
    render(
      <TaskCollaborationDialog
        draft={{
          title: "Team",
          sourceRuntimeId: "hermes",
          configureOnly: true,
        }}
        runtimes={[runtime("hermes", "Hermes"), runtime("codex", "Codex")]}
        onClose={() => {}}
        onStart={onStart}
      />,
    );
    expect(screen.queryByLabelText("任务说明")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启用协作" })).toBeDisabled();
    selectAgent("实施智能体", "Codex");
    selectAgent("测试智能体", "Codex");
    fireEvent.click(screen.getByRole("button", { name: "启用协作" }));
    expect(onStart).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ runtimeId: "hermes" }),
        expect.objectContaining({ runtimeId: "codex" }),
      ]),
      "",
    );
  });
});

describe("English explicit mode", () => {
  it("keeps both initial selections while configuring the complete team", () => {
    i18nTestState.locale = "en";
    const onStart = vi.fn();
    render(
      <TaskCollaborationDialog
        draft={{
          title: "Team",
          sourceRuntimeId: "hermes",
          configureOnly: true,
        }}
        runtimes={[runtime("hermes", "Hermes"), runtime("codex", "Codex")]}
        onClose={() => {}}
        onStart={onStart}
      />,
    );
    selectAgent("Implementation agent", "Codex");
    selectAgent("Testing agent", "Hermes");
    expect(screen.getByLabelText("Implementation agent")).toHaveTextContent(
      "Codex",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Enable collaboration" }),
    );
    expect(onStart).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "Implementation", runtimeId: "codex" }),
        expect.objectContaining({ role: "Testing", runtimeId: "hermes" }),
      ]),
      "",
    );
  });
});

describe("Role presets and compatibility", () => {
  beforeEach(() => {
    i18nTestState.locale = "zh-CN";
  });
  it("fills responsibilities and context when choosing a role, with no fixed workspace access", () => {
    const onStart = vi.fn();
    render(
      <TaskCollaborationDialog
        draft={{
          title: "Team",
          sourceRuntimeId: "hermes",
          message: "Research",
        }}
        runtimes={[runtime("hermes", "Hermes"), runtime("codex", "Codex")]}
        onClose={() => {}}
        onStart={onStart}
      />,
    );
    fireEvent.change(screen.getAllByLabelText("角色")[1], {
      target: { value: "researcher" },
    });
    selectAgent("资料研究智能体", "Codex");
    expect(
      screen.getAllByText(
        "检索并核对一手资料，记录来源、日期、证据与待确认事项。",
      )[0],
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "发送并启动" }));
    expect(onStart.mock.calls[0][0][1]).toEqual(
      expect.objectContaining({
        role: "资料研究",
        responsibility: expect.stringContaining("一手资料"),
        contextSources: ["project", "handoffs"],
      }),
    );
    expect(onStart.mock.calls[0][0][1].workspaceAccess).toBeUndefined();
  });
  it("preserves a custom role, context, mapping and explicit DAG when reopened", () => {
    const onStart = vi.fn();
    const assignments = [
      {
        id: "lead",
        role: "统筹研究",
        runtimeId: "hermes",
        responsibility: "保留原职责",
        context: "保留原材料",
        dependsOn: [],
        workspaceAccess: "remote_mapping" as const,
        workspaceRef: "/remote/research",
      },
      {
        id: "work",
        role: "数据核对",
        runtimeId: "codex",
        responsibility: "核对",
        context: "指定材料",
        dependsOn: ["lead"],
      },
    ];
    render(
      <TaskCollaborationDialog
        draft={{ title: "Team", assignments, message: "继续" }}
        runtimes={[runtime("hermes", "Hermes"), runtime("codex", "Codex")]}
        onClose={() => {}}
        onStart={onStart}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "发送并启动" }));
    expect(onStart).toHaveBeenCalledWith(assignments, "继续");
  });
  it("shows avatar options and supports keyboard choice and Escape", () => {
    render(
      <TaskCollaborationDialog
        draft={{ title: "Team" }}
        runtimes={[
          { ...runtime("codex", "Codex"), avatar: "data:image/png;base64,abc" },
          runtime("hermes", "Hermes"),
        ]}
        onClose={() => {}}
        onStart={() => {}}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "实施智能体" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(
      screen.getByRole("option", { name: "Codex" }).querySelector("img"),
    ).toHaveAttribute("src", "data:image/png;base64,abc");
    fireEvent.click(screen.getByRole("option", { name: "Codex" }));
    expect(trigger).toHaveTextContent("Codex");
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
