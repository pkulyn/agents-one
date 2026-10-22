import { createHash, randomUUID } from "node:crypto";
import {
  assertMobileSchema,
  MOBILE_CONTROL_VERSION,
  MOBILE_LIMITS,
  resolveMobileRoute,
  validateMobileBody,
  validateMobileMutationHeaders,
  validateMobileQuery,
} from "../../shared/mobile-control";
import type {
  OwnerControlHandler,
  OwnerControlRequest,
  OwnerControlResponse,
} from "./owner-tunnel";
import type { MobileOwnerLedgerPort } from "./owner-ledger-port";
import type { MobileExecutionCoordinator } from "./execution-coordinator";
import type { MobileDesktopCatalog } from "./desktop-catalog";
import type { MobileScheduleReadRepository } from "./schedule-read";
import type { MobileScheduleControl } from "./schedule-control";
import { issueMobileSchedulePreview } from "./schedule-preview";
import { MobileOwnerEventStream } from "./event-stream";
import { MobileSourceEventPublisher } from "./source-events";
import type { MobileArtifactRepository } from "./artifact-repository";
import type { MobileRunReadRepository } from "./run-read";
import type { OriginalMobileRunControl } from "./original-run-control";
import type {
  MobileConversationCreation,
  NewMobileConversation,
} from "./conversation-creation";
import {
  publicConversationPreview,
  type ConversationRepository,
  type Json,
  type SourceConversation,
} from "./conversation-projection";

interface Snapshot {
  bytes: number;
  id: string;
  deviceId: string;
  grantRevision: string;
  kind: string;
  filter: string;
  expiresAt: number;
  revision: string;
  eventCursor: string;
  items: Json[];
}
function fail(code: string, status = 409): never {
  throw Object.assign(Error(code), { code, status });
}
function data(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}
const iso = (value: number): string => new Date(value).toISOString();
const queryHash = (value: Json): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    .digest("hex");
const LIMITS = {
  maxPageSize: 100,
  maxTextCharacters: 50000,
  maxRequestBytes: 262144,
  maxTimeoutMs: 86400000,
  eventRetentionDays: 7,
  eventRetentionCount: 100000,
  snapshotTtlMs: 300000,
};

/** Real conversation routes. Runtime execution and scheduler routes are composed in a separate handler. */
export class MobileConversationController implements OwnerControlHandler {
  private snapshots = new Map<string, Snapshot>();
  private continuationPolicies = new WeakMap<OwnerControlRequest, Json[]>();
  private policiesForRequest(request: OwnerControlRequest): Json[] {
    let policies = this.continuationPolicies.get(request);
    if (!policies) {
      policies = this.catalog?.snapshot().policies ?? [];
      this.continuationPolicies.set(request, policies);
    }
    return policies;
  }
  private sourcePublisher?: MobileSourceEventPublisher;
  constructor(
    private readonly repository: ConversationRepository,
    private readonly ledger: MobileOwnerLedgerPort,
    private readonly label: string,
    private readonly now: () => number = Date.now,
    private readonly execution?: MobileExecutionCoordinator,
    private readonly creation?: MobileConversationCreation,
    private readonly catalog?: MobileDesktopCatalog,
    private readonly schedules?: MobileScheduleReadRepository,
    private readonly scheduleControl?: MobileScheduleControl,
    sourceGuard?: () => void,
    private readonly executionAvailable: () => boolean = () => true,
    private readonly schedulerOnline: () => boolean = () => false,
    private readonly artifacts?: MobileArtifactRepository,
    private readonly originalRuns?: MobileRunReadRepository,
    private readonly originalControl?: OriginalMobileRunControl,
  ) {
    if (sourceGuard)
      this.sourcePublisher = new MobileSourceEventPublisher(
        ledger,
        repository,
        (row) => this.messages(row),
        (row, messages) => this.conversation(row, undefined, messages),
        sourceGuard,
        schedules,
        originalRuns ? () => originalRuns.list() : undefined,
      );
  }
  status(): Json {
    const available = this.executionAvailable();
    const executable = Boolean(this.execution) && available;
    return {
      ownerId: this.ledger.ownerId,
      spaceId: this.ledger.spaceId,
      label: this.label,
      ownerType: "desktop",
      online: true,
      executionAvailable: executable,
      schedulerOnline: this.schedulerOnline() === true,
      schedulerTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      capabilities: [
        "conversation:read",
        "conversation:manage",
        ...(this.artifacts ? ["artifact:read"] : []),
        ...(this.creation && available ? ["conversation:create"] : []),
        ...(executable || this.originalControl ? ["conversation:advance"] : []),
        ...(this.schedules ? ["schedule:read"] : []),
        ...(this.scheduleControl ? ["schedule:manage"] : []),
        ...(this.scheduleControl?.cancelRun ? ["schedule:cancel"] : []),
        ...(this.scheduleControl?.triggerAvailable?.()
          ? ["schedule:trigger"]
          : []),
      ],
      limits: LIMITS,
      dataEpoch: this.ledger.dataEpoch,
    };
  }
  private messages(value: SourceConversation): Promise<Json[]> {
    return Promise.resolve(this.ledger.indexMessages(
      value.id,
      value.messages.map((message) => ({
        id: message.id,
        conversationId: value.id,
        kind: message.kind,
        content: message.content,
        visibleToUser: true,
        createdAt: iso(message.createdAt),
        ...(message.runtimeId ? { runtimeId: message.runtimeId } : {}),
        ...(message.runId ? { runId: message.runId } : {}),
      })),
    ));
  }
  private async conversation(
    value: SourceConversation,
    request?: OwnerControlRequest,
    messages?: Json[],
  ): Promise<Json> {
    const indexedMessages = messages ?? (await this.messages(value));
    const last = indexedMessages.reduce(
      (max, item) =>
        BigInt(String(item.messageSeq)) > BigInt(max)
          ? String(item.messageSeq)
          : max,
      "0",
    );
    const actions = [
      "read",
      ...(value.sourceKind === "runtime_conversation" &&
      this.execution &&
      (!request || request.device.scopes.includes("conversation:advance")) &&
      (!request || this.policiesForRequest(request).some((policy) =>
        policy.enforced === true && policy.runtimeId === value.runtimeId &&
        (policy.projectId ?? undefined) === value.projectId &&
        (policy.allowedActions as string[]).includes("advance")))
        ? ["advance"]
        : []),
      ...(value.manageable &&
      (!request || request.device.scopes.includes("conversation:manage"))
        ? ["manage"]
        : []),
    ];
    return {
      id: value.id,
      sourceKind: value.sourceKind,
      title: value.title,
      runtimeId: value.runtimeId,
      projectId: value.projectId ?? null,
      revision:
        value.revision ??
        await this.ledger.observeReadonlySource(
          JSON.stringify([value.sourceKind, value.id]),
          { ...value, messages: indexedMessages },
        ),
      pinned: value.pinned,
      archived: value.archived,
      lastMessageSeq: last,
      lastMessagePreview: publicConversationPreview(value.messages),
      lastReadMessageSeq: request
        ? await this.ledger.readPosition(request.device.deviceId, value.id)
        : "0",
      activity: value.activeRunIds.length
        ? "active"
        : value.restrictionReason
          ? "needs_attention"
          : "idle",
      activeRunIds: value.activeRunIds,
      createdAt: iso(value.createdAt),
      updatedAt: iso(value.updatedAt),
      allowedActions: actions,
      restrictionReason: actions.includes("advance") ? null : value.restrictionReason ?? "requires_owner_action",
    };
  }
  private requireRead(request: OwnerControlRequest): void {
    if (!request.device.scopes.includes("conversation:read"))
      fail("scope_denied", 403);
  }
  private schedule(row: Json, request: OwnerControlRequest): Json {
    return {
      ...row,
      allowedActions: [
        "read",
        ...(this.scheduleControl
          ? this.scheduleControl
              .actions(row)
              .filter((action) =>
                request.device.scopes.includes(
                  action === "trigger"
                    ? "schedule:trigger"
                    : action === "cancel"
                      ? "schedule:cancel"
                      : "schedule:manage",
                ),
              )
          : []),
      ],
    };
  }
  private async run(row: Json, request: OwnerControlRequest): Promise<Json> {
    const scope = (await this.ledger.execution(String(row.runId)))
      ? "conversation:advance"
      : this.originalControl?.scope(String(row.runId));
    return {
      ...row,
      allowedActions: (row.allowedActions as string[]).filter(
        (action) =>
          action === "read" ||
          (action === "cancel" &&
            scope !== undefined &&
            request.device.scopes.includes(scope)),
      ),
      artifacts: request.device.scopes.includes("artifact:read")
        ? row.artifacts
        : [],
    };
  }
  private source(id: string): SourceConversation {
    const value = this.repository.list().find((item) => item.id === id);
    if (!value) fail("resource_not_found", 404);
    return value;
  }
  private async frozen(
    request: OwnerControlRequest,
    kind: string,
    filters: Json,
    cursor: unknown,
    create: () => Json[] | Promise<Json[]>,
  ): Promise<{ snapshot: Snapshot; position: number }> {
    for (const [key, value] of this.snapshots)
      if (value.expiresAt <= this.now()) this.snapshots.delete(key);
    const filter = queryHash(filters);
    if (cursor !== undefined) {
      const parsed = await this.ledger.parseCursor(
        String(cursor),
        request.device.deviceId,
        request.device.grantRevision,
      );
      const snapshot = this.snapshots.get(String(parsed.snapshotId));
      if (
        !snapshot ||
        snapshot.kind !== kind ||
        snapshot.filter !== filter ||
        snapshot.deviceId !== request.device.deviceId ||
        snapshot.grantRevision !== request.device.grantRevision ||
        !Number.isSafeInteger(parsed.position) ||
        Number(parsed.position) < 0 ||
        Number(parsed.position) > snapshot.items.length
      )
        fail("cursor_expired", 410);
      return { snapshot, position: Number(parsed.position) };
    }
    if (
      this.snapshots.size >= 128 ||
      [...this.snapshots.values()].filter(
        (value) => value.deviceId === request.device.deviceId,
      ).length >= 32
    )
      fail("rate_limited", 429);
    const items = await create();
    const bytes = Buffer.byteLength(JSON.stringify(items));
    if (
      bytes +
        [...this.snapshots.values()].reduce(
          (total, item) => total + item.bytes,
          0,
        ) >
      64 * 1024 * 1024
    )
      fail("rate_limited", 429);
    const snapshot: Snapshot = {
      bytes,
      id: randomUUID(),
      deviceId: request.device.deviceId,
      grantRevision: request.device.grantRevision,
      kind,
      filter,
      items: structuredClone(items),
      expiresAt: this.now() + MOBILE_LIMITS.previewTtlMs,
      revision: this.ledger.changeSeq,
      eventCursor: await this.ledger.cursor(
        request.device.deviceId,
        request.device.grantRevision,
      ),
    };
    this.snapshots.set(snapshot.id, snapshot);
    return {
      snapshot,
      position: kind === "messages" ? snapshot.items.length : 0,
    };
  }
  private cursor(snapshot: Snapshot, position: number): Promise<string> {
    return Promise.resolve(this.ledger.cursor(snapshot.deviceId, snapshot.grantRevision, {
      snapshotId: snapshot.id,
      position,
    }));
  }
  private async page(
    request: OwnerControlRequest,
    kind: string,
    filters: Json,
    cursor: unknown,
    limit: number,
    create: () => Json[] | Promise<Json[]>,
  ): Promise<Json> {
    const { snapshot, position } = await this.frozen(
      request,
      kind,
      filters,
      cursor,
      create,
    );
    const end = Math.min(position + limit, snapshot.items.length);
    return {
      items: snapshot.items.slice(position, end),
      nextCursor:
        end < snapshot.items.length ? await this.cursor(snapshot, end) : null,
      snapshotRevision: snapshot.revision,
    };
  }
  async handle(request: OwnerControlRequest): Promise<OwnerControlResponse> {
    this.continuationPolicies.delete(request);
    if (
      request.signal.aborted ||
      request.device.revoked ||
      !Number.isFinite(Date.parse(request.device.expiresAt)) ||
      Date.parse(request.device.expiresAt) <= this.now()
    )
      fail("revoked", 403);
    if (
      request.device.ownerId !== this.ledger.ownerId ||
      request.device.spaceId !== this.ledger.spaceId
    )
      fail("scope_denied", 403);
    const resolved = resolveMobileRoute(request.method, request.path);
    if (
      !resolved ||
      resolved.params.ownerId !== this.ledger.ownerId ||
      resolved.params.spaceId !== this.ledger.spaceId ||
      resolved.route.operationId !== request.operationId ||
      JSON.stringify(resolved.params) !== JSON.stringify(request.params)
    )
      fail("scope_denied", 403);
    const route = resolved.route;
    if (route.body) validateMobileBody(route.body, request.body);
    validateMobileQuery(route, request.query);
    validateMobileMutationHeaders(route, request.headers, request.body);
    if (route.scope && !request.device.scopes.includes(route.scope))
      fail("scope_denied", 403);
    const input = data(request.body);
    let body: unknown;
    switch (request.operationId) {
      case "streamEvents": {
        if (request.device.scopes.includes("artifact:read"))
          await this.artifacts?.sync();
        await this.originalRuns?.sync();
        return {
          status: 200,
          events: await new MobileOwnerEventStream(
            this.ledger,
            async () => await this.sourcePublisher?.sync(),
            async () => {
              if (request.device.scopes.includes("artifact:read"))
                await this.artifacts?.sync();
              await this.originalRuns?.sync();
            },
            (run) => this.run(run, request),
          ).open(request),
        };
      }
      case "getSnapshot": {
        if (request.device.scopes.includes("artifact:read"))
          await this.artifacts?.sync();
        await this.originalRuns?.sync();
        await this.sourcePublisher?.sync();
        const { cursor, limit, ...filters } = request.query;
        const { snapshot, position } = await this.frozen(
          request,
          "space-snapshot",
          filters,
          cursor,
          async () => {
            const conversationItems =
              request.device.scopes.includes("conversation:read")
                ? await Promise.all(
                    this.repository
                      .list()
                      .filter(
                        (row) =>
                          !filters.conversationId ||
                          row.id === filters.conversationId,
                      )
                      .map(async (row) => ({
                        kind: "conversation",
                        value: await this.conversation(row, request),
                      })),
                  )
                : [];
            const scheduleItems =
              request.device.scopes.includes("schedule:read") &&
              this.schedules &&
              !filters.conversationId
                ? this.schedules.list().map((row) => ({
                    kind: "schedule",
                    value: this.schedule(
                      this.schedules!.get(String(row.id)),
                      request,
                    ),
                  }))
                : [];
            const originalRunItems =
              request.device.scopes.includes("conversation:read")
                ? await Promise.all(
                    (this.originalRuns?.list() ?? [])
                      .filter(
                        (run) =>
                          !filters.conversationId ||
                          run.conversationId === filters.conversationId,
                      )
                      .map(async (run) => ({
                        kind: "run",
                        value: await this.run(run, request),
                      })),
                  )
                : [];
            const executionEntries =
              request.device.scopes.includes("conversation:read") &&
              this.execution
                ? await this.ledger.executionEntries()
                : [];
            const executionItems = await Promise.all(
              executionEntries
                .filter(
                  (entry) =>
                    !filters.conversationId ||
                    entry.run.conversationId === filters.conversationId,
                )
                .map(async (entry) => ({
                  kind: "run",
                  value: {
                    ...entry.run,
                    artifacts: request.device.scopes.includes("artifact:read")
                      ? (await this.artifacts?.list(String(entry.run.runId))) ??
                        entry.run.artifacts
                      : [],
                    allowedActions: request.device.scopes.includes(
                      "conversation:advance",
                    )
                      ? entry.run.allowedActions
                      : ["read"],
                  },
                })),
            );
            return [
              ...conversationItems,
              ...scheduleItems,
              ...originalRunItems,
              ...executionItems,
            ];
          },
        );
        const count = Number(limit ?? 100);
        const rows = snapshot.items.slice(position, position + count);
        const next = position + rows.length;
        body = {
          conversations: rows
            .filter((row) => row.kind === "conversation")
            .map((row) => row.value),
          schedules: rows
            .filter((row) => row.kind === "schedule")
            .map((row) => row.value),
          runs: rows
            .filter((row) => row.kind === "run")
            .map((row) => row.value),
          snapshotRevision: snapshot.revision,
          dataEpoch: this.ledger.dataEpoch,
          snapshotCursor: snapshot.eventCursor,
          nextCursor:
            next < snapshot.items.length ? await this.cursor(snapshot, next) : null,
        };
        break;
      }
      case "getBootstrap": {
        await this.originalRuns?.sync();
        await this.sourcePublisher?.sync();
        const owner = this.status();
        const capabilities = (owner.capabilities as string[]).filter((scope) =>
          request.device.scopes.includes(scope),
        );
        body = {
          protocolVersion: MOBILE_CONTROL_VERSION,
          ownerSpace: { ...owner, capabilities },
          grantRevision: request.device.grantRevision,
          serverTime: iso(this.now()),
          dataEpoch: this.ledger.dataEpoch,
          capabilities,
          limits: LIMITS,
          snapshotCursor: await this.ledger.cursor(
            request.device.deviceId,
            request.device.grantRevision,
          ),
        };
        break;
      }
      case "getRuntimeAvatar": {
        if (!this.catalog?.avatar) fail("requires_owner_action", 503);
        body = this.catalog.avatar(request.params.id, request.params.avatarId);
        break;
      }
      case "listRuntimes":
      case "listProjects":
      case "listExecutionPolicies": {
        if (!this.catalog) fail("requires_owner_action", 503);
        const kind =
          request.operationId === "listRuntimes"
            ? "runtimes"
            : request.operationId === "listProjects"
              ? "projects"
              : "policies";
        const { cursor, limit, ...filters } = request.query;
        body = await this.page(
          request,
          kind,
          filters,
          cursor,
          Number(limit ?? 50),
          () => {
            const rows = this.catalog!.snapshot()[kind];
            return rows.map((row) => {
              if (kind === "projects") return row;
              const actions = (row.allowedActions as string[]).filter(
                (action) => {
                  if (action === "read")
                    return request.device.scopes.includes("conversation:read");
                  if (action === "create")
                    return (
                      Boolean(this.creation) &&
                      request.device.scopes.includes("conversation:create")
                    );
                  if (action === "advance")
                    return (
                      Boolean(this.execution) &&
                      request.device.scopes.includes("conversation:advance")
                    );
                  if (action === "trigger")
                    return (
                      kind === "policies" &&
                      row.enforced === true &&
                      row.unattendedApproved === true &&
                      Boolean(this.scheduleControl) &&
                      (request.device.scopes.includes("schedule:manage") ||
                        request.device.scopes.includes("schedule:trigger"))
                    );
                  return false;
                },
              );
              return { ...row, allowedActions: actions };
            });
          },
        );
        break;
      }
      case "previewSchedule": {
        if (!this.schedules) fail("requires_owner_action", 503);
        body = await issueMobileSchedulePreview(
          input,
          request,
          this.ledger,
          this.schedules,
          this.now(),
        );
        break;
      }
      case "listSchedules":
      case "searchSchedules": {
        if (!this.schedules) fail("requires_owner_action", 503);
        const query =
          request.operationId === "listSchedules" ? request.query : input;
        const { cursor, limit, ...filters } = query;
        body = await this.page(
          request,
          "schedules",
          filters,
          cursor,
          Number(limit ?? 50),
          () =>
            this.schedules!.list()
              .map((row) => this.schedule(row, request))
              .filter(
                (row) =>
                  (!filters.projectId || row.projectId === filters.projectId) &&
                  (!filters.state ||
                    filters.state === "all" ||
                    row.effectiveState === filters.state) &&
                  (!filters.query ||
                    String(row.name)
                      .toLocaleLowerCase()
                      .includes(String(filters.query).toLocaleLowerCase())),
              )
               .sort(
                 (a, b) =>
                   (typeof a.nextRunAt === "string" ? a.nextRunAt : "~").localeCompare(typeof b.nextRunAt === "string" ? b.nextRunAt : "~") ||
                   String(a.name).localeCompare(String(b.name)) ||
                  String(a.id).localeCompare(String(b.id)),
              ),
        );
        break;
      }
      case "getSchedule": {
        if (!this.schedules) fail("requires_owner_action", 503);
        body = this.schedule(this.schedules.get(request.params.id), request);
        break;
      }
      case "listExecutions": {
        if (!this.schedules) fail("requires_owner_action", 503);
        const { cursor, limit, ...filters } = request.query;
        body = await this.page(
          request,
          "schedule-executions",
          { ...filters, id: request.params.id },
          cursor,
          Number(limit ?? 50),
          () => this.schedules!.executions(request.params.id),
        );
        break;
      }
      case "listConversations":
      case "searchConversations": {
        this.requireRead(request);
        const query =
          request.operationId === "listConversations" ? request.query : input;
        const {
          cursor,
          limit: pageLimit,
          clientMutationId: unused,
          ...filters
        } = query;
        void unused;
        const limit = Number(pageLimit ?? 50);
        body = await this.page(
          request,
          "conversations",
          filters,
          cursor,
          limit,
          async () => {
            const mapped = await Promise.all(
              this.repository
                .list()
                .filter(
                  (value) =>
                    !filters.query ||
                    [
                      value.title,
                      ...value.messages.map((message) => message.content),
                    ].some((text) =>
                      text
                        .toLocaleLowerCase()
                        .includes(String(filters.query).toLocaleLowerCase()),
                    ),
                )
                .map((value) => this.conversation(value, request)),
            );
            return mapped
              .filter(
                (value) =>
                  (filters.archived === undefined
                    ? value.archived === false
                    : value.archived ===
                      (filters.archived === true ||
                        filters.archived === "true")) &&
                  (!filters.projectId || value.projectId === filters.projectId) &&
                  (!filters.state ||
                    filters.state === "all" ||
                    value.activity ===
                      (filters.state === "attention"
                        ? "needs_attention"
                        : filters.state)),
              )
              .sort(
                (a, b) =>
                  Number(b.pinned) - Number(a.pinned) ||
                  String(b.updatedAt).localeCompare(String(a.updatedAt)) ||
                  String(a.id).localeCompare(String(b.id)),
              );
          },
        );
        break;
      }
      case "getConversation": {
        this.requireRead(request);
        body = await this.conversation(this.source(request.params.id), request);
        break;
      }
      case "listMessages": {
        this.requireRead(request);
        const value = this.source(request.params.id);
        const frozen = await this.frozen(
          request,
          "messages",
          { id: value.id },
          request.query.cursor,
          () => this.messages(value),
        );
        const snapshot = frozen.snapshot;
        let position = frozen.position;
        if (request.query.beforeSeq !== undefined) {
          const boundary = snapshot.items.findIndex(
            (item) => item.messageSeq === request.query.beforeSeq,
          );
          if (
            boundary < 0 ||
            (request.query.cursor !== undefined && boundary !== position)
          )
            fail("cursor_expired", 410);
          position = boundary;
        }
        const start = Math.max(0, position - Number(request.query.limit ?? 50));
        const items = snapshot.items.slice(start, position);
        for (const item of items) assertMobileSchema("Message", item);
        await this.ledger.delivered(
          request.device.deviceId,
          value.id,
          items.map((item) => String(item.messageSeq)),
        );
        body = {
          items,
          hasMoreBefore: start > 0,
          snapshotCursor: await this.cursor(snapshot, start),
          snapshotRevision: snapshot.revision,
        };
        break;
      }
      case "markRead": {
        this.requireRead(request);
        const value = this.source(request.params.id);
        body = {
          conversationId: value.id,
          lastReadMessageSeq: await this.ledger.markRead(
            request.device.deviceId,
            value.id,
            String(input.lastReadMessageSeq),
          ),
        };
        break;
      }
      case "patchConversation": {
        const replay = await this.ledger.operation(request);
        if (replay) {
          body = replay;
          break;
        }
        const value = this.source(request.params.id);
        if (!value.manageable) fail("requires_owner_action", 403);
        const revision = request.headers["if-match"].slice(1, -1);
        if (value.revision !== revision) fail("revision_conflict");
        const { clientMutationId: unused, ...patch } = input;
        void unused;
        await this.ledger.accept(request, { type: "conversation", id: value.id });
        try {
          this.repository.patch(value.id, patch, revision);
        } catch (error) {
          await this.ledger.reject(
            request,
            error as { code?: string; status?: number },
          );
          throw error;
        }
        try {
          body = await this.ledger.complete(request, { conversationId: value.id });
        } catch {
          fail("reconciliation_required");
        }
        break;
      }
      case "createConversation": {
        if (!this.creation) fail("requires_owner_action", 503);
        const replay = await this.ledger.operation(request);
        if (replay) {
          body = replay;
          break;
        }
        const value = input as unknown as NewMobileConversation;
        this.creation.validate(value);
        const id = `conversation-${randomUUID()}`;
        await this.ledger.accept(request, { type: "conversation", id });
        try {
          this.creation.create(id, value);
        } catch (error) {
          const failure = error as { code?: string; status?: number };
          if (
            [
              "unverified_policy",
              "profile_inactive",
              "resource_not_found",
              "requires_owner_action",
            ].includes(failure.code ?? "")
          )
            await this.ledger.reject(request, failure);
          else await this.ledger.uncertain(request);
          throw error;
        }
        try {
          body = await this.ledger.complete(request, { conversationId: id });
        } catch {
          try {
            await this.ledger.uncertain(request);
          } catch {
            /* Durable intent remains available after storage recovery. */
          }
          fail("reconciliation_required");
        }
        break;
      }
      case "pauseSchedule":
      case "createSchedule":
      case "patchSchedule":
      case "resumeSchedule":
      case "triggerSchedule":
      case "discard_pendingSchedule":
      case "deleteSchedule": {
        if (!this.scheduleControl) fail("requires_owner_action", 503);
        body = await this.scheduleControl.handle(request);
        break;
      }
      case "createTurn": {
        if (!this.execution) fail("requires_owner_action", 503);
        if (
          this.source(request.params.id).sourceKind !== "runtime_conversation"
        )
          fail("requires_owner_action", 403);
        body = await this.execution.createTurn(request);
        break;
      }
      case "getRun": {
        if (request.device.scopes.includes("artifact:read"))
          await this.artifacts?.sync();
        if (await this.ledger.execution(request.params.id)) {
          if (!this.execution) fail("requires_owner_action", 503);
          body = await this.execution.getRun(request);
        } else {
          await this.originalRuns?.sync();
          body = this.originalRuns?.get(request.params.id);
          if (!body) fail("resource_not_found", 404);
        }
        const run = data(body);
        body = await this.run(
          {
            ...run,
            artifacts: request.device.scopes.includes("artifact:read")
              ? (await this.artifacts?.list(request.params.id)) ?? run.artifacts
              : [],
          },
          request,
        );
        break;
      }
      case "getArtifact": {
        if (!this.artifacts) fail("requires_owner_action", 503);
        await this.artifacts.sync();
        body = await this.artifacts.metadata(request.params.id);
        break;
      }
      case "downloadArtifact": {
        if (!this.artifacts) fail("requires_owner_action", 503);
        await this.artifacts.sync();
        return {
          status: 200,
          download: await this.artifacts.download(
            request.params.id,
            request.signal,
          ),
        };
      }
      case "cancelRun": {
        if (await this.ledger.execution(request.params.id)) {
          if (!this.execution) fail("requires_owner_action", 503);
          body = await this.execution.cancelRun(request);
        } else {
          await this.originalRuns?.sync();
          if (
            this.originalControl?.scope(request.params.id) ===
            "conversation:advance"
          )
            body = await this.originalControl.cancel(request);
          else if (this.scheduleControl?.cancelRun)
            body = await this.scheduleControl.cancelRun(request);
          else fail("resource_not_found", 404);
        }
        break;
      }
      case "listOperations": {
        const { cursor, limit, ...filters } = request.query;
        body = await this.page(
          request,
          "operations",
          filters,
          cursor,
          Number(limit ?? 50),
          async () =>
            (await this.ledger
              .operations(request.device.deviceId))
              .filter(
                (value) =>
                  (!filters.status || value.status === filters.status) &&
                  (!filters.clientMutationId ||
                    value.clientMutationId === filters.clientMutationId),
              ) as unknown as Json[],
        );
        break;
      }
      case "getOperation": {
        body = (await this.ledger
          .operations(request.device.deviceId)
        ).find((value) => value.operationId === request.params.id);
        if (!body) fail("resource_not_found", 404);
        break;
      }
      default:
        return fail("requires_owner_action", 503);
    }
    if (route.response) assertMobileSchema(route.response, body);
    return { status: route.status, body };
  }
}
