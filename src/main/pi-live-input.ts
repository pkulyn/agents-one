import { randomUUID } from "crypto";
import type { ChildProcess } from "child_process";

/** One live RPC input channel; success means Pi acknowledged the command. */
export interface PiLiveInput {
  accept(frame: Record<string, unknown>): void;
  send(
    type: "prompt" | "steer",
    message: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
  ): Promise<void>;
}

export function createPiLiveInput(child: ChildProcess): PiLiveInput {
  const pending = new Map<
    string,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  let closed = false;
  const close = (): void => {
    closed = true;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("Pi input channel closed before acknowledgement."));
    }
    pending.clear();
  };
  child.once("close", close);
  child.once("error", close);
  return {
    accept(frame: Record<string, unknown>): void {
      if (frame.type !== "response" || typeof frame.id !== "string") return;
      const item = pending.get(frame.id);
      if (!item) return;
      pending.delete(frame.id);
      clearTimeout(item.timer);
      if (frame.success === true) item.resolve();
      else
        item.reject(
          new Error(
            typeof frame.error === "string"
              ? frame.error
              : "Pi input was rejected.",
          ),
        );
    },
    send(
      type: "prompt" | "steer",
      message: string,
      images?: Array<{ type: "image"; data: string; mimeType: string }>,
    ): Promise<void> {
      if (closed || !child.stdin?.writable)
        return Promise.reject(new Error("Pi input channel is closed."));
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Pi input acknowledgement timed out."));
        }, 10000);
        pending.set(id, { resolve, reject, timer });
        child.stdin!.write(
          JSON.stringify({
            id,
            type,
            message,
            ...(images?.length ? { images } : {}),
          }) + "\n",
          (error) => {
            if (!error) return;
            const item = pending.get(id);
            if (!item) return;
            pending.delete(id);
            clearTimeout(timer);
            reject(error);
          },
        );
      });
    },
  };
}
