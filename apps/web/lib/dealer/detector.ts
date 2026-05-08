/**
 * Dealer DING-detector hook.
 *
 * Backend resolution order on each call:
 *   1. **Roboflow Hosted Inference** — when `ROBOFLOW_API_KEY` AND
 *      `ROBOFLOW_MODEL_ID` are set. Pay-per-call, ~50ms p50, no infra.
 *      This is the production path on Render — see DEPLOY.md.
 *   2. **Self-hosted FastAPI** at `INFERENCE_API_URL` (default
 *      http://127.0.0.1:8000) — runs the YOLO weights via ultralytics
 *      under `services/inference-api/`. Used in dev and as a Roboflow
 *      fallback if you keep both deployed.
 *   3. **Curated fixture** annotations for a known-hash demo image, so
 *      the workbench has something to show even when both backends are
 *      unreachable (offline dev, deploy in progress, etc).
 *
 * Returns a normalized `DealerModelFinding[]` regardless of which
 * backend served — the caller doesn't have to care.
 *
 * Server-side only — runs in the Next.js Node runtime.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";
import type { DealerModelFinding } from "./types";

type FastApiFinding = {
  type?: string;
  kind?: string;
  ding_type?: string;
  bbox?: [number, number, number, number];
  severity?: string;
  confidence?: number;
  region?: string;
  source?: string;
};

type FastApiAnalyzeResponse = {
  report?: {
    findings?: FastApiFinding[];
    summary?: string;
    model_version?: string;
    condition_score?: number;
  };
  normalized?: {
    sha256?: string;
  };
};

function inferenceBase(): string {
  return (
    process.env.INFERENCE_API_URL ??
    process.env.NEXT_PUBLIC_INFERENCE_API_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
}

// ─── Roboflow Hosted Inference adapter ────────────────────────────────

type RoboflowPrediction = {
  // Roboflow returns x,y as the bbox CENTER in pixels — not the corner.
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class?: string;
  detection_id?: string;
};

type RoboflowResponse = {
  predictions?: RoboflowPrediction[];
  image?: { width?: number; height?: number };
  inference_id?: string;
  time?: number;
};

function roboflowConfigured(): { modelId: string; version: string; apiKey: string; baseUrl: string } | null {
  const apiKey = process.env.ROBOFLOW_API_KEY;
  // Accept "workspace/project/version" OR "workspace/project" (defaults
  // version to "1") OR "project" (uses public-workspace shorthand).
  const modelIdRaw = process.env.ROBOFLOW_MODEL_ID;
  if (!apiKey || !modelIdRaw) return null;
  const trimmed = modelIdRaw.replace(/^\/+|\/+$/g, "");
  const parts = trimmed.split("/");
  let modelId: string;
  let version: string;
  if (parts.length >= 3) {
    modelId = `${parts[0]}/${parts[1]}`;
    version = parts[2]!;
  } else if (parts.length === 2) {
    modelId = trimmed;
    version = "1";
  } else {
    modelId = trimmed;
    version = process.env.ROBOFLOW_MODEL_VERSION ?? "1";
  }
  const baseUrl = (process.env.ROBOFLOW_BASE_URL ?? "https://detect.roboflow.com").replace(/\/+$/, "");
  return { modelId, version, apiKey, baseUrl };
}

/**
 * Convert Roboflow's center-based pixel bboxes to our corner-based
 * percentage bboxes. We clamp to [0,100] so a noisy detection at the
 * image edge can't render off-canvas in the bbox overlay.
 */
function roboflowBboxToPct(
  pred: RoboflowPrediction,
  imageW: number | undefined,
  imageH: number | undefined,
): [number, number, number, number] {
  if (!imageW || !imageH) {
    // No dimensions — treat the values as already-normalized 0..100.
    return [pred.x, pred.y, pred.x + pred.width, pred.y + pred.height].map(clampPct) as [
      number,
      number,
      number,
      number,
    ];
  }
  const x1 = ((pred.x - pred.width / 2) / imageW) * 100;
  const y1 = ((pred.y - pred.height / 2) / imageH) * 100;
  const x2 = ((pred.x + pred.width / 2) / imageW) * 100;
  const y2 = ((pred.y + pred.height / 2) / imageH) * 100;
  return [clampPct(x1), clampPct(y1), clampPct(x2), clampPct(y2)];
}

/**
 * Map Roboflow class labels onto our DING type taxonomy. Roboflow class
 * names come from however the user labeled their dataset — we accept
 * common variants and fall through to `unknown_damage` when the label
 * isn't recognized.
 */
function roboflowClassToDingType(rawClass: string | undefined): string {
  const c = (rawClass ?? "").toLowerCase().replace(/\s+/g, "_");
  if (!c) return "unknown_damage";
  const direct = [
    "corner_wear",
    "edge_wear",
    "scratch",
    "crease",
    "dent",
    "surface_contamination",
    "print_line",
    "glare_uncertain",
    "no_material_ding",
    "unknown_damage",
  ];
  if (direct.includes(c)) return c;
  // Common synonyms.
  if (/(corner|cnr)/.test(c)) return "corner_wear";
  if (/edge|whitening|silver/.test(c)) return "edge_wear";
  if (/(scratch|scuff)/.test(c)) return "scratch";
  if (/(crease|crinkle|fold)/.test(c)) return "crease";
  if (/(dent|indent|impression)/.test(c)) return "dent";
  if (/(stain|smudge|fingerprint|residue)/.test(c)) return "surface_contamination";
  if (/print/.test(c)) return "print_line";
  if (/glare|reflection/.test(c)) return "glare_uncertain";
  return "unknown_damage";
}

function severityFromConfidence(confidence: number): DealerModelFinding["severity"] {
  if (confidence >= 0.85) return "major";
  if (confidence >= 0.65) return "moderate";
  if (confidence >= 0.4) return "minor";
  return "uncertain";
}

async function tryRoboflow(
  imageBase64: string,
  imageHash: string,
  dimensions: { width?: number; height?: number },
  timeoutMs: number,
): Promise<DetectorRunResult | null> {
  const cfg = roboflowConfigured();
  if (!cfg) return null;
  const url = `${cfg.baseUrl}/${cfg.modelId}/${cfg.version}?api_key=${encodeURIComponent(cfg.apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Roboflow accepts the raw base64 in the body with a form-encoded
    // Content-Type. No JSON envelope needed.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: imageBase64,
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Roboflow HTTP ${res.status}: ${errBody.slice(0, 200)}`);
    }
    const body = (await res.json()) as RoboflowResponse;
    const imageW = body.image?.width ?? dimensions.width;
    const imageH = body.image?.height ?? dimensions.height;
    const findings: DealerModelFinding[] = (body.predictions ?? []).map((pred) => ({
      type: roboflowClassToDingType(pred.class),
      bbox: roboflowBboxToPct(pred, imageW, imageH),
      severity: severityFromConfidence(pred.confidence),
      confidence: pred.confidence,
      modelVersion: `roboflow:${cfg.modelId}/${cfg.version}`,
      region: pred.class,
      imageHash,
      acceptedByReview: "pending",
      reviewerNote: pred.detection_id ? `Roboflow detection_id ${pred.detection_id}` : undefined,
    }));
    return {
      findings,
      summary:
        findings.length > 0
          ? `Roboflow ${cfg.modelId}/${cfg.version} returned ${findings.length} candidate finding(s).`
          : `Roboflow ${cfg.modelId}/${cfg.version} returned no findings above confidence threshold.`,
      modelVersion: `roboflow:${cfg.modelId}/${cfg.version}`,
      imageHash,
    };
  } finally {
    clearTimeout(timer);
  }
}

function clampSeverity(raw?: string): DealerModelFinding["severity"] {
  switch ((raw ?? "").toLowerCase()) {
    case "minor":
      return "minor";
    case "major":
    case "severe":
    case "high":
      return "major";
    case "moderate":
    case "medium":
      return "moderate";
    default:
      return "uncertain";
  }
}

function normalizeFindingType(finding: FastApiFinding): string {
  const raw = (finding.type ?? finding.kind ?? finding.ding_type ?? "").trim();
  const normalized = raw.replace(/\s+/g, "_").toLowerCase();
  return normalized || "unknown_damage";
}

async function imageSize(imageBase64: string): Promise<{ width?: number; height?: number }> {
  try {
    const metadata = await sharp(Buffer.from(imageBase64, "base64")).metadata();
    return { width: metadata.width, height: metadata.height };
  } catch {
    return {};
  }
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function normalizeBbox(
  bbox: [number, number, number, number],
  dimensions: { width?: number; height?: number },
): [number, number, number, number] {
  const max = Math.max(...bbox.map((value) => Math.abs(value)));
  if (max <= 100 || !dimensions.width || !dimensions.height) {
    return bbox.map(clampPct) as [number, number, number, number];
  }
  const [x1, y1, x2, y2] = bbox;
  return [
    clampPct((x1 / dimensions.width) * 100),
    clampPct((y1 / dimensions.height) * 100),
    clampPct((x2 / dimensions.width) * 100),
    clampPct((y2 / dimensions.height) * 100),
  ];
}

export type DetectorRunResult = {
  findings: DealerModelFinding[];
  summary?: string;
  modelVersion: string;
  imageHash: string;
};

const TAUROS_REAL_DING_FIXTURE_HASH =
  "b4605124fb7104df361b025c1db830091684974c2047ec54abfbe3a149c43a6f";

function curatedOpenDingFixtureFindings(imageHash: string): DealerModelFinding[] {
  if (imageHash !== TAUROS_REAL_DING_FIXTURE_HASH) return [];
  return [
    {
      type: "edge_wear",
      bbox: [0, 0, 98, 9],
      severity: "moderate",
      confidence: 0.82,
      modelVersion: "human-curated-open-ding-fixture",
      region: "top_edge",
      imageHash,
      acceptedByReview: "pending",
      reviewerNote: "Open DING fixture label: visible whitening and border wear along the top edge.",
    },
    {
      type: "corner_wear",
      bbox: [0, 86, 10, 100],
      severity: "moderate",
      confidence: 0.76,
      modelVersion: "human-curated-open-ding-fixture",
      region: "bottom_left_corner",
      imageHash,
      acceptedByReview: "pending",
      reviewerNote: "Open DING fixture label: corner and lower-edge wear near the lower-left card boundary.",
    },
    {
      type: "edge_wear",
      bbox: [91, 10, 100, 88],
      severity: "minor",
      confidence: 0.69,
      modelVersion: "human-curated-open-ding-fixture",
      region: "right_edge",
      imageHash,
      acceptedByReview: "pending",
      reviewerNote: "Open DING fixture label: right-edge whitening visible on real card pixels.",
    },
  ];
}

const DEFAULT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.INFERENCE_API_TIMEOUT_MS ?? "8000");
  return Number.isFinite(raw) && raw > 0 ? raw : 8000;
})();

async function tryFastApi(
  imageBase64: string,
  imageHash: string,
  dimensions: { width?: number; height?: number },
  timeoutMs: number,
): Promise<DetectorRunResult> {
  const base = inferenceBase();
  const url = `${base}/scan/analyze`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: imageBase64,
        run_ocr: false,
        finish_hint: null,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`scan/analyze ${res.status}: ${body.slice(0, 400)}`);
    }
    const j = (await res.json()) as FastApiAnalyzeResponse;
    const modelVersion = j.report?.model_version ?? "ding-detector-v0";
    const findings: DealerModelFinding[] = (j.report?.findings ?? []).map((f) => {
      const type = normalizeFindingType(f);
      const bbox = normalizeBbox(
        (f.bbox ?? [0, 0, 0, 0]) as [number, number, number, number],
        dimensions,
      );
      return {
        type,
        bbox,
        severity: clampSeverity(f.severity),
        confidence: typeof f.confidence === "number" ? f.confidence : 0,
        modelVersion,
        region: f.region,
        imageHash,
        acceptedByReview: "pending",
        reviewerNote: f.source ? `Detector source: ${f.source}.` : undefined,
      };
    });
    return {
      findings,
      summary: j.report?.summary,
      modelVersion,
      imageHash,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runDealerDetector(imageBase64: string): Promise<DetectorRunResult> {
  const imageHash = createHash("sha256").update(imageBase64, "base64").digest("hex");
  const dimensions = await imageSize(imageBase64);
  const curatedFindings = curatedOpenDingFixtureFindings(imageHash);
  const errors: string[] = [];

  // ─── Backend 1: Roboflow (preferred when configured) ───────────────
  if (roboflowConfigured()) {
    try {
      const result = await tryRoboflow(imageBase64, imageHash, dimensions, DEFAULT_TIMEOUT_MS);
      if (result && result.findings.length > 0) {
        return result;
      }
      // Roboflow returned no findings — fall through to fixture overlay
      // but tag the response so the caller knows the model ran.
      if (result && curatedFindings.length === 0) {
        return result;
      }
      if (result) {
        errors.push("roboflow_returned_zero");
      }
    } catch (err) {
      errors.push(`roboflow:${(err as Error).message}`);
    }
  }

  // ─── Backend 2: Self-hosted FastAPI (fallback / dev) ───────────────
  // Only attempted when explicitly enabled via INFERENCE_API_URL or in
  // development. In production with Roboflow configured, we skip this.
  const fastApiEnabled =
    Boolean(process.env.INFERENCE_API_URL) ||
    process.env.NODE_ENV !== "production";
  if (fastApiEnabled) {
    try {
      const result = await tryFastApi(imageBase64, imageHash, dimensions, DEFAULT_TIMEOUT_MS);
      if (result.findings.length > 0) {
        return result;
      }
      // Fall through to curated fixture only if there's a fixture for
      // this hash; otherwise return the empty result honestly.
      if (curatedFindings.length === 0) {
        return result;
      }
    } catch (err) {
      errors.push(`fastapi:${(err as Error).message}`);
    }
  }

  // ─── Backend 3: Curated fixture overlay (offline / demo) ───────────
  if (curatedFindings.length > 0) {
    return {
      findings: curatedFindings,
      summary:
        errors.length > 0
          ? `Open DING fixture: using bundled human-reviewed Tauros annotations because no live detector responded (${errors.join("; ")}).`
          : "Open DING fixture: using bundled human-reviewed Tauros annotations.",
      modelVersion: "human-curated-open-ding-fixture",
      imageHash,
    };
  }

  // Nothing worked and no fixture matched — surface the failure cleanly.
  // The caller (attach-image route) catches this and persists the image
  // anyway so the workbench can still flag DINGs manually.
  throw new Error(
    `No DING detector backend responded. Configure ROBOFLOW_API_KEY+ROBOFLOW_MODEL_ID or INFERENCE_API_URL. Errors: ${errors.join("; ")}`,
  );
}
