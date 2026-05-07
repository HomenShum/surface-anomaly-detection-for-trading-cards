/**
 * Dealer DING-detector hook.
 *
 * Given an image (base64) attached to a Dealer record, calls FastAPI's
 * /scan/analyze endpoint and converts the response into our
 * `DealerModelFinding[]` shape so the human-review workbench has something
 * to accept/reject.
 *
 * Server-side only — runs in the Next.js Node runtime.
 */

import { createHash } from "node:crypto";
import type { DealerModelFinding } from "./types";

type FastApiFinding = {
  type?: string;
  ding_type?: string;
  bbox?: [number, number, number, number];
  severity?: string;
  confidence?: number;
  region?: string;
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
  const raw = (finding.type ?? finding.ding_type ?? "").trim();
  const normalized = raw.replace(/\s+/g, "_").toLowerCase();
  return normalized || "unknown_damage";
}

export type DetectorRunResult = {
  findings: DealerModelFinding[];
  summary?: string;
  modelVersion: string;
  imageHash: string;
};

export async function runDealerDetector(imageBase64: string): Promise<DetectorRunResult> {
  const base = inferenceBase();
  const imageHash = createHash("sha256").update(imageBase64, "base64").digest("hex");
  const url = `${base}/scan/analyze`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: imageBase64,
        run_ocr: false,
        finish_hint: null,
      }),
    });
  } catch (err) {
    throw new Error(`scan/analyze unreachable at ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`scan/analyze ${res.status}: ${body.slice(0, 400)}`);
  }
  const j = (await res.json()) as FastApiAnalyzeResponse;
  const modelVersion = j.report?.model_version ?? "ding-detector-v0";
  const findings: DealerModelFinding[] = (j.report?.findings ?? []).map((f) => {
    const type = normalizeFindingType(f);
    const bbox = (f.bbox ?? [0, 0, 0, 0]) as [number, number, number, number];
    return {
      type,
      bbox,
      severity: clampSeverity(f.severity),
      confidence: typeof f.confidence === "number" ? f.confidence : 0,
      modelVersion,
      region: f.region,
      imageHash,
      acceptedByReview: "pending",
    };
  });
  return {
    findings,
    summary: j.report?.summary,
    modelVersion,
    imageHash,
  };
}
