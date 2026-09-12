import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  FileCode2,
  FileText,
  FlaskConical,
} from "lucide-react";
import type { TaskCollaborationExecution } from "../../../shared/task-collaboration";
import { useI18n } from "./useI18n";

const KIND_META = {
  file: { labelKey: "collaboration.kind.file", Icon: FileText },
  code_diff: { labelKey: "collaboration.kind.code_diff", Icon: FileCode2 },
  test_result: {
    labelKey: "collaboration.kind.test_result",
    Icon: FlaskConical,
  },
} as const;

export function TaskCollaborationArtifactPanel({
  execution,
  onIntervene,
  onReassignImplementation,
  onReassignAcceptance,
  acceptanceRuntimeOptions = [],
}: {
  execution?: TaskCollaborationExecution;
  onIntervene?: () => void;
  onReassignImplementation?: () => void;
  onReassignAcceptance?: (runtimeId: string) => void;
  acceptanceRuntimeOptions?: Array<{ id: string; name: string }>;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const artifacts = execution?.artifacts || [];
  const deliveries = artifacts.filter(
    (artifact) => artifact.kind !== "test_result",
  );
  const verification = artifacts.filter(
    (artifact) => artifact.kind === "test_result",
  );
  const acceptance = execution?.acceptance;
  const [acceptanceRuntimeId, setAcceptanceRuntimeId] = useState("");
  useEffect(() => {
    if (
      !acceptanceRuntimeOptions.some(
        (option) => option.id === acceptanceRuntimeId,
      )
    ) {
      setAcceptanceRuntimeId(acceptanceRuntimeOptions[0]?.id || "");
    }
  }, [acceptanceRuntimeId, acceptanceRuntimeOptions]);
  if (!artifacts.length && !acceptance) return null;
  const acceptanceLabel =
    acceptance?.status === "passed"
      ? t("collaboration.acceptance.passed")
      : acceptance?.status === "failed"
        ? t("collaboration.acceptance.failed")
        : t("collaboration.acceptance.manual_review");
  return (
    <details className="task-collaboration-artifact-panel">
      <summary>
        <span>
          <FileText size={15} /> {t("collaboration.artifactsTitle")}
        </span>
        <small>
          {deliveries.length
            ? t("collaboration.deliverySummary", {
                deliveries: deliveries.length,
                verification: verification.length,
              })
            : t("collaboration.noDeliveries")}
        </small>
        {acceptance ? (
          <b className={`task-collaboration-acceptance ${acceptance.status}`}>
            {acceptance.status === "passed" ? (
              <Check size={13} />
            ) : (
              <CircleAlert size={13} />
            )}
            {acceptanceLabel}
          </b>
        ) : null}
        <ChevronDown size={14} />
      </summary>
      <div className="task-collaboration-artifact-list">
        {artifacts.map((artifact, index) => {
          const { Icon, labelKey } = KIND_META[artifact.kind];
          return (
            <article key={artifact.id}>
              <Icon size={15} />
              <div>
                <strong>
                  {t("collaboration.artifact", {
                    number: index + 1,
                    kind: t(labelKey),
                  })}
                </strong>
                <span>
                  {artifact.role} · {artifact.label}
                </span>
                {artifact.path ? <code>{artifact.path}</code> : null}
                {artifact.sourceMachine ? (
                  <small>
                    {t("collaboration.source", {
                      source: artifact.sourceMachine,
                    })}
                  </small>
                ) : null}
                {artifact.sha256 ? (
                  <small>SHA-256：{artifact.sha256}</small>
                ) : null}
                {artifact.changeSummary ? (
                  <p>{artifact.changeSummary}</p>
                ) : null}
                {artifact.summary ? <p>{artifact.summary}</p> : null}
              </div>
            </article>
          );
        })}
      </div>
      {acceptance ? (
        <footer
          className={`task-collaboration-acceptance-detail ${acceptance.status}`}
        >
          <strong>{acceptanceLabel}</strong>
          <p>{acceptance.conclusion}</p>
          {acceptance.reviewedArtifactIds.length ? (
            <small>
              {t("collaboration.evidence", {
                ids: acceptance.reviewedArtifactIds
                  .map(
                    (id) =>
                      `#${artifacts.findIndex((item) => item.id === id) + 1}`,
                  )
                  .join(", "),
              })}
            </small>
          ) : null}
          {acceptance.status !== "passed" ? (
            <div className="task-collaboration-recovery-actions">
              <button type="button" onClick={onReassignImplementation}>
                {t("collaboration.reassignImplementation")}
              </button>
              {acceptanceRuntimeOptions.length ? (
                <label>
                  <span className="sr-only">
                    {t("collaboration.reassignAcceptanceAgent")}
                  </span>
                  <select
                    value={acceptanceRuntimeId}
                    onChange={(event) =>
                      setAcceptanceRuntimeId(event.target.value)
                    }
                  >
                    {acceptanceRuntimeOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      acceptanceRuntimeId &&
                      onReassignAcceptance?.(acceptanceRuntimeId)
                    }
                  >
                    {t("collaboration.reassignAcceptance")}
                  </button>
                </label>
              ) : null}
              <button type="button" onClick={onIntervene}>
                {t("collaboration.interveneAndContinue")}
              </button>
            </div>
          ) : null}
        </footer>
      ) : null}
    </details>
  );
}
