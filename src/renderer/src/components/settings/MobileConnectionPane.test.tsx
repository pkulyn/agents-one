import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MobileConnectionPane from "./MobileConnectionPane";
import type { MobileConnectionResult } from "../../../../shared/mobile-connection";
vi.mock("./MobileExecutionPolicies", () => ({ default: () => { throw Error("Connection settings must not load execution approval UI"); } }));
vi.mock("./MobileWriteRecovery", () => ({ default: () => null }));

vi.mock("../useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key.replace("settings.mobile.", "") }),
}));
const connected: MobileConnectionResult = {
  status: {
    configured: true,
    endpoint: "https://connect.example",
    enabled: true,
    taskChannelReady: false,
    owner: { ownerId: "o", spaceId: "s", label: "Desktop", online: false },
    allowedScopes: ["conversation:read", "schedule:read", "conversation:create", "conversation:advance", "conversation:manage", "schedule:manage", "schedule:trigger", "schedule:cancel", "artifact:read"],
    devices: [],
    claims: [
      {
        id: "claim-1",
        deviceLabel: "Phone",
        verificationPhrase: "same phrase",
        expiresAt: "2099-01-01T00:00:00Z",
        state: "pending",
      },
    ],
  },
};
afterEach(() => vi.restoreAllMocks());
describe("phone connection settings", () => {
  it("keeps invitation available during background polling and ignores its stale response after an action", async () => {
    vi.useFakeTimers();
    try {
      let finishPoll!: (result: MobileConnectionResult) => void;
      const manage=vi.fn().mockResolvedValueOnce(connected).mockImplementationOnce(()=>new Promise<MobileConnectionResult>(resolve=>{finishPoll=resolve;})).mockResolvedValue(connected);
      Object.assign(window,{agentsOneAPI:{manageMobileConnection:manage}});
      render(<MobileConnectionPane profile="a" />);
      await act(async()=>{});
      await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
      const invite=screen.getByRole("button",{name:"invite"});
      expect(invite).toBeEnabled();
      fireEvent.click(invite);
      await act(async()=>{});
      expect(manage).toHaveBeenCalledWith("a",{action:"invite"});
      await act(async()=>finishPoll({...connected,status:{...connected.status,enabled:false}}));
      expect(invite).toBeEnabled();
    } finally {vi.useRealTimers();}
  });
  it("requires phrase confirmation before approving and sends selected grants", async () => {
    const manage = vi.fn().mockResolvedValue(connected);
    Object.assign(window, { agentsOneAPI: { manageMobileConnection: manage } });
    render(<MobileConnectionPane profile="a" />);
    await screen.findByText("Phone");
    const approve = screen.getByRole("button", { name: "approve" });
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByLabelText("match"));
    fireEvent.click(approve);
    await waitFor(() =>
      expect(manage).toHaveBeenCalledWith("a", {
        action: "approve",
        id: "claim-1",
        verificationPhrase: "same phrase",
        scopes: connected.status.allowedScopes,
      }),
    );
    expect(screen.getByText("taskPending")).toBeVisible();
    expect(screen.queryByRole("group", { name: "permissions" })).toBeNull();
  });
  it("displays offline configured status without exposing pairing actions", async () => {
    Object.assign(window, {
      agentsOneAPI: {
        manageMobileConnection: vi.fn().mockResolvedValue({
          status: {
            configured: true,
            endpoint: "https://connect.example",
            connectionError: "service_unavailable",
          },
        }),
      },
    });
    render(<MobileConnectionPane />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "errors.service_unavailable",
    );
    expect(screen.getByLabelText("endpoint")).toHaveValue(
      "https://connect.example",
    );
    expect(screen.queryByRole("button", { name: "invite" })).toBeNull();
  });
  it("ignores a prior profile response after profile switching", async () => {
    let complete!: (value: MobileConnectionResult) => void;
    const manage = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue({ status: { configured: false } });
    Object.assign(window, { agentsOneAPI: { manageMobileConnection: manage } });
    const view = render(<MobileConnectionPane profile="a" />);
    view.rerender(<MobileConnectionPane profile="b" />);
    await waitFor(() =>
      expect(manage).toHaveBeenCalledWith("b", { action: "status" }),
    );
    await act(async () => complete(connected));
    expect(screen.queryByText("Phone")).toBeNull();
    expect(screen.getByLabelText("endpoint")).toHaveValue("");
  });
});
