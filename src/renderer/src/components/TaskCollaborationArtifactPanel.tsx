import { useEffect, useState } from "react";
import { Check, ChevronDown, CircleAlert, FileCode2, FileText, FlaskConical } from "lucide-react";
import type { TaskCollaborationExecution } from "../../../shared/task-collaboration";

const KIND_META = {
  file: { label: "文件", Icon: FileText },
  code_diff: { label: "代码变更", Icon: FileCode2 },
  test_result: { label: "测试结果", Icon: FlaskConical },
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
  const artifacts = execution?.artifacts || [];
  const deliveries = artifacts.filter((artifact) => artifact.kind !== "test_result");
  const verification = artifacts.filter((artifact) => artifact.kind === "test_result");
  const acceptance = execution?.acceptance;
  const [acceptanceRuntimeId, setAcceptanceRuntimeId] = useState("");
  useEffect(() => {
    if (!acceptanceRuntimeOptions.some((option) => option.id === acceptanceRuntimeId)) {
      setAcceptanceRuntimeId(acceptanceRuntimeOptions[0]?.id || "");
    }
  }, [acceptanceRuntimeId, acceptanceRuntimeOptions]);
  if (!artifacts.length && !acceptance) return null;
  const acceptanceLabel = acceptance?.status === "passed"
    ? "验收通过"
    : acceptance?.status === "failed"
      ? "验收不通过"
      : "需人工复核";
  return (
    <details className="task-collaboration-artifact-panel">
      <summary>
        <span><FileText size={15} /> 产物与验收</span>
        <small>{deliveries.length ? `${deliveries.length} 项交付 · ${verification.length} 项验证` : "尚无真实交付"}</small>
        {acceptance ? (
          <b className={`task-collaboration-acceptance ${acceptance.status}`}>
            {acceptance.status === "passed" ? <Check size={13} /> : <CircleAlert size={13} />}
            {acceptanceLabel}
          </b>
        ) : null}
        <ChevronDown size={14} />
      </summary>
      <div className="task-collaboration-artifact-list">
        {artifacts.map((artifact, index) => {
          const { Icon, label } = KIND_META[artifact.kind];
          return (
            <article key={artifact.id}>
              <Icon size={15} />
              <div>
                <strong>产物 #{index + 1} · {label}</strong>
                <span>{artifact.role} · {artifact.label}</span>
                {artifact.path ? <code>{artifact.path}</code> : null}
                {artifact.sourceMachine ? <small>来源：{artifact.sourceMachine}</small> : null}
                {artifact.sha256 ? <small>SHA-256：{artifact.sha256}</small> : null}
                {artifact.changeSummary ? <p>{artifact.changeSummary}</p> : null}
                {artifact.summary ? <p>{artifact.summary}</p> : null}
              </div>
            </article>
          );
        })}
      </div>
      {acceptance ? (
        <footer className={`task-collaboration-acceptance-detail ${acceptance.status}`}>
          <strong>{acceptanceLabel}</strong>
          <p>{acceptance.conclusion}</p>
          {acceptance.reviewedArtifactIds.length ? (
            <small>依据：{acceptance.reviewedArtifactIds.map((id) => `#${artifacts.findIndex((item) => item.id === id) + 1}`).join("、")}</small>
          ) : null}
          {acceptance.status !== "passed" ? (
            <div className="task-collaboration-recovery-actions">
              <button type="button" onClick={onReassignImplementation}>重派实施</button>
              {acceptanceRuntimeOptions.length ? (
                <label>
                  <span className="sr-only">改派验收智能体</span>
                  <select value={acceptanceRuntimeId} onChange={(event) => setAcceptanceRuntimeId(event.target.value)}>
                    {acceptanceRuntimeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                  <button type="button" onClick={() => acceptanceRuntimeId && onReassignAcceptance?.(acceptanceRuntimeId)}>改派验收</button>
                </label>
              ) : null}
              <button type="button" onClick={onIntervene}>介入并继续</button>
            </div>
          ) : null}
        </footer>
      ) : null}
    </details>
  );
}
