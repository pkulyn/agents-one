import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MobileExecutionPolicies from "./MobileExecutionPolicies";
import type {
  MobileExecutionApprovalStatus,
  MobileExecutionManagementCommand,
  MobileExecutionManagementResult,
} from "../../../../shared/mobile-execution-management";
vi.mock("../useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key.replace("settings.mobile.execution.", ""),
  }),
}));
const status: MobileExecutionApprovalStatus = {
  revision: "0",
  runtimes: [{ id: "runtime-one", name: "Original runtime", available: true }],
  projects: [{ id: "project-one", name: "Original project" }],
  policies: [],
};
const selection = {
  runtimeId: "runtime-one",
  mode: "inspect" as const,
  unattendedApproved: false,
};
const verified = (): MobileExecutionManagementResult => ({
  status,
  review: {
    selection,
    verified: true,
    unattendedSupported: false,
    expiresAt: Date.now() + 60000,
  },
});
function install(manage: ReturnType<typeof vi.fn>): void {
  Object.assign(window, {
    agentsOneAPI: { manageMobileExecutionPolicies: manage },
  });
}
async function select(): Promise<void> {
  await screen.findByRole("option", { name: "Original runtime" });
  fireEvent.change(screen.getByLabelText("runtime"), {
    target: { value: "runtime-one" },
  });
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("shows current restriction and never enables approval without verified execution capabilities", async () => {
  const manage = vi
    .fn()
    .mockImplementation((_profile, command: MobileExecutionManagementCommand) =>
      Promise.resolve(
        command.action === "review"
          ? {
              status,
              review: {
                selection: command.selection,
                verified: false,
                unattendedSupported: false,
                restrictionReason: "unverified_policy",
              },
            }
          : { status },
      ),
    );
  install(manage);
  render(<MobileExecutionPolicies profile="owner" />);
  await select();
  fireEvent.click(screen.getByRole("button", { name: "review" }));
  expect(await screen.findByText("unverified")).toBeVisible();
  expect(screen.getByText("errors.unverified_policy")).toBeVisible();
  expect(screen.getByLabelText("confirmApproval")).toBeDisabled();
  expect(screen.getByRole("button", { name: "approve" })).toBeDisabled();
  expect(manage.mock.calls.every((call) => call[1].action !== "approve")).toBe(
    true,
  );
});
it("requires review and explicit confirmation, sends only selection and revision, and ignores a second click while pending", async () => {
  let complete!: (value: MobileExecutionManagementResult) => void;
  const manage = vi
    .fn()
    .mockImplementation(
      (_profile, command: MobileExecutionManagementCommand) =>
        command.action === "approve"
          ? new Promise((resolve) => {
              complete = resolve;
            })
          : Promise.resolve(
              command.action === "review" ? verified() : { status },
            ),
    );
  install(manage);
  render(<MobileExecutionPolicies profile="owner" />);
  await select();
  fireEvent.click(screen.getByRole("button", { name: "review" }));
  await screen.findByText("verified");
  const approve = screen.getByRole("button", { name: "approve" });
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByLabelText("confirmApproval"));
  fireEvent.click(approve);
  fireEvent.click(approve);
  expect(
    manage.mock.calls.filter((call) => call[1].action === "approve"),
  ).toEqual([
    ["owner", { action: "approve", selection, expectedRevision: "0" }],
  ]);
  await act(async () =>
    complete({
      status: {
        ...status,
        revision: "1",
        policies: [{ ...selection, id: "policy-one", verified: true }],
      },
    }),
  );
  expect(approve).toBeDisabled();
  expect(screen.getByLabelText("confirmApproval")).not.toBeChecked();
});
it("expires review and clears confirmed capabilities when selection changes; writing requires a project", async () => {
  vi.useFakeTimers();
  const manage = vi
    .fn()
    .mockImplementation((_profile, command: MobileExecutionManagementCommand) =>
      Promise.resolve(command.action === "review" ? verified() : { status }),
    );
  install(manage);
  render(<MobileExecutionPolicies profile="owner" />);
  await act(async () => undefined);
  expect(
    screen.getByRole("option", { name: "Original runtime" }),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("runtime"), {
    target: { value: "runtime-one" },
  });
  fireEvent.click(screen.getByRole("button", { name: "review" }));
  await act(async () => undefined);
  expect(screen.getByText("verified")).toBeVisible();
  fireEvent.click(screen.getByLabelText("confirmApproval"));
  await act(async () => {
    vi.advanceTimersByTime(61000);
  });
  expect(screen.getByText("expired")).toBeVisible();
  expect(screen.getByRole("button", { name: "approve" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("project"), {
    target: { value: "project-one" },
  });
  expect(screen.queryByText("verified")).toBeNull();
  expect(screen.getByLabelText("confirmApproval")).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("mode"), {
    target: { value: "project_write" },
  });
  fireEvent.change(screen.getByLabelText("project"), { target: { value: "" } });
  expect(screen.getByRole("button", { name: "review" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "approve" })).toBeDisabled();
});
it("ignores a verified response from a previous profile and resets the selected execution scope", async () => {
  let complete!: (value: MobileExecutionManagementResult) => void;
  const manage = vi
    .fn()
    .mockImplementation((profile, command: MobileExecutionManagementCommand) =>
      command.action === "review"
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve({
            status: profile === "owner" ? status : { ...status, runtimes: [] },
          }),
    );
  install(manage);
  const view = render(<MobileExecutionPolicies profile="owner" />);
  await select();
  fireEvent.click(screen.getByRole("button", { name: "review" }));
  view.rerender(<MobileExecutionPolicies profile="other" />);
  await waitFor(() =>
    expect(manage).toHaveBeenCalledWith("other", { action: "status" }),
  );
  await act(async () => complete(verified()));
  expect(screen.queryByText("verified")).toBeNull();
  expect(screen.getByLabelText("runtime")).toHaveValue("");
  expect(screen.queryByRole("option", { name: "Original runtime" })).toBeNull();
});
it("allows revoking an inactive policy after confirmation with its current revision", async () => {
  const current = {
    ...status,
    revision: "7",
    policies: [{ ...selection, id: "policy-old", verified: false }],
  };
  const manage = vi.fn().mockResolvedValue({ status: current });
  install(manage);
  render(<MobileExecutionPolicies profile="owner" />);
  await screen.findByText("inactive");
  fireEvent.click(screen.getByRole("button", { name: "revoke" }));
  expect(manage).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "confirmRevoke" }));
  await waitFor(() =>
    expect(manage).toHaveBeenCalledWith("owner", {
      action: "revoke",
      id: "policy-old",
      expectedRevision: "7",
    }),
  );
});
