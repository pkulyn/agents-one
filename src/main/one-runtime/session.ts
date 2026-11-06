import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
  type CreateAgentSessionResult,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  isOneModelApiType,
  type OneModelApiType,
} from "../../shared/one-model-api";

/** Explicit inputs for an isolated One session. Never persist apiKey in config. */
export interface OneSessionOptions {
  workspace: string;
  stateDir: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  apiType?: OneModelApiType;
  /** Model context capacity; absent values use a conservative estimate. */
  contextWindow?: number;
  imageInput?: boolean;
  /** Per-run logical request limit; includes automatic summaries. */
  maxModelCalls?: number;
  onModelCall?: (count: number, limit: number) => void;
  systemPrompt?: string;
  sessionId?: string;
  /** Only host-provided tools may be exposed; built-in shell/file tools are not implicit. */
  tools?: ToolDefinition[];
}

/**
 * Prepare a Pi SDK session without loading the user's external Pi settings,
 * extensions, skills or credentials. This is an internal foundation; callers
 * remain responsible for authorizing every host-provided tool.
 */
export async function createOneSession(
  options: OneSessionOptions,
): Promise<CreateAgentSessionResult> {
  const workspace = resolve(options.workspace);
  const stateDir = resolve(options.stateDir);
  const url = new URL(options.baseUrl);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) {
    throw new Error("Invalid model provider URL");
  }
  if (!options.modelId.trim() || !options.apiKey.trim()) {
    throw new Error("Model ID and API key are required");
  }
  const apiType = options.apiType ?? "openai-completions";
  if (!isOneModelApiType(apiType))
    throw new Error("Invalid One model API type");
  const contextWindow = options.contextWindow ?? 32768;
  if (
    !Number.isSafeInteger(contextWindow) ||
    contextWindow < 4096 ||
    contextWindow > 2000000
  )
    throw new Error(
      "Model context window must be between 4096 and 2000000 tokens",
    );
  const tools = options.tools ?? [];
  const names = tools.map((tool) => tool.name);
  if (
    new Set(names).size !== names.length ||
    names.some(
      (name) =>
        !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name) ||
        [
          "read",
          "write",
          "edit",
          "bash",
          "powershell",
          "grep",
          "find",
          "ls",
        ].includes(name),
    )
  )
    throw new Error("Invalid or reserved One tool name");

  const sessionsDir = join(stateDir, "sessions");
  await mkdir(sessionsDir, { recursive: true });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(stateDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const maxModelCalls = options.maxModelCalls ?? 64;
  if (
    !Number.isSafeInteger(maxModelCalls) ||
    maxModelCalls < 1 ||
    maxModelCalls > 64
  )
    throw new Error("Invalid One model call limit");
  let modelCalls = 0;
  const streamModel = modelRuntime.streamSimple.bind(modelRuntime);
  modelRuntime.streamSimple = (...args) => {
    if (modelCalls >= maxModelCalls)
      throw new Error("One reached the per-run model call limit");
    modelCalls++;
    options.onModelCall?.(modelCalls, maxModelCalls);
    return streamModel(...args);
  };
  const provider = "agents-one-model";
  modelRuntime.registerProvider(provider, {
    baseUrl: url.toString().replace(/\/$/, ""),
    api: apiType,
    models: [
      {
        id: options.modelId,
        name: options.modelId,
        reasoning: false,
        input: options.imageInput ? ["text", "image"] : ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens: Math.min(8192, Math.floor(contextWindow / 4)),
      },
    ],
  });
  await modelRuntime.setRuntimeApiKey(provider, options.apiKey);
  const model = modelRuntime.getModel(provider, options.modelId);
  if (!model) throw new Error("Could not configure model");
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () =>
      options.systemPrompt || "You are One, a helpful assistant.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  const sessionPath = options.sessionId
    ? SessionManager.findById(workspace, options.sessionId, sessionsDir)
    : undefined;
  if (options.sessionId && !sessionPath)
    throw new Error("One session not found");
  const sessionManager = sessionPath
    ? SessionManager.open(sessionPath, sessionsDir)
    : SessionManager.create(workspace, sessionsDir);
  if (resolve(sessionManager.getCwd()) !== workspace) {
    throw new Error("One session belongs to a different workspace");
  }
  return createAgentSession({
    cwd: workspace,
    agentDir: stateDir,
    modelRuntime,
    model,
    resourceLoader,
    settingsManager: SettingsManager.inMemory({
      images: { autoResize: false },
      compaction: {
        enabled: true,
        reserveTokens: Math.min(8192, Math.floor(contextWindow / 4)),
        keepRecentTokens: Math.min(8192, Math.floor(contextWindow / 4)),
      },
      retry: {
        enabled: true,
        maxRetries: 2,
        baseDelayMs: 1000,
        maxAgentDelayMs: 5000,
        provider: { maxRetries: 0 },
      },
    }),
    sessionManager,
    thinkingLevel: "off",
    tools: names,
    customTools: tools,
  });
}
