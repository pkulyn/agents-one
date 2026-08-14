import { createHash, randomUUID } from "crypto";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import {
  basename,
  dirname,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep,
} from "path";

/**
 * The desktop is the only component that touches a local project. Remote
 * Bridges queue structured requests; this process polls them over its existing
 * outbound authenticated connection and applies a narrow, task-scoped grant.
 */
export type RemoteWorkspaceOperation =
  | "list"
  | "read"
  | "write"
  | "move"
  | "delete";

export interface RemoteWorkspaceGatewayConfig {
  endpoint: string;
  bearerToken?: string;
  timeoutMs?: number;
  contract?: "legacy-workspace-gateway" | "agents-one-v1";
}

export interface RemoteWorkspaceGrantInput {
  taskId: string;
  runtimeId: string;
  rootPath: string;
  permission: "read" | "write";
  /** Optional operation subset. Write grants default to the legacy full set. */
  operations?: RemoteWorkspaceOperation[];
  /** null means the Grant does not expire; it is revoked explicitly. */
  expiresAt?: number | null;
  maxOperationBytes?: number;
}

export interface RemoteWorkspaceGrant {
  id: string;
  taskId: string;
  runtimeId: string;
  rootPath: string;
  permission: "read" | "write";
  /** Absent only on legacy in-memory grants created before operation scoping. */
  operations?: RemoteWorkspaceOperation[];
  /** null means the Grant does not expire; it is revoked explicitly. */
  expiresAt: number | null;
  maxOperationBytes: number;
  createdAt: number;
}

export interface RemoteWorkspaceRequest {
  id: string;
  operation: RemoteWorkspaceOperation;
  path: string;
  destinationPath?: string;
  content?: string;
  expectedSha256?: string;
}

export interface RemoteWorkspaceAuditEntry {
  id: string;
  grantId: string;
  requestId: string;
  operation: RemoteWorkspaceOperation;
  path: string;
  status: "succeeded" | "denied" | "confirmation_required" | "failed";
  summary: string;
  createdAt: number;
}

export interface RemoteWorkspaceResult {
  requestId: string;
  status: "succeeded" | "denied" | "confirmation_required" | "failed";
  summary: string;
  data?: {
    entries?: Array<{
      path: string;
      type: "file" | "directory";
      size?: number;
    }>;
    content?: string;
    sha256?: string;
    bytes?: number;
    path?: string;
  };
}

export interface RemoteWorkspaceGatewayCapabilities {
  outboundWorkspaceGateway: boolean;
  operations: RemoteWorkspaceOperation[];
  maxOperationBytes?: number;
  maxGrantSeconds?: number;
}

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OPERATION_BYTES = 256 * 1024;
const MAX_MAX_OPERATION_BYTES = 1024 * 1024;
const MAX_LIST_ENTRIES = 200;
const VALID_HASH = /^[a-f0-9]{64}$/i;

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const code =
      "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
    if (code === "ENOENT") {
      const syscall =
        "syscall" in error
          ? String((error as { syscall?: unknown }).syscall || "")
          : "";
      return syscall === "scandir"
        ? "Workspace root is no longer available. Please reselect the folder."
        : "Workspace file or directory no longer exists.";
    }
    if (code === "EACCES" || code === "EPERM") {
      return "Workspace path is not accessible.";
    }
  }
  return error instanceof Error
    ? error.message
    : "Remote workspace operation failed.";
}

class RemoteWorkspaceHttpError extends Error {
  constructor(
    readonly status: number,
    detail?: string,
  ) {
    super(
      `Remote workspace Bridge returned HTTP ${status}.${detail ? ` ${detail}` : ""}`,
    );
    this.name = "RemoteWorkspaceHttpError";
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^\d+$/.test(octet))) {
    return false;
  }
  const values = octets.map(Number);
  if (values.some((value) => value < 0 || value > 255)) return false;
  const [first, second] = values;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function allowsLocalHttp(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    isPrivateIpv4(normalized)
  );
}

function isGrantRecoveryResponse(value: unknown): boolean {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!raw) return false;
  const error =
    raw.error && typeof raw.error === "object" && !Array.isArray(raw.error)
      ? (raw.error as Record<string, unknown>)
      : null;
  const candidates = [
    raw.code,
    raw.message,
    raw.error,
    error?.code,
    error?.message,
  ].filter((item): item is string => typeof item === "string");
  return candidates.some((item) =>
    /grant(?:[_ -]?(?:not|unknown)[_ -]?found)|grant_not_found|unknown grant|grant[_ -]?expired|grant has expired/i.test(
      item,
    ),
  );
}

function isMissingGrantError(error: unknown): boolean {
  if (!(error instanceof RemoteWorkspaceHttpError)) return false;
  const message = error.message;
  return (
    (error.status === 404 &&
      /grant(?:[_ -]?(?:not|unknown)[_ -]?found)|grant_not_found|unknown grant/i.test(
        message,
      )) ||
    (error.status === 403 &&
      /grant[_ -]?expired|grant has expired/i.test(message))
  );
}

function assertText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

/**
 * Gateway v1 names this field `id`. Early Relay implementations returned the
 * same server-issued value as `requestId`; accept that wire-compatible alias
 * without ever manufacturing or replacing an identifier locally.
 */
function normalizeRemoteWorkspaceRequest(
  value: unknown,
): RemoteWorkspaceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace request is invalid.");
  }
  const raw = value as Record<string, unknown>;
  const primaryId =
    typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : undefined;
  const compatibilityId =
    typeof raw.requestId === "string" && raw.requestId.trim()
      ? raw.requestId.trim()
      : undefined;
  if (primaryId && compatibilityId && primaryId !== compatibilityId) {
    throw new Error("Workspace request identifiers do not match.");
  }
  const id = assertText(
    primaryId ?? compatibilityId,
    "Workspace request id",
    256,
  );
  return { ...raw, id } as RemoteWorkspaceRequest;
}

function requestUrl(
  config: RemoteWorkspaceGatewayConfig,
  segments: string[],
): URL {
  const endpoint = assertText(
    config.endpoint,
    "Remote workspace endpoint",
    4096,
  );
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Remote workspace endpoint must be an http/https URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Remote workspace endpoint must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Remote workspace endpoint is invalid.");
  }
  if (url.protocol === "http:" && !allowsLocalHttp(url.hostname)) {
    throw new Error(
      "Remote workspace gateway requires HTTPS outside local/private-network testing.",
    );
  }
  const basePath = url.pathname.replace(/\/+$/, "");
  if (config.contract === "agents-one-v1") {
    const mappedSegments =
      segments[0] === "grants"
        ? ["workspace-grants", ...segments.slice(1)]
        : segments;
    url.pathname =
      `${basePath}/${mappedSegments.map(encodeURIComponent).join("/")}`.replace(
        /\/{2,}/g,
        "/",
      );
    return url;
  }
  const gatewayPath = /\/workspace-gateway$/i.test(basePath)
    ? basePath
    : `${basePath}/workspace-gateway`;
  url.pathname =
    `${gatewayPath}/${segments.map(encodeURIComponent).join("/")}`.replace(
      /\/{2,}/g,
      "/",
    );
  return url;
}

function isSelfSignedCertificateError(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  if (
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN"
  ) {
    return true;
  }
  return Boolean(
    error &&
    typeof error === "object" &&
    "cause" in error &&
    isSelfSignedCertificateError((error as { cause?: unknown }).cause),
  );
}

function requestJsonOnce<T>(
  config: RemoteWorkspaceGatewayConfig,
  segments: string[],
  method: "GET" | "POST",
  body?: unknown,
  rejectUnauthorized?: boolean,
): Promise<T> {
  const url = requestUrl(config, segments);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error("Remote workspace timeout is invalid.");
  }
  const bearerToken = config.bearerToken?.trim();
  if (bearerToken && /[\r\n]/.test(bearerToken))
    throw new Error("Remote workspace credential is invalid.");
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<T>((resolvePromise, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
        },
        ...(url.protocol === "https:" && rejectUnauthorized === false
          ? { rejectUnauthorized: false }
          : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () => {
          const status = response.statusCode || 0;
          if (status < 200 || status >= 300) {
            let detail = "";
            try {
              const parsed = JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
              ) as unknown;
              const raw =
                parsed && typeof parsed === "object" && !Array.isArray(parsed)
                  ? (parsed as Record<string, unknown>)
                  : null;
              const nestedError =
                raw?.error &&
                typeof raw.error === "object" &&
                !Array.isArray(raw.error)
                  ? (raw.error as Record<string, unknown>)
                  : null;
              const message = [
                raw?.message,
                nestedError?.message,
                nestedError?.code,
                raw?.error,
              ].find(
                (item): item is string =>
                  typeof item === "string" && item.trim().length > 0,
              );
              if (message) detail = message.trim().slice(0, 300);
            } catch {
              // Keep the status-only error when the Bridge body is not JSON.
            }
            reject(new RemoteWorkspaceHttpError(status, detail));
            return;
          }
          try {
            resolvePromise(
              JSON.parse(Buffer.concat(chunks).toString("utf8")) as T,
            );
          } catch {
            reject(new Error("Remote workspace Bridge returned invalid JSON."));
          }
        });
      },
    );
    request.once("error", reject);
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error("Remote workspace Bridge request timed out.")),
    );
    if (payload) request.write(payload);
    request.end();
  });
}

async function requestJson<T>(
  config: RemoteWorkspaceGatewayConfig,
  segments: string[],
  method: "GET" | "POST",
  body?: unknown,
): Promise<T> {
  try {
    return await requestJsonOnce<T>(config, segments, method, body);
  } catch (error) {
    // The user explicitly configured this exact Gateway. Retry only a
    // self-signed certificate; non-TLS validation and transport errors remain
    // strict, and public plaintext HTTP is still rejected by requestUrl().
    if (
      config.endpoint.trim().toLowerCase().startsWith("https://") &&
      isSelfSignedCertificateError(error)
    ) {
      return await requestJsonOnce<T>(config, segments, method, body, false);
    }
    throw error;
  }
}

function validateRelativePath(value: unknown, label: string): string {
  const input = assertText(value, label, 4096);
  const slashPath = input.replace(/\\/g, "/");
  // Remote tools sometimes use POSIX `/` to mean the root of the granted
  // project. That is not an OS absolute path here; it is the relative path
  // `.` inside the already-approved Grant.
  const projectPath = /^\/+\.?\/?$/.test(slashPath) ? "." : slashPath;
  if (projectPath.includes("\0") || isAbsolute(projectPath))
    throw new Error(`${label} must be project-relative.`);
  const normalized = normalize(projectPath).replace(/\\/g, "/");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} escapes the project root.`);
  }
  return normalized || ".";
}

function pathInsideRoot(rootPath: string, projectRelativePath: string): string {
  const target = resolve(rootPath, projectRelativePath);
  const relation = relative(rootPath, target);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error("Workspace path escapes the project root.");
  }
  return target;
}

/** Reject every symbolic link in the existing portion of a local path. */
function assertNoSymlink(rootPath: string, targetPath: string): void {
  const relation = relative(rootPath, targetPath);
  const parts = relation.split(sep).filter(Boolean);
  let current = rootPath;
  for (const part of parts) {
    current = resolve(current, part);
    if (!lstatSync(current, { throwIfNoEntry: false })) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error("Workspace symbolic links are not permitted.");
    }
  }
}

function ensureWithinGrant(
  grant: RemoteWorkspaceGrant,
  inputPath: unknown,
  label: string,
): { relativePath: string; absolutePath: string } {
  const relativePath = validateRelativePath(inputPath, label);
  const absolutePath = pathInsideRoot(grant.rootPath, relativePath);
  assertNoSymlink(grant.rootPath, absolutePath);
  return { relativePath, absolutePath };
}

function ensureWritable(grant: RemoteWorkspaceGrant): void {
  if (grant.permission !== "write")
    throw new Error("Workspace grant is read-only.");
}

function ensureOperationSize(
  value: string,
  grant: RemoteWorkspaceGrant,
): Buffer {
  const bytes = Buffer.from(value, "utf8");
  if (!bytes.length || bytes.length > grant.maxOperationBytes) {
    throw new Error("Workspace operation exceeds its approved size limit.");
  }
  return bytes;
}

function assertExpectedHash(
  current: Buffer | null,
  expectedSha256: unknown,
): void {
  if (
    expectedSha256 === undefined ||
    expectedSha256 === null ||
    expectedSha256 === ""
  )
    return;
  if (typeof expectedSha256 !== "string" || !VALID_HASH.test(expectedSha256)) {
    throw new Error("Workspace expected checksum is invalid.");
  }
  if (!current || sha256(current) !== expectedSha256.toLowerCase()) {
    throw new Error(
      "Workspace file changed since the remote request was prepared.",
    );
  }
}

function checkGrant(grant: RemoteWorkspaceGrant): void {
  if (grant.expiresAt !== null && grant.expiresAt <= Date.now())
    throw new Error("Workspace grant has expired.");
}

function defaultGrantOperations(
  permission: RemoteWorkspaceGrant["permission"],
): RemoteWorkspaceOperation[] {
  return permission === "write"
    ? ["list", "read", "write", "move", "delete"]
    : ["list", "read"];
}

function grantOperations(grant: RemoteWorkspaceGrant): RemoteWorkspaceOperation[] {
  return grant.operations || defaultGrantOperations(grant.permission);
}

export function createRemoteWorkspaceGrant(
  input: RemoteWorkspaceGrantInput,
): RemoteWorkspaceGrant {
  const requestedRoot = assertText(input.rootPath, "Workspace root", 4096);
  let rootPath: string;
  try {
    rootPath = realpathSync(requestedRoot);
  } catch {
    throw new Error(
      "Workspace root does not exist or is inaccessible. Please reselect the folder.",
    );
  }
  try {
    if (!statSync(rootPath).isDirectory())
      throw new Error("Workspace root must be a directory.");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Workspace root must be a directory."
    ) {
      throw error;
    }
    throw new Error(
      "Workspace root does not exist or is inaccessible. Please reselect the folder.",
    );
  }
  if (input.permission !== "read" && input.permission !== "write")
    throw new Error("Workspace permission is invalid.");
  const operations = input.operations || defaultGrantOperations(input.permission);
  if (
    operations.length === 0 ||
    operations.some(
      (operation) =>
        !["list", "read", "write", "move", "delete"].includes(operation),
    ) ||
    (input.permission === "read" &&
      operations.some((operation) => operation !== "list" && operation !== "read"))
  ) {
    throw new Error("Workspace grant operations are invalid.");
  }
  if (
    input.expiresAt !== undefined &&
    input.expiresAt !== null &&
    (!Number.isInteger(input.expiresAt) || input.expiresAt <= Date.now())
  )
    throw new Error("Workspace grant expiry is invalid.");
  const maxOperationBytes =
    input.maxOperationBytes ?? DEFAULT_MAX_OPERATION_BYTES;
  if (
    !Number.isInteger(maxOperationBytes) ||
    maxOperationBytes < 1 ||
    maxOperationBytes > MAX_MAX_OPERATION_BYTES
  ) {
    throw new Error("Workspace operation size limit is invalid.");
  }
  return {
    id: `workspace-grant-${randomUUID()}`,
    taskId: assertText(input.taskId, "Workspace task id", 256),
    runtimeId: assertText(input.runtimeId, "Workspace runtime id", 256),
    rootPath,
    permission: input.permission,
    operations: [...new Set(operations)],
    expiresAt: input.expiresAt ?? null,
    maxOperationBytes,
    createdAt: Date.now(),
  };
}

/**
 * Executes exactly one request. Deletion never happens here: the result is a
 * confirmation requirement so the renderer can ask the local user first.
 */
export function executeRemoteWorkspaceRequest(
  grant: RemoteWorkspaceGrant,
  request: RemoteWorkspaceRequest,
): RemoteWorkspaceResult {
  const finish = (
    status: RemoteWorkspaceResult["status"],
    summary: string,
    data?: RemoteWorkspaceResult["data"],
  ): RemoteWorkspaceResult => ({
    requestId: request.id,
    status,
    summary,
    ...(data ? { data } : {}),
  });
  try {
    checkGrant(grant);
    assertText(request.id, "Workspace request id", 256);
    const operation = request.operation;
    if (!["list", "read", "write", "move", "delete"].includes(operation)) {
      throw new Error("Workspace operation is invalid.");
    }
    if (!grantOperations(grant).includes(operation)) {
      throw new Error(
        grant.permission === "read"
          ? "Workspace grant is read-only."
          : `Workspace operation ${operation} is not permitted.`,
      );
    }
    const target = ensureWithinGrant(grant, request.path, "Workspace path");
    if (operation === "list") {
      const items = readdirSync(target.absolutePath, { withFileTypes: true })
        .filter((entry) => !entry.isSymbolicLink())
        .slice(0, MAX_LIST_ENTRIES)
        .map((entry) => {
          const entryPath = resolve(target.absolutePath, entry.name);
          return {
            path: `${target.relativePath}/${entry.name}`.replace(/^\.\//, ""),
            type: entry.isDirectory()
              ? ("directory" as const)
              : ("file" as const),
            ...(entry.isFile() ? { size: statSync(entryPath).size } : {}),
          };
        });
      return finish("succeeded", `Listed ${items.length} project entries.`, {
        entries: items,
      });
    }
    if (operation === "read") {
      const bytes = readFileSync(target.absolutePath);
      if (bytes.length > grant.maxOperationBytes)
        throw new Error("Workspace file exceeds its approved read limit.");
      return finish("succeeded", `Read ${target.relativePath}.`, {
        path: target.relativePath,
        content: bytes.toString("utf8"),
        sha256: sha256(bytes),
        bytes: bytes.length,
      });
    }
    ensureWritable(grant);
    if (operation === "delete") {
      return finish(
        "confirmation_required",
        `Delete ${target.relativePath} requires local user confirmation.`,
      );
    }
    if (operation === "write") {
      const bytes = ensureOperationSize(
        assertText(
          request.content,
          "Workspace file content",
          grant.maxOperationBytes,
        ),
        grant,
      );
      const current = lstatSync(target.absolutePath, { throwIfNoEntry: false })
        ? readFileSync(target.absolutePath)
        : null;
      assertExpectedHash(current, request.expectedSha256);
      mkdirSync(dirname(target.absolutePath), { recursive: true });
      assertNoSymlink(grant.rootPath, dirname(target.absolutePath));
      writeFileSync(target.absolutePath, bytes, { flag: "w" });
      return finish("succeeded", `Wrote ${target.relativePath}.`, {
        path: target.relativePath,
        sha256: sha256(bytes),
        bytes: bytes.length,
      });
    }
    const destination = ensureWithinGrant(
      grant,
      request.destinationPath,
      "Workspace destination path",
    );
    const current = readFileSync(target.absolutePath);
    assertExpectedHash(current, request.expectedSha256);
    if (lstatSync(destination.absolutePath, { throwIfNoEntry: false })) {
      throw new Error("Workspace move destination already exists.");
    }
    mkdirSync(dirname(destination.absolutePath), { recursive: true });
    assertNoSymlink(grant.rootPath, dirname(destination.absolutePath));
    renameSync(target.absolutePath, destination.absolutePath);
    return finish(
      "succeeded",
      `Moved ${target.relativePath} to ${destination.relativePath}.`,
      {
        path: destination.relativePath,
        sha256: sha256(current),
        bytes: current.length,
      },
    );
  } catch (error) {
    return finish("denied", errorMessage(error));
  }
}

/** Runs an already-approved delete request. This must be called from a local UI action. */
export function confirmRemoteWorkspaceDelete(
  grant: RemoteWorkspaceGrant,
  request: RemoteWorkspaceRequest,
): RemoteWorkspaceResult {
  const requestId = typeof request.id === "string" ? request.id : "";
  try {
    checkGrant(grant);
    if (request.operation !== "delete")
      throw new Error("Workspace delete confirmation is invalid.");
    ensureWritable(grant);
    const target = ensureWithinGrant(grant, request.path, "Workspace path");
    const current = readFileSync(target.absolutePath);
    assertExpectedHash(current, request.expectedSha256);
    unlinkSync(target.absolutePath);
    return {
      requestId,
      status: "succeeded",
      summary: `Deleted ${target.relativePath}.`,
      data: {
        path: target.relativePath,
        sha256: sha256(current),
        bytes: current.length,
      },
    };
  } catch (error) {
    return { requestId, status: "denied", summary: errorMessage(error) };
  }
}

function normalizeCapabilities(
  value: unknown,
): RemoteWorkspaceGatewayCapabilities {
  if (!value || typeof value !== "object")
    throw new Error("Remote workspace Bridge returned invalid capabilities.");
  const record = value as Record<string, unknown>;
  const nested =
    record.outboundWorkspaceGateway &&
    typeof record.outboundWorkspaceGateway === "object"
      ? (record.outboundWorkspaceGateway as Record<string, unknown>)
      : undefined;
  const capability = nested ?? record;
  const operations = Array.isArray(capability.operations)
    ? capability.operations.filter(
        (item): item is RemoteWorkspaceOperation =>
          item === "list" ||
          item === "read" ||
          item === "write" ||
          item === "move" ||
          item === "delete",
      )
    : [];
  const enabled = nested
    ? nested.enabled === true
    : record.outboundWorkspaceGateway === true;
  if (!enabled || !operations.length) {
    throw new Error(
      "Remote workspace Bridge does not confirm the outbound gateway capability.",
    );
  }
  return {
    outboundWorkspaceGateway: true,
    operations,
    ...(typeof capability.maxOperationBytes === "number"
      ? { maxOperationBytes: capability.maxOperationBytes }
      : {}),
    ...(typeof capability.maxGrantSeconds === "number"
      ? { maxGrantSeconds: capability.maxGrantSeconds }
      : {}),
  };
}

export async function probeRemoteWorkspaceGateway(
  config: RemoteWorkspaceGatewayConfig,
): Promise<RemoteWorkspaceGatewayCapabilities> {
  const response = await requestJson<
    { capabilities?: unknown } & Record<string, unknown>
  >(config, ["capabilities"], "GET");
  // Hermes wraps this in `capabilities`; OpenClaw's standalone gateway may
  // return the same capability object directly. Both are protocol-equivalent.
  return normalizeCapabilities(response.capabilities ?? response);
}

export class OutboundRemoteWorkspaceGateway {
  readonly audit: RemoteWorkspaceAuditEntry[] = [];
  private registered = false;

  constructor(
    readonly config: RemoteWorkspaceGatewayConfig,
    readonly grant: RemoteWorkspaceGrant,
    readonly options: {
      confirmDelete?: (request: RemoteWorkspaceRequest) => Promise<boolean>;
    } = {},
  ) {}

  async register(): Promise<void> {
    const grantIdentity =
      this.config.contract === "agents-one-v1"
        ? { grantId: this.grant.id }
        : { id: this.grant.id };
    const response = await requestJson<Record<string, unknown>>(
      this.config,
      ["grants"],
      "POST",
      {
        ...grantIdentity,
        taskId: this.grant.taskId,
        runtimeId: this.grant.runtimeId,
        permission: this.grant.permission,
        expiresAt:
          this.grant.expiresAt === null
            ? null
            : new Date(this.grant.expiresAt).toISOString(),
        maxOperationBytes: this.grant.maxOperationBytes,
        operations: grantOperations(this.grant),
      },
    );
    const returnedGrantId =
      typeof response.grantId === "string"
        ? response.grantId
        : typeof response.id === "string"
          ? response.id
          : undefined;
    if (returnedGrantId && returnedGrantId !== this.grant.id) {
      throw new Error(
        "Remote workspace Gateway replaced the desktop grant ID.",
      );
    }
    this.registered = true;
  }

  async pollOnce(): Promise<RemoteWorkspaceResult | null> {
    if (!this.registered)
      throw new Error("Remote workspace gateway is not registered.");
    checkGrant(this.grant);
    let response: { request?: unknown };
    try {
      response = await requestJson<{ request?: unknown }>(
        this.config,
        ["grants", this.grant.id, "pull"],
        "POST",
        { maxWaitSeconds: 20 },
      );
    } catch (error) {
      if (!isMissingGrantError(error)) throw error;
      // Relay restarts or an expired in-memory session can lose the current
      // registration. Re-register the same still-valid desktop Grant once;
      // revoked/expired Grants are never silently revived.
      this.registered = false;
      await this.register();
      return null;
    }
    if (isGrantRecoveryResponse(response)) {
      this.registered = false;
      await this.register();
      return null;
    }
    if (Array.isArray((response as Record<string, unknown>).requests)) {
      throw new Error(
        "Remote workspace Gateway returned a batch pull response; v1 requires one request.",
      );
    }
    if (!response.request) return null;
    const request = normalizeRemoteWorkspaceRequest(response.request);
    let result = executeRemoteWorkspaceRequest(this.grant, request);
    if (
      request.operation === "delete" &&
      result.status === "confirmation_required" &&
      this.options.confirmDelete
    ) {
      const approved = await this.options.confirmDelete(request);
      result = approved
        ? confirmRemoteWorkspaceDelete(this.grant, request)
        : {
            requestId: request.id,
            status: "denied",
            summary: `Local user rejected deletion of ${request.path}.`,
          };
    }
    this.recordAudit(request, result);
    await requestJson(
      this.config,
      ["grants", this.grant.id, "results"],
      "POST",
      result,
    );
    return result;
  }

  async revoke(reason = "Task completed or cancelled."): Promise<void> {
    if (!this.registered) return;
    await requestJson(
      this.config,
      ["grants", this.grant.id, "revoke"],
      "POST",
      { reason: reason.slice(0, 500) },
    );
    this.registered = false;
  }

  private recordAudit(
    request: RemoteWorkspaceRequest,
    result: RemoteWorkspaceResult,
  ): void {
    this.audit.push({
      id: `workspace-audit-${randomUUID()}`,
      grantId: this.grant.id,
      requestId:
        typeof request.id === "string" ? request.id.slice(0, 256) : "unknown",
      operation: request.operation,
      path:
        typeof request.path === "string"
          ? basename(request.path).slice(0, 512)
          : "unknown",
      status: result.status,
      summary: result.summary.slice(0, 1_000),
      createdAt: Date.now(),
    });
    if (this.audit.length > 500) this.audit.splice(0, this.audit.length - 500);
  }
}
