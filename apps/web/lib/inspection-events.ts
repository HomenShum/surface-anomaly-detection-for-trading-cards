import type { DingDetection } from "./vault";

export type InspectionTool =
  | "detect_card_boundary"
  | "normalize_card"
  | "crop_region"
  | "zoom_region"
  | "run_ding_detector"
  | "run_surface_anomaly"
  | "save_evidence";

export type InspectionVisualAnimation =
  | "card_outline"
  | "perspective_warp"
  | "crop_extract"
  | "zoom_lens"
  | "edge_sweep"
  | "surface_glare_scan"
  | "ding_box_appear"
  | "evidence_stamp";

export type InspectionEventStatus = "running" | "passed" | "warning" | "failed";

export type InspectionTarget = {
  imageId: string;
  bboxNorm?: [number, number, number, number];
  region?: string;
};

export type InspectionEvent = {
  id: string;
  type: "tool.started" | "tool.progress" | "tool.completed";
  tool: InspectionTool;
  label: string;
  detail: string;
  status: InspectionEventStatus;
  target?: InspectionTarget;
  visual: {
    animation: InspectionVisualAnimation;
    durationMs: number;
  };
  progress: number;
  createdAt: string;
  detections?: DingDetection[];
};

export const inspectionPlanByStepId: Record<
  string,
  Omit<InspectionEvent, "id" | "type" | "status" | "progress" | "createdAt" | "detections">
> = {
  "card-detected": {
    tool: "detect_card_boundary",
    label: "Locking onto card boundary",
    detail: "The inspection canvas is aligning to the uploaded card frame.",
    target: { imageId: "front_original", bboxNorm: [0.07, 0.06, 0.93, 0.95], region: "full_card" },
    visual: { animation: "card_outline", durationMs: 700 },
  },
  "perspective-normalized": {
    tool: "normalize_card",
    label: "Straightening perspective",
    detail: "The card is being transformed into the normalized model coordinate system.",
    target: { imageId: "front_original", bboxNorm: [0.07, 0.06, 0.93, 0.95], region: "full_card" },
    visual: { animation: "perspective_warp", durationMs: 900 },
  },
  "corner-regions": {
    tool: "crop_region",
    label: "Magnifying top-right corner",
    detail: "Corner crops are generated before DING classification.",
    target: { imageId: "front_normalized", bboxNorm: [0.74, 0.02, 0.98, 0.24], region: "top_right_corner" },
    visual: { animation: "crop_extract", durationMs: 900 },
  },
  "edge-regions": {
    tool: "zoom_region",
    label: "Sweeping the left edge",
    detail: "Edge strips are magnified so whitening does not disappear in the full-card view.",
    target: { imageId: "front_normalized", bboxNorm: [0.02, 0.18, 0.18, 0.82], region: "left_edge" },
    visual: { animation: "edge_sweep", durationMs: 1000 },
  },
  "surface-scan": {
    tool: "run_surface_anomaly",
    label: "Checking reflective surface risk",
    detail: "The center field is checked for glare and suspicious surface lines.",
    target: { imageId: "front_normalized", bboxNorm: [0.24, 0.20, 0.76, 0.62], region: "surface_center" },
    visual: { animation: "surface_glare_scan", durationMs: 1100 },
  },
  "ding-detection": {
    tool: "run_ding_detector",
    label: "Running DING detector on zoomed regions",
    detail: "The detector runs on normalized and region-magnified views.",
    target: { imageId: "front_normalized", bboxNorm: [0.74, 0.02, 0.98, 0.24], region: "top_right_corner" },
    visual: { animation: "zoom_lens", durationMs: 1200 },
  },
  "evidence-manifest": {
    tool: "save_evidence",
    label: "Stamping evidence manifest",
    detail: "The selected frame, normalized crop, model version, and hashes are bound to the report.",
    target: { imageId: "front_normalized", bboxNorm: [0.08, 0.84, 0.92, 0.97], region: "evidence_stamp" },
    visual: { animation: "evidence_stamp", durationMs: 700 },
  },
  "catalog-update": {
    tool: "save_evidence",
    label: "Saving reviewed card",
    detail: "The reviewed inspection result is being attached to the local vault queue.",
    target: { imageId: "front_normalized", bboxNorm: [0.08, 0.84, 0.92, 0.97], region: "catalog_record" },
    visual: { animation: "evidence_stamp", durationMs: 700 },
  },
};

export function createInspectionEvent(
  stepId: string,
  status: InspectionEventStatus,
  progress: number,
  detections?: DingDetection[],
): InspectionEvent | null {
  const planned = inspectionPlanByStepId[stepId];
  if (!planned) return null;
  const now = new Date().toISOString();
  return {
    ...planned,
    id: `${stepId}-${status}-${Date.now()}`,
    type: status === "running" ? "tool.started" : "tool.completed",
    status,
    progress,
    createdAt: now,
    detections,
  };
}
