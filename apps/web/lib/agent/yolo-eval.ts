import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Loader for per-class YOLO evaluation reports.
 *
 * The Python script `ml/scripts/eval_yolo_per_class.py` writes timestamped
 * JSON files into `data/benchmarks/yolo_eval/`. This module loads the most
 * recent one and exposes a typed shape for the `/benchmarks` page.
 *
 * If no real report exists, the seed file ships as a clearly labeled stub
 * (is_stub: true). The page renders a banner explaining that.
 */

export type YoloPerClassRow = {
  class: string;
  precision: number | null;
  recall: number | null;
  mAP_50: number | null;
  mAP_50_95: number | null;
};

export type YoloPerRegionRow = {
  region: string;
  precision: number | null;
  recall: number | null;
  mAP_50: number | null;
};

export type YoloEvalReport = {
  report_id: string;
  generated_at: string;
  model_version: string;
  dataset_version: string;
  imgsz: number;
  conf: number;
  iou: number;
  device?: string;
  duration_s?: number;
  passed: boolean;
  is_stub: boolean;
  reason?: string | null;
  summary: {
    precision: number | null;
    recall: number | null;
    mAP_50: number | null;
    mAP_50_95: number | null;
    fitness: number | null;
  };
  per_class: YoloPerClassRow[];
  per_region: YoloPerRegionRow[];
  limitations: string[];
};

function dataDir() {
  const override = process.env.CCV_DATA_DIR;
  if (override) return resolve(override);
  return resolve(process.cwd(), "..", "..", "data");
}

function evalDir() {
  return join(dataDir(), "benchmarks", "yolo_eval");
}

export function loadLatestYoloEval(): YoloEvalReport | null {
  const dir = evalDir();
  if (!existsSync(dir)) return null;
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".json"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  // Prefer the most recent non-stub real report; if none exist, return the most recent stub.
  const sorted = files.sort();
  const real = [...sorted]
    .reverse()
    .map((file) => safeReadReport(join(dir, file)))
    .find((report): report is YoloEvalReport => report !== null && !report.is_stub);
  if (real) return real;
  const lastStub = safeReadReport(join(dir, sorted[sorted.length - 1]));
  return lastStub;
}

function safeReadReport(path: string): YoloEvalReport | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as YoloEvalReport;
  } catch {
    return null;
  }
}
