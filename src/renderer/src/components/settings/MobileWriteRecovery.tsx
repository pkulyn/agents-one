import { useEffect, useRef, useState } from "react";
import { useI18n } from "../useI18n";
import type {
  MobileWriteRecoveryCommand,
  MobileWriteRecoveryStatus,
} from "../../../../shared/mobile-write-recovery";

export default function MobileWriteRecovery({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const text = (key: string): string => t(`settings.mobile.recovery.${key}`);
  const [status, setStatus] = useState<MobileWriteRecoveryStatus>({
    items: [],
    capacityExceeded: false,
  });
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0),
    lock = useRef(false);
  async function run(command: MobileWriteRecoveryCommand): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const version = generation.current;
    try {
      const next = await window.agentsOneAPI.manageMobileWriteRecovery(
        profile,
        command,
      );
      if (version !== generation.current) return;
      setStatus(next);
      setSelected(undefined);
    } catch (cause) {
      if (version !== generation.current) return;
      const code =
        String((cause as Error)?.message).match(
          /(revision_conflict|profile_inactive|restore_write_locked|run_active|run_unavailable|scope_denied)/,
        )?.[1] || "requires_owner_action";
      setError(text(`errors.${code}`));
      setSelected(undefined);
    } finally {
      if (version === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const version = ++generation.current;
    lock.current = false;
    setBusy(false);
    setSelected(undefined);
    setStatus({ items: [], capacityExceeded: false });
    setError("");
    void latest.current({ action: "status" });
    return () => {
      generation.current = version + 1;
    };
  }, [profile]);
  return (
    <section style={{ display: "grid", gap: 12 }} aria-label={text("title")}>
      <h3 style={{ margin: 0 }}>{text("title")}</h3>
      <p className="settings-field-hint">{text("description")}</p>
      <button
        className="btn btn-secondary"
        disabled={busy}
        onClick={() => void run({ action: "status" })}
      >
        {text("refresh")}
      </button>
      {error && (
        <div role="alert" className="settings-pane-flash">
          {error}
        </div>
      )}
      {status.capacityExceeded && (
        <p role="alert">{text("capacityExceeded")}</p>
      )}
      {!status.items.length && !busy && (
        <p className="settings-field-hint">{text("empty")}</p>
      )}
      {status.items.map((row) => (
        <div
          key={row.id}
          className="settings-field"
          style={{
            display: "grid",
            gap: 8,
            minWidth: 0,
            overflowWrap: "anywhere",
          }}
        >
          <strong>{row.path}</strong>
          <span className="settings-field-hint">
            {row.runId ? `${text("run")}: ${row.runId}` : text("unknownRun")}
          </span>
          <p>{text(`states.${row.state}`)}</p>
          {row.restrictionReason && (
            <p className="settings-field-hint">
              {text(`errors.${row.restrictionReason}`)}
            </p>
          )}
          {row.reviewToken && row.state !== "blocked" && (
            <>
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected === row.id}
                  onChange={(event) =>
                    setSelected(event.target.checked ? row.id : undefined)
                  }
                />
                {text("acknowledge")}
              </label>
              <button
                className="btn btn-secondary"
                disabled={busy || selected !== row.id}
                onClick={() =>
                  void run({
                    action: "release",
                    id: row.id,
                    reviewToken: row.reviewToken!,
                    acknowledged: true,
                  })
                }
              >
                {text("release")}
              </button>
            </>
          )}
        </div>
      ))}
      <p className="settings-field-hint">{text("restartHint")}</p>
    </section>
  );
}
