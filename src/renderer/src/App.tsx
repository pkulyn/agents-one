import { useState, useEffect, useCallback } from "react";
import { Toaster } from "react-hot-toast";
import { ThemeProvider } from "./components/ThemeProvider";
import { FontProvider } from "./components/FontProvider";
import { ProfileModalProvider } from "./components/profile/ProfileModalProvider";
import { SettingsModalProvider } from "./components/settings/SettingsModalProvider";
import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./screens/Layout/Layout";
import SplashScreen from "./screens/SplashScreen/SplashScreen";

type Screen = "splash" | "main";

// Minimum time for the complete contact → wordmark sequence. Gateway / config
// checks happen during this window, while the final wordmark gets a readable
// hold instead of disappearing as soon as its entrance finishes.
const SPLASH_MIN_MS = 2900;

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("splash");
  const [splashStatus, setSplashStatus] = useState<string | undefined>(
    undefined,
  );
  const isMac = window.electron?.process?.platform === "darwin";

  const runStartup = useCallback(async () => {
    const startedAt = Date.now();

    try {
      setSplashStatus("正在准备工作区…");
      await window.agentsOneAPI.getConnectionConfig();
    } catch (err) {
      // Agents One is a Runtime aggregator. A transient connection/config
      // read must never block the desktop shell behind a first-install page.
      console.warn(
        "Startup connection check failed; opening the workspace.",
        err,
      );
    }

    setSplashStatus(undefined);
    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    setScreen("main");
  }, []);

  useEffect(() => {
    void runStartup();
  }, [runStartup]);

  const handleSplashFinished = useCallback(() => {
    /* splash transition is driven by the install check, not a timer */
  }, []);

  function renderScreen(): React.JSX.Element {
    switch (screen) {
      case "splash":
        return (
          <SplashScreen
            onFinished={handleSplashFinished}
            status={splashStatus}
          />
        );
      case "main":
        return <Layout />;
    }
  }

  return (
    <ThemeProvider>
      <FontProvider>
        <ProfileModalProvider>
          <SettingsModalProvider>
            <ErrorBoundary>
              <div className={`app${isMac ? " is-mac" : ""}`}>
                {isMac && <div className="drag-region" />}
                <div className="app-content">{renderScreen()}</div>
              </div>
              <Toaster
                position="bottom-right"
                reverseOrder={false}
                toastOptions={{
                  style: {
                    background: "var(--bg-elevated)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-bright)",
                    fontSize: 13,
                  },
                }}
              />
            </ErrorBoundary>
          </SettingsModalProvider>
        </ProfileModalProvider>
      </FontProvider>
    </ThemeProvider>
  );
}

export default App;
