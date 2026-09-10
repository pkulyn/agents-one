// Build-time env vars baked into the main process by electron-vite (the
// MAIN_VITE_ prefix). Injected by the release workflow; absent in dev builds.
interface ImportMetaEnv {}

declare const __AGENTS_ONE_SIGNED_AUTO_UPDATE_BUILD__: boolean;
