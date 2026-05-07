/**
 * OCR + label detection for dealer intake.
 *
 * Forwards a base64 image to FastAPI's `/certs/detect-labels` endpoint
 * (which runs Tesseract under the hood) via the same-origin
 * /api/inference proxy, then normalizes the response into candidate
 * cert numbers + grade hints we can persist as Dealer records.
 */

import { createHash } from "node:crypto";

export type DetectedLabel = {
  index: number;
  bbox: [number, number, number, number];
  cropBase64: string | null;
  ocrText: string;
  candidateCerts: string[];
  candidateGrades: string[];
};

export type LabelDetectionResult = {
  imageSize: [number, number];
  labels: DetectedLabel[];
  ocrRun: boolean;
  uniqueCerts: string[];
  imageHash: string;
};

function inferenceBase(): string {
  // Server-side: talk directly to FastAPI; same logic as the [...path] proxy.
  return (
    process.env.INFERENCE_API_URL ??
    process.env.NEXT_PUBLIC_INFERENCE_API_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
}

export async function detectCertLabels(imageBase64: string): Promise<LabelDetectionResult> {
  const base = inferenceBase();
  const url = `${base}/certs/detect-labels`;
  const imageHash = createHash("sha256").update(imageBase64, "base64").digest("hex");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: imageBase64,
        run_ocr: true,
        include_thumbnails: false,
      }),
    });
  } catch (err) {
    throw new Error(`Inference unreachable at ${base}/certs/detect-labels: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`detect-labels ${res.status}: ${body.slice(0, 400)}`);
  }
  const j = await res.json();
  const labels: DetectedLabel[] = (j.labels ?? []).map((l: {
    index: number;
    bbox: [number, number, number, number];
    crop_base64: string | null;
    ocr_text: string;
    candidate_certs: string[];
    candidate_grades: string[];
  }) => ({
    index: l.index,
    bbox: l.bbox,
    cropBase64: l.crop_base64,
    ocrText: l.ocr_text ?? "",
    candidateCerts: l.candidate_certs ?? [],
    candidateGrades: l.candidate_grades ?? [],
  }));
  return {
    imageSize: j.image_size,
    labels,
    ocrRun: Boolean(j.ocr_run),
    uniqueCerts: j.unique_certs ?? [],
    imageHash,
  };
}

export function imageHash(imageBase64: string): string {
  return createHash("sha256").update(imageBase64, "base64").digest("hex");
}
