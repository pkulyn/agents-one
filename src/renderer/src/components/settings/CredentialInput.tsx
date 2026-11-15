import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../useI18n";

export const CREDENTIAL_MASK = "••••••••••••••••";

/** Saved secrets are read only after an explicit reveal, never as form drafts. */
export default function CredentialInput({
  value,
  onChange,
  configured,
  reveal,
  disabled,
  id,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  configured: boolean;
  reveal: () => Promise<string>;
  disabled?: boolean;
  id?: string;
  label?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const maskedSaved = configured && !value && !visible;
  async function toggle(): Promise<void> {
    setError("");
    if (visible) {
      generation.current++;
      setVisible(false);
      setSaved("");
      return;
    }
    if (value || !configured) {
      setVisible(true);
      return;
    }
    const request = ++generation.current;
    setLoading(true);
    try {
      const secret = await reveal();
      if (generation.current === request) {
        setSaved(secret);
        setVisible(true);
      }
    } catch {
      if (generation.current === request)
        setError(t("agents.configRevealFailed"));
    } finally {
      if (generation.current === request) setLoading(false);
    }
  }
  return (
    <>
      <div className="agent-one-api-key-row">
        <input
          id={id}
          aria-label={label}
          className="input"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          spellCheck={false}
          disabled={disabled || loading}
          value={
            value || (maskedSaved ? CREDENTIAL_MASK : visible ? saved : "")
          }
          onFocus={(event) => {
            if (maskedSaved) event.target.select();
          }}
          onChange={(event) => {
            const next = event.target.value.replaceAll(CREDENTIAL_MASK, "");
            generation.current++;
            setSaved("");
            onChange(next);
          }}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm agent-one-key-visibility"
          aria-label={t("agents.configToggleApiKeyVisibility")}
          aria-pressed={visible}
          disabled={disabled || loading}
          onClick={() => void toggle()}
        >
          {loading ? (
            <Loader2 size={14} className="settings-spin" />
          ) : visible ? (
            <EyeOff size={14} />
          ) : (
            <Eye size={14} />
          )}
        </button>
      </div>
      {error && (
        <span className="settings-field-hint" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
