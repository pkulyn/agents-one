/** Independent mobile control contract. Importing it never starts a listener or a Runtime. */
export const MOBILE_CONTROL_VERSION = "mobile-control/1.0" as const;
export const MOBILE_CONTROL_BASE = "/agents-one/mobile/v1" as const;
export const MOBILE_LIMITS = Object.freeze({
  defaultPageSize: 50,
  maxPageSize: 100,
  maxSearchCharacters: 200,
  maxTitleCharacters: 160,
  maxTextCharacters: 50_000,
  maxRequestBytes: 262_144,
  previewTtlMs: 300_000,
  heartbeatMs: 20_000,
  streamIdleMs: 60_000,
  minTimeoutMs: 1_000,
  defaultTimeoutMs: 300_000,
  maxTimeoutMs: 86_400_000,
});

export interface MobileSchema {
  $ref?: string;
  type?: "object" | "array" | "string" | "integer" | "boolean" | "null";
  enum?: readonly (string | boolean | null)[];
  properties?: Record<string, MobileSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: MobileSchema;
  anyOf?: MobileSchema[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  pattern?: string;
  format?: string;
  description?: string;
}
const str = (maxLength = 160, minLength = 1): MobileSchema => ({
  type: "string",
  minLength,
  maxLength,
});
const id: MobileSchema = {
  ...str(),
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$",
};
// Native desktop continuation/error messages retain their signed numeric IDs.
const messageId: MobileSchema = {
  anyOf: [id, { ...str(160), pattern: "^-[0-9]{1,159}$" }],
};
const seq: MobileSchema = { type: "string", pattern: "^(0|[1-9][0-9]{0,63})$" };
const timestamp: MobileSchema = { ...str(40), format: "utc-date-time" };
const bool: MobileSchema = { type: "boolean" };
const integer = (
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): MobileSchema => ({ type: "integer", minimum, maximum });
const ref = (name: string): MobileSchema => ({ $ref: `#/$defs/${name}` });
const nullable = (schema: MobileSchema): MobileSchema => ({
  anyOf: [schema, { type: "null" }],
});
const array = (items: MobileSchema, maxItems = 100): MobileSchema => ({
  type: "array",
  items,
  maxItems,
});
const enumeration = (values: readonly string[]): MobileSchema => ({
  type: "string",
  enum: values,
});
const object = (
  properties: Record<string, MobileSchema>,
  optional: string[] = [],
  write = false,
): MobileSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
  additionalProperties: !write,
});
const actions = (values: string[]): MobileSchema => ({
  ...array(enumeration(values), 32),
  uniqueItems: true,
});
const mutation = { clientMutationId: id };
const page = { cursor: str(4096), limit: integer(1, 100) };
const policyInput = {
  runtimeId: id,
  projectId: nullable(id),
  executionPolicyId: id,
};
const scheduleDefinition = {
  name: str(160),
  prompt: str(50_000),
  ...policyInput,
  scheduleExpression: str(160),
  timeoutMs: integer(1_000, 86_400_000),
  concurrencyPolicy: ref("ConcurrencyPolicy"),
};

export const MOBILE_ENUMS = Object.freeze({
  RunStatus: [
    "queued",
    "running",
    "cancelling",
    "succeeded",
    "failed",
    "cancelled",
    "timed_out",
    "review_required",
    "reconciliation_required",
  ],
  RunActivityType: [
    "queued",
    "started",
    "progress",
    "tool_call",
    "tool_result",
    "error",
    "completed",
    "cancelled",
    "timed_out",
  ],
  TurnState: [
    "accepted",
    "queued",
    "running",
    "cancelling",
    "succeeded",
    "failed",
    "cancelled",
    "timed_out",
    "review_required",
    "reconciliation_required",
  ],
  OperationStatus: [
    "accepted",
    "applying",
    "applied",
    "rejected",
    "reconciliation_required",
  ],
  ConversationActivity: ["idle", "active", "needs_attention"],
  ConversationSource: [
    "runtime_conversation",
    "quick_chat",
    "native_session",
    "collaboration",
  ],
  ConversationFilter: ["all", "active", "attention", "idle"],
  ScheduleState: ["enabled", "paused", "running", "blocked"],
  ConcurrencyPolicy: ["skip", "queue", "replace"],
  ExecutionStatus: [
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "timed_out",
    "skipped",
  ],
  TriggerKind: ["manual", "scheduled", "missed"],
  MessageKind: ["user", "assistant", "control", "tool_summary", "error"],
  RestrictionReason: [
    "requires_owner_action",
    "unverified_policy",
    "unsupported_source",
    "profile_inactive",
    "runtime_offline",
    "login_required",
    "project_binding_conflict",
    "policy_revoked",
    "unknown_state",
  ],
  Scope: [
    "conversation:read",
    "conversation:create",
    "conversation:advance",
    "conversation:manage",
    "schedule:read",
    "schedule:manage",
    "schedule:trigger",
    "schedule:cancel",
    "artifact:read",
  ],
  EventType: [
    "conversation.updated",
    "message.upsert",
    "run.updated",
    "schedule.updated",
    "schedule.execution.updated",
    "artifact.created",
    "permission.changed",
    "owner.status",
    "resource.deleted",
  ],
  ClaimState: ["pending", "approved", "rejected", "expired", "exchanged"],
  ResourceType: [
    "owner",
    "conversation",
    "message",
    "turn",
    "run",
    "schedule",
    "schedule_execution",
    "artifact",
    "permission",
  ],
});
export const MOBILE_ERROR_CODES = Object.freeze([
  "credential_expired",
  "revoked",
  "scope_denied",
  "policy_denied",
  "resource_not_found",
  "revision_conflict",
  "run_active",
  "idempotency_conflict",
  "cursor_expired",
  "invalid_schedule",
  "invalid_input",
  "revision_required",
  "rate_limited",
  "owner_offline",
  "runtime_offline",
  "requires_owner_action",
  "project_binding_conflict",
  "queue_full",
  "preview_expired",
  "protocol_incompatible",
  "reconciliation_required",
  "invitation_expired",
  "claim_rejected",
  "refresh_reused",
  "payload_too_large",
]);

export const MOBILE_SCHEMAS: Record<string, MobileSchema> = {
  ...Object.fromEntries(
    Object.entries(MOBILE_ENUMS).map(([name, values]) => [
      name,
      enumeration(values),
    ]),
  ),
  ResourceRef: object({ type: ref("ResourceType"), id: messageId }),
  ErrorDetails: object(
    {
      resourceRef: ref("ResourceRef"),
      currentRevision: seq,
      restrictionReason: ref("RestrictionReason"),
      field: enumeration([
        "title",
        "name",
        "text",
        "prompt",
        "runtimeId",
        "projectId",
        "executionPolicyId",
        "scheduleExpression",
        "timeoutMs",
        "concurrencyPolicy",
        "previewRevision",
        "cursor",
        "limit",
      ]),
      retryAfterMs: integer(),
    },
    [
      "resourceRef",
      "currentRevision",
      "restrictionReason",
      "field",
      "retryAfterMs",
    ],
    true,
  ),
  MobileError: object(
    {
      code: str(80),
      message: str(500),
      retryable: bool,
      requestId: id,
      details: ref("ErrorDetails"),
    },
    ["details"],
  ),
  ErrorEnvelope: object({ error: ref("MobileError") }),
  Limits: object({
    maxPageSize: integer(1, 100),
    maxTextCharacters: integer(1, 50_000),
    maxRequestBytes: integer(1, 262_144),
    maxTimeoutMs: integer(1_000, 86_400_000),
    eventRetentionDays: integer(1, 7),
    eventRetentionCount: integer(1, 100_000),
    snapshotTtlMs: integer(1, 300_000),
  }),
  OwnerSpace: object({
    ownerId: id,
    spaceId: id,
    label: str(160),
    ownerType: enumeration(["desktop", "server"]),
    online: bool,
    executionAvailable: bool,
    schedulerOnline: bool,
    schedulerTimeZone: { ...str(100), format: "iana-time-zone" },
    capabilities: array(ref("Scope"), 32),
    limits: ref("Limits"),
    dataEpoch: id,
  }),
  Bootstrap: object({
    protocolVersion: str(80),
    ownerSpace: ref("OwnerSpace"),
    grantRevision: seq,
    serverTime: timestamp,
    dataEpoch: id,
    capabilities: array(ref("Scope"), 32),
    limits: ref("Limits"),
    snapshotCursor: str(4096),
  }),
  Runtime: object(
    {
      id,
      name: str(160),
      category: enumeration(["local", "web", "remote"]),
      color: { ...str(7, 7), pattern: "^#[A-Fa-f0-9]{6}$" },
      avatar: nullable(id),
      healthy: bool,
      capabilities: array(str(80), 32),
      allowedActions: actions(["read", "create", "advance", "cancel"]),
      restrictionReason: nullable(ref("RestrictionReason")),
    },
    ["avatar", "color", "restrictionReason"],
  ),
  RuntimeAvatar: object(
    {
      id,
      runtimeId: id,
      mime: enumeration(["image/png", "image/jpeg", "image/webp", "image/gif"]),
      sizeBytes: integer(1, 525000),
      sha256: { ...str(64, 64), pattern: "^[a-f0-9]{64}$" },
      base64: { ...str(700000), pattern: "^[A-Za-z0-9+/]+={0,2}$" },
    },
    [],
    true,
  ),
  Project: object({
    id,
    name: str(160),
    allowedExecutionPolicyIds: array(id, 100),
  }),
  ExecutionPolicy: object(
    {
      id,
      runtimeId: id,
      projectId: nullable(id),
      mode: enumeration(["inspect", "project_write", "desktop_analysis", "desktop_execute", "desktop_auto", "desktop_full_access"]),
      enforced: bool,
      unattendedApproved: bool,
      allowedActions: actions(["create", "advance", "trigger"]),
      restrictionReason: nullable(ref("RestrictionReason")),
    },
    ["projectId", "restrictionReason"],
  ),
  Conversation: object(
    {
      id,
      sourceKind: ref("ConversationSource"),
      title: str(160),
      runtimeId: id,
      projectId: nullable(id),
      pinned: bool,
      archived: bool,
      revision: seq,
      lastMessageSeq: seq,
      lastReadMessageSeq: seq,
      lastMessagePreview: nullable(str(240, 0)),
      activity: ref("ConversationActivity"),
      lastRunStatus: nullable(ref("RunStatus")),
      activeRunIds: array(id, 100),
      createdAt: timestamp,
      updatedAt: timestamp,
      allowedActions: actions(["read", "advance", "manage", "cancel"]),
      restrictionReason: nullable(ref("RestrictionReason")),
    },
    ["projectId", "lastRunStatus", "restrictionReason", "lastMessagePreview"],
  ),
  Message: object(
    {
      id: messageId,
      conversationId: id,
      messageSeq: seq,
      messageRevision: seq,
      turnId: id,
      runId: id,
      kind: ref("MessageKind"),
      content: str(200_000, 0),
      runtimeId: id,
      visibleToUser: bool,
      createdAt: timestamp,
    },
    ["messageRevision", "turnId", "runId", "runtimeId"],
  ),
  Turn: object(
    {
      turnId: id,
      conversationId: id,
      clientMutationId: id,
      runId: id,
      state: ref("TurnState"),
      revision: seq,
      requestedPolicyId: id,
      createdAt: timestamp,
    },
    ["runId"],
  ),
  Artifact: object(
    {
      id,
      runId: id,
      name: str(160),
      mime: str(160),
      sizeBytes: integer(),
      sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      expiresAt: nullable(timestamp),
      allowedActions: actions(["read", "download"]),
    },
    ["expiresAt"],
  ),
  Run: object(
    {
      runId: id,
      turnId: id,
      conversationId: id,
      runtimeId: id,
      status: ref("RunStatus"),
      startedAt: nullable(timestamp),
      completedAt: nullable(timestamp),
      lastRunEventSeq: seq,
      error: nullable(ref("MobileError")),
      artifacts: array(ref("Artifact"), 100),
      activity: array(ref("RunActivity"), 50),
      allowedActions: actions(["read", "cancel"]),
    },
    ["turnId", "startedAt", "completedAt", "error", "activity"],
  ),
  RunActivity: object(
    {
      eventId: str(160),
      type: ref("RunActivityType"),
      summary: str(500),
      createdAt: timestamp,
      toolName: nullable(str(160)),
      toolKind: nullable(str(40)),
    },
    ["toolName", "toolKind"],
  ),
  Schedule: object(
    {
      id,
      name: str(160),
      prompt: str(50_000),
      runtimeId: id,
      projectId: nullable(id),
      executionPolicyId: nullable(id),
      scheduleExpression: str(160),
      schedulerTimeZone: { ...str(100), format: "iana-time-zone" },
      enabled: bool,
      effectiveState: ref("ScheduleState"),
      concurrencyPolicy: ref("ConcurrencyPolicy"),
      timeoutMs: integer(1_000, 86_400_000),
      nextRunAt: nullable(timestamp),
      recentExecution: ref("ScheduleRecentExecution"),
      activeRunIds: array(id, 100),
      pendingCount: integer(),
      revision: seq,
      allowedActions: actions([
        "read",
        "edit",
        "pause",
        "resume",
        "trigger",
        "cancel",
        "discard_pending",
        "delete",
      ]),
      restrictionReason: nullable(ref("RestrictionReason")),
    },
    [
      "projectId",
      "executionPolicyId",
      "nextRunAt",
      "restrictionReason",
      "recentExecution",
    ],
  ),
  ScheduleExecution: object(
    {
      id,
      scheduleId: id,
      trigger: ref("TriggerKind"),
      dueAt: nullable(timestamp),
      triggeredAt: timestamp,
      status: ref("ExecutionStatus"),
      runtimeRunId: id,
      conversationId: id,
      completedAt: nullable(timestamp),
      summary: str(1000, 0),
      restrictionReason: nullable(ref("RestrictionReason")),
    },
    [
      "dueAt",
      "runtimeRunId",
      "conversationId",
      "completedAt",
      "summary",
      "restrictionReason",
    ],
  ),
  ScheduleRecentExecution: object({
    execution: nullable(ref("ScheduleExecution")),
  }),
  OperationResult: object(
    {
      turnId: id,
      messageId: id,
      conversationId: id,
      scheduleId: id,
      runId: id,
      disposition: enumeration(["started", "queued", "skipped"]),
      discardedCount: integer(),
    },
    [
      "turnId",
      "messageId",
      "conversationId",
      "scheduleId",
      "runId",
      "disposition",
      "discardedCount",
    ],
  ),
  OperationReceipt: object(
    {
      operationId: id,
      clientMutationId: id,
      deviceId: id,
      action: str(100),
      resourceRef: ref("ResourceRef"),
      status: ref("OperationStatus"),
      resultRef: ref("OperationResult"),
      error: ref("MobileError"),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    ["resourceRef", "resultRef", "error"],
  ),
  PermissionChange: object({
    deviceId: id,
    grantRevision: seq,
    scopes: array(ref("Scope"), 32),
    revoked: bool,
  }),
  ReadPosition: object({ conversationId: id, lastReadMessageSeq: seq }),
  MessagePage: object({
    items: array(ref("Message")),
    hasMoreBefore: bool,
    snapshotCursor: str(4096),
    snapshotRevision: seq,
  }),
  Snapshot: object({
    conversations: array(ref("Conversation")),
    runs: array(ref("Run")),
    schedules: array(ref("Schedule")),
    snapshotCursor: str(4096),
    snapshotRevision: seq,
    dataEpoch: id,
    nextCursor: nullable(str(4096)),
  }),
  SchedulePreview: object({
    normalizedExpression: str(160),
    schedulerTimeZone: { ...str(100), format: "iana-time-zone" },
    description: str(500),
    nextOccurrences: { ...array(timestamp, 5), minItems: 5 },
    previewRevision: str(4096),
  }),
  DeviceGrant: object({
    deviceId: id,
    deviceLabel: str(80),
    ownerId: id,
    spaceId: id,
    scopes: array(ref("Scope"), 32),
    grantRevision: seq,
    expiresAt: timestamp,
    revoked: bool,
  }),
  PairingClaim: object(
    {
      id,
      state: ref("ClaimState"),
      expiresAt: timestamp,
      verificationPhrase: str(100),
      claimProof: str(4096),
    },
    ["claimProof"],
  ),
  Credentials: object({
    deviceId: id,
    accessToken: str(8192),
    accessExpiresAt: timestamp,
    refreshCredential: str(8192),
    refreshExpiresAt: timestamp,
    grantRevision: seq,
  }),
  PairingClaimInput: object(
    { invitation: str(4096), code: str(32), deviceLabel: str(80) },
    ["invitation", "code"],
    true,
  ),
  ExchangeInput: object({ ...mutation }, ["clientMutationId"], true),
  RefreshInput: object(
    { refreshCredential: str(8192), rotationId: id },
    [],
    true,
  ),
  CreateConversationInput: object(
    { title: str(160), ...policyInput, ...mutation },
    ["title", "projectId", "clientMutationId"],
    true,
  ),
  PatchConversationInput: object(
    {
      title: str(160),
      pinned: bool,
      archived: bool,
      projectId: nullable(id),
      ...mutation,
    },
    ["title", "pinned", "archived", "projectId", "clientMutationId"],
    true,
  ),
  CreateTurnInput: object(
    {
      text: str(50_000),
      executionPolicyId: id,
      projectId: nullable(id),
      ...mutation,
    },
    ["projectId", "clientMutationId"],
    true,
  ),
  ReadPositionInput: object({ lastReadMessageSeq: seq }, [], true),
  SearchConversationInput: object(
    {
      query: str(200),
      projectId: id,
      state: ref("ConversationFilter"),
      archived: bool,
      ...page,
    },
    ["projectId", "state", "archived", "cursor", "limit"],
    true,
  ),
  SearchScheduleInput: object(
    {
      query: str(200),
      projectId: id,
      state: enumeration(["all", ...MOBILE_ENUMS.ScheduleState]),
      ...page,
    },
    ["projectId", "state", "cursor", "limit"],
    true,
  ),
  SchedulePreviewInput: object(
    scheduleDefinition,
    ["projectId", "timeoutMs", "concurrencyPolicy"],
    true,
  ),
  CreateScheduleInput: object(
    { ...scheduleDefinition, previewRevision: str(4096), ...mutation },
    ["projectId", "timeoutMs", "concurrencyPolicy", "clientMutationId"],
    true,
  ),
  PatchScheduleInput: object(
    { ...scheduleDefinition, previewRevision: str(4096), ...mutation },
    Object.keys({ ...scheduleDefinition, previewRevision: 1, ...mutation }),
    true,
  ),
  ActionInput: object(mutation, ["clientMutationId"], true),
};
const eventPayloads: Record<string, string> = {
  "conversation.updated": "Conversation",
  "message.upsert": "MessageUpsert",
  "run.updated": "Run",
  "schedule.updated": "Schedule",
  "schedule.execution.updated": "ScheduleExecution",
  "artifact.created": "Artifact",
  "permission.changed": "PermissionChange",
  "owner.status": "OwnerSpace",
  "resource.deleted": "ResourceDeletion",
};
MOBILE_SCHEMAS.ResourceDeletion = {
  anyOf: [
    object({ kind: enumeration(["conversation", "schedule", "run"]), id }),
    object({
      kind: enumeration(["message"]),
      id: messageId,
      conversationId: id,
    }),
    object({ kind: enumeration(["schedule_execution"]), id, scheduleId: id }),
  ],
};
MOBILE_SCHEMAS.MessageUpsert = {
  ...MOBILE_SCHEMAS.Message,
  required: [...MOBILE_SCHEMAS.Message.required!, "messageRevision"],
};
MOBILE_SCHEMAS.Event = {
  anyOf: Object.entries(eventPayloads).map(([type, payload]) =>
    object(
      {
        eventId: id,
        spaceChangeSeq: seq,
        dataEpoch: id,
        type: enumeration([type]),
        resourceRef: ref("ResourceRef"),
        resourceRevision: seq,
        createdAt: timestamp,
        payload: ref(payload),
        runId: id,
        runEventSeq: seq,
      },
      type === "run.updated" ? [] : ["runId", "runEventSeq"],
    ),
  ),
};
MOBILE_SCHEMAS.ScheduleSummary = {
  ...MOBILE_SCHEMAS.Schedule,
  properties: { ...MOBILE_SCHEMAS.Schedule.properties },
  required: MOBILE_SCHEMAS.Schedule.required?.filter((key) => key !== "prompt"),
};
delete MOBILE_SCHEMAS.ScheduleSummary.properties?.prompt;
for (const name of [
  "Conversation",
  "ScheduleSummary",
  "ScheduleExecution",
  "OperationReceipt",
  "Runtime",
  "Project",
  "ExecutionPolicy",
  "OwnerSpace",
]) {
  MOBILE_SCHEMAS[`${name}Page`] = object({
    items: array(ref(name)),
    nextCursor: nullable(str(4096)),
    snapshotRevision: seq,
  });
}

export class MobileContractError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly field?: string,
  ) {
    super(code);
    this.name = "MobileContractError";
  }
}
function fail(path: string): never {
  throw new MobileContractError("invalid_input", 422, path);
}
function validate(schema: MobileSchema, value: unknown, path: string): void {
  if (schema.$ref) {
    const target = MOBILE_SCHEMAS[schema.$ref.split("/").at(-1)!];
    if (!target) throw new Error("Unresolved mobile schema");
    return validate(target, value, path);
  }
  if (schema.anyOf) {
    for (const child of schema.anyOf) {
      try {
        validate(child, value, path);
        return;
      } catch (e) {
        if (!(e instanceof MobileContractError)) throw e;
      }
    }
    return fail(path);
  }
  if (schema.enum && !schema.enum.includes(value as string)) fail(path);
  if (schema.type === "null") {
    if (value !== null) fail(path);
    return;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") fail(path);
    return;
  }
  if (schema.type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity)
    )
      fail(path);
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") fail(path);
    const length = Array.from(value).length;
    if (
      length < (schema.minLength ?? 0) ||
      length > (schema.maxLength ?? Infinity) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value))
    )
      fail(path);
    if (
      schema.format === "utc-date-time" &&
      (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19))
    )
      fail(path);
    if (schema.format === "iana-time-zone") {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
      } catch {
        fail(path);
      }
    }
    return;
  }
  if (schema.type === "array") {
    if (
      !Array.isArray(value) ||
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? Infinity)
    )
      fail(path);
    if (
      schema.uniqueItems &&
      new Set(value.map((x) => JSON.stringify(x))).size !== value.length
    )
      fail(path);
    value.forEach((item, index) =>
      validate(schema.items!, item, `${path}[${index}]`),
    );
    return;
  }
  if (schema.type === "object") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      fail(path);
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(record, key)) fail(`${path}.${key}`);
    for (const [key, item] of Object.entries(record)) {
      const child = schema.properties?.[key];
      if (!child) {
        if (schema.additionalProperties === false) fail(`${path}.${key}`);
      } else validate(child, item, `${path}.${key}`);
    }
    return;
  }
}
export function assertMobileSchema(name: string, value: unknown): void {
  const schema = MOBILE_SCHEMAS[name];
  if (!schema) throw new Error("Unknown mobile schema");
  validate(schema, value, name);
}
export function validateMobileBody(name: string, value: unknown): void {
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    MOBILE_LIMITS.maxRequestBytes
  )
    throw new MobileContractError("payload_too_large", 413);
  assertMobileSchema(name, value);
  if (
    name === "PairingClaimInput" &&
    !(
      (value as Record<string, unknown>).invitation ||
      (value as Record<string, unknown>).code
    )
  )
    fail(`${name}.invitation`);
  if (
    name.startsWith("Patch") &&
    Object.keys(value as object).filter((key) => key !== "clientMutationId")
      .length === 0
  )
    fail(name);
}

export interface MobileRoute {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  operationId: string;
  body?: string;
  response?: string;
  status: 200 | 202 | 204;
  scope?: string;
  mutation?: boolean;
  revision?: boolean;
  proof?: boolean;
  stream?: boolean;
}
const B = `${MOBILE_CONTROL_BASE}/owners/{ownerId}/spaces/{spaceId}`;
const route = (
  method: MobileRoute["method"],
  suffix: string,
  operationId: string,
  response?: string,
  options: Partial<MobileRoute> = {},
): MobileRoute => ({
  method,
  path: `${B}${suffix}`,
  operationId,
  response,
  status: 200,
  ...options,
});
export const MOBILE_ROUTES: readonly MobileRoute[] = [
  {
    method: "POST",
    path: `${MOBILE_CONTROL_BASE}/pairing/claims`,
    operationId: "claimPairing",
    body: "PairingClaimInput",
    response: "PairingClaim",
    status: 202,
  },
  {
    method: "GET",
    path: `${MOBILE_CONTROL_BASE}/pairing/claims/{id}`,
    operationId: "getPairingClaim",
    response: "PairingClaim",
    status: 200,
    proof: true,
  },
  {
    method: "POST",
    path: `${MOBILE_CONTROL_BASE}/pairing/claims/{id}/exchange`,
    operationId: "exchangePairingClaim",
    body: "ExchangeInput",
    response: "Credentials",
    status: 200,
    proof: true,
    mutation: true,
  },
  {
    method: "POST",
    path: `${MOBILE_CONTROL_BASE}/auth/refresh`,
    operationId: "refreshCredentials",
    body: "RefreshInput",
    response: "Credentials",
    status: 200,
  },
  {
    method: "GET",
    path: `${MOBILE_CONTROL_BASE}/devices/self`,
    operationId: "getDevice",
    response: "DeviceGrant",
    status: 200,
  },
  {
    method: "DELETE",
    path: `${MOBILE_CONTROL_BASE}/devices/self`,
    operationId: "revokeDevice",
    status: 204,
  },
  {
    method: "GET",
    path: `${MOBILE_CONTROL_BASE}/owners`,
    operationId: "listOwners",
    response: "OwnerSpacePage",
    status: 200,
  },
  route("GET", "/bootstrap", "getBootstrap", "Bootstrap"),
  route("GET", "/runtimes", "listRuntimes", "RuntimePage"),
  route(
    "GET",
    "/runtimes/{id}/avatars/{avatarId}",
    "getRuntimeAvatar",
    "RuntimeAvatar",
  ),
  route("GET", "/projects", "listProjects", "ProjectPage"),
  route(
    "GET",
    "/execution-policies",
    "listExecutionPolicies",
    "ExecutionPolicyPage",
  ),
  route("GET", "/conversations", "listConversations", "ConversationPage", {
    scope: "conversation:read",
  }),
  route(
    "POST",
    "/conversations/search",
    "searchConversations",
    "ConversationPage",
    { body: "SearchConversationInput", scope: "conversation:read" },
  ),
  route("POST", "/conversations", "createConversation", "OperationReceipt", {
    body: "CreateConversationInput",
    status: 202,
    scope: "conversation:create",
    mutation: true,
  }),
  route("GET", "/conversations/{id}", "getConversation", "Conversation", {
    scope: "conversation:read",
  }),
  route("GET", "/conversations/{id}/messages", "listMessages", "MessagePage", {
    scope: "conversation:read",
  }),
  route("POST", "/conversations/{id}/read", "markRead", "ReadPosition", {
    body: "ReadPositionInput",
    scope: "conversation:read",
  }),
  route(
    "PATCH",
    "/conversations/{id}",
    "patchConversation",
    "OperationReceipt",
    {
      body: "PatchConversationInput",
      status: 202,
      scope: "conversation:manage",
      mutation: true,
      revision: true,
    },
  ),
  route("POST", "/conversations/{id}/turns", "createTurn", "OperationReceipt", {
    body: "CreateTurnInput",
    status: 202,
    scope: "conversation:advance",
    mutation: true,
    revision: true,
  }),
  route("GET", "/runs/{id}", "getRun", "Run", { scope: "conversation:read" }),
  route("POST", "/runs/{id}/cancel", "cancelRun", "OperationReceipt", {
    body: "ActionInput",
    status: 202,
    mutation: true,
  }),
  route("GET", "/events", "streamEvents", "Event", { stream: true }),
  route("GET", "/snapshots", "getSnapshot", "Snapshot"),
  route("GET", "/operations", "listOperations", "OperationReceiptPage"),
  route("GET", "/operations/{id}", "getOperation", "OperationReceipt"),
  route("GET", "/schedules", "listSchedules", "ScheduleSummaryPage", {
    scope: "schedule:read",
  }),
  route("POST", "/schedules/search", "searchSchedules", "ScheduleSummaryPage", {
    body: "SearchScheduleInput",
    scope: "schedule:read",
  }),
  route("GET", "/schedules/{id}", "getSchedule", "Schedule", {
    scope: "schedule:read",
  }),
  route("POST", "/schedules/preview", "previewSchedule", "SchedulePreview", {
    body: "SchedulePreviewInput",
    scope: "schedule:manage",
  }),
  route("POST", "/schedules", "createSchedule", "OperationReceipt", {
    body: "CreateScheduleInput",
    status: 202,
    scope: "schedule:manage",
    mutation: true,
  }),
  route("PATCH", "/schedules/{id}", "patchSchedule", "OperationReceipt", {
    body: "PatchScheduleInput",
    status: 202,
    scope: "schedule:manage",
    mutation: true,
    revision: true,
  }),
  ...["pause", "resume", "trigger", "discard-pending"].map((action) =>
    route(
      "POST",
      `/schedules/{id}/${action}`,
      `${action.replace("-", "_")}Schedule`,
      "OperationReceipt",
      {
        body: "ActionInput",
        status: 202,
        scope: action === "trigger" ? "schedule:trigger" : "schedule:manage",
        mutation: true,
        revision: true,
      },
    ),
  ),
  route(
    "GET",
    "/schedules/{id}/executions",
    "listExecutions",
    "ScheduleExecutionPage",
    { scope: "schedule:read" },
  ),
  route("DELETE", "/schedules/{id}", "deleteSchedule", "OperationReceipt", {
    status: 202,
    scope: "schedule:manage",
    mutation: true,
    revision: true,
  }),
  route("GET", "/artifacts/{id}", "getArtifact", "Artifact", {
    scope: "artifact:read",
  }),
  route("GET", "/artifacts/{id}/content", "downloadArtifact", undefined, {
    scope: "artifact:read",
  }),
];
export function resolveMobileRoute(
  method: string,
  path: string,
): { route: MobileRoute; params: Record<string, string> } | null {
  if (
    path.includes("?") ||
    path.includes("#") ||
    path.includes("%") ||
    path.includes("..") ||
    path.length > 2048
  )
    return null;
  for (const candidate of MOBILE_ROUTES) {
    if (candidate.method !== method) continue;
    const names = [...candidate.path.matchAll(/\{([^}]+)\}/g)].map(
      (match) => match[1],
    );
    const pattern = candidate.path.replace(
      /\{[^}]+\}/g,
      "([A-Za-z0-9][A-Za-z0-9._:-]{0,159})",
    );
    const match = new RegExp(`^${pattern}$`).exec(path);
    if (match)
      return {
        route: candidate,
        params: Object.fromEntries(
          names.map((name, index) => [name, match[index + 1]]),
        ),
      };
  }
  return null;
}
export function validateMobileMutationHeaders(
  route: MobileRoute,
  headers: Record<string, string | undefined>,
  body?: unknown,
): void {
  if (!route.mutation) return;
  const key = headers["idempotency-key"],
    mutationId = headers["x-client-mutation-id"];
  if (
    !key ||
    !mutationId ||
    key !== mutationId ||
    !new RegExp(id.pattern!).test(key)
  )
    fail("headers.clientMutationId");
  const inBody = (body as Record<string, unknown> | undefined)
    ?.clientMutationId;
  if (inBody !== undefined && inBody !== key) fail("body.clientMutationId");
  if (route.revision && !headers["if-match"])
    throw new MobileContractError("revision_required", 428);
  if (
    route.revision &&
    !/^"(?:0|[1-9][0-9]{0,63})"$/.test(headers["if-match"]!)
  )
    fail("headers.if-match");
}
export function mobileProtocolCompatible(version: string): boolean {
  return /^mobile-control\/1\.(?:0|[1-9][0-9]*)$/.test(version);
}

/** One query contract for OpenAPI generation and Owner-side validation. */
export function mobileQuerySchemas(
  route: MobileRoute,
): Record<string, MobileSchema> {
  const paging =
    route.method === "GET" &&
    (route.response?.endsWith("Page") || route.operationId === "getSnapshot")
      ? page
      : {};
  const filters: Record<string, Record<string, MobileSchema>> = {
    streamEvents: { cursor: str(4096) },
    listConversations: {
      projectId: id,
      state: ref("ConversationFilter"),
      archived: bool,
    },
    listMessages: { beforeSeq: seq },
    getSnapshot: { conversationId: id },
    listSchedules: { state: ref("ScheduleState") },
    listOperations: { clientMutationId: id, status: ref("OperationStatus") },
  };
  return { ...paging, ...filters[route.operationId] };
}
export function validateMobileQuery(
  route: MobileRoute,
  query: Record<string, string>,
): void {
  const schemas = mobileQuerySchemas(route);
  for (const [key, value] of Object.entries(query)) {
    const schema = schemas[key];
    if (!schema) fail(`query.${key}`);
    let parsed: unknown = value;
    if (schema.type === "integer") {
      if (!/^[1-9][0-9]*$/.test(value)) fail(`query.${key}`);
      parsed = Number(value);
    }
    if (schema.type === "boolean") {
      if (!["true", "false"].includes(value)) fail(`query.${key}`);
      parsed = value === "true";
    }
    validate(schema, parsed, `query.${key}`);
  }
}
