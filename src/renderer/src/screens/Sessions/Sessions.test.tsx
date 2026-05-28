import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// useI18n needs an I18nProvider; the Sessions tab only uses `t` for labels,
// so a pass-through mock keeps these tests focused on the refresh behaviour.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: () => {},
  }),
}));

import Sessions, { SESSIONS_REFRESH_MS } from "./Sessions";

const baseProps = {
  onResumeSession: (): void => {},
  onNewChat: (): void => {},
  currentSessionId: null,
};

function installHermesAPI(): {
  listCachedSessions: ReturnType<typeof vi.fn>;
  syncSessionCache: ReturnType<typeof vi.fn>;
  searchSessions: ReturnType<typeof vi.fn>;
} {
  const api = {
    listCachedSessions: vi.fn().mockResolvedValue([]),
    syncSessionCache: vi.fn().mockResolvedValue([]),
    searchSessions: vi.fn().mockResolvedValue([]),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

function sessionSearchResult(title: string, snippet: string): {
  sessionId: string;
  title: string;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  snippet: string;
} {
  return {
    sessionId: title.toLowerCase().replace(/\s+/g, "-"),
    title,
    startedAt: Math.floor(Date.now() / 1000),
    source: "desktop",
    messageCount: 1,
    model: "gpt-5.5",
    snippet,
  };
}

describe("Sessions tab live refresh (#322)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-syncs from state.db on an interval while the tab is visible", async () => {
    const api = installHermesAPI();
    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const afterMount = api.syncSessionCache.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(SESSIONS_REFRESH_MS);
    });
    expect(api.syncSessionCache.mock.calls.length).toBe(afterMount + 1);

    await act(async () => {
      vi.advanceTimersByTime(SESSIONS_REFRESH_MS);
    });
    expect(api.syncSessionCache.mock.calls.length).toBe(afterMount + 2);
  });

  it("runs no timer while the tab is hidden", async () => {
    const api = installHermesAPI();
    render(<Sessions {...baseProps} visible={false} />);
    await act(async () => {});

    const afterMount = api.syncSessionCache.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(SESSIONS_REFRESH_MS * 5);
    });
    expect(api.syncSessionCache.mock.calls.length).toBe(afterMount);
  });

  it("stops the timer once the tab becomes hidden", async () => {
    const api = installHermesAPI();
    const view = render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await act(async () => {
      view.rerender(<Sessions {...baseProps} visible={false} />);
    });
    const afterHide = api.syncSessionCache.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(SESSIONS_REFRESH_MS * 3);
    });
    expect(api.syncSessionCache.mock.calls.length).toBe(afterHide);
  });

  it("refreshes when the window regains focus", async () => {
    const api = installHermesAPI();
    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const afterMount = api.syncSessionCache.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(api.syncSessionCache.mock.calls.length).toBe(afterMount + 1);
  });

  it("renders sessions recovered by sync when the fast cache starts empty", async () => {
    vi.useRealTimers();
    const api = installHermesAPI();
    api.syncSessionCache.mockResolvedValue([
      {
        id: "recovered-session",
        title: "Recovered older conversation",
        startedAt: Math.floor(Date.now() / 1000),
        source: "desktop",
        messageCount: 4,
        model: "gpt-5.5",
      },
    ]);

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    await waitFor(() => {
      expect(screen.getByText("Recovered older conversation")).toBeTruthy();
    });
    expect(screen.queryByText("sessions.empty")).toBeNull();
  });

  it("ignores stale search results from earlier keystrokes", async () => {
    const api = installHermesAPI();
    let resolveBroadSearch:
      | ((value: ReturnType<typeof sessionSearchResult>[]) => void)
      | undefined;
    api.searchSessions.mockImplementation((query: string) => {
      if (query === "h") {
        return new Promise((resolve) => {
          resolveBroadSearch = resolve;
        });
      }
      if (query === "hello") {
        return Promise.resolve([
          sessionSearchResult("Hello match", "<<hello>>"),
        ]);
      }
      return Promise.resolve([]);
    });

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const search = screen.getByPlaceholderText("sessions.searchPlaceholder");
    fireEvent.change(search, { target: { value: "h" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.change(search, { target: { value: "hello" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => {});
    expect(screen.getByText("Hello match")).toBeTruthy();

    await act(async () => {
      resolveBroadSearch?.([
        sessionSearchResult("Broad h match", "<<hermes>>"),
      ]);
    });

    expect(screen.getByText("Hello match")).toBeTruthy();
    expect(screen.queryByText("Broad h match")).toBeNull();
  });

  it("does not repopulate search results after clearing the input", async () => {
    const api = installHermesAPI();
    let resolveSearch:
      | ((value: ReturnType<typeof sessionSearchResult>[]) => void)
      | undefined;
    api.searchSessions.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );

    render(<Sessions {...baseProps} visible={true} />);
    await act(async () => {});

    const search = screen.getByPlaceholderText("sessions.searchPlaceholder");
    fireEvent.change(search, { target: { value: "hello" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    fireEvent.click(screen.getByRole("button", { name: "" }));

    await act(async () => {
      resolveSearch?.([sessionSearchResult("Late hello", "<<hello>>")]);
    });

    expect(search).toHaveProperty("value", "");
    expect(screen.queryByText("Late hello")).toBeNull();
    expect(screen.queryByText("sessions.empty")).toBeTruthy();
  });
});
