export const PRODUCTION_DESKTOP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: https:; media-src 'self' data: blob: file: https:; connect-src 'self' blob: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https: wss:; font-src 'self' data:; frame-src 'self' https: http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'self'";

/** Inline scripts are limited to an unpackaged Vite development session. */
export function resolveDesktopContentSecurityPolicy(
  development = false,
): string {
  return development
    ? PRODUCTION_DESKTOP_CSP.replace(
        "script-src 'self';",
        "script-src 'self' 'unsafe-inline';",
      )
    : PRODUCTION_DESKTOP_CSP;
}
