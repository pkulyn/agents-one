import { useEffect, useRef, useState } from "react";
import type { Attachment } from "../../../../shared/attachments";

export interface PendingRuntimeInput {
  id: string;
  text: string;
  attachments: Attachment[];
  mode: "steer" | "follow_up";
  status: "pending" | "sending" | "failed";
  readyAt: number;
  editing?: boolean;
  error?: string;
  deliveredTo: Set<string>;
}

// Leave a short, visible edit/switch window before native delivery begins.
export const RUNTIME_INPUT_REVIEW_MS = 1800;

export interface RuntimeInputQueueState {
  items: PendingRuntimeInput[];
  change: (
    id: string,
    patch: Partial<Pick<PendingRuntimeInput, "text" | "mode" | "editing">>,
  ) => void;
  enqueue: (text: string, attachments: Attachment[]) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
}

export function useRuntimeInputQueue({
  running,
  onDispatch,
}: {
  running: boolean;
  onDispatch: (input: PendingRuntimeInput) => Promise<void>;
}): RuntimeInputQueueState {
  const [items, setItems] = useState<PendingRuntimeInput[]>([]);
  const itemsRef = useRef(items);
  const dispatchRef = useRef(onDispatch);
  dispatchRef.current = onDispatch;
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function update(
    fn: (current: PendingRuntimeInput[]) => PendingRuntimeInput[],
  ): void {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  }
  function change(
    id: string,
    patch: Partial<Pick<PendingRuntimeInput, "text" | "mode" | "editing">>,
  ): void {
    update((queue) =>
      queue.map((item) =>
        item.id === id && item.status !== "sending"
          ? {
              ...item,
              ...patch,
              error: undefined,
              status: "pending",
              readyAt: Date.now() + RUNTIME_INPUT_REVIEW_MS,
            }
          : item,
      ),
    );
  }
  useEffect(() => {
    if (inFlight.current) return;
    const item = items.find(
      (input) =>
        input.status === "pending" &&
        !input.editing &&
        (input.mode === "steer" || !running),
    );
    if (!item) return;
    const timer = setTimeout(
      () => {
        const current = itemsRef.current.find((input) => input.id === item.id);
        if (
          inFlight.current ||
          !current ||
          current.status !== "pending" ||
          current.editing
        )
          return;
        inFlight.current = true;
        update((queue) =>
          queue.map((input) =>
            input.id === current.id ? { ...input, status: "sending" } : input,
          ),
        );
        void dispatchRef
          .current(current)
          .then(
            () => {
              if (mounted.current)
                update((queue) =>
                  queue.filter((input) => input.id !== current.id),
                );
            },
            (error: unknown) => {
              if (mounted.current)
                update((queue) =>
                  queue.map((input) =>
                    input.id === current.id
                      ? {
                          ...input,
                          status: "failed",
                          error:
                            error instanceof Error
                              ? error.message
                              : String(error),
                        }
                      : input,
                  ),
                );
            },
          )
          .finally(() => {
            inFlight.current = false;
            if (mounted.current) update((queue) => [...queue]);
          });
      },
      Math.max(0, item.readyAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [items, running]);
  return {
    items,
    change,
    enqueue(text: string, attachments: Attachment[]) {
      update((queue) => [
        ...queue,
        {
          id: crypto.randomUUID(),
          text,
          attachments,
          mode: "steer",
          status: "pending",
          readyAt: Date.now() + RUNTIME_INPUT_REVIEW_MS,
          deliveredTo: new Set<string>(),
        },
      ]);
    },
    remove(id: string) {
      update((queue) =>
        queue.filter((item) => item.id !== id || item.status === "sending"),
      );
    },
    retry(id: string) {
      update((queue) =>
        queue.map((item) =>
          item.id === id && item.status === "failed"
            ? {
                ...item,
                status: "pending",
                error: undefined,
                readyAt: Date.now() + RUNTIME_INPUT_REVIEW_MS,
              }
            : item,
        ),
      );
    },
  };
}
