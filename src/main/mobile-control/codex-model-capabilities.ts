import { createHash } from "node:crypto";

const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
const MODEL = "gpt-6-sol";
type Json = Record<string, unknown>;

export interface CodexMobileModelCatalog {
  model: string;
  originalCatalogHash: string;
  originalMetadataHash: string;
  projectedCatalogHash: string;
  /** Main-owned contents only; never a Renderer or phone-supplied catalog path. */
  contents: string;
  /** A capability projection is not a production enforcement certificate. */
  completeExecutionPolicyVerified: false;
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
function record(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function invalid(): never {
  // Do not expose catalog contents, model instructions or filesystem locations.
  throw new Error("Codex mobile model capabilities are unavailable.");
}

/** A narrow, independently testable projection; the dispatch authority still requires live proof. */
export function projectCodexMobileModelCatalog(
  catalogBytes: Buffer,
  selectedModel: string,
): CodexMobileModelCatalog {
  if (
    selectedModel !== MODEL ||
    !catalogBytes.length ||
    catalogBytes.length > MAX_CATALOG_BYTES
  )
    invalid();
  let catalog: unknown;
  try {
    catalog = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(catalogBytes),
    );
  } catch {
    invalid();
  }
  if (!record(catalog) || !Array.isArray(catalog.models)) invalid();
  const selected = catalog.models.filter(
    (value: unknown) => record(value) && value.slug === selectedModel,
  );
  if (selected.length !== 1) invalid();
  const metadata = selected[0] as Json;
  // These are the capability fields exercised with the reviewed native CLI.
  // New tool modes/models must receive their own audit rather than falling back.
  if (
    metadata.tool_mode !== "code_mode_only" ||
    metadata.shell_type !== "unified_exec" ||
    metadata.node_repl_disabled !== false ||
    !["v1", "v2"].includes(String(metadata.multi_agent_version))
  )
    invalid();
  const originalMetadata = JSON.stringify(metadata);
  // The native v2 reserved collaboration tools bypass the feature gates in
  // 0.159.3, and v1 still installs nested agent tools. Explicit null removes
  // both model-selected protocols with the multi-agent features disabled.
  // This changes the tool protocol, never the model/provider/session identity.
  const contents = JSON.stringify({
    models: [{ ...metadata, multi_agent_version: null }],
  });
  return {
    model: selectedModel,
    originalCatalogHash: hash(catalogBytes),
    originalMetadataHash: hash(originalMetadata),
    projectedCatalogHash: hash(contents),
    contents,
    completeExecutionPolicyVerified: false,
  };
}
