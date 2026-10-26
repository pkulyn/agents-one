import { useEffect, useRef, useState } from "react";
import { Smartphone, RefreshCw, Link } from "lucide-react";
import { useI18n } from "../useI18n";
import MobileWriteRecovery from "./MobileWriteRecovery";
import type {
  MobileConnectionCommand,
  MobileConnectionInvitation,
  MobileConnectionStatus,
} from "../../../../shared/mobile-connection";

export default function MobileConnectionPane({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const text = (key: string): string => t(`settings.mobile.${key}`);
  const [status, setStatus] = useState<MobileConnectionStatus>({
    configured: false,
  });
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invitation, setInvitation] = useState<MobileConnectionInvitation>();
  const [copied, setCopied] = useState(false);
  const [time, setTime] = useState(Date.now());
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [revoke, setRevoke] = useState<{ id: string; name: string }>();
  const [showRecovery, setShowRecovery] = useState(false);
  const mounted = useRef(true),
    lock = useRef(false),
    refreshing = useRef(false),
    requestSequence = useRef(0),
    generation = useRef(0);
  async function run(
    command: MobileConnectionCommand,
    background = false,
  ): Promise<void> {
    if (lock.current || (background && refreshing.current)) return;
    if (background) refreshing.current = true;
    else {
      lock.current = true;
      setBusy(true);
    }
    const version = generation.current;
    const sequence = ++requestSequence.current;
    try {
      const result = await window.agentsOneAPI.manageMobileConnection(
        profile,
        command,
      );
      if (
        !mounted.current ||
        version !== generation.current ||
        sequence !== requestSequence.current
      )
        return;
      setStatus(result.status);
      setError(
        result.status.connectionError
          ? text(`errors.${result.status.connectionError}`)
          : "",
      );
      if (result.status.connectionError) setInvitation(undefined);
      if (command.action === "save") setToken("");
      if (result.status.endpoint) setEndpoint(result.status.endpoint);
      if (result.invitation) {
        setInvitation(result.invitation);
        setCopied(false);
      }
      if (command.action === "enabled" && !command.enabled)
        setInvitation(undefined);
      if (command.action === "approve" || command.action === "reject")
        setApproved((old) => ({ ...old, [command.id]: false }));
      if (command.action === "revoke") setRevoke(undefined);
    } catch (cause) {
      if (
        mounted.current &&
        version === generation.current &&
        sequence === requestSequence.current
      ) {
        const code =
          String((cause as Error)?.message).match(
            /(invalid_input|scope_denied|secure_storage_unavailable|protocol_incompatible|connection_binding_conflict|invitation_expired|service_unavailable)/,
          )?.[1] || "generic";
        setError(text(`errors.${code}`));
      }
    } finally {
      if (version === generation.current) {
        if (background) refreshing.current = false;
        else {
          lock.current = false;
          if (mounted.current) setBusy(false);
        }
      }
    }
  }
  const runLatest = useRef(run);
  useEffect(() => {
    runLatest.current = run;
  });
  useEffect(() => {
    mounted.current = true;
    const version = ++generation.current;
    lock.current = false;
    refreshing.current = false;
    setStatus({ configured: false });
    setEndpoint("");
    setToken("");
    setInvitation(undefined);
    setApproved({});
    setRevoke(undefined);
    void runLatest.current({ action: "status" });
    const timer = setInterval(() => {
      setTime(Date.now());
      void runLatest.current({ action: "status" }, true);
    }, 5000);
    return () => {
      mounted.current = false;
      generation.current = version + 1;
      clearInterval(timer);
    };
  }, [profile]);
  const expired = invitation ? Date.parse(invitation.expiresAt) <= time : false;
  return (
    <div className="settings-modal-pane" style={{ display: "grid", gap: 20 }}>
      <div>
        <h3
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            margin: "0 0 8px",
          }}
        >
          <Smartphone size={20} />
          {text("title")}
        </h3>
        <p className="settings-field-hint">{text("description")}</p>
      </div>
      {error && (
        <div role="alert" className="settings-pane-flash">
          {error}
        </div>
      )}
      <details open={!status.configured}>
        <summary>{text("connectionSetup")}</summary>
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="mobile-endpoint">
            {text("endpoint")}
          </label>
          <input
            id="mobile-endpoint"
            className="input"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://connect.example.com"
            disabled={busy || status.configured}
          />
        </div>
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="mobile-token">
            {text("token")}
          </label>
          <input
            id="mobile-token"
            className="input"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={busy}
          />
          <p className="settings-field-hint">{text("setup")}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            disabled={busy || !endpoint.trim() || !token.trim()}
            onClick={() =>
              void run({ action: "save", endpoint, managementToken: token })
            }
          >
            <Link size={14} />
            {text("save")}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => void run({ action: "status" })}
          >
            <RefreshCw size={14} />
            {text("refresh")}
          </button>
          {busy && <span role="status">{text("loading")}</span>}
        </div>
      </details>
      {status.configured && status.owner && (
        <>
          <div className="settings-subsection">
            <strong>
              {text("owner")}: {status.owner.label}
            </strong>
            <p className="settings-field-hint">{text("ready")}</p>
            {!status.taskChannelReady && (
              <p className="settings-field-hint">{text("taskPending")}</p>
            )}
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!status.enabled}
                disabled={busy || !!error}
                onChange={(e) =>
                  void run({ action: "enabled", enabled: e.target.checked })
                }
              />
              {text("enabled")}
            </label>
            <p className="settings-field-hint">{text("enabledHint")}</p>
            <button
              className="btn btn-primary"
              disabled={busy || !status.enabled || !!error}
              onClick={() => void run({ action: "invite" })}
            >
              {text("invite")}
            </button>
          </div>
          {invitation && (
            <div className="settings-subsection">
              <strong>{text("invitation")}</strong>
              <p style={{ overflowWrap: "anywhere", userSelect: "text" }}>
                {expired ? text("expired") : invitation.invitation}
              </p>
              <p className="settings-field-hint">
                {text("expiry")}:{" "}
                {new Date(invitation.expiresAt).toLocaleString()}
              </p>
              <button
                className="btn"
                disabled={expired}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(invitation.invitation)
                    .then(() => setCopied(true))
                    .catch(() => setError(text("copyFailed")));
                }}
              >
                {text(copied ? "copied" : "copy")}
              </button>
              <p className="settings-field-hint">{text("instructions")}</p>
            </div>
          )}
          <section>
            <h4>{text("pending")}</h4>
            {!status.claims?.length && (
              <p className="settings-field-hint">{text("noPending")}</p>
            )}
            {status.claims?.map((claim) => {
              const selected = status.allowedScopes || [];
              return (
                <div
                  key={claim.id}
                  className="settings-subsection"
                  style={{ display: "grid", gap: 10 }}
                >
                  <strong>{claim.deviceLabel}</strong>
                  <div>
                    {text("phrase")}: <code>{claim.verificationPhrase}</code>
                  </div>
                  <span className="settings-field-hint">
                    {text("expiry")}:{" "}
                    {new Date(claim.expiresAt).toLocaleString()}
                  </span>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!approved[claim.id]}
                      disabled={busy}
                      onChange={(e) =>
                        setApproved({
                          ...approved,
                          [claim.id]: e.target.checked,
                        })
                      }
                    />{" "}
                    {text("match")}
                  </label>
                  <p className="settings-field-hint">
                    {text("pairedTasksHint")}
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn btn-primary"
                      disabled={
                        busy ||
                        !approved[claim.id] ||
                        !selected.length ||
                        !!error ||
                        Date.parse(claim.expiresAt) <= time
                      }
                      onClick={() =>
                        void run({
                          action: "approve",
                          id: claim.id,
                          verificationPhrase: claim.verificationPhrase,
                          scopes: selected,
                        })
                      }
                    >
                      {text("approve")}
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void run({ action: "reject", id: claim.id })
                      }
                    >
                      {text("reject")}
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
          <section>
            <h4>{text("devices")}</h4>
            {!status.devices?.length && (
              <p className="settings-field-hint">{text("noDevices")}</p>
            )}
            {status.devices?.map((device) => (
              <div key={device.deviceId} className="settings-subsection">
                <strong>{device.deviceLabel}</strong>
                <span style={{ marginLeft: 8 }}>
                  {text(
                    device.revoked
                      ? "revoked"
                      : Date.parse(device.expiresAt) <= time
                        ? "deviceExpired"
                        : "active",
                  )}
                </span>
                <p className="settings-field-hint">
                  {device.scopes
                    .map((scope) => text(`scopes.${scope.replace(":", "_")}`))
                    .join(" · ")}
                </p>
                <p className="settings-field-hint">
                  {text("expiry")}:{" "}
                  {new Date(device.expiresAt).toLocaleString()}
                  <br />
                  {text("lastSeen")}:{" "}
                  {new Date(device.lastSeenAt).toLocaleString()}
                </p>
                {!device.revoked && (
                  <button
                    className="btn"
                    disabled={busy || !!error}
                    onClick={() =>
                      setRevoke({
                        id: device.deviceId,
                        name: device.deviceLabel,
                      })
                    }
                  >
                    {text("revoke")}
                  </button>
                )}
              </div>
            ))}
          </section>
          {revoke && (
            <div
              role="alertdialog"
              aria-label={text("revoke")}
              className="settings-subsection"
            >
              <p>{t("settings.mobile.revokeConfirm", { name: revoke.name })}</p>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void run({ action: "revoke", id: revoke.id })}
              >
                {text("confirm")}
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
        </>
      )}
      <details onToggle={(event) => setShowRecovery(event.currentTarget.open)}>
        <summary>{text("advancedRecovery")}</summary>
        {showRecovery && <MobileWriteRecovery profile={profile} />}
      </details>
    </div>
  );
}
