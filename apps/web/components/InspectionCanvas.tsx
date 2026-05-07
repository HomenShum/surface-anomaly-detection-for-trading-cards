"use client";

import type { InspectionEvent } from "../lib/inspection-events";
import type { DingDetection } from "../lib/vault";
import { DingOverlay } from "./DingOverlay";

function pct(value: number) {
  return `${Math.max(0, Math.min(1, value)) * 100}%`;
}

function cropImageStyle(bbox: [number, number, number, number]) {
  const [x1, y1, x2, y2] = bbox;
  const width = Math.max(0.04, x2 - x1);
  const height = Math.max(0.04, y2 - y1);
  return {
    left: `${(-x1 / width) * 100}%`,
    top: `${(-y1 / height) * 100}%`,
    width: `${(1 / width) * 100}%`,
    height: `${(1 / height) * 100}%`,
  };
}

export function InspectionCanvas({
  imageDataUrl,
  detections,
  activeEvent,
}: {
  imageDataUrl?: string;
  detections: DingDetection[];
  activeEvent?: InspectionEvent;
}) {
  const bbox = activeEvent?.target?.bboxNorm;
  const animation = activeEvent?.visual.animation ?? "card_outline";
  const duration = activeEvent?.visual.durationMs ?? 800;
  return (
    <div className={`visual-inspection-canvas animation-${animation}`} data-testid="inspection-canvas">
      <DingOverlay detections={detections} imageDataUrl={imageDataUrl} />
      {bbox ? (
        <div
          aria-label={activeEvent?.label}
          className={`inspection-tool-target status-${activeEvent?.status ?? "running"}`}
          data-animation={animation}
          data-testid="inspection-tool-target"
          data-tool={activeEvent?.tool}
          data-region={activeEvent?.target?.region}
          style={{
            left: pct(bbox[0]),
            top: pct(bbox[1]),
            width: pct(bbox[2] - bbox[0]),
            height: pct(bbox[3] - bbox[1]),
            animationDuration: `${duration}ms`,
          }}
        >
          <span>{activeEvent?.target?.region?.replaceAll("_", " ")}</span>
        </div>
      ) : null}

      {imageDataUrl && bbox ? (
        <aside className="inspection-crop-preview" data-testid="inspection-crop-preview">
          <div className="inspection-crop-preview-head">
            <span>{activeEvent?.tool.replaceAll("_", " ")}</span>
            <strong>{activeEvent?.status ?? "running"}</strong>
          </div>
          <div className="inspection-crop-preview-window">
            <img alt={`${activeEvent?.target?.region ?? "region"} crop preview`} src={imageDataUrl} style={cropImageStyle(bbox)} />
            <span className="inspection-crop-scanline" />
          </div>
          <p>{activeEvent?.label}</p>
        </aside>
      ) : null}
    </div>
  );
}
