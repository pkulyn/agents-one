import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrayCompletionData } from "../../../../shared/tray-completion";
import { t as translate } from "../../../../shared/i18n";
import agentsOneMark from "../../assets/agents-one-mark.svg";

const i18nTestState = vi.hoisted(() => ({
  locale: "zh-CN" as "en" | "zh-CN",
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, i18nTestState.locale, options),
  }),
}));

import TrayCompletionToast from "./TrayCompletionToast";

const notification: TrayCompletionData = {
  id: "run-1",
  taskId: "conversation-1",
  title: "整理本周项目进展",
  runtimeName: "Hermes",
  runtimeKind: "hermes",
  runtimeAvatar: "data:image/png;base64,YXZhdGFy",
  status: "succeeded",
  completedAt: 1,
};

describe("TrayCompletionToast", () => {
  const closeTrayCompletion = vi.fn();
  const openTrayCompletion = vi.fn();

  function installApi(data: TrayCompletionData = notification): void {
    Object.defineProperty(window, "agentsOneAPI", {
      configurable: true,
      value: {
        getTrayCompletionData: vi.fn().mockResolvedValue(data),
        onTrayCompletionData: vi.fn().mockReturnValue(() => undefined),
        closeTrayCompletion,
        openTrayCompletion,
      },
    });
  }

  beforeEach(() => {
    i18nTestState.locale = "zh-CN";
    vi.useFakeTimers();
    closeTrayCompletion.mockReset();
    openTrayCompletion.mockReset();
    installApi();
  });

  it("renders an English completion card while preserving task data", async () => {
    i18nTestState.locale = "en";
    const card = await renderToast();

    expect(card).toHaveAccessibleName(
      "Open completed a task: 整理本周项目进展",
    );
    expect(screen.getByText(/is complete\. View the result\./)).toBeVisible();
    expect(screen.getByText("Just now")).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Hermes agent avatar" }),
    ).toHaveAttribute("src", notification.runtimeAvatar);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderToast(): Promise<HTMLElement> {
    render(<TrayCompletionToast />);
    await act(async () => {
      await Promise.resolve();
    });
    return screen.getByRole("button");
  }

  it("renders the Agents One header and the completing agent avatar", async () => {
    await renderToast();

    expect(screen.getByText("Agents One")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Agents One" })).toHaveAttribute(
      "src",
      agentsOneMark,
    );
    expect(screen.getByText("Hermes")).toBeInTheDocument();
    expect(screen.getByText(/整理本周项目进展/)).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Hermes 智能体图标" }),
    ).toHaveAttribute("src", notification.runtimeAvatar);
  });

  it.each([
    {
      status: "scheduled_started" as const,
      label: "定时任务已启动",
      summary: "已触发，正在执行",
    },
    {
      status: "succeeded" as const,
      label: "完成了任务",
      summary: "已完成，可以查看结果了",
    },
    {
      status: "failed" as const,
      label: "执行失败",
      detail: "网络连接中断",
      summary: "失败：网络连接中断",
    },
    {
      status: "cancelled" as const,
      label: "任务已取消",
      summary: "执行已停止",
    },
    {
      status: "timed_out" as const,
      label: "执行超时",
      summary: "已超过时间限制",
    },
  ])("renders the $status semantic state", async (state) => {
    installApi({
      ...notification,
      status: state.status,
      ...(state.detail ? { detail: state.detail } : {}),
    });

    const card = await renderToast();

    expect(card).toHaveClass(`tray-completion-card--${state.status}`);
    expect(screen.getByText(new RegExp(state.label))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(state.summary))).toBeInTheDocument();
  });

  // @lat: [[main-process#App Lifecycle#Notification-area tray and quick task composer#Task completion toast]]
  it("opens on click and automatically closes after three seconds", async () => {
    const card = await renderToast();
    expect(card).toHaveAccessibleName("打开完成了任务：整理本周项目进展");

    fireEvent.click(card);
    expect(openTrayCompletion).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(2_999));
    expect(closeTrayCompletion).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(closeTrayCompletion).toHaveBeenCalledOnce();
  });

  it("pauses dismissal while the pointer is over the card", async () => {
    const card = await renderToast();

    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(3_500));
    expect(closeTrayCompletion).not.toHaveBeenCalled();

    fireEvent.mouseLeave(card);
    act(() => vi.advanceTimersByTime(3_000));
    expect(closeTrayCompletion).toHaveBeenCalledOnce();
  });
});
