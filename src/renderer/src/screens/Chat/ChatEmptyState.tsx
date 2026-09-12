import { memo } from "react";
import { FolderSearch, ListChecks, PackageCheck, Workflow } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import welcomeMark from "../../assets/agents-one-welcome.svg";

interface Suggestion {
  labelKey: string;
  promptKey: string;
  Icon: typeof FolderSearch;
}

const SUGGESTIONS: Suggestion[] = [
  {
    labelKey: "chat.projectSuggestions.analyzeLabel",
    promptKey: "chat.projectSuggestions.analyzePrompt",
    Icon: FolderSearch,
  },
  {
    labelKey: "chat.projectSuggestions.planLabel",
    promptKey: "chat.projectSuggestions.planPrompt",
    Icon: ListChecks,
  },
  {
    labelKey: "chat.projectSuggestions.collaborateLabel",
    promptKey: "chat.projectSuggestions.collaboratePrompt",
    Icon: Workflow,
  },
  {
    labelKey: "chat.projectSuggestions.verifyLabel",
    promptKey: "chat.projectSuggestions.verifyPrompt",
    Icon: PackageCheck,
  },
];

interface ChatEmptyStateProps {
  onSelectSuggestion: (text: string) => void;
}

export const ChatEmptyState = memo(function ChatEmptyState({
  onSelectSuggestion,
}: ChatEmptyStateProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="chat-empty">
      <div className="chat-empty-icon">
        <img src={welcomeMark} alt="Agents One" />
      </div>
      <div className="chat-empty-text">{t("chat.emptyTitle")}</div>
      <div className="chat-empty-hint">{t("chat.emptyHint")}</div>
      <div className="chat-empty-suggestions">
        {SUGGESTIONS.map(({ labelKey, promptKey, Icon }) => (
          <button
            key={labelKey}
            className="chat-suggestion"
            onClick={() => onSelectSuggestion(t(promptKey))}
          >
            <Icon size={16} />
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
});
