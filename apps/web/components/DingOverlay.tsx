"use client";

import type { DingDetection } from "../lib/vault";

function dingLabel(detection: DingDetection) {
  const label = detection.type.replaceAll("_", " ");
  const confidence = `${Math.round(detection.confidence * 100)}%`;
  return `${label} ${confidence} - ${detection.severity}`;
}

export function DingOverlay({
  imageDataUrl,
  detections,
  alt = "Normalized card"
}: {
  imageDataUrl?: string;
  detections: DingDetection[];
  alt?: string;
}) {
  return (
    <div className="inspection-stage">
      {imageDataUrl ? <img src={imageDataUrl} alt={alt} /> : <div className="card-placeholder" />}
      {detections.map((detection) => {
        const [x1, y1, x2, y2] = detection.bbox;
        const label = dingLabel(detection);
        return (
          <button
            aria-label={label}
            className={`ding-box severity-${detection.severity}`}
            data-label-placement={y1 < 12 ? "below" : "above"}
            key={detection.id}
            style={{
              left: `${x1}%`,
              top: `${y1}%`,
              width: `${Math.max(4, x2 - x1)}%`,
              height: `${Math.max(4, y2 - y1)}%`
            }}
            title={label}
            type="button"
          >
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
