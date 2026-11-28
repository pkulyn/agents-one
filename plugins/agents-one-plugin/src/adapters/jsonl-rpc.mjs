import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { createChildShutdown } from "../child-shutdown.mjs";

const MAX_FRAME_CHARS = 2 * 1024 * 1024;

/** One trusted local child; credentials and executable configuration never come from the Gateway. */
export function openJsonlRpc({
  command,
  args,
  cwd,
  env,
  onMessage,
  pi = false,
}) {
  const child = spawn(command, args, {
    cwd,
    env,
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const shutdown = createChildShutdown(child);
  const decoder = new StringDecoder("utf8");
  const pending = new Map();
  let sequence = 0;
  let buffer = "";
  let failure;
  let signalFailure;
  const failed = new Promise((resolve) => {
    signalFailure = resolve;
  });

  function fail(error) {
    if (failure) return;
    failure = error;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    signalFailure(error);
  }

  function deliver(frame) {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) return;
    if (pi ? frame.type !== "response" : typeof frame.method === "string") {
      Promise.resolve()
        .then(() => onMessage?.(frame))
        .catch(fail);
      return;
    }
    const request = pending.get(frame.id);
    if (!request) return;
    pending.delete(frame.id);
    clearTimeout(request.timer);
    if (pi) {
      if (frame.command !== request.method || frame.success !== true) {
        request.reject(
          new Error(`Native Pi request failed: ${request.method}.`),
        );
      } else request.resolve(frame.data);
    } else if (frame.error) {
      const code = Number.isSafeInteger(frame.error.code)
        ? frame.error.code
        : "unknown";
      request.reject(
        new Error(`Native request failed: ${request.method} (${code}).`),
      );
    } else {
      request.resolve(frame.result);
    }
  }

  child.stdout.on("data", (chunk) => {
    if (failure) return;
    buffer += decoder.write(chunk);
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      if (newline > MAX_FRAME_CHARS) {
        fail(new Error("Native RPC response exceeded the frame limit."));
        return;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim()) {
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          fail(new Error("Native RPC returned an invalid JSON frame."));
          return;
        }
        deliver(frame);
      }
      newline = buffer.indexOf("\n");
    }
    if (buffer.length > MAX_FRAME_CHARS)
      fail(new Error("Native RPC response exceeded the frame limit."));
  });
  child.stderr.resume();
  child.stdin.on("error", () => fail(new Error("Native RPC input closed.")));
  child.once("error", (error) => {
    const code = typeof error.code === "string" ? error.code : "unknown";
    fail(new Error(`Native executable could not be started (${code}).`));
  });
  child.once("close", (code) =>
    fail(new Error(`Native RPC process exited (${code ?? "signal"}).`)),
  );

  const send = (frame) => {
    if (failure) return;
    child.stdin.write(JSON.stringify(frame) + "\n");
  };

  return {
    failed,
    send,
    request(method, params, timeoutMs = 10_000) {
      if (failure) return Promise.reject(failure);
      sequence++;
      const id = pi ? String(sequence) : sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Native request timed out: ${method}.`));
        }, timeoutMs);
        pending.set(id, { method, timer, resolve, reject });
        send(pi ? { id, type: method, ...params } : { id, method, params });
      });
    },
    close() {
      fail(new Error("Native RPC process was closed."));
      return shutdown();
    },
  };
}
