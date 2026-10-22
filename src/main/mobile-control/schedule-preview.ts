import { createHash } from "node:crypto";
import { assertMobileSchema } from "../../shared/mobile-control";
import { DEFAULT_TASK_SCHEDULE_TIMEOUT_MS } from "../task-schedules";
import type { Json } from "./conversation-projection";
import type { OwnerControlRequest } from "./owner-tunnel";
import type { MobileOwnerLedgerPort } from "./owner-ledger-port";
import type { MobileScheduleReadRepository } from "./schedule-read";

const hash = (value: Json): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    .digest("hex");
const reject = (): never => {
  throw Object.assign(Error("preview_expired"), {
    code: "preview_expired",
    status: 409,
  });
};
/** Sign the exact effective draft; transport mutation metadata is excluded. */
export function schedulePreviewDraft(value: Json): Json {
  const {
    previewRevision: preview,
    clientMutationId: mutation,
    ...draft
  } = value;
  void preview;
  void mutation;
  assertMobileSchema("SchedulePreviewInput", draft);
  return {
    projectId: null,
    timeoutMs: DEFAULT_TASK_SCHEDULE_TIMEOUT_MS,
    concurrencyPolicy: "skip",
    ...draft,
  };
}
export async function issueMobileSchedulePreview(
  input: Json,
  request: OwnerControlRequest,
  ledger: MobileOwnerLedgerPort,
  schedules: MobileScheduleReadRepository,
  now: number,
): Promise<Json> {
  const draft = schedulePreviewDraft(input);
  const preview = schedules.preview(String(draft.scheduleExpression), now);
  return {
    ...preview,
    description: `${preview.normalizedExpression} (${preview.schedulerTimeZone})`,
    previewRevision: await ledger.cursor(
      request.device.deviceId,
      request.device.grantRevision,
      {
        purpose: "schedule-preview",
        previewedAt: now,
        inputHash: hash({
          ...draft,
          scheduleExpression: preview.normalizedExpression,
        }),
        schedulerTimeZone: preview.schedulerTimeZone,
        occurrenceHash: hash({ nextOccurrences: preview.nextOccurrences }),
      },
    ),
  };
}
/** Verify against the original preview time, rather than a new interval anchor. */
export async function validateMobileSchedulePreview(
  input: Json,
  request: OwnerControlRequest,
  ledger: MobileOwnerLedgerPort,
  schedules: MobileScheduleReadRepository,
  now: number,
): Promise<Json> {
  const draft = schedulePreviewDraft(input);
  let token: Json;
  try {
    token = await ledger.parseCursor(
      String(input.previewRevision),
      request.device.deviceId,
      request.device.grantRevision,
    );
  } catch {
    return reject();
  }
  if (
    token.purpose !== "schedule-preview" ||
    typeof token.previewedAt !== "number" ||
    !Number.isSafeInteger(token.previewedAt) ||
    token.previewedAt > now ||
    now - token.previewedAt >= 300000
  )
    return reject();
  const preview = schedules.preview(
    String(draft.scheduleExpression),
    token.previewedAt,
  );
  if (
    token.inputHash !==
      hash({ ...draft, scheduleExpression: preview.normalizedExpression }) ||
    token.schedulerTimeZone !== preview.schedulerTimeZone ||
    token.occurrenceHash !== hash({ nextOccurrences: preview.nextOccurrences })
  )
    return reject();
  return { ...draft, scheduleExpression: preview.normalizedExpression };
}
