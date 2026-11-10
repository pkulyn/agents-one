import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startOneWorker } from "./controller";
import type { OneModelApiType } from "../../shared/one-model-api";

/** Test the configured provider with an actual, harmless tool call. */
export async function probeOneProvider(options: {
  workerPath: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  apiType?: OneModelApiType;
  timeoutMs?: number;
  supportsToolCall?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
}): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "agents-one-probe-"));
  let called = false;
  try {
    const worker = startOneWorker({
      workerPath: options.workerPath,
      workspace: directory,
      stateDir: join(directory, "state"),
      baseUrl: options.baseUrl,
      modelId: options.modelId,
      apiKey: options.apiKey,
      apiType: options.apiType,
      contextWindow: options.contextWindow,
      maxOutputTokens: options.maxOutputTokens,
      prompt:
        options.supportsToolCall === false
          ? "For this connectivity test, reply OK."
          : "For this connectivity test, call the one_probe tool once, then reply OK.",
      tools:
        options.supportsToolCall === false
          ? []
          : [
              {
                name: "one_probe",
                label: "Connection test",
                description: "Confirm the model can call a tool.",
                parameters: {
                  type: "object",
                  properties: {},
                  additionalProperties: false,
                },
              },
            ],
      executeTool: async (name) => {
        if (name !== "one_probe") throw new Error("Unexpected probe tool");
        called = true;
        return "OK";
      },
    });
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        worker.cancel();
      },
      Math.min(Math.max(options.timeoutMs ?? 30000, 1000), 60000),
    );
    try {
      const result = await worker.completion;
      if (options.supportsToolCall === false) {
        if (!result.output.trim())
          throw new Error("The model returned an empty test reply");
        return;
      }
      if (!called) throw new Error("The model did not call the probe tool");
    } catch (error) {
      if (timedOut) throw new Error("Model connection test timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
