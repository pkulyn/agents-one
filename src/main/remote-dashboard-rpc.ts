import WebSocket from "ws";
import type { RemoteSessionConfig } from "./remote-sessions";
import { configuredRemoteTlsOptions } from "./remote-tls";

interface RpcFrame {
  id?: string;
  result?: unknown;
  error?: { message?: string } | string;
}

function websocketUrl(config: RemoteSessionConfig, token: string): string {
  const url = new URL(config.remoteUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/ws`;
  url.search = "";
  url.searchParams.set("token", token);
  return url.toString();
}

function frameText(data: string | Buffer | ArrayBuffer | Buffer[]): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function requestWithToken<T>(
  config: RemoteSessionConfig,
  token: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = websocketUrl(config, token);
    const ws = new WebSocket(url, configuredRemoteTlsOptions(url));
    const id = `desktop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`Hermes dashboard request timed out: ${method}`));
    }, timeoutMs);
    timer.unref?.();

    const finish = (error?: Error, result?: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeAllListeners();
      try {
        ws.close();
      } catch {
        // best-effort close
      }
      if (error) reject(error);
      else resolve(result as T);
    };

    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
    ws.on("message", (data) => {
      let frame: RpcFrame;
      try {
        frame = JSON.parse(frameText(data)) as RpcFrame;
      } catch {
        return;
      }
      if (frame.id !== id) return;
      if (frame.error) {
        const message =
          typeof frame.error === "string"
            ? frame.error
            : frame.error.message || "Hermes dashboard RPC failed";
        finish(new Error(message));
        return;
      }
      finish(undefined, frame.result as T);
    });
    ws.on("error", (error) => finish(error));
    ws.on("close", () => {
      finish(new Error("Hermes dashboard WebSocket closed"));
    });
  });
}

export async function remoteDashboardRpc<T>(
  config: RemoteSessionConfig,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 15_000,
): Promise<T> {
  const token = config.apiKey.trim();
  if (!token) throw new Error("Remote Hermes dashboard token is not configured.");
  try {
    return await requestWithToken<T>(config, token, method, params, timeoutMs);
  } catch (error) {
    const fallback = config.fallbackApiKey?.trim();
    if (!fallback || fallback === token) throw error;
    return requestWithToken<T>(config, fallback, method, params, timeoutMs);
  }
}
