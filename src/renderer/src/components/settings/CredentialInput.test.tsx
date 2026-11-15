import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CredentialInput, { CREDENTIAL_MASK } from "./CredentialInput";
vi.mock("../useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe("CredentialInput", () => {
  it("masks a saved secret without fetching it and reveals only on explicit click", async () => {
    const reveal = vi.fn().mockResolvedValue("saved-test-key");
    const change = vi.fn();
    render(
      <CredentialInput
        label="key"
        value=""
        configured
        reveal={reveal}
        onChange={change}
      />,
    );
    const field = screen.getByLabelText("key");
    expect(field).toHaveValue(CREDENTIAL_MASK);
    expect(field).toHaveAttribute("type", "password");
    expect(reveal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(field).toHaveValue("saved-test-key"));
    expect(field).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button"));
    expect(field).toHaveValue(CREDENTIAL_MASK);
    expect(field).toHaveAttribute("type", "password");
    expect(change).not.toHaveBeenCalled();
  });

  it("sends only a replacement draft and never sends the masked sentinel", () => {
    const change = vi.fn();
    render(
      <CredentialInput
        label="key"
        value=""
        configured
        reveal={vi.fn()}
        onChange={change}
      />,
    );
    fireEvent.change(screen.getByLabelText("key"), {
      target: { value: CREDENTIAL_MASK + "replacement" },
    });
    expect(change).toHaveBeenCalledWith("replacement");
  });

  it("does not fetch saved secrets when revealing a typed draft", () => {
    const reveal = vi.fn();
    render(
      <CredentialInput
        label="key"
        value="new-key"
        configured
        reveal={reveal}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByLabelText("key")).toHaveValue("new-key");
    expect(screen.getByLabelText("key")).toHaveAttribute("type", "text");
    expect(reveal).not.toHaveBeenCalled();
  });

  it("discards a late reveal after the target is unmounted", async () => {
    let resolve!: (value: string) => void;
    const reveal = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const { rerender } = render(
      <CredentialInput
        key="a"
        label="key"
        value=""
        configured
        reveal={reveal}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    rerender(
      <CredentialInput
        key="b"
        label="key"
        value=""
        configured
        reveal={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    await act(async () => {
      resolve("other-target-secret");
    });
    expect(screen.getByLabelText("key")).toHaveValue(CREDENTIAL_MASK);
  });

  it("keeps errors redacted and the secret hidden on failed reveal", async () => {
    render(
      <CredentialInput
        label="key"
        value=""
        configured
        reveal={vi.fn().mockRejectedValue(new Error("sensitive-error"))}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("key")).toHaveValue(CREDENTIAL_MASK);
    expect(screen.queryByText("sensitive-error")).toBeNull();
  });
});
