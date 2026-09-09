import type {
  AgentRuntimeCapabilities,
  AgentRuntimeLocation,
  AgentRuntimeProbe,
  AgentRuntimeTransport,
} from "./agent-runtimes";

/** A renderer-safe field description used to build Runtime forms. */
export type RuntimeAdapterFieldType =
  | "text"
  | "password"
  | "path"
  | "number"
  | "boolean"
  | "select";

export interface RuntimeAdapterFieldOption {
  value: string;
  label: string;
}

export interface RuntimeAdapterFieldManifest {
  key: string;
  label: string;
  type: RuntimeAdapterFieldType;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  options?: readonly RuntimeAdapterFieldOption[];
}

/**
 * The serializable half of the Adapter Registry contract. It is safe to
 * expose through preload because it contains no executable code or secrets.
 */
export interface AgentRuntimeAdapterManifest {
  adapterId: string;
  vendorId: string;
  adapterVersion: string;
  displayName: string;
  description: string;
  locations: readonly AgentRuntimeLocation[];
  transports: readonly AgentRuntimeTransport[];
  /** Canonical persisted kind(s) accepted by this adapter. */
  kinds: readonly string[];
  /** Legacy kinds that can be migrated to adapterId on read. */
  legacyKinds?: readonly string[];
  localCliCommand?: string;
  requiresCredential?: boolean;
  fields: readonly RuntimeAdapterFieldManifest[];
  defaultCapabilities?: AgentRuntimeCapabilities;
}

export interface RuntimeAdapterCatalogEntry extends AgentRuntimeAdapterManifest {
  installed: boolean;
  /** Derived from a Runtime probe; never treated as a permission grant. */
  lastProbe?: Pick<AgentRuntimeProbe, "state" | "checkedAt" | "message">;
}

export const BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS: readonly AgentRuntimeAdapterManifest[] =
  [
    {
      adapterId: "hermes",
      vendorId: "agents-one",
      adapterVersion: "1.0.0",
      displayName: "Hermes",
      description: "Agents One 内置的本地智能体运行时。",
      locations: ["local", "remote"],
      transports: ["local-api", "gateway-v1"],
      kinds: ["hermes"],
      fields: [
        {
          key: "timeoutMs",
          label: "超时（毫秒）",
          type: "number",
          help: "本地 Hermes 请求的最长等待时间。",
        },
      ],
    },
    {
      adapterId: "codex",
      vendorId: "openai",
      adapterVersion: "1.0.0",
      displayName: "Codex",
      description: "通过本地 Codex CLI 接入。",
      locations: ["local"],
      transports: ["local-cli"],
      kinds: ["codex"],
      localCliCommand: "codex",
      fields: [
        {
          key: "executablePath",
          label: "可执行文件",
          type: "path",
          required: true,
          placeholder: "codex",
        },
        { key: "model", label: "模型（可选）", type: "text" },
        { key: "workspace", label: "默认工作区（可选）", type: "path" },
        {
          key: "agent",
          label: "默认 Agent（可选）",
          type: "text",
          help: "留空使用 OpenCode 默认 Agent。",
        },
        {
          key: "acpArgs",
          label: "ACP 参数（可选）",
          type: "text",
          help: "每行一个参数；留空时默认使用 acp。",
        },
      ],
    },
    {
      adapterId: "claude-code",
      vendorId: "anthropic",
      adapterVersion: "1.0.0",
      displayName: "Claude Code",
      description: "通过本地 Claude Code CLI/SDK 接入。",
      locations: ["local"],
      transports: ["local-cli"],
      kinds: ["claude-code"],
      localCliCommand: "claude",
      fields: [
        {
          key: "executablePath",
          label: "可执行文件",
          type: "path",
          required: true,
          placeholder: "claude",
        },
        { key: "model", label: "模型（可选）", type: "text" },
        { key: "workspace", label: "默认工作区（可选）", type: "path" },
      ],
    },
    {
      adapterId: "pi",
      vendorId: "badlogic",
      adapterVersion: "1.0.0",
      displayName: "Pi Agent",
      description: "通过本地 Pi Agent CLI/RPC 接入。",
      locations: ["local"],
      transports: ["local-cli"],
      kinds: ["pi"],
      localCliCommand: "pi",
      fields: [
        {
          key: "executablePath",
          label: "可执行文件",
          type: "path",
          required: true,
          placeholder: "pi",
        },
        { key: "model", label: "模型（可选）", type: "text" },
        { key: "workspace", label: "默认工作区（可选）", type: "path" },
      ],
    },
    {
      adapterId: "opencode",
      vendorId: "opencode",
      adapterVersion: "1.0.0",
      displayName: "OpenCode",
      description:
        "通过本地或远程 OpenCode ACP 接入；远程使用统一 Gateway v1。",
      // The main-process registry adds the remote surface only when the
      // independent remoteOpenCodeAcpV1 rollout gate is enabled. Keeping the
      // renderer fallback local-only prevents a failed IPC refresh from
      // advertising an unapproved remote entry point.
      locations: ["local"],
      transports: ["local-cli"],
      kinds: ["opencode"],
      localCliCommand: "opencode",
      fields: [
        {
          key: "executablePath",
          label: "可执行文件",
          type: "path",
          required: true,
          placeholder: "opencode",
          help: "优先启动 `opencode acp`，通过 JSON-RPC stdio 通信。",
        },
        { key: "model", label: "模型（可选）", type: "text" },
        { key: "workspace", label: "默认工作区（可选）", type: "path" },
      ],
    },
    {
      adapterId: "openclaw",
      vendorId: "openclaw",
      adapterVersion: "1.0.0",
      displayName: "OpenClaw",
      description: "通过 Agents One Gateway v1 接入远程 OpenClaw。",
      locations: ["remote"],
      transports: ["gateway-v1"],
      kinds: ["openclaw"],
      requiresCredential: true,
      fields: [
        {
          key: "endpoint",
          label: "Gateway 地址",
          type: "text",
          required: true,
          placeholder: "https://example.com",
        },
        {
          key: "bearerToken",
          label: "访问令牌",
          type: "password",
          secret: true,
          help: "令牌只写入受保护的 Secret Store，不进入 Runtime 配置。",
        },
      ],
    },
    {
      adapterId: "web-agent",
      vendorId: "agents-one",
      adapterVersion: "1.0.0",
      displayName: "网页智能体",
      description: "通过隔离浏览器配置接入网页智能体。",
      locations: ["local"],
      transports: ["local-web"],
      kinds: ["web-agent"],
      fields: [],
    },
  ];

export function manifestForAdapterId(
  adapterId: string | undefined,
): AgentRuntimeAdapterManifest | undefined {
  if (!adapterId) return undefined;
  return BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS.find(
    (manifest) => manifest.adapterId === adapterId,
  );
}

export function manifestForRuntimeKind(
  kind: string,
): AgentRuntimeAdapterManifest | undefined {
  return BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS.find(
    (manifest) =>
      manifest.kinds.includes(kind) || manifest.legacyKinds?.includes(kind),
  );
}
