import { spawn, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import { closeSync, existsSync, mkdirSync, openSync } from "fs";
import http from "http";
import https from "https";
import net from "net";
import { homedir } from "os";
import { join } from "path";
import {
  getEnhancedPath,
  hermesCliArgs,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
} from "./installer";
import { buildLocalDashboardCliArgs } from "./dashboard-launch";
import { ensureLocalDashboardCompatibility } from "./hermes-agent-compat";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import {
  getActiveProfileNameSync,
  normalizeProfileName,
  profileHome,
} from "./utils";

export interface DashboardConnection {
  baseUrl: string;
  wsUrl: string;
  token: string;
  fallbackToken?: string;
  mode: "local";
  profile?: string;
  pid?: number;
  port?: number;
  logPath?: string;
  alreadyRunning?: boolean;
}

export interface DashboardStatus {
  supported: boolean;
  running: boolean;
  connection?: DashboardConnection;
  error?: string;
  logPath?: string;
}

interface ManagedDashboard {
  proc: ChildProcess;
  connection: DashboardConnection;
}

const dashboards = new Map<string, ManagedDashboard>();

function resolveProfile(profile?: string): string | undefined {
  return normalizeProfileName(profile ?? getActiveProfileNameSync());
}

function profileKey(profile?: string): string {
  return resolveProfile(profile) ?? "default";
}

function dashboardWsUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/api/ws`;
  url.searchParams.set("token", token);
  return url.toString();
}

function getManagedDashboard(profile?: string): ManagedDashboard | undefined {
  const key = profileKey(profile);
  const managed = dashboards.get(key);
  if (!managed) return undefined;
  if (managed.proc.exitCode === null && !managed.proc.killed) return managed;
  dashboards.delete(key);
  return undefined;
}

function unsupportedReasonForLocalSpawn(): string | undefined {
  if (!existsSync(HERMES_REPO)) {
    return `Hermes repo not found at ${HERMES_REPO}.`;
  }
  if (!existsSync(HERMES_PYTHON)) {
    return `Hermes Python environment not found at ${HERMES_PYTHON}.`;
  }
  return undefined;
}

function dashboardLogPath(profile: string | undefined): string {
  const dir = profileHome(profile);
  mkdirSync(dir, { recursive: true });
  return join(dir, "dashboard-stderr.log");
}

function dashboardHasPrebuiltWebDist(): boolean {
  return existsSync(join(HERMES_REPO, "hermes_cli", "web_dist", "index.html"));
}

async function getFreePort(): Promise<number> {
  const preferred = Number(process.env.HERMES_DESKTOP_DASHBOARD_PORT);
  if (Number.isInteger(preferred) && preferred > 0 && preferred < 65536) {
    if (await isPortFree(preferred)) return preferred;
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

function requestJson(
  url: string,
  token: string,
  timeoutMs = 2_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      parsed,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Hermes-Session-Token": token,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("error", reject);
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(
              new Error(`${res.statusCode}: ${text || res.statusMessage}`),
            );
            return;
          }
          if (!text) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(
              new Error(
                `Invalid JSON from ${url} (status ${res.statusCode}): ${text.slice(
                  0,
                  200,
                )}`,
              ),
            );
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(
        new Error(
          `Timed out connecting to Hermes dashboard after ${timeoutMs}ms`,
        ),
      );
    });
    req.end();
  });
}

function isAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof Error && /\b(401|403)(?::|\)|\s)/.test(error.message)
  );
}

async function requestDashboardJson(
  connection: DashboardConnection,
  path: string,
  timeoutMs = 2_000,
): Promise<unknown> {
  const url = `${connection.baseUrl}${path}`;
  try {
    return await requestJson(url, connection.token, timeoutMs);
  } catch (error) {
    const fallback = connection.fallbackToken;
    if (fallback && fallback !== connection.token && isAuthenticationFailure(error)) {
      return requestJson(url, fallback, timeoutMs);
    }
    throw error;
  }
}

export function probeDashboardWebSocket(
  connection: DashboardConnection,
  timeoutMs = 2_000,
): Promise<void> {
  return probeDashboardWebSocketWithToken(connection, connection.token, timeoutMs).catch(
    (error) => {
      const fallback = connection.fallbackToken;
      if (fallback && fallback !== connection.token && isAuthenticationFailure(error)) {
        return probeDashboardWebSocketWithToken(connection, fallback, timeoutMs).then(
          () => {
            // The renderer opens its own WebSocket from this connection object.
            // Keep the successful fallback in memory so a passed main-process
            // probe cannot be followed by a renderer connection with the stale
            // dashboard token. Do not persist or expose the fallback separately.
            connection.token = fallback;
            connection.wsUrl = dashboardWsUrl(connection.baseUrl, fallback);
          },
        );
      }
      throw error;
    },
  );
}

function probeDashboardWebSocketWithToken(
  connection: DashboardConnection,
  token: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(dashboardWsUrl(connection.baseUrl, token));
    const client = parsed.protocol === "wss:" ? https : http;
    parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
    const req = client.request(parsed, {
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        Authorization: `Bearer ${token}`,
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        "Sec-WebSocket-Version": "13",
      },
    });

    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      req.destroy();
      if (err) reject(err);
      else resolve();
    };

    req.on("upgrade", (_res, socket) => {
      socket.destroy();
      finish();
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8").trim();
        finish(
          new Error(
            `Hermes dashboard chat WebSocket is unavailable (${res.statusCode}${
              body ? `: ${body.slice(0, 160)}` : ""
            })`,
          ),
        );
      });
    });
    req.on("error", (err) => finish(err));
    req.setTimeout(timeoutMs, () => {
      finish(
        new Error(
          `Timed out connecting to Hermes dashboard chat WebSocket after ${timeoutMs}ms`,
        ),
      );
    });
    req.end();
  });
}

async function waitForDashboardReady(
  connection: DashboardConnection,
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await requestDashboardJson(connection, "/api/status");
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const message =
    lastError instanceof Error
      ? lastError.message
      : "dashboard did not respond";
  throw new Error(`Timed out waiting for Hermes dashboard: ${message}`);
}

export async function getDashboardStatus(
  profile?: string,
): Promise<DashboardStatus> {
  const managed = getManagedDashboard(profile);
  if (managed) {
    return {
      supported: true,
      running: true,
      connection: { ...managed.connection, alreadyRunning: true },
      logPath: managed.connection.logPath,
    };
  }

  const unsupported = unsupportedReasonForLocalSpawn();
  if (unsupported) {
    return { supported: false, running: false, error: unsupported };
  }

  return {
    supported: true,
    running: false,
    logPath: dashboardLogPath(resolveProfile(profile)),
  };
}

export async function startDashboard(
  profile?: string,
): Promise<DashboardStatus> {
  const existing = getManagedDashboard(profile);
  if (existing) {
    return {
      supported: true,
      running: true,
      connection: { ...existing.connection, alreadyRunning: true },
      logPath: existing.connection.logPath,
    };
  }

  const unsupported = unsupportedReasonForLocalSpawn();
  if (unsupported) {
    return { supported: false, running: false, error: unsupported };
  }

  const compat = ensureLocalDashboardCompatibility();
  const compatWarning = compat.ok
    ? ""
    : compat.error
      ? `${compat.detail}: ${compat.error}`
      : compat.detail;

  const resolvedProfile = resolveProfile(profile);
  const key = profileKey(profile);
  const token = randomBytes(24).toString("hex");
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logPath = dashboardLogPath(resolvedProfile);
  const stderrFd = openSync(logPath, "a");
  const hasPrebuiltWebDist = dashboardHasPrebuiltWebDist();
  const cliArgs = buildLocalDashboardCliArgs(resolvedProfile, port, {
    skipBuild: hasPrebuiltWebDist,
  });

  let proc: ChildProcess;
  try {
    proc = spawn(HERMES_PYTHON, hermesCliArgs(cliArgs), {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: process.env.HOME || homedir(),
        HERMES_HOME,
        HERMES_DASHBOARD_SESSION_TOKEN: token,
        HERMES_DESKTOP: "1",
        ...(hasPrebuiltWebDist
          ? { HERMES_WEB_DIST: join(HERMES_REPO, "hermes_cli", "web_dist") }
          : {}),
      },
      stdio: ["ignore", "ignore", stderrFd],
      detached: false,
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });
  } catch (err) {
    closeSync(stderrFd);
    return {
      supported: true,
      running: false,
      logPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  closeSync(stderrFd);

  const connection: DashboardConnection = {
    baseUrl,
    wsUrl: dashboardWsUrl(baseUrl, token),
    token,
    mode: "local",
    profile: resolvedProfile,
    pid: proc.pid,
    port,
    logPath,
  };

  dashboards.set(key, { proc, connection });
  proc.once("exit", () => {
    if (dashboards.get(key)?.proc === proc) dashboards.delete(key);
  });

  try {
    await waitForDashboardReady(
      connection,
      hasPrebuiltWebDist ? 45_000 : 180_000,
    );
    await probeDashboardWebSocket(connection, 5_000);
  } catch (err) {
    dashboards.delete(key);
    try {
      proc.kill();
    } catch {
      // Ignore shutdown errors for a failed probe; the log path is returned.
    }
    return {
      supported: true,
      running: false,
      logPath,
      error: [
        err instanceof Error ? err.message : String(err),
        compatWarning ? `compatibility: ${compatWarning}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    };
  }

  return { supported: true, running: true, connection, logPath };
}

export function stopDashboard(profile?: string): boolean {
  const key = profileKey(profile);
  const managed = dashboards.get(key);
  if (!managed) return true;
  dashboards.delete(key);
  try {
    managed.proc.kill();
  } catch {
    return false;
  }
  return true;
}

export function stopAllDashboards(): void {
  for (const key of [...dashboards.keys()]) {
    stopDashboard(key === "default" ? undefined : key);
  }
}
