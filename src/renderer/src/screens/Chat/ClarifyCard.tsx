import { memo, useState } from "react";
import { useI18n } from "../../components/useI18n";
import type { ClarifyMessage } from "./types";

/**
 * Sentinel answer for "skip — let Hermes decide". Mirrors the gateway's
 * autonomous-proceed convention: an empty answer tells the agent to choose a
 * reasonable default rather than block.
 */
const SKIP_ANSWER = "";

interface ClarifyCardProps {
  msg: ClarifyMessage;
  /** Mark the card resolved in parent state once the user answers/skips. */
  onResolved: (requestId: string, answer: string) => void;
}

/**
 * Inline card for a mid-turn `clarify.request`. Renders choice buttons when the
 * agent offered choices, otherwise an open-ended textarea, plus an auto-choose
 * toggle and a skip control. On answer it forwards to the main process via
 * `respondClarify` and flips the card to a resolved, read-only state.
 */
export const ClarifyCard = memo(function ClarifyCard({
  msg,
  onResolved,
}: ClarifyCardProps): React.JSX.Element {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const resolved = !!msg.resolved;

  const submit = async (answer: string): Promise<void> => {
    if (resolved || submitting) return;
    setSubmitting(true);
    try {
      await window.hermesAPI.respondClarify(msg.requestId, answer);
    } finally {
      onResolved(msg.requestId, answer);
    }
  };

  if (resolved) {
    return (
      <div className="chat-clarify chat-clarify--resolved">
        <div className="chat-clarify-question">{msg.question}</div>
        <div className="chat-clarify-answer">
          {msg.answer && msg.answer.trim()
            ? msg.answer
            : t("chat.clarify.skipped")}
        </div>
      </div>
    );
  }

  const hasChoices = msg.choices.length > 0;

  return (
    <div className="chat-clarify">
      <div className="chat-clarify-question">
        {msg.question || t("chat.clarify.defaultQuestion")}
      </div>

      {hasChoices ? (
        <div className="chat-clarify-choices">
          {msg.choices.map((choice, i) => (
            <button
              key={`${msg.requestId}-${i}`}
              className="chat-clarify-choice"
              disabled={submitting}
              onClick={() => void submit(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
      ) : (
        <div className="chat-clarify-open">
          <textarea
            className="chat-clarify-textarea"
            rows={3}
            value={text}
            placeholder={t("chat.clarify.placeholder")}
            disabled={submitting}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                void submit(text);
              }
            }}
          />
          <button
            className="chat-clarify-send"
            disabled={submitting || !text.trim()}
            onClick={() => void submit(text)}
          >
            {t("chat.clarify.send")}
          </button>
        </div>
      )}

      <button
        className="chat-clarify-skip"
        disabled={submitting}
        onClick={() => void submit(SKIP_ANSWER)}
      >
        {t("chat.clarify.skip")}
      </button>
    </div>
  );
});
