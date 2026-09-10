/**
 * Shared contracts for a browser-backed Runtime.  These types are intentionally
 * independent from Electron so the security and state rules can be tested in
 * Node and rendered safely in the desktop UI.
 *
 * @lat: [[web-agent-runtime]]
 */

export const WEB_AGENT_PROVIDERS = ["doubao", "chatgpt", "grok"] as const;
export type WebAgentProvider = (typeof WEB_AGENT_PROVIDERS)[number];

export const WEB_AGENT_ERROR_CODES = [
  "WEB_LOGIN_REQUIRED",
  "WEB_USER_VERIFICATION_REQUIRED",
  "WEB_PAGE_UNSUPPORTED",
  "WEB_NAVIGATION_BLOCKED",
  "WEB_UPLOAD_REJECTED",
  "WEB_SUBMISSION_UNCONFIRMED",
  "WEB_RESPONSE_TIMEOUT",
  "WEB_PROVIDER_RATE_LIMITED",
  "WEB_PROVIDER_ERROR",
  "WEB_DOWNLOAD_FAILED",
  "WEB_SESSION_CRASHED",
  "WEB_CANCEL_UNCONFIRMED",
] as const;
export type WebAgentErrorCode = (typeof WEB_AGENT_ERROR_CODES)[number];

export type WebAgentRunStage =
  | "queued"
  | "preparing"
  | "waiting_for_user"
  | "uploading"
  | "submitting"
  | "generating"
  | "collecting"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface WebAgentRuntimeSettings {
  provider: WebAgentProvider;
  /** Opaque local identifier, never an account name, email, or phone number. */
  profileId: string;
  adapterVersion: string;
  enabled: boolean;
}

export interface WebAgentPolicyStatus {
  /** Local development opt-in is present and the emergency disable is clear. */
  available: boolean;
  /** User explicitly accepted the experimental data/account-risk notice. */
  enabled: boolean;
  killSwitchActive: boolean;
  reason?: string;
}

export interface WebAgentUserActionRequired {
  kind: "login" | "verification" | "confirmation" | "page_recovery";
  message: string;
  code: WebAgentErrorCode;
}

export interface WebAgentConversationRef {
  /** Verified, provider-owned page URL used to resume a conversation. */
  url?: string;
  /** Provider-visible opaque ID when one is safely available. */
  opaqueId?: string;
}

export interface WebAgentSubmissionReceipt {
  id: string;
  createdAt: number;
  /** Hash of the normalized prompt; the original prompt is never persisted. */
  promptHash: string;
}

export interface WebAgentResponseSnapshot {
  text: string;
  hash: string;
  hasAssistantMessage: boolean;
  isGenerating: boolean;
  hasUploadInProgress: boolean;
  hasError: boolean;
  errorCode?: "rate_limited" | "provider_error" | null;
  observedAt: number;
}

export interface WebAgentStagedFile {
  path: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
}

export interface WebAgentDownload {
  id: string;
  label: string;
  path: string;
  mime?: string;
  size?: number;
  sha256?: string;
}

export interface WebAgentCapabilities {
  chat: true;
  taskDispatch: true;
  streaming: true;
  cancellation: true;
  tools: false;
  artifacts: true;
  artifactUpload: true;
  workspaceAccess: false;
}

const PROVIDER_ORIGINS: Record<WebAgentProvider, readonly string[]> = {
  doubao: ["https://www.doubao.com", "https://doubao.com"],
  chatgpt: ["https://chatgpt.com", "https://www.chatgpt.com"],
  grok: ["https://grok.com", "https://www.grok.com"],
};

/** Authentication redirects needed to complete a provider's own login flow. */
const PROVIDER_AUTH_ORIGINS: Record<WebAgentProvider, readonly string[]> = {
  doubao: [],
  chatgpt: [
    "https://auth.openai.com",
    "https://auth0.openai.com",
    "https://accounts.google.com",
    "https://appleid.apple.com",
    "https://login.microsoftonline.com",
    "https://login.live.com",
  ],
  grok: [
    "https://accounts.x.ai",
    "https://accounts.google.com",
    "https://appleid.apple.com",
    "https://x.com",
    "https://twitter.com",
  ],
};

const TRANSITIONS: Record<WebAgentRunStage, readonly WebAgentRunStage[]> = {
  queued: ["preparing", "cancelled"],
  preparing: [
    "waiting_for_user",
    "uploading",
    "submitting",
    "failed",
    "cancelled",
  ],
  waiting_for_user: ["preparing", "cancelled", "failed", "timed_out"],
  uploading: [
    "submitting",
    "waiting_for_user",
    "failed",
    "cancelled",
    "timed_out",
  ],
  submitting: [
    "generating",
    "waiting_for_user",
    "failed",
    "cancelled",
    "timed_out",
  ],
  generating: [
    "collecting",
    "waiting_for_user",
    "failed",
    "cancelled",
    "timed_out",
  ],
  collecting: ["succeeded", "failed", "cancelled", "timed_out"],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

export function webAgentAllowedOrigins(
  provider: WebAgentProvider,
): readonly string[] {
  return PROVIDER_ORIGINS[provider];
}

/** Accept only a HTTPS origin explicitly owned by the selected Provider. */
export function isAllowedWebAgentUrl(
  provider: WebAgentProvider,
  rawUrl: unknown,
): rawUrl is string {
  if (typeof rawUrl !== "string") return false;
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      webAgentAllowedOrigins(provider).includes(url.origin)
    );
  } catch {
    return false;
  }
}

/**
 * Navigation allow-list used only by the isolated login window. Conversation
 * references still use isAllowedWebAgentUrl and therefore never persist an
 * authentication-provider URL.
 */
export function isAllowedWebAgentNavigationUrl(
  provider: WebAgentProvider,
  rawUrl: unknown,
): rawUrl is string {
  if (isAllowedWebAgentUrl(provider, rawUrl)) return true;
  if (typeof rawUrl !== "string") return false;
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      PROVIDER_AUTH_ORIGINS[provider].includes(url.origin)
    );
  } catch {
    return false;
  }
}

/**
 * Prevent profile identifiers becoming filesystem or Electron partition
 * syntax.  The result remains human-debuggable but has no account meaning.
 */
export function normalizeWebAgentProfileId(value: unknown): string {
  const cleaned =
    typeof value === "string"
      ? value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "";
  return (cleaned || "default").slice(0, 64);
}

export function webAgentPartition(
  provider: WebAgentProvider,
  profileId: unknown,
): string {
  return `persist:agents-one-web-${provider}:${normalizeWebAgentProfileId(profileId)}`;
}

export function canTransitionWebAgentRun(
  from: WebAgentRunStage,
  to: WebAgentRunStage,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertWebAgentTransition(
  from: WebAgentRunStage,
  to: WebAgentRunStage,
): void {
  if (!canTransitionWebAgentRun(from, to)) {
    throw new Error(`Invalid Web Agent state transition: ${from} -> ${to}.`);
  }
}

/** Normalize visible assistant text without retaining invisible controls. */
export function normalizeWebAgentResponseText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t \u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 512 * 1024);
}

/** Small deterministic hash suitable for de-duplication, not cryptography. */
export function webAgentTextHash(value: unknown): string {
  const text = normalizeWebAgentResponseText(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Completion needs observable content plus a stable page state.  A time-only
 * delay is deliberately insufficient because provider pages often continue
 * updating after the send button reappears.
 */
export function isWebAgentResponseComplete(
  snapshot: WebAgentResponseSnapshot,
  previous: WebAgentResponseSnapshot | undefined,
  stableForMs: number,
  minimumStableMs = 1_200,
): boolean {
  return (
    snapshot.hasAssistantMessage &&
    Boolean(snapshot.text) &&
    !snapshot.isGenerating &&
    !snapshot.hasUploadInProgress &&
    !snapshot.hasError &&
    previous?.hash === snapshot.hash &&
    stableForMs >= minimumStableMs
  );
}

export function webAgentProviderLabel(provider: WebAgentProvider): string {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "grok") return "Grok";
  return "豆包";
}

export function webAgentErrorMessage(
  code: WebAgentErrorCode,
  provider: WebAgentProvider = "doubao",
): string {
  const label = webAgentProviderLabel(provider);
  const messages: Record<WebAgentErrorCode, string> = {
    WEB_LOGIN_REQUIRED: `需要在应用内登录${label}后才能继续。`,
    WEB_USER_VERIFICATION_REQUIRED: `需要在应用内完成${label}验证后才能继续。`,
    WEB_PAGE_UNSUPPORTED: `当前${label}页面版本无法被安全识别。`,
    WEB_NAVIGATION_BLOCKED: "已阻止跳转到未授权的网站。",
    WEB_UPLOAD_REJECTED: `${label}未接受所选附件，提示词没有发送。`,
    WEB_SUBMISSION_UNCONFIRMED: "无法确认提示词是否已发送，因此不会自动重试。",
    WEB_RESPONSE_TIMEOUT: `等待${label}回复超时。`,
    WEB_PROVIDER_RATE_LIMITED: `${label}网页提示当前请求受限，请稍后重试。`,
    WEB_PROVIDER_ERROR: `${label}网页报告生成失败，请检查页面状态后重试。`,
    WEB_DOWNLOAD_FAILED: `${label}生成的下载文件未能安全保存。`,
    WEB_SESSION_CRASHED: `${label}网页会话意外退出。`,
    WEB_CANCEL_UNCONFIRMED: `无法确认${label}是否已停止生成。`,
  };
  return messages[code];
}
