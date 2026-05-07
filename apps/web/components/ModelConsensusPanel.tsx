"use client";

import { useMemo } from "react";
import {
  VisualInspectionAgentRuntime,
  type DataSensitivity,
  type InspectionReleaseMode,
} from "../lib/agent/multi-model-inspection";
import type { VaultItem } from "../lib/vault";

type Props = {
  item: VaultItem;
  dataSensitivity?: DataSensitivity;
  releaseMode?: InspectionReleaseMode;
};

export function ModelConsensusPanel({
  item,
  dataSensitivity = "user_private",
  releaseMode = "demo",
}: Props) {
  const run = useMemo(() => {
    const runtime = new VisualInspectionAgentRuntime();
    return runtime.inspect({
      scanSessionId: item.evidence.scanSessionId,
      releaseMode,
      dataSensitivity,
      inputImages: [
        {
          id: "front_normalized",
          role: "front_normalized",
          sha256:
            item.normalizedSha256 ??
            item.evidence.files.find((file) => file.role === "front_normalized")?.sha256 ??
            "missing",
          dataUrl: item.imageDataUrl,
        },
      ],
      mlDetections: item.detections.map((detection) => ({
        id: detection.id,
        type: detection.type,
        zone: detection.zone,
        confidence: detection.confidence,
        severity: detection.severity,
        bbox: detection.bbox,
        source: detection.source,
      })),
      qualityScores: {
        surfaceScore: item.surfaceScore,
        edgeScore: item.edgeScore,
        centeringScore: item.centeringScore,
      },
      reportIds: [`${item.id}-report`],
    });
  }, [dataSensitivity, item, releaseMode]);

  return (
    <div className="report-card model-consensus-panel">
      <div className="section-head">
        <div>
          <span className="page-kicker">Agentic inspection ensemble</span>
          <h2>Model consensus</h2>
        </div>
        <span className="meta-chip">{run.providerPolicy}</span>
      </div>
      <p className="muted">
        Local ML remains the source of final DING boxes. Frontier visual agents are routed by policy
        and can only contribute grounded candidates or human-review tasks.
      </p>

      <div className="consensus-stack">
        {run.reportPatch.modelConsensus.length === 0 ? (
          <div className="consensus-row">
            <strong>No final DING consensus</strong>
            <span>No model candidates exceeded the current threshold.</span>
          </div>
        ) : (
          run.reportPatch.modelConsensus.map((entry, index) => (
            <div className="consensus-row" key={`${entry.label}-${entry.region}-${index}`}>
              <div>
                <strong>{entry.label.replaceAll("_", " ")}</strong>
                <span>{entry.region.replaceAll("_", " ")}</span>
              </div>
              <div>
                <span>{Math.round(entry.confidence * 100)}%</span>
                <em>{entry.decision.replaceAll("_", " ")}</em>
              </div>
            </div>
          ))
        )}
      </div>

      <dl className="detail-list consensus-detail-list">
        <div>
          <dt>Primary route</dt>
          <dd>{run.primaryModel}</dd>
        </div>
        <div>
          <dt>Candidate count</dt>
          <dd>{run.annotationCandidates.length}</dd>
        </div>
        <div>
          <dt>Human review tasks</dt>
          <dd>{run.humanReviewTasks.length}</dd>
        </div>
        <div>
          <dt>Tool events</dt>
          <dd>{run.toolEvents.length}</dd>
        </div>
      </dl>

      {run.humanReviewTasks.length > 0 ? (
        <ul className="consensus-review-list">
          {run.humanReviewTasks.slice(0, 3).map((task) => (
            <li key={task.id}>
              <strong>{task.priority} review</strong>
              <span>{task.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
