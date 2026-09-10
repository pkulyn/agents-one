import { memo } from "react";
import { FolderSearch, ListChecks, PackageCheck, Workflow } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import welcomeMark from "../../assets/agents-one-welcome.svg";

interface Suggestion {
  label: string;
  text: string;
  Icon: typeof FolderSearch;
}

const SUGGESTIONS: Suggestion[] = [
  {
    label: "分析项目",
    text: "请分析当前项目的结构、关键模块和主要风险。",
    Icon: FolderSearch,
  },
  {
    label: "拆解任务",
    text: "请将这个需求拆解为可执行任务，并给出验收标准。",
    Icon: ListChecks,
  },
  {
    label: "协作规划",
    text: "请为这个项目制定多智能体协作计划，明确分工和交接产物。",
    Icon: Workflow,
  },
  {
    label: "验收产物",
    text: "请检查当前任务产物是否满足要求，并列出未完成项。",
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
        {SUGGESTIONS.map(({ label, text, Icon }) => (
          <button
            key={label}
            className="chat-suggestion"
            onClick={() => onSelectSuggestion(text)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
});
