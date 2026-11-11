import type { OneModelApiType } from "../../shared/one-model-api";

/** Private Main-to-worker protocol; this is not exposed to the renderer. */
export interface OneWorkerTool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type OneWorkerInput =
  | {
      type: "start";
      options: {
        workspace: string;
        stateDir: string;
        baseUrl: string;
        modelId: string;
        apiKey: string;
        apiType?: OneModelApiType;
        contextWindow?: number;
        maxOutputTokens?: number;
        maxModelCalls?: number;
        imageInput?: boolean;
        thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
        operation?: "compact";
        customInstructions?: string;
        systemPrompt?: string;
        sessionId?: string;
        revisionBinding?: {
          runId: string;
          definitionRevision: string;
          snapshotHash: string;
        };
      };
      prompt: string;
      images?: Array<{ type: "image"; data: string; mimeType: string }>;
      tools: OneWorkerTool[];
    }
  | { type: "steer"; requestId: string; text: string }
  | { type: "cancel" }
  | { type: "ready-ack" }
  | {
      type: "tool-result";
      requestId: string;
      content?: string;
      error?: string;
    };

export type OneWorkerOutput =
  | { type: "ready"; sessionId: string; sessionFile?: string }
  | { type: "event"; event: unknown }
  | {
      type: "tool-call";
      requestId: string;
      toolName: string;
      parameters: unknown;
    }
  | {
      type: "complete";
      sessionId: string;
      output: string;
      sessionFile?: string;
    }
  | { type: "steer-result"; requestId: string; error?: string }
  | { type: "cancelled" }
  | { type: "error"; message: string };
