import { useEffect, useRef, useState } from "react";
import { useI18n } from "../useI18n";
import type {
  MobileExecutionApprovalStatus,
  MobileExecutionManagementCommand,
  MobileExecutionReview,
  MobileExecutionSelection,
} from "../../../../shared/mobile-execution-management";

const emptySelection = (): MobileExecutionSelection => ({
  runtimeId: "",
  mode: "inspect",
  unattendedApproved: false,
});
const key = (value: MobileExecutionSelection): string =>
  JSON.stringify([
    value.runtimeId,
    value.projectId ?? null,
    value.mode,
    value.unattendedApproved,
  ]);

/** Local execution approval remains available independently of the cloud connection. */
export default function MobileExecutionPolicies({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const text = (name: string): string => t(`settings.mobile.execution.${name}`);
  const [status, setStatus] = useState<MobileExecutionApprovalStatus>();
  const [selection, setSelection] = useState(emptySelection);
  const [review, setReview] = useState<MobileExecutionReview>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revoke, setRevoke] = useState<string>();
  const [time, setTime] = useState(Date.now());
  const mounted = useRef(true),
    generation = useRef(0),
    locked = useRef(false),
    selectionVersion = useRef(0);
  function change(next: MobileExecutionSelection): void {
    selectionVersion.current++;
    setSelection(next);
    setReview(undefined);
    setConfirmed(false);
  }
  async function run(command: MobileExecutionManagementCommand): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    const version = generation.current,
      selectedVersion = selectionVersion.current;
    try {
      const result = await window.agentsOneAPI.manageMobileExecutionPolicies(
        profile,
        command,
      );
      if (!mounted.current || generation.current !== version) return;
      setStatus(result.status);
      setError("");
      if (result.review && selectionVersion.current === selectedVersion) {
        setReview(result.review);
        setConfirmed(false);
      }
      if (command.action === "approve" || command.action === "revoke") {
        setReview(undefined);
        setConfirmed(false);
        setRevoke(undefined);
      }
    } catch (cause) {
      if (!mounted.current || generation.current !== version) return;
      const code =
        String((cause as Error)?.message).match(
          /(invalid_input|profile_inactive|restore_write_locked|revision_conflict|resource_not_found|requires_owner_action|unverified_policy|mobile_execution_unavailable)/,
        )?.[1] || "mobile_execution_unavailable";
      setError(text(`errors.${code}`));
      setReview(undefined);
      setConfirmed(false);
    } finally {
      if (version === generation.current) {
        locked.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    mounted.current = true;
    const version = ++generation.current;
    locked.current = false;
    selectionVersion.current++;
    setStatus(undefined);
    setSelection(emptySelection());
    setReview(undefined);
    setConfirmed(false);
    setError("");
    setRevoke(undefined);
    setBusy(false);
    void latest.current({ action: "status" });
    let ticks = 0;
    const timer = setInterval(() => {
      setTime(Date.now());
      if (++ticks % 5 === 0) void latest.current({ action: "status" });
    }, 1000);
    return () => {
      mounted.current = false;
      generation.current = version + 1;
      clearInterval(timer);
    };
  }, [profile]);
  useEffect(() => {
    if (!status) return;
    if (
      (selection.runtimeId &&
        !status.runtimes.some((row) => row.id === selection.runtimeId)) ||
      (selection.projectId &&
        !status.projects.some((row) => row.id === selection.projectId))
    )
      change(emptySelection());
  }, [status, selection.runtimeId, selection.projectId]);
  const validSelection = Boolean(
    selection.runtimeId &&
    status?.runtimes.some(
      (row) => row.id === selection.runtimeId && row.available,
    ) &&
    (selection.mode !== "project_write" || selection.projectId),
  );
  const ready =
    validSelection &&
    review?.verified &&
    key(review.selection) === key(selection) &&
    (review.expiresAt ?? 0) > time;
  const alreadyApproved = status?.policies.some(
    (row) => row.verified && key(row) === key(selection),
  );
  const runtimeName = (id: string): string =>
    status?.runtimes.find((row) => row.id === id)?.name ||
    text("missingRuntime");
  const projectName = (id?: string): string =>
    id
      ? status?.projects.find((row) => row.id === id)?.name ||
        text("missingProject")
      : text("noProject");
  return (
    <section
      className="settings-subsection"
      style={{ display: "grid", gap: 12 }}
      aria-label={text("title")}
    >
      <h4 style={{ margin: 0 }}>{text("title")}</h4>
      <p className="settings-field-hint">{text("description")}</p>
      {error && (
        <div role="alert" className="settings-pane-flash">
          {error}
        </div>
      )}
      <fieldset
        disabled={busy}
        style={{ border: 0, padding: 0, display: "grid", gap: 12 }}
      >
        <legend>{text("selection")}</legend>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,200px),1fr))",
            gap: 12,
          }}
        >
          <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <label htmlFor="mobile-policy-runtime">{text("runtime")}</label>
            <select
              id="mobile-policy-runtime"
              className="input"
              value={selection.runtimeId}
              onChange={(event) =>
                change({ ...selection, runtimeId: event.target.value })
              }
            >
              <option value="">{text("chooseRuntime")}</option>
              {status?.runtimes.map((row) => (
                <option key={row.id} value={row.id} disabled={!row.available}>
                  {row.name}
                  {row.available ? "" : ` · ${text("unavailable")}`}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <label htmlFor="mobile-policy-project">{text("project")}</label>
            <select
              id="mobile-policy-project"
              className="input"
              value={selection.projectId ?? ""}
              onChange={(event) => {
                const { projectId: previous, ...rest } = selection;
                void previous;
                change({
                  ...rest,
                  ...(event.target.value
                    ? { projectId: event.target.value }
                    : {}),
                });
              }}
            >
              <option value="">{text("noProject")}</option>
              {status?.projects.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <label htmlFor="mobile-policy-mode">{text("mode")}</label>
            <select
              id="mobile-policy-mode"
              className="input"
              value={selection.mode}
              onChange={(event) =>
                change({
                  ...selection,
                  mode: event.target.value as MobileExecutionSelection["mode"],
                })
              }
            >
              <option value="inspect">{text("inspect")}</option>
              <option value="project_write">{text("project_write")}</option>
            </select>
          </div>
        </div>
        <label>
          <input
            type="checkbox"
            checked={selection.unattendedApproved}
            onChange={(event) =>
              change({ ...selection, unattendedApproved: event.target.checked })
            }
          />{" "}
          {text("unattended")}
        </label>
        <p className="settings-field-hint">{text("unattendedHint")}</p>
        <button
          className="btn"
          disabled={!validSelection}
          onClick={() => void run({ action: "review", selection })}
        >
          {text("review")}
        </button>
        {review && (
          <div role="status">
            <strong>
              {text(
                ready ? "verified" : review.verified ? "expired" : "unverified",
              )}
            </strong>
            {review.restrictionReason && (
              <p className="settings-field-hint">
                {text(`errors.${review.restrictionReason}`)}
              </p>
            )}
            {ready && (
              <p className="settings-field-hint">
                {text("reviewExpiry")}:{" "}
                {new Date(review.expiresAt!).toLocaleString()}
              </p>
            )}
          </div>
        )}
        {alreadyApproved && (
          <p className="settings-field-hint">{text("alreadyApproved")}</p>
        )}
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!ready || alreadyApproved}
            onChange={(event) => setConfirmed(event.target.checked)}
          />{" "}
          {text("confirmApproval")}
        </label>
        <button
          className="btn btn-primary"
          disabled={!ready || !confirmed || alreadyApproved || !status}
          onClick={() =>
            void run({
              action: "approve",
              selection,
              expectedRevision: status!.revision,
            })
          }
        >
          {text("approve")}
        </button>
      </fieldset>
      <button
        className="btn"
        disabled={busy}
        onClick={() => void run({ action: "status" })}
      >
        {text("refresh")}
      </button>
      <h4>{text("approved")}</h4>
      {status && !status.policies.length && (
        <p className="settings-field-hint">{text("noPolicies")}</p>
      )}
      {status?.policies.map((row) => (
        <div key={row.id} className="settings-subsection">
          <strong>{runtimeName(row.runtimeId)}</strong>
          <p>
            {projectName(row.projectId)} · {text(row.mode)}
          </p>
          <p className="settings-field-hint">
            {text(row.verified ? "active" : "inactive")}
            {row.unattendedApproved ? ` · ${text("unattended")}` : ""}
          </p>
          <button
            className="btn"
            disabled={busy}
            onClick={() => setRevoke(row.id)}
          >
            {text("revoke")}
          </button>
        </div>
      ))}
      {revoke && (
        <div role="alertdialog" aria-label={text("revoke")}>
          <p>{text("revokeConfirm")}</p>
          <button
            className="btn btn-danger"
            disabled={busy || !status}
            onClick={() =>
              void run({
                action: "revoke",
                id: revoke,
                expectedRevision: status!.revision,
              })
            }
          >
            {text("confirmRevoke")}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => setRevoke(undefined)}
          >
            {text("cancel")}
          </button>
        </div>
      )}
    </section>
  );
}
