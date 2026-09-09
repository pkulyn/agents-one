import "./assets/main.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./components/I18nProvider";
import { ThemeProvider } from "./components/ThemeProvider";
import { FontProvider } from "./components/FontProvider";
import QuickComposer from "./screens/QuickComposer/QuickComposer";
import TrayMenu from "./screens/TrayMenu/TrayMenu";
import TrayCompletionToast from "./screens/TrayCompletionToast/TrayCompletionToast";

const appName =
  import.meta.env.VITE_AGENTS_ONE_APP_NAME?.trim() ||
  import.meta.env.VITE_HERMES_DESKTOP_APP_NAME?.trim();
document.title = appName || "Agents One";

const searchParams = new URLSearchParams(window.location.search);
const isTrayComposer = searchParams.get("tray") === "1";
const isTrayMenu = searchParams.get("trayMenu") === "1";
const isTrayCompletion = searchParams.get("trayCompletion") === "1";

if (isTrayCompletion) {
  document.documentElement.classList.add("tray-completion-document");
  document.body.classList.add("tray-completion-document");
}

if (isTrayMenu) {
  document.documentElement.classList.add("tray-task-menu-document");
  document.body.classList.add("tray-task-menu-document");
}

if (isTrayComposer) {
  document.documentElement.classList.add("tray-composer-document");
  document.body.classList.add("tray-composer-document");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      {isTrayCompletion ? (
        <TrayCompletionToast />
      ) : isTrayMenu ? (
        <TrayMenu />
      ) : isTrayComposer ? (
        <ThemeProvider>
          <FontProvider>
            <QuickComposer />
          </FontProvider>
        </ThemeProvider>
      ) : (
        <App />
      )}
    </I18nProvider>
  </StrictMode>,
);
