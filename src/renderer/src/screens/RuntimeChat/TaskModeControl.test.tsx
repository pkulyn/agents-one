import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { t } from "../../../../shared/i18n";
import { TaskModeControl } from "./TaskModeControl";
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      t(key, "zh-CN", options),
  }),
}));
const base = {
  collaborative: false,
  count: 2,
  busy: false,
  runtimeId: "pi",
  runtimes: [
    { id: "pi", name: "Pi" },
    { id: "opencode", name: "OpenCode" },
  ],
};
describe("Explicit task mode control", () => {
  it("opens team configuration without sending a model request", () => {
    const configure = vi.fn();
    render(<TaskModeControl {...base} onConfigure={configure} />);
    fireEvent.click(screen.getByLabelText("任务模式"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "协作任务" }));
    expect(configure).toHaveBeenCalledTimes(1);
  });
  it("keeps mode changes disabled while execution is active", () => {
    render(<TaskModeControl {...base} busy onConfigure={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("任务模式"));
    expect(
      screen.getByRole("menuitemradio", { name: "协作任务" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("menuitemradio", { name: "普通任务" }),
    ).toBeDisabled();
    expect(screen.getByText("当前任务执行中，结束后可切换。")).toBeVisible();
  });
  it("selects the future agent and waits for a successful saved mode change", async () => {
    const single = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskModeControl
        {...base}
        collaborative
        onSingle={single}
        onConfigure={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("任务模式"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "普通任务" }));
    expect(screen.getByLabelText("后续答复智能体")).toHaveValue("pi");
    fireEvent.change(screen.getByLabelText("后续答复智能体"), {
      target: { value: "opencode" },
    });
    fireEvent.click(screen.getByRole("button", { name: "切换为普通任务" }));
    await waitFor(() => expect(single).toHaveBeenCalledWith("opencode"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("keeps the dialog and team visible when saving fails", async () => {
    render(
      <TaskModeControl
        {...base}
        collaborative
        onSingle={vi.fn().mockRejectedValue(new Error("disk error"))}
      />,
    );
    fireEvent.click(screen.getByLabelText("任务模式"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "普通任务" }));
    fireEvent.click(screen.getByRole("button", { name: "切换为普通任务" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("切换失败"),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByLabelText("任务模式")).toHaveTextContent("协作任务");
  });
});
