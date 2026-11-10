import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { createInterface } from "node:readline";
import type { OneModelApiType } from "../../shared/one-model-api";

/** Inputs deliberately exclude credentials and raw conversation messages. */
export interface OneRevisionInputs {
  instructions: string;
  skillIds: string[];
  skillInstructions: string[];
  endpoint: string;
  defaultModel: string;
  apiType?: OneModelApiType;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsToolCall?: boolean;
  imageInput: boolean;
  memoryEnabled: boolean;
  extensionToolIds?: string[];
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Content-addressed definition revision; selected skill contents are included. */
export function oneDefinitionRevision(input: OneRevisionInputs): string {
  const { apiType, supportsToolCall, ...definition } = input;
  return digest({
    schema: 1,
    ...definition,
    ...(supportsToolCall === false ? { supportsToolCall: false } : {}),
    ...(apiType && apiType !== "openai-completions" ? { apiType } : {}),
  });
}

/** Persist a prepared run/session binding before acknowledging the worker. */
export function persistOneRunBinding(
  stateDir: string,
  binding: {
    agentId: string;
    runId: string;
    sessionId: string;
    conversationId?: string;
    definitionRevision: string;
    snapshotHash: string;
  },
): void {
  if (
    !binding.agentId ||
    !binding.runId ||
    !binding.sessionId ||
    !/^[a-f0-9]{64}$/.test(binding.definitionRevision) ||
    !/^[a-f0-9]{64}$/.test(binding.snapshotHash)
  )
    throw new Error("Invalid One run binding");
  const directory = join(stateDir, "run-bindings");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, digest(binding.runId) + ".json");
  const record = JSON.stringify({ schema: 1, status: "prepared", ...binding });
  try {
    writeFileSync(path, record, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "EEXIST" ||
      readFileSync(path, "utf8") !== record
    )
      throw error;
  }
}

/** Hash the effective per-run selection without persisting private memory. */
export function oneRunSnapshotHash(input: {
  definitionRevision: string;
  modelId: string;
  mode: string;
  workspace: string;
  memory: string;
}): string {
  return digest({ schema: 1, ...input });
}

/** Reconcile prepared Main metadata with the actual persisted Pi session tree. */
export async function reconcileOneSessionBinding(
  sessionFile: string,
  expected: {
    sessionId: string;
    runId: string;
    definitionRevision: string;
    snapshotHash: string;
  },
): Promise<"committed" | "missing" | "mismatch"> {
  const stream = createReadStream(sessionFile, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let header = false;
  let bindingFound = false;
  const descendants = new Set<string>();
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const item: unknown = JSON.parse(line);
      if (!item || typeof item !== "object" || Array.isArray(item))
        return "mismatch";
      const entry = item as Record<string, unknown>;
      if (!header) {
        if (entry.type !== "session" || entry.id !== expected.sessionId)
          return "mismatch";
        header = true;
        continue;
      }
      if (
        entry.type === "custom" &&
        entry.customType === "agents-one-run-binding-v1"
      ) {
        const data = entry.data as Record<string, unknown> | undefined;
        // A later run starts a new checkpoint boundary. Its user message
        // cannot prove that an earlier prepared run ever dispatched.
        if (data?.runId !== expected.runId) continue;
        if (data?.runId === expected.runId) {
          if (
            bindingFound ||
            data.definitionRevision !== expected.definitionRevision ||
            data.snapshotHash !== expected.snapshotHash ||
            typeof entry.id !== "string"
          )
            return "mismatch";
          bindingFound = true;
          descendants.add(entry.id);
        }
      }
      if (
        typeof entry.parentId === "string" &&
        descendants.has(entry.parentId) &&
        typeof entry.id === "string"
      ) {
        descendants.add(entry.id);
        const message = entry.message as Record<string, unknown> | undefined;
        if (entry.type === "message" && message?.role === "user")
          return "committed";
      }
    }
    return header ? "missing" : "mismatch";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "mismatch";
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** Limit reconciliation to an actual file inside this agent's session store. */
export async function verifyOneSessionBinding(
  stateDir: string,
  sessionFile: string,
  expected: {
    sessionId: string;
    runId: string;
    definitionRevision: string;
    snapshotHash: string;
  },
): Promise<boolean> {
  try {
    const root = realpathSync(join(stateDir, "sessions"));
    if (!lstatSync(sessionFile).isFile()) return false;
    const actual = realpathSync(sessionFile);
    const path = relative(root, actual);
    if (
      !path ||
      path === ".." ||
      path.startsWith("..\\") ||
      path.startsWith("../") ||
      isAbsolute(path)
    )
      return false;
    return (await reconcileOneSessionBinding(actual, expected)) === "committed";
  } catch {
    return false;
  }
}

/** A separate receipt never overwrites the original prepared record. */
export function commitOneRunBinding(stateDir: string, runId: string): void {
  const directory = join(stateDir, "run-bindings");
  const stem = digest(runId);
  const prepared = JSON.parse(
    readFileSync(join(directory, stem + ".json"), "utf8"),
  );
  if (
    prepared?.schema !== 1 ||
    prepared.status !== "prepared" ||
    prepared.runId !== runId
  )
    throw new Error("One prepared binding is invalid");
  const receipt = JSON.stringify({
    schema: 1,
    status: "committed",
    runId,
    preparedHash: digest(prepared),
  });
  const path = join(directory, stem + ".committed.json");
  try {
    writeFileSync(path, receipt, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "EEXIST" ||
      readFileSync(path, "utf8") !== receipt
    )
      throw error;
  }
}

/** Reconcile earlier unfinished records for the resumed session without inferring task outcome. */
export async function reconcileEarlierOneBindings(
  stateDir: string,
  agentId: string,
  sessionId: string,
  sessionFile: string,
  currentRunId: string,
): Promise<number> {
  const directory = join(stateDir, "run-bindings");
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) =>
      /^[a-f0-9]{64}\.json$/.test(name),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  let reconciled = 0;
  for (const name of names.slice(0, 1000)) {
    const path = join(directory, name);
    const stem = name.slice(0, -5);
    if (
      existsSync(join(directory, stem + ".committed.json")) ||
      existsSync(join(directory, stem + ".session.json"))
    )
      continue;
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size > 16384) continue;
      const prepared: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!prepared || typeof prepared !== "object" || Array.isArray(prepared))
        continue;
      const record = prepared as Record<string, unknown>;
      if (
        record.schema !== 1 ||
        record.status !== "prepared" ||
        record.agentId !== agentId ||
        record.sessionId !== sessionId ||
        typeof record.runId !== "string" ||
        record.runId === currentRunId ||
        digest(record.runId) !== stem ||
        typeof record.definitionRevision !== "string" ||
        !/^[a-f0-9]{64}$/.test(record.definitionRevision) ||
        typeof record.snapshotHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(record.snapshotHash)
      )
        continue;
      if (
        !(await verifyOneSessionBinding(stateDir, sessionFile, {
          sessionId,
          runId: record.runId,
          definitionRevision: record.definitionRevision,
          snapshotHash: record.snapshotHash,
        }))
      )
        continue;
      const receipt = JSON.stringify({
        schema: 1,
        status: "session-persisted",
        runId: record.runId,
        preparedHash: digest(record),
      });
      try {
        writeFileSync(join(directory, stem + ".session.json"), receipt, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        reconciled++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    } catch {
      // A malformed or inaccessible historical record is left intact.
    }
  }
  return reconciled;
}
