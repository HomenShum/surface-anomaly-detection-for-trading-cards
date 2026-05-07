import { createHash } from "node:crypto";

/**
 * Server-side image operations for the inspection agent.
 *
 * Backed by `sharp`, dynamically imported so build does not fail on
 * platforms where the native binding is unavailable. Every function returns
 * either a real result or a structured `{ ok: false, error }` object — never
 * throws into the agent loop.
 *
 * Bounding (per agentic-reliability checklist):
 *   • CROP_CACHE caps at MAX_CROPS entries (LRU eviction).
 *   • CROP_CACHE entries expire after CROP_TTL_MS even if not evicted.
 *   • Each crop is bounded to MAX_CROP_BYTES so a malicious bbox cannot OOM.
 */

const MAX_CROPS = 64;
const CROP_TTL_MS = 10 * 60 * 1000;
const MAX_CROP_BYTES = 4 * 1024 * 1024; // 4 MB
const MAX_DIM = 2048;

type CropEntry = {
  cropId: string;
  cropDataUrl: string;
  cropBuffer: Buffer;
  width: number;
  height: number;
  sourceSha256: string;
  bboxPct: [number, number, number, number];
  region: string;
  ts: number;
};

const CROP_CACHE = new Map<string, CropEntry>();

function evictIfFull() {
  while (CROP_CACHE.size > MAX_CROPS) {
    const oldestKey = CROP_CACHE.keys().next().value;
    if (oldestKey) CROP_CACHE.delete(oldestKey);
    else break;
  }
  // Also evict expired
  const now = Date.now();
  for (const [key, entry] of CROP_CACHE.entries()) {
    if (now - entry.ts > CROP_TTL_MS) CROP_CACHE.delete(key);
  }
}

function bufferFromDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > MAX_CROP_BYTES * 4) return null;
  return { buffer, mime: match[1] };
}

function dataUrlFrom(buffer: Buffer, mime = "image/png"): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function loadSharp() {
  try {
    const mod = await import("sharp");
    return mod.default ?? mod;
  } catch (error) {
    return null;
  }
}

export type CropResult =
  | {
      ok: true;
      cropId: string;
      cropDataUrl: string;
      width: number;
      height: number;
      sourceSha256: string;
      bboxPx: [number, number, number, number];
    }
  | { ok: false; error: string };

/**
 * Crop the image at a bbox expressed in percent (0..100). `paddingPct` adds
 * a margin around the bbox before cropping, useful for context.
 */
export async function cropImage(input: {
  imageDataUrl: string;
  bboxPct: [number, number, number, number];
  paddingPct?: number;
  region?: string;
}): Promise<CropResult> {
  const sharp = await loadSharp();
  if (!sharp) return { ok: false, error: "sharp unavailable on this runtime — image ops disabled." };
  const decoded = bufferFromDataUrl(input.imageDataUrl);
  if (!decoded) return { ok: false, error: "Image data URL malformed or missing." };
  if (decoded.buffer.length > MAX_CROP_BYTES * 4) return { ok: false, error: "Source image exceeds size cap." };

  let metadata: { width?: number; height?: number };
  try {
    metadata = await sharp(decoded.buffer).metadata();
  } catch (error) {
    return { ok: false, error: `sharp could not read image: ${error instanceof Error ? error.message : "unknown"}.` };
  }
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (sourceWidth === 0 || sourceHeight === 0) return { ok: false, error: "Image has no dimensions." };
  if (sourceWidth > MAX_DIM || sourceHeight > MAX_DIM) {
    return { ok: false, error: `Image too large (${sourceWidth}x${sourceHeight}); cap is ${MAX_DIM}px.` };
  }

  const padding = Math.max(0, Math.min(20, input.paddingPct ?? 4));
  const [x1, y1, x2, y2] = input.bboxPct;
  const x1Pad = Math.max(0, x1 - padding);
  const y1Pad = Math.max(0, y1 - padding);
  const x2Pad = Math.min(100, x2 + padding);
  const y2Pad = Math.min(100, y2 + padding);

  const left = Math.round((x1Pad / 100) * sourceWidth);
  const top = Math.round((y1Pad / 100) * sourceHeight);
  const right = Math.round((x2Pad / 100) * sourceWidth);
  const bottom = Math.round((y2Pad / 100) * sourceHeight);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  let cropBuffer: Buffer;
  try {
    cropBuffer = await sharp(decoded.buffer).extract({ left, top, width, height }).png().toBuffer();
  } catch (error) {
    return { ok: false, error: `Crop failed: ${error instanceof Error ? error.message : "unknown"}.` };
  }
  if (cropBuffer.length > MAX_CROP_BYTES) return { ok: false, error: "Crop exceeds output size cap." };

  const sourceSha = sha256(decoded.buffer);
  const cropId = `crop-${sha256(cropBuffer).slice(0, 16)}`;
  const cropDataUrl = dataUrlFrom(cropBuffer, "image/png");

  evictIfFull();
  CROP_CACHE.set(cropId, {
    cropId,
    cropDataUrl,
    cropBuffer,
    width,
    height,
    sourceSha256: sourceSha,
    bboxPct: input.bboxPct,
    region: input.region ?? "custom",
    ts: Date.now(),
  });
  evictIfFull();

  return {
    ok: true,
    cropId,
    cropDataUrl,
    width,
    height,
    sourceSha256: sourceSha,
    bboxPx: [left, top, right, bottom],
  };
}

export function getCachedCrop(cropId: string): CropEntry | null {
  evictIfFull();
  return CROP_CACHE.get(cropId) ?? null;
}

export type GlareCheckResult =
  | {
      ok: true;
      cropId: string;
      glareScore: number;
      brightFraction: number;
      meanLuminance: number;
      maxLuminance: number;
      finishHint: "high_glare" | "moderate_glare" | "low_glare";
    }
  | { ok: false; error: string };

/**
 * Compute a glare score from a cached crop.
 * Definition: fraction of pixels in the top luminance percentile, weighted
 * by their saturation. Range 0..1. >0.35 ≈ visible specular highlight.
 *
 * Pure pixel math via sharp's `raw()` output. No inference call.
 */
export async function glareCheckOnCrop(cropId: string): Promise<GlareCheckResult> {
  const sharp = await loadSharp();
  if (!sharp) return { ok: false, error: "sharp unavailable on this runtime — glare check disabled." };
  const entry = getCachedCrop(cropId);
  if (!entry) return { ok: false, error: `Crop ${cropId} not found in cache (may have expired).` };

  let raw: { data: Buffer; info: { width: number; height: number; channels: number } };
  try {
    raw = await sharp(entry.cropBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    return { ok: false, error: `sharp raw extract failed: ${error instanceof Error ? error.message : "unknown"}.` };
  }
  const { data, info } = raw;
  const total = info.width * info.height;
  if (total === 0) return { ok: false, error: "Crop has no pixels." };

  let sumLum = 0;
  let maxLum = 0;
  let brightCount = 0;
  let weightedHighlight = 0;
  const channels = info.channels;
  for (let i = 0; i + channels - 1 < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1] ?? r;
    const b = data[i + 2] ?? r;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sumLum += lum;
    if (lum > maxLum) maxLum = lum;
    if (lum > 230) {
      brightCount += 1;
      const minC = Math.min(r, g, b);
      const maxC = Math.max(r, g, b);
      const desat = maxC === 0 ? 0 : (maxC - minC) / maxC;
      // Specular highlights are bright AND desaturated.
      weightedHighlight += 1 - desat;
    }
  }
  const meanLuminance = sumLum / total;
  const brightFraction = brightCount / total;
  const glareScore = Math.min(1, weightedHighlight / total + brightFraction * 0.5);
  const finishHint =
    glareScore > 0.35 ? "high_glare" : glareScore > 0.15 ? "moderate_glare" : "low_glare";

  return {
    ok: true,
    cropId,
    glareScore,
    brightFraction,
    meanLuminance,
    maxLuminance: maxLum,
    finishHint,
  };
}

export type RerunDetectorResult =
  | {
      ok: true;
      cropId: string;
      findings: Array<{
        kind: string;
        confidence: number;
        severity: string;
        bbox?: number[];
        description?: string;
      }>;
      modelVersion: string;
      conditionScore: number;
      summary: string;
    }
  | { ok: false; error: string };

/**
 * Re-run the detector on a cached crop. Calls the FastAPI /scan/analyze
 * endpoint (which already supports image_base64). If the inference service
 * is offline, returns a structured error so the agent can adapt.
 */
export async function rerunDetectorOnCrop(input: {
  cropId: string;
  inferenceBaseUrl: string;
}): Promise<RerunDetectorResult> {
  const entry = getCachedCrop(input.cropId);
  if (!entry) return { ok: false, error: `Crop ${input.cropId} not found in cache.` };

  let response: Response;
  try {
    response = await fetch(`${input.inferenceBaseUrl.replace(/\/$/, "")}/scan/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        image_base64: entry.cropBuffer.toString("base64"),
        filename: `${input.cropId}.png`,
        content_type: "image/png",
      }),
    });
  } catch (error) {
    return {
      ok: false,
      error: `Inference service unreachable: ${error instanceof Error ? error.message : "unknown"}.`,
    };
  }
  if (!response.ok) {
    return { ok: false, error: `Inference service returned HTTP ${response.status}.` };
  }
  let body: {
    report?: {
      findings?: Array<Record<string, unknown>>;
      condition_score?: number;
      summary?: string;
      model_version?: string;
      evidence_manifest?: { model?: { ding_detector?: string } };
    };
  };
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "Inference service returned non-JSON body." };
  }
  const report = body.report ?? {};
  const findings = (report.findings ?? []).slice(0, 20).map((finding) => ({
    kind: String(finding.kind ?? "unknown_damage"),
    confidence: Math.max(0, Math.min(1, Number(finding.confidence ?? 0))),
    severity: String(finding.severity ?? "low"),
    bbox: Array.isArray(finding.bbox) ? finding.bbox.map(Number) : undefined,
    description: typeof finding.description === "string" ? finding.description : undefined,
  }));
  return {
    ok: true,
    cropId: input.cropId,
    findings,
    modelVersion: String(report.model_version ?? report.evidence_manifest?.model?.ding_detector ?? "ding-detector-v0"),
    conditionScore: Math.max(0, Math.min(100, Number(report.condition_score ?? 0))),
    summary: String(report.summary ?? "Crop re-inspection complete."),
  };
}

export function imageOpsHealthSummary() {
  return {
    cropCacheSize: CROP_CACHE.size,
    maxCrops: MAX_CROPS,
    cropTtlMs: CROP_TTL_MS,
  };
}
