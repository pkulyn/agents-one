import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Users } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import Office3D from "./office3d/Office3D";
import { profilesToOfficeAgents } from "./office3d/agents";
import type { OfficeAgent } from "./office3d/core/types";

interface OfficeProps {
  profile?: string;
  visible?: boolean;
}

/**
 * The Office tab. Renders a native, in-renderer 3D office (no external dev
 * server / webview) where each Hermes profile appears as an interactive agent.
 */
function Office({ visible }: OfficeProps): React.JSX.Element {
  const { t } = useI18n();
  const [agents, setAgents] = useState<OfficeAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Avoid refetching every time the tab regains visibility within a session;
  // only the first reveal and explicit refreshes hit IPC.
  const loadedOnce = useRef(false);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const profiles = await window.hermesAPI.listProfiles();
      setAgents(profilesToOfficeAgents(profiles));
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
      loadedOnce.current = true;
    }
  }, []);

  useEffect(() => {
    if (visible && !loadedOnce.current) {
      void loadAgents();
    }
  }, [visible, loadAgents]);

  // Initial load on mount (the tab lazy-mounts on first visit).
  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {t("office.title")}
          </span>
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            {t("office.subtitle")}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              opacity: 0.75,
            }}
          >
            <Users size={15} />
            {t("office.agentCount", { count: agents.length })}
          </span>
          <button
            type="button"
            onClick={() => void loadAgents()}
            disabled={loading}
            title={t("office.refresh")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border, rgba(0,0,0,0.12))",
              background: "transparent",
              cursor: loading ? "default" : "pointer",
              fontSize: 13,
            }}
          >
            <RefreshCw
              size={14}
              style={{
                animation: loading ? "spin 1s linear infinite" : undefined,
              }}
            />
            {t("office.refresh")}
          </button>
        </div>
      </header>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <Office3D agents={agents} onSelectAgent={setSelectedId} />

        {selectedAgent && (
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              padding: "10px 14px",
              borderRadius: 10,
              background: "var(--card, rgba(20,24,33,0.85))",
              color: "#fff",
              boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
              maxWidth: 260,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {selectedAgent.name}
            </div>
            {selectedAgent.subtitle && (
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                {selectedAgent.subtitle}
              </div>
            )}
          </div>
        )}

        {!loading && agents.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              opacity: 0.6,
              fontSize: 14,
            }}
          >
            {t("office.loadingAgents")}
          </div>
        )}
      </div>
    </div>
  );
}

export default Office;
