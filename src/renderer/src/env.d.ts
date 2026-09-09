/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENTS_ONE_APP_NAME?: string;
  readonly VITE_AGENTS_ONE_DASHBOARD_CHAT?: string;
  readonly VITE_AGENTS_ONE_DASHBOARD_EVENT_LOG?: string;
  /** @deprecated Compatibility with pre-Agents One development environments. */
  readonly VITE_HERMES_DESKTOP_APP_NAME?: string;
  /** @deprecated Compatibility with pre-Agents One development environments. */
  readonly VITE_HERMES_DESKTOP_DASHBOARD_CHAT?: string;
  /** @deprecated Compatibility with pre-Agents One development environments. */
  readonly VITE_HERMES_DESKTOP_DASHBOARD_EVENT_LOG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
