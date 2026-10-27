import {
  mkdirSync,
  lstatSync,
  realpathSync,
  openSync,
  writeFileSync,
  closeSync,
  unlinkSync,
  readSync,
  fstatSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { agentsOneProfileHome } from "../utils";
import { projectCodexMobileModelCatalog } from "./codex-model-capabilities";
import { codexMobileInspectionArgs } from "./codex-inspect-boundary";
import { startProjectInspectionMcp } from "./project-inspection-mcp";
import type { ProjectWriteRunner } from "./project-write-runner";

const TOKEN_ENV = "AGENTS_ONE_PROJECT_MCP_TOKEN";
const hash = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");
function unavailable(): never {
  throw new Error("Mobile Codex execution context is unavailable.");
}
export interface CodexMobileContext {
  args: string[];
  environment: NodeJS.ProcessEnv;
  assertCurrent(): void;
  dispose(): Promise<void>;
}
interface ContextInput {
  profile?: string;
  model: string;
  environment: NodeJS.ProcessEnv;
  workspace?: string;
  projectGuard?: () => void;
  /** Main-only, already authorized runner; never derived from task/model JSON. */
  projectWriter?: ProjectWriteRunner;
}
function readCatalog(file: string): Buffer {
  const stat = lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 8 * 1024 * 1024
  )
    unavailable();
  const fd = openSync(file, "r");
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) unavailable();
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 1);
    let count = 0;
    while (count < bytes.length) {
      const n = readSync(fd, bytes, count, bytes.length - count, null);
      if (!n) break;
      count += n;
    }
    const after = fstatSync(fd);
    if (
      count > 8 * 1024 * 1024 ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs
    )
      unavailable();
    return bytes.subarray(0, count);
  } finally {
    closeSync(fd);
  }
}

/** Bounded original selected-model binding for Main's verifier; no files are written. */
export function readCodexMobileCatalogBinding(
  environment: NodeJS.ProcessEnv,
  model: string,
): ReturnType<typeof projectCodexMobileModelCatalog> {
  try {
    const authHome = environment.CODEX_HOME || homedirCodex(environment);
    return projectCodexMobileModelCatalog(
      readCatalog(join(authHome, "models_cache.json")),
      model,
    );
  } catch {
    return unavailable();
  }
}

/** Main-created invocation files and live tools; not an approval/proof or public task input. */
export async function prepareCodexMobileContext(
  input: ContextInput,
): Promise<CodexMobileContext> {
  try {
    return await prepare(input);
  } catch {
    return unavailable();
  }
}
async function prepare(input: ContextInput): Promise<CodexMobileContext> {
  if (input.workspace && typeof input.projectGuard !== "function")
    unavailable();
  if (!input.workspace && input.projectGuard) unavailable();
  if (
    input.projectWriter &&
    (!input.workspace ||
      input.projectWriter.projectRoot() !== realpathSync(input.workspace))
  )
    unavailable();
  const authority = input.projectGuard;
  const projectGuard = authority
    ? (): void => {
        const result: unknown = authority();
        if (result instanceof Promise) void result.catch(() => undefined);
        if (result !== undefined) unavailable();
      }
    : undefined;
  projectGuard?.();
  const authHome =
    input.environment.CODEX_HOME || homedirCodex(input.environment);
  const cache = join(authHome, "models_cache.json");
  const source = readCatalog(cache);
  const projection = projectCodexMobileModelCatalog(source, input.model);
  let base = realpathSync(agentsOneProfileHome(input.profile));
  for (const segment of ["desktop", "mobile-codex-invocations"]) {
    const child = join(base, segment);
    if (!existsSync(child)) mkdirSync(child);
    const stat = lstatSync(child);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      realpathSync(child) !== child
    )
      unavailable();
    base = child;
  }
  if (lstatSync(base).isSymbolicLink() || !lstatSync(base).isDirectory())
    unavailable();
  const directory = realpathSync(base);
  const directoryIdentity = lstatSync(base);
  const directoryCurrent = (): boolean => {
    const current = lstatSync(base);
    return (
      !current.isSymbolicLink() &&
      current.isDirectory() &&
      realpathSync(base) === directory &&
      current.dev === directoryIdentity.dev &&
      current.ino === directoryIdentity.ino &&
      current.birthtimeMs === directoryIdentity.birthtimeMs
    );
  };
  const file = join(directory, `catalog-${randomUUID()}.json`);
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(fd, projection.contents, "utf8");
  } catch {
    try {
      unlinkSync(file);
    } catch {
      /* Preserve a private partial file on failed cleanup. */
    }
    return unavailable();
  } finally {
    closeSync(fd);
  }
  let transport:
    | Awaited<ReturnType<typeof startProjectInspectionMcp>>
    | undefined;
  let disposed = false;
  let disposing: Promise<void> | undefined;
  const assertCurrent = (): void => {
    try {
      projectGuard?.();
      if (
        disposed ||
        !directoryCurrent() ||
        lstatSync(file).isSymbolicLink() ||
        hash(readCatalog(cache)) !== projection.originalCatalogHash ||
        hash(readCatalog(file)) !== projection.projectedCatalogHash
      )
        unavailable();
    } catch {
      unavailable();
    }
  };
  function dispose(): Promise<void> {
    if (disposing) return disposing;
    disposed = true;
    // Native error/close and cancellation must all wait for the same worker shutdown.
    // Publish completion before close aborts a worker: abort listeners may re-enter dispose.
    let complete!: () => void;
    let fail!: (reason: unknown) => void;
    disposing = new Promise<void>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    void (async () => {
      await transport?.close();
      try {
        // Remove only our own uniquely named bytes; preserve unexpected replacement data.
        if (
          directoryCurrent() &&
          !lstatSync(file).isSymbolicLink() &&
          hash(readCatalog(file)) === projection.projectedCatalogHash
        )
          unlinkSync(file);
      } catch {
        /* Preserve evidence when ownership cannot be established. */
      }
    })().then(complete, fail);
    return disposing;
  }
  try {
    if (input.workspace)
      transport = await startProjectInspectionMcp(
        input.workspace,
        assertCurrent,
        input.projectWriter,
      );
    const args = codexMobileInspectionArgs();
    const environment = { ...input.environment };
    // A parent invocation's transient token cannot become this Run's credential.
    delete environment[TOKEN_ENV];
    if (transport) {
      // Main's fixed, continuously authorized project root also supports non-Git projects.
      args.push("--skip-git-repo-check");
      const index = args.indexOf("code_mode_host");
      args.splice(index - 1, 2);
      args.push("--enable", "code_mode_host");
      environment[TOKEN_ENV] = transport.token;
      args.push(
        "-c",
        `mcp_servers.agents_one_project={url=${JSON.stringify(transport.url)},bearer_token_env_var=${JSON.stringify(TOKEN_ENV)},required=true,enabled_tools=${JSON.stringify(input.projectWriter ? ["read_project_text", "list_project_directory", "write_project_text"] : ["read_project_text", "list_project_directory"])}${input.projectWriter ? ',tools={write_project_text={approval_mode="approve"}}' : ""}}`,
      );
    }
    args.push(
      "-c",
      `model_catalog_json=${JSON.stringify(file)}`,
      "-c",
      'approval_policy="never"',
    );
    const context: CodexMobileContext = {
      args,
      environment,
      assertCurrent,
      dispose,
    };
    context.assertCurrent();
    return context;
  } catch (error) {
    await dispose();
    throw error;
  }
}
function homedirCodex(environment: NodeJS.ProcessEnv): string {
  const home =
    process.platform === "win32" ? environment.USERPROFILE : environment.HOME;
  return join(home || homedir(), ".codex");
}
