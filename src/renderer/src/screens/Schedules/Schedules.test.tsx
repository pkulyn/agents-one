import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string, values?: Record<string, string>) => values?.n ? `${key}:${values.n}` : key }),
}));

import Schedules from "./Schedules";

describe("Task Center schedules", () => {
  const listCronJobs = vi.fn();
  const listTaskSchedules = vi.fn();
  const listAgentRuntimes = vi.fn();
  const createTaskSchedule = vi.fn();
  const triggerTaskSchedule = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listCronJobs.mockResolvedValue([]);
    listTaskSchedules.mockResolvedValue([{
      id: "schedule-1",
      name: "Nightly checks",
      schedule: "5m",
      prompt: "Run tests.",
      runtimeId: "codex-local",
      mode: "analysis",
      timeoutMs: 600000,
      enabled: true,
      concurrencyPolicy: "queue",
      pendingRuns: 0,
      runs: [],
      createdAt: 1,
      updatedAt: 1,
    }]);
    listAgentRuntimes.mockResolvedValue([{
      id: "codex-local",
      name: "Local Codex",
      kind: "codex",
      location: "local",
      enabled: true,
      managed: "user",
      config: {},
    }]);
    createTaskSchedule.mockResolvedValue({ id: "schedule-2" });
    triggerTaskSchedule.mockResolvedValue({ schedule: { id: "schedule-1" } });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        listCronJobs,
        listTaskSchedules,
        listAgentRuntimes,
        createTaskSchedule,
        triggerTaskSchedule,
        setTaskScheduleEnabled: vi.fn(),
        deleteTaskSchedule: vi.fn(),
        createCronJob: vi.fn(),
        removeCronJob: vi.fn(),
        pauseCronJob: vi.fn(),
        resumeCronJob: vi.fn(),
        triggerCronJob: vi.fn(),
      },
    });
  });

  it("shows local schedules alongside compatible Hermes Cron rules", async () => {
    render(<Schedules profile="default" />);
    await screen.findByText("Nightly checks");
    expect(screen.getByText("本地智能体定时任务")).toBeInTheDocument();
    expect(screen.getByText("远程 Hermes 定时任务")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "立即执行计划任务" }));
    await waitFor(() => expect(triggerTaskSchedule).toHaveBeenCalledWith("schedule-1", "default"));
  });

  it("creates a local schedule with its selected Runtime and concurrency policy", async () => {
    render(<Schedules profile="default" />);
    await screen.findByText("Nightly checks");
    fireEvent.click(screen.getByRole("button", { name: "schedules.newTask" }));
    fireEvent.change(screen.getByPlaceholderText("schedules.namePlaceholder"), { target: { value: "Hourly research" } });
    fireEvent.change(screen.getByPlaceholderText("schedules.promptPlaceholder"), { target: { value: "Summarize new findings." } });
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "codex-local" } });
    fireEvent.change(selects[2], { target: { value: "queue" } });
    fireEvent.click(screen.getByRole("button", { name: "schedules.create" }));

    await waitFor(() => expect(createTaskSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Hourly research",
        runtimeId: "codex-local",
        concurrencyPolicy: "queue",
      }),
      "default",
    ));
  });

  it("uses one primary creation entry when both schedule sources are empty", async () => {
    listTaskSchedules.mockResolvedValue([]);
    render(<Schedules profile="default" />);

    await screen.findByText("暂无本地计划任务。");
    expect(screen.getAllByRole("button", { name: "schedules.newTask" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "schedules.firstTask" })).toBeNull();
  });
});
