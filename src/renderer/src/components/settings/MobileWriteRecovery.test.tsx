import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MobileWriteRecovery from "./MobileWriteRecovery";
import type { MobileWriteRecoveryStatus } from "../../../../shared/mobile-write-recovery";
vi.mock("../useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key.replace("settings.mobile.recovery.", ""),
  }),
}));
const status: MobileWriteRecoveryStatus = {
  items: [
    {
      id: "recovery-one",
      runId: "run-one",
      projectId: "project-one",
      path: "file.txt",
      state: "changed",
      reviewToken: "a".repeat(64),
    },
  ],
  capacityExceeded: false,
};
afterEach(() => cleanup());
// @lat: [[mobile-data#Mobile data#Recovery UI explicit confirmation and one submit]]
it("shows uncertain observation, requires confirmation and submits the exact reviewed token only once", async () => {
  let resolve!: (value: MobileWriteRecoveryStatus) => void;
  const manage = vi
    .fn()
    .mockResolvedValueOnce(status)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  Object.assign(window, {
    agentsOneAPI: { manageMobileWriteRecovery: manage },
  });
  render(<MobileWriteRecovery profile="owner" />);
  await screen.findByText("file.txt");
  expect(screen.getByText("states.changed")).toBeVisible();
  const button = screen.getByRole("button", { name: "release" });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByLabelText("acknowledge"));
  fireEvent.click(button);
  fireEvent.click(button);
  expect(manage).toHaveBeenCalledTimes(2);
  expect(manage).toHaveBeenLastCalledWith("owner", {
    action: "release",
    id: "recovery-one",
    reviewToken: "a".repeat(64),
    acknowledged: true,
  });
  await act(async () => resolve({ items: [], capacityExceeded: false }));
  await screen.findByText("empty");
});
// @lat: [[mobile-data#Mobile data#Recovery UI old profile response isolation]]
it("ignores an earlier profile response and offers no release for a blocked Run", async () => {
  let resolve!: (value: MobileWriteRecoveryStatus) => void;
  const manage = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue({
      items: [
        {
          ...status.items[0],
          state: "blocked",
          reviewToken: undefined,
          restrictionReason: "run_active",
        },
      ],
      capacityExceeded: false,
    });
  Object.assign(window, {
    agentsOneAPI: { manageMobileWriteRecovery: manage },
  });
  const view = render(<MobileWriteRecovery profile="old" />);
  view.rerender(<MobileWriteRecovery profile="new" />);
  await screen.findByText("errors.run_active");
  await act(async () => resolve(status));
  expect(screen.queryByRole("button", { name: "release" })).toBeNull();
  expect(screen.getByText("states.blocked")).toBeVisible();
  await waitFor(() =>
    expect(manage).toHaveBeenLastCalledWith("new", { action: "status" }),
  );
});
