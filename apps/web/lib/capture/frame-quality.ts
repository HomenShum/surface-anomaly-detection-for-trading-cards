// Lightweight client-side capture-quality scoring.
// Real signals only - Laplacian variance for blur, brightness histogram,
// edge visibility from Sobel, glare from highlight saturation.
//
// All scoring runs on a downscaled 256x192 canvas so it stays under 4ms
// per frame on a mid-range phone. Callers should run this inside a
// requestVideoFrameCallback loop, not requestAnimationFrame.

export type FrameQuality = {
  blurScore: number;       // 0..100, higher is sharper
  brightness: number;      // 0..100, target ~50
  glareRisk: number;       // 0..100, higher is worse
  edgeCoverage: number;    // 0..100, fraction of border that has visible edges
  surfaceMode: SurfaceMode; // matte | glossy | holo | unknown
  pass: boolean;           // true if all gates pass
  reasons: string[];       // human-readable failure reasons (empty when pass)
};

export type SurfaceMode = "matte" | "glossy" | "holo" | "unknown";

const TARGET_W = 256;
const TARGET_H = 192;

let scratchCanvas: HTMLCanvasElement | null = null;
function getScratch(): HTMLCanvasElement {
  if (!scratchCanvas) {
    scratchCanvas = document.createElement("canvas");
    scratchCanvas.width = TARGET_W;
    scratchCanvas.height = TARGET_H;
  }
  return scratchCanvas;
}

export function scoreFrameFromVideo(video: HTMLVideoElement): FrameQuality {
  const canvas = getScratch();
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return failQuality(["no canvas context"]);
  ctx.drawImage(video, 0, 0, TARGET_W, TARGET_H);
  const data = ctx.getImageData(0, 0, TARGET_W, TARGET_H).data;
  return scoreFrameFromImageData(data, TARGET_W, TARGET_H);
}

export function scoreFrameFromImage(image: HTMLImageElement): FrameQuality {
  const canvas = getScratch();
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return failQuality(["no canvas context"]);
  ctx.drawImage(image, 0, 0, TARGET_W, TARGET_H);
  const data = ctx.getImageData(0, 0, TARGET_W, TARGET_H).data;
  return scoreFrameFromImageData(data, TARGET_W, TARGET_H);
}

function scoreFrameFromImageData(data: Uint8ClampedArray, w: number, h: number): FrameQuality {
  const luma = new Float32Array(w * h);
  let bSum = 0;
  let highlightCount = 0;
  let saturationSum = 0;
  let saturationN = 0;
  for (let i = 0, p = 0; p < data.length; p += 4, i += 1) {
    const r = data[p]!;
    const g = data[p + 1]!;
    const b = data[p + 2]!;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    luma[i] = y;
    bSum += y;
    if (y > 245) highlightCount += 1;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 30) {
      saturationSum += (max - min) / max;
      saturationN += 1;
    }
  }
  const avgLuma = bSum / (w * h);
  const brightness = Math.round((avgLuma / 255) * 100);

  // Laplacian variance - classic blur metric.
  let lapMean = 0;
  let lapM2 = 0;
  let lapN = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const v =
        -luma[i - w - 1]! - luma[i - w]! - luma[i - w + 1]!
        - luma[i - 1]! + 8 * luma[i]! - luma[i + 1]!
        - luma[i + w - 1]! - luma[i + w]! - luma[i + w + 1]!;
      lapN += 1;
      const delta = v - lapMean;
      lapMean += delta / lapN;
      lapM2 += delta * (v - lapMean);
    }
  }
  const lapVar = lapM2 / Math.max(1, lapN - 1);
  const blurScore = Math.min(100, Math.round((lapVar / 1800) * 100));

  // Sobel edge coverage near image border (card edge visibility).
  let borderEdgeHits = 0;
  let borderSamples = 0;
  const margin = 6;
  for (let x = margin; x < w - margin; x += 2) {
    for (const y of [margin, h - margin - 1]) {
      const i = y * w + x;
      const gx = -luma[i - 1]! + luma[i + 1]!;
      const gy = -luma[i - w]! + luma[i + w]!;
      const mag = Math.hypot(gx, gy);
      if (mag > 30) borderEdgeHits += 1;
      borderSamples += 1;
    }
  }
  for (let y = margin; y < h - margin; y += 2) {
    for (const x of [margin, w - margin - 1]) {
      const i = y * w + x;
      const gx = -luma[i - 1]! + luma[i + 1]!;
      const gy = -luma[i - w]! + luma[i + w]!;
      const mag = Math.hypot(gx, gy);
      if (mag > 30) borderEdgeHits += 1;
      borderSamples += 1;
    }
  }
  const edgeCoverage = Math.round((borderEdgeHits / Math.max(1, borderSamples)) * 100);

  const glareRisk = Math.min(100, Math.round((highlightCount / (w * h)) * 100 * 18));
  const avgSaturation = saturationN ? saturationSum / saturationN : 0;
  const surfaceMode = classifySurface({ glareRisk, avgSaturation, brightness });

  const reasons: string[] = [];
  if (blurScore < 38) reasons.push("Frame too blurry - hold steady.");
  if (brightness < 22) reasons.push("Too dark - move to better light.");
  if (brightness > 86) reasons.push("Too bright - reduce direct light.");
  if (glareRisk > 35) reasons.push("Glare detected - angle the card.");
  if (edgeCoverage < 28) reasons.push("Move the card closer to fill the frame.");

  return {
    blurScore,
    brightness,
    glareRisk,
    edgeCoverage,
    surfaceMode,
    pass: reasons.length === 0,
    reasons,
  };
}

function classifySurface(input: { glareRisk: number; avgSaturation: number; brightness: number }): SurfaceMode {
  if (input.glareRisk > 28 && input.avgSaturation > 0.32) return "holo";
  if (input.glareRisk > 22) return "glossy";
  if (input.glareRisk < 12 && input.avgSaturation > 0.18) return "matte";
  return "unknown";
}

function failQuality(reasons: string[]): FrameQuality {
  return {
    blurScore: 0,
    brightness: 0,
    glareRisk: 100,
    edgeCoverage: 0,
    surfaceMode: "unknown",
    pass: false,
    reasons,
  };
}

export function isSecureCameraContext(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}
