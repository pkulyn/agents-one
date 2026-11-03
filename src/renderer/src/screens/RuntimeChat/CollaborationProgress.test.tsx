import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { t } from "../../../../shared/i18n";
import type { TaskCollaborationExecution } from "../../../../shared/task-collaboration";
import { CollaborationProgress } from "./CollaborationProgress";
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      t(key, "zh-CN", options),
  }),
}));
const execution: TaskCollaborationExecution = {
  status: "running",
  roleRuns: [
    {
      assignmentId: "lead",
      runtimeId: "pi",
      role: "编排",
      status: "succeeded",
    },
    {
      assignmentId: "work",
      runtimeId: "opencode",
      role: "检索",
      status: "running",
    },
    {
      assignmentId: "review",
      runtimeId: "pi",
      role: "复核",
      status: "pending",
    },
  ],
  updatedAt: 1,
};
const assignments = [
  { id: "lead", runtimeId: "pi", role: "编排", responsibility: "制定计划" },
  {
    id: "work",
    runtimeId: "opencode",
    role: "检索",
    responsibility: "检索官方来源",
  },
  { id: "review", runtimeId: "pi", role: "复核", responsibility: "复核资讯" },
];
describe("Inline collaboration progress", () => {
  it("shows actual role completion and supports direct role communication", () => {
    const intervene = vi.fn();
    render(
      <CollaborationProgress
        enabled
        execution={execution}
        assignments={assignments}
        runtimes={{}}
        onIntervene={intervene}
      />,
    );
    expect(screen.getByText("已完成 1/3")).toBeVisible();
    expect(screen.queryByText("检索官方来源")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "与 opencode（检索）沟通" }),
    );
    expect(intervene).toHaveBeenCalledWith(assignments[1], "work");
    fireEvent.click(screen.getByRole("button", { name: /协作进展/ }));
    expect(screen.getByText("检索官方来源")).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "查看与沟通" })[1]);
    expect(screen.queryByText("检索官方来源")).not.toBeInTheDocument();
  });
  it("automatically hides at completion, cancellation, and in single mode", () => {
    const props = {
      enabled: true,
      execution,
      assignments,
      runtimes: {},
      onIntervene: vi.fn(),
    };
    const view = render(<CollaborationProgress {...props} />);
    view.rerender(
      <CollaborationProgress
        {...props}
        execution={{ ...execution, status: "succeeded", completedAt: 2 }}
      />,
    );
    expect(screen.queryByLabelText("协作进展")).not.toBeInTheDocument();
    view.rerender(
      <CollaborationProgress
        {...props}
        execution={{ ...execution, status: "needs_review", completedAt: 2 }}
      />,
    );
    expect(screen.queryByLabelText("协作进展")).not.toBeInTheDocument();
    view.rerender(
      <CollaborationProgress
        {...props}
        execution={{ ...execution, status: "failed", completedAt: 2 }}
      />,
    );
    expect(screen.queryByLabelText("协作进展")).not.toBeInTheDocument();
    view.rerender(<CollaborationProgress {...props} enabled={false} />);
    expect(screen.queryByLabelText("协作进展")).not.toBeInTheDocument();
    view.rerender(
      <CollaborationProgress
        {...props}
        execution={{ ...execution, status: "cancelled" }}
      />,
    );
    expect(screen.queryByLabelText("协作进展")).not.toBeInTheDocument();
  });
  it("retains actionable progress while waiting for the user", () => {
    render(
      <CollaborationProgress
        enabled
        execution={{
          ...execution,
          status: "waiting_for_user",
          roleRuns: [{ ...execution.roleRuns[1], status: "waiting_for_user" }],
        }}
        assignments={assignments}
        runtimes={{}}
        onIntervene={vi.fn()}
      />,
    );
    expect(screen.getByText("等待人工处理")).toBeVisible();
  });
});
