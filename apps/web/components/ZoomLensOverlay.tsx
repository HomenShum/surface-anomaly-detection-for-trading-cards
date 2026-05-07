"use client";

import { useEffect, useState } from "react";

export type ZoomRegion =
  | "top_left_corner"
  | "top_right_corner"
  | "bottom_left_corner"
  | "bottom_right_corner"
  | "left_edge"
  | "right_edge"
  | "top_edge"
  | "bottom_edge"
  | "center";

export type ZoomLensTarget = {
  /** Normalized bbox in percent: [x1, y1, x2, y2], 0..100 */
  bboxNorm: [number, number, number, number];
  region: ZoomRegion;
  label: string;
  /** Optional findings detected in this region (already normalized 0..100) */
  findings?: { type: string; bbox: [number, number, number, number]; severity?: string }[];
};

type Props = {
  imageDataUrl?: string;
  target: ZoomLensTarget | null;
  /** ms total. Phase split: 30% pulse, 50% lens, 20% settle */
  durationMs?: number;
};

/**
 * CSS-driven zoom-lens overlay.
 * Phases:
 *   1. pulse  — glow box on bboxNorm
 *   2. lens   — magnified crop tile slides out to side, scanline runs across
 *   3. settle — finding marks pop in over the magnified crop
 * Then the parent flips `target` to the next region or null.
 */
export function ZoomLensOverlay({ imageDataUrl, target, durationMs = 1100 }: Props) {
  const [phase, setPhase] = useState<"idle" | "pulse" | "lens" | "settle" | "done">("idle");

  useEffect(() => {
    if (!target) {
      setPhase("idle");
      return;
    }
    setPhase("pulse");
    const t1 = window.setTimeout(() => setPhase("lens"), durationMs * 0.3);
    const t2 = window.setTimeout(() => setPhase("settle"), durationMs * 0.7);
    const t3 = window.setTimeout(() => setPhase("done"), durationMs);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [target, durationMs]);

  if (!target) return null;

  const [x1, y1, x2, y2] = target.bboxNorm;
  const left = `${x1}%`;
  const top = `${y1}%`;
  const width = `${Math.max(2, x2 - x1)}%`;
  const height = `${Math.max(2, y2 - y1)}%`;

  // Lens tile docks on the side of the canvas opposite from the target's center.
  const cx = (x1 + x2) / 2;
  const dockSide: "left" | "right" = cx > 50 ? "left" : "right";
  // Background-position math for the magnified crop preview.
  // CSS `background-size: <scale*100>%` + `background-position: -<offsetPx> -<offsetPy>` simulates a crop+zoom.
  const cropW = Math.max(8, x2 - x1);
  const cropH = Math.max(8, y2 - y1);
  const scale = Math.max(2.6, Math.min(6, 60 / cropW));
  const bgSize = `${scale * 100}% ${scale * 100}%`;
  // Position the chosen rect to fill the lens tile.
  const cx_n = (x1 + cropW / 2) / 100;
  const cy_n = (y1 + cropH / 2) / 100;
  const bgPos = `${cx_n * 100}% ${cy_n * 100}%`;

  return (
    <div className="zoom-lens-root" data-region={target.region} data-phase={phase} aria-hidden="true">
      {/* dim the rest of the canvas */}
      <div className={`zoom-lens-dim ${phase !== "idle" ? "is-active" : ""}`} />

      {/* glow box on the target bbox */}
      <div
        className={`zoom-lens-bbox phase-${phase}`}
        style={{ left, top, width, height }}
      >
        <span className="zoom-lens-bbox-label">{target.label}</span>
        <span className="zoom-lens-corners">
          <i /><i /><i /><i />
        </span>
      </div>

      {/* connector line from bbox to dock tile */}
      <svg className={`zoom-lens-connector phase-${phase}`} preserveAspectRatio="none">
        <line
          x1={`${cx}%`}
          y1={`${(y1 + y2) / 2}%`}
          x2={dockSide === "right" ? "94%" : "6%"}
          y2="50%"
        />
      </svg>

      {/* lens tile — magnified crop */}
      <div
        className={`zoom-lens-tile dock-${dockSide} phase-${phase}`}
        style={
          imageDataUrl
            ? {
                backgroundImage: `url(${imageDataUrl})`,
                backgroundSize: bgSize,
                backgroundPosition: bgPos,
              }
            : undefined
        }
      >
        <span className="zoom-lens-tile-tag">{regionLabel(target.region)}</span>
        <span className="zoom-lens-scanline" />

        {/* findings inside the magnified crop */}
        {phase === "settle" || phase === "done"
          ? target.findings?.map((f, i) => {
              const [fx1, fy1, fx2, fy2] = f.bbox;
              // Remap finding bbox (image-space %) into the lens tile's visible window.
              const localLeft = ((fx1 - x1) / Math.max(0.001, cropW)) * 100;
              const localTop = ((fy1 - y1) / Math.max(0.001, cropH)) * 100;
              const localW = ((fx2 - fx1) / Math.max(0.001, cropW)) * 100;
              const localH = ((fy2 - fy1) / Math.max(0.001, cropH)) * 100;
              if (
                localLeft < -8 ||
                localTop < -8 ||
                localLeft > 108 ||
                localTop > 108
              )
                return null;
              return (
                <span
                  className={`zoom-lens-finding severity-${f.severity ?? "minor"}`}
                  key={`${target.region}-finding-${i}`}
                  style={{
                    left: `${Math.max(0, localLeft)}%`,
                    top: `${Math.max(0, localTop)}%`,
                    width: `${Math.min(100, localW)}%`,
                    height: `${Math.min(100, localH)}%`,
                  }}
                >
                  <em>{f.type.replaceAll("_", " ")}</em>
                </span>
              );
            })
          : null}
      </div>
    </div>
  );
}

function regionLabel(region: ZoomRegion): string {
  switch (region) {
    case "top_left_corner":
      return "Top-left corner";
    case "top_right_corner":
      return "Top-right corner";
    case "bottom_left_corner":
      return "Bottom-left corner";
    case "bottom_right_corner":
      return "Bottom-right corner";
    case "left_edge":
      return "Left edge";
    case "right_edge":
      return "Right edge";
    case "top_edge":
      return "Top edge";
    case "bottom_edge":
      return "Bottom edge";
    default:
      return "Surface";
  }
}

/** Standard 9% corner tile + edge ribbon bboxes in image-space percent. */
export const REGION_BBOXES: Record<ZoomRegion, [number, number, number, number]> = {
  top_left_corner: [0, 0, 18, 14],
  top_right_corner: [82, 0, 100, 14],
  bottom_left_corner: [0, 86, 18, 100],
  bottom_right_corner: [82, 86, 100, 100],
  top_edge: [12, 0, 88, 8],
  bottom_edge: [12, 92, 88, 100],
  left_edge: [0, 14, 8, 86],
  right_edge: [92, 14, 100, 86],
  center: [22, 28, 78, 72],
};

/** Sort findings into the region they fall under (corner > edge > center priority). */
export function regionForFinding(bbox: [number, number, number, number]): ZoomRegion {
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;
  if (cx < 18 && cy < 14) return "top_left_corner";
  if (cx > 82 && cy < 14) return "top_right_corner";
  if (cx < 18 && cy > 86) return "bottom_left_corner";
  if (cx > 82 && cy > 86) return "bottom_right_corner";
  if (cy < 8) return "top_edge";
  if (cy > 92) return "bottom_edge";
  if (cx < 8) return "left_edge";
  if (cx > 92) return "right_edge";
  return "center";
}
