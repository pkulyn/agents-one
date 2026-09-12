import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import { t as translate } from "../../../../shared/i18n";

const i18nTestState = vi.hoisted(() => ({
  locale: "zh-CN" as "en" | "zh-CN",
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, i18nTestState.locale, options),
  }),
}));

import TaskCollaborationWorkspace from "./TaskCollaborationWorkspace";

const runtimes: AgentRuntimeDefinition[] = [
  {
    id: "hermes",
    name: "Hermes",
    kind: "hermes",
    location: "remote",
    enabled: true,
    managed: "user",
    config: {},
  },
  {
    id: "codex",
    name: "Codex",
    kind: "codex",
    location: "local",
    enabled: true,
    managed: "user",
    config: {},
  },
];

describe("TaskCollaborationWorkspace", () => {
  beforeEach(() => {
    i18nTestState.locale = "zh-CN";
  });

  it("shows the next step for a newly configured task", () => {
    const onOpenTask = vi.fn();
    render(
      <TaskCollaborationWorkspace
        state={{
          runId: "run-1",
          title: "网站改版",
          projectFolder: "D:\\projects\\site",
          assignments: [
            { role: "coordinator", runtimeId: "hermes" },
            { role: "implementer", runtimeId: "codex" },
          ],
          status: "draft",
        }}
        runtimes={runtimes}
        onClose={() => {}}
        onConfigure={() => {}}
        onStart={() => {}}
        onOpenTask={onOpenTask}
      />,
    );

    expect(screen.getByText("协作角色")).toBeInTheDocument();
    expect(screen.getByText("等待创建任务")).toBeInTheDocument();
    expect(screen.getByText("向协调者发送首条任务说明")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开协调者任务对话" }));
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });

  it("renders the collaboration workspace in English", () => {
    i18nTestState.locale = "en";
    render(
      <TaskCollaborationWorkspace
        state={{
          runId: "run-english",
          title: "Release review",
          assignments: [{ role: "coordinator", runtimeId: "hermes" }],
          status: "draft",
        }}
        runtimes={runtimes}
        onClose={() => {}}
        onConfigure={() => {}}
        onStart={() => {}}
        onOpenTask={() => {}}
      />,
    );

    expect(screen.getByText("Multi-agent collaboration")).toBeVisible();
    expect(screen.getByText("No linked project")).toBeVisible();
    expect(screen.getByText("Waiting to create task")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Open coordinator task conversation",
      }),
    ).toBeVisible();
  });

  it("lets the user explicitly start a persisted collaboration", () => {
    const onStart = vi.fn();
    render(
      <TaskCollaborationWorkspace
        state={{
          taskId: "task-1",
          title: "网站改版",
          assignments: [{ role: "coordinator", runtimeId: "hermes" }],
          status: "configured",
        }}
        runtimes={runtimes}
        onClose={() => {}}
        onConfigure={() => {}}
        onStart={onStart}
        onOpenTask={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始协作" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
