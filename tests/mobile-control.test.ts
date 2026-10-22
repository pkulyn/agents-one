import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  assertMobileSchema,
  MOBILE_ROUTES,
  MOBILE_SCHEMAS,
  MobileContractError,
  mobileProtocolCompatible,
  resolveMobileRoute,
  validateMobileBody,
  validateMobileMutationHeaders,
} from "../src/shared/mobile-control";

const root = new URL("../", import.meta.url);
const fixtures = JSON.parse(
  readFileSync(
    new URL("contracts/mobile-control/v1/fixtures.json", root),
    "utf8",
  ),
);
const openapi = JSON.parse(
  readFileSync(
    new URL("contracts/mobile-control/v1/openapi.json", root),
    "utf8",
  ),
);
const write = { executionPolicyId: "inspect-1", text: "请总结当前进展" };
const turn = MOBILE_ROUTES.find((route) => route.operationId === "createTurn")!;
const headers = {
  "idempotency-key": "mutation-1",
  "x-client-mutation-id": "mutation-1",
  "if-match": '"9007199254740993"',
};

describe("mobile control contract", () => {
  test("all generated examples and references stay synchronized", () => {
    execFileSync(
      process.execPath,
      ["scripts/generate-mobile-contract.mjs", "--check"],
      { cwd: root, stdio: "pipe" },
    );
    for (const [name, example] of Object.entries(fixtures.objects))
      assertMobileSchema(name, example);
    for (const error of fixtures.errors)
      assertMobileSchema("ErrorEnvelope", error);
    for (const [name, values] of Object.entries(fixtures.enums))
      for (const value of values as unknown[]) assertMobileSchema(name, value);
    for (const route of MOBILE_ROUTES) {
      expect(
        openapi.paths[route.path][route.method.toLowerCase()].operationId,
      ).toBe(route.operationId);
      if (route.body) expect(MOBILE_SCHEMAS[route.body]).toBeDefined();
      if (route.response) expect(MOBILE_SCHEMAS[route.response]).toBeDefined();
    }
  });
  test("rejects unknown write fields and paths while allowing future read fields", () => {
    expect(() =>
      validateMobileBody("CreateTurnInput", {
        ...write,
        workspace: "D:/private",
      }),
    ).toThrow(MobileContractError);
    assertMobileSchema("Conversation", {
      ...fixtures.objects.Conversation,
      futureField: { x: true },
    });
    for (const path of [
      "/ipc/execute",
      "/v1/runtime/tasks",
      "/agents-one/mobile/v1/owners/a/spaces/b/conversations/../runtimes",
      "/agents-one/mobile/v1/owners/a/spaces/b/conversations/%2e",
    ])
      expect(resolveMobileRoute("POST", path)).toBeNull();
    expect(
      resolveMobileRoute(
        "POST",
        "/agents-one/mobile/v1/owners/a/spaces/b/conversations/c/turns",
      )?.params,
    ).toEqual({ ownerId: "a", spaceId: "b", id: "c" });
  });
  test("keeps decimal revisions exact and rejects unsafe numeric coercion", () => {
    assertMobileSchema("Conversation", fixtures.objects.Conversation);
    expect(() =>
      assertMobileSchema("Conversation", {
        ...fixtures.objects.Conversation,
        revision: 9007199254740992,
      }),
    ).toThrow();
    expect(() =>
      validateMobileBody("ReadPositionInput", { lastReadMessageSeq: "-1" }),
    ).toThrow();
    expect(() =>
      validateMobileBody("ReadPositionInput", { lastReadMessageSeq: "01" }),
    ).toThrow();
  });
  test("requires matching stable mutation headers and quoted revisions", () => {
    validateMobileMutationHeaders(turn, headers, write);
    expect(() =>
      validateMobileMutationHeaders(turn, {
        ...headers,
        "if-match": undefined,
      }),
    ).toThrow(
      expect.objectContaining({ code: "revision_required", status: 428 }),
    );
    expect(() =>
      validateMobileMutationHeaders(turn, {
        ...headers,
        "idempotency-key": "new-id",
      }),
    ).toThrow();
    expect(() =>
      validateMobileMutationHeaders(turn, headers, {
        ...write,
        clientMutationId: "new-id",
      }),
    ).toThrow();
    expect(() =>
      validateMobileMutationHeaders(turn, { ...headers, "if-match": "1" }),
    ).toThrow();
    validateMobileMutationHeaders(
      MOBILE_ROUTES.find((route) => route.operationId === "cancelRun")!,
      { ...headers, "if-match": undefined },
    );
    validateMobileMutationHeaders(
      MOBILE_ROUTES.find((route) => route.operationId === "markRead")!,
      {},
      { lastReadMessageSeq: "1" },
    );
  });
  test("distinguishes absent PATCH field from explicit null", () => {
    validateMobileBody("PatchConversationInput", { title: "新名称" });
    validateMobileBody("PatchConversationInput", { projectId: null });
    expect(() =>
      validateMobileBody("PatchConversationInput", { title: null }),
    ).toThrow();
    expect(() =>
      validateMobileBody("PatchConversationInput", { clientMutationId: "m1" }),
    ).toThrow();
  });
  test("enforces unicode character and UTF-8 request limits without logging content", () => {
    validateMobileBody("CreateTurnInput", {
      ...write,
      text: "😀".repeat(50_000),
    });
    expect(() =>
      validateMobileBody("CreateTurnInput", {
        ...write,
        text: "x".repeat(50_001),
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(() =>
      validateMobileBody("CreateTurnInput", {
        ...write,
        text: "x".repeat(262_144),
      }),
    ).toThrow(
      expect.objectContaining({ code: "payload_too_large", status: 413 }),
    );
  });
  test("validates event payload type and requires stream message revision", () => {
    const event = {
      ...fixtures.objects.Event,
      type: "message.upsert",
      payload: { ...fixtures.objects.Message, messageRevision: "1" },
    };
    assertMobileSchema("Event", event);
    expect(() =>
      assertMobileSchema("Event", {
        ...event,
        payload: fixtures.objects.Conversation,
      }),
    ).toThrow();
    const { messageRevision: _, ...payload } = event.payload;
    expect(() => assertMobileSchema("Event", { ...event, payload })).toThrow();
  });
  test("limits schedule preview to five UTC dates and Owner IANA timezone", () => {
    assertMobileSchema("SchedulePreview", fixtures.objects.SchedulePreview);
    expect(() =>
      assertMobileSchema("SchedulePreview", {
        ...fixtures.objects.SchedulePreview,
        schedulerTimeZone: "not/a-zone",
      }),
    ).toThrow();
    expect(() =>
      assertMobileSchema("SchedulePreview", {
        ...fixtures.objects.SchedulePreview,
        nextOccurrences: ["2026-02-30T00:00:00Z"],
      }),
    ).toThrow();
    expect(() =>
      assertMobileSchema("SchedulePreview", {
        ...fixtures.objects.SchedulePreview,
        nextOccurrences: Array(5).fill("2026-02-30T00:00:00Z"),
      }),
    ).toThrow();
  });
  test("negotiates only the supported major version", () => {
    expect(mobileProtocolCompatible("mobile-control/1.0")).toBe(true);
    expect(mobileProtocolCompatible("mobile-control/1.2")).toBe(true);
    expect(mobileProtocolCompatible("mobile-control/2.0")).toBe(false);
    expect(mobileProtocolCompatible("mobile-control/1.01")).toBe(false);
  });
});
