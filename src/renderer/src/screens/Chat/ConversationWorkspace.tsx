import type { ReactNode } from "react";

interface ConversationWorkspaceProps {
  children: ReactNode;
  composer: ReactNode;
  panel?: ReactNode;
  panelOpen: boolean;
}

/**
 * The single conversation shell used by Hermes and every Runtime adapter.
 * Keeping the composer inside the main column makes messages and input resize
 * together when the task panel occupies the right-hand column.
 */
export function ConversationWorkspace({
  children,
  composer,
  panel,
  panelOpen,
}: ConversationWorkspaceProps): React.JSX.Element {
  return (
    <div
      className={`conversation-workspace${
        panelOpen ? " conversation-workspace--panel-open" : ""
      }`}
    >
      <section className="conversation-main">
        {children}
        {composer}
      </section>
      {panelOpen ? panel : null}
    </div>
  );
}
