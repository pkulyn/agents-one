import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../../shared/i18n";
import { RuntimeInputQueue } from "./RuntimeInputQueue";
import {
  useRuntimeInputQueue,
  RUNTIME_INPUT_REVIEW_MS,
} from "./useRuntimeInputQueue";
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => t(key, "zh-CN") }),
}));
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const advance = (): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(RUNTIME_INPUT_REVIEW_MS);
  });

describe("pending Runtime input delivery", () => {
  // @lat: [[runtime-chat#Pending running input capsules#Default correction and mutable pending messages]]
  it("defaults to correction, permits deletion before dispatch and only removes after native acknowledgement", async () => {
    let accept!: () => void;
    const dispatch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          accept = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useRuntimeInputQueue({ running: true, onDispatch: dispatch }),
    );
    act(() => result.current.enqueue("discard", []));
    act(() => result.current.remove(result.current.items[0].id));
    await advance();
    expect(dispatch).not.toHaveBeenCalled();
    act(() => result.current.enqueue("correct this", []));
    expect(result.current.items[0].mode).toBe("steer");
    await advance();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(result.current.items[0].status).toBe("sending");
    act(() =>
      result.current.change(result.current.items[0].id, { text: "too late" }),
    );
    expect(result.current.items[0].text).toBe("correct this");
    await act(async () => accept());
    expect(result.current.items).toHaveLength(0);
  });
  // @lat: [[runtime-chat#Pending running input capsules#Editing and deferred follow-up]]
  it("pauses editing, keeps follow-up queued until the round ends and sends the saved text", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ running }) => useRuntimeInputQueue({ running, onDispatch: dispatch }),
      { initialProps: { running: true } },
    );
    act(() => result.current.enqueue("before", []));
    const id = result.current.items[0].id;
    act(() => result.current.change(id, { editing: true }));
    await advance();
    expect(dispatch).not.toHaveBeenCalled();
    act(() =>
      result.current.change(id, {
        editing: false,
        text: "after",
        mode: "follow_up",
      }),
    );
    await advance();
    expect(dispatch).not.toHaveBeenCalled();
    rerender({ running: false });
    await advance();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ text: "after", mode: "follow_up" }),
    );
    expect(result.current.items).toHaveLength(0);
  });
  // @lat: [[runtime-chat#Pending running input capsules#Failure retention and serial dispatch]]
  it("retains failed inputs for explicit retry and serializes outstanding native calls", async () => {
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("not received"))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRuntimeInputQueue({ running: true, onDispatch: dispatch }),
    );
    act(() => result.current.enqueue("retry me", []));
    await advance();
    expect(result.current.items[0]).toMatchObject({
      status: "failed",
      error: "not received",
      text: "retry me",
    });
    await advance();
    expect(dispatch).toHaveBeenCalledTimes(1);
    act(() => result.current.retry(result.current.items[0].id));
    await advance();
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(result.current.items).toHaveLength(0);
  });
  it("edits, cancels, changes mode and deletes through the actual capsule controls", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    function Harness(): React.JSX.Element {
      const queue = useRuntimeInputQueue({
        running: true,
        onDispatch: dispatch,
      });
      return (
        <>
          <button onClick={() => queue.enqueue("original text", [])}>
            Add
          </button>
          <RuntimeInputQueue {...queue} />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByText("Add"));
    fireEvent.click(screen.getByRole("button", { name: "编辑待发送消息" }));
    fireEvent.change(screen.getByLabelText("修改补充消息"), {
      target: { value: "cancelled edit" },
    });
    fireEvent.click(screen.getByText("取消"));
    expect(screen.getByText("original text")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑待发送消息" }));
    fireEvent.change(screen.getByLabelText("修改补充消息"), {
      target: { value: "saved edit" },
    });
    fireEvent.click(screen.getByText("保存修改"));
    fireEvent.click(screen.getByRole("button", { name: "运行中补充方式" }));
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "完成本轮后跟进" }),
    );
    await advance();
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText("saved edit")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除待发送消息" }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});

it("keeps stopped-task supplements paused instead of automatically starting a new run", async () => {
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const { result, rerender } = renderHook(
    ({ running }) => useRuntimeInputQueue({ running, onDispatch: dispatch }),
    { initialProps: { running: true } },
  );
  act(() => result.current.enqueue("do not restart", []));
  act(() => result.current.pause("task stopped"));
  rerender({ running: false });
  await advance();
  expect(dispatch).not.toHaveBeenCalled();
  expect(result.current.items[0]).toMatchObject({
    status: "failed",
    text: "do not restart",
  });
  act(() => result.current.retry(result.current.items[0].id));
  await advance();
  expect(dispatch).toHaveBeenCalledTimes(1);
});
