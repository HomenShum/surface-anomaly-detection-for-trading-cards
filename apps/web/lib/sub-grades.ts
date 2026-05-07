/**
 * Sub-grade calibration helper.
 *
 * Derives BGS-style numeric sub-grades (0-10) from the inference API's
 * findings list. The four sub-grades:
 *
 *   centering  — derived from the normalized-card frame geometry, not
 *                from DING findings. Unavailable when the inference output
 *                doesn't carry centering info.
 *   corners    — derived from corner-zone findings (top_left_corner, etc.).
 *   edges      — derived from edge-zone findings.
 *   surface    — derived from center/surface findings + glare score.
 *
 * Design contract:
 *   - We never claim the predicted sub-grade equals an official BGS sub-grade.
 *   - Sub-grades are auxiliary signal, not authoritative.
 *   - Each sub-grade is paired with a confidence (0-1) so the UI can soften
 *     low-confidence values.
 *   - When findings don't reach a region, we DON'T silently emit 10/10. We
 *     emit `null` so the UI shows "no signal".
 */

export type SubGradeKey = "centering" | "corners" | "edges" | "surface";

export type SubGradeValue = {
  score: number | null;
  confidence: number;
  /** Region/zone names that contributed to this sub-grade. */
  contributors: string[];
  /** Total finding count seen for this sub-grade. */
  findingCount: number;
};

export type SubGrades = Record<SubGradeKey, SubGradeValue>;

export type InferenceFindingLike = {
  type?: string;
  kind?: string;
  zone?: string;
  region?: string;
  bbox?: [number, number, number, number];
  severity?: string;
  confidence?: number;
};

export type InferenceReportLike = {
  condition_score?: number;
  conditionScore?: number;
  surface_score?: number;
  surfaceScore?: number;
  glare_score?: number;
  glareScore?: number;
  centering_score?: number;
  centeringScore?: number;
  corner_score?: number;
  cornerScore?: number;
  edge_score?: number;
  edgeScore?: number;
  findings?: InferenceFindingLike[];
};

const CORNER_ZONES = new Set([
  "top_left_corner",
  "top_right_corner",
  "bottom_left_corner",
  "bottom_right_corner",
  "tl_corner",
  "tr_corner",
  "bl_corner",
  "br_corner",
  "corner",
]);

const EDGE_ZONES = new Set([
  "top_edge",
  "bottom_edge",
  "left_edge",
  "right_edge",
  "edge",
]);

const SURFACE_ZONES = new Set([
  "surface",
  "center",
  "centre",
  "face",
  "front",
]);

function severityWeight(severity?: string): number {
  if (severity === "high" || severity === "major") return 2.5;
  if (severity === "medium" || severity === "moderate") return 1.5;
  if (severity === "low" || severity === "minor") return 0.8;
  return 1.0;
}

function classifyZone(zone?: string): SubGradeKey | "other" {
  const key = String(zone ?? "").toLowerCase();
  if (CORNER_ZONES.has(key)) return "corners";
  if (EDGE_ZONES.has(key)) return "edges";
  if (SURFACE_ZONES.has(key)) return "surface";
  return "other";
}

function clampScore(raw: number, floor = 0, ceiling = 10): number {
  if (!Number.isFinite(raw)) return floor;
  return Math.max(floor, Math.min(ceiling, raw));
}

/**
 * 0-100 condition_score → 0-10 sub-grade base. We then subtract per-finding
 * penalties weighted by severity + confidence.
 */
function baseFromConditionScore(score?: number): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return 8.5;
  return clampScore(score / 10, 1, 10);
}

export function deriveSubGradesFromInference(report: InferenceReportLike | null | undefined): SubGrades {
  const result: SubGrades = {
    centering: { score: null, confidence: 0, contributors: [], findingCount: 0 },
    corners: { score: null, confidence: 0, contributors: [], findingCount: 0 },
    edges: { score: null, confidence: 0, contributors: [], findingCount: 0 },
    surface: { score: null, confidence: 0, contributors: [], findingCount: 0 },
  };
  if (!report) return result;

  const conditionScore = report.condition_score ?? report.conditionScore;
  const base = baseFromConditionScore(conditionScore);

  // Centering — only available when the inference report carries it.
  const centering = report.centering_score ?? report.centeringScore;
  if (typeof centering === "number" && Number.isFinite(centering)) {
    result.centering = {
      score: clampScore(centering / 10),
      confidence: 0.7,
      contributors: ["centering_score"],
      findingCount: 0,
    };
  }

  const findings = Array.isArray(report.findings) ? report.findings : [];
  const buckets: Record<SubGradeKey, { penalty: number; weightSum: number; contributors: Set<string>; count: number }> = {
    centering: { penalty: 0, weightSum: 0, contributors: new Set(), count: 0 },
    corners: { penalty: 0, weightSum: 0, contributors: new Set(), count: 0 },
    edges: { penalty: 0, weightSum: 0, contributors: new Set(), count: 0 },
    surface: { penalty: 0, weightSum: 0, contributors: new Set(), count: 0 },
  };
  for (const finding of findings) {
    const zone = String(finding.zone ?? finding.region ?? "").toLowerCase();
    const key = classifyZone(zone);
    if (key === "other") continue;
    const weight = severityWeight(finding.severity);
    const conf = typeof finding.confidence === "number" ? Math.max(0, Math.min(1, finding.confidence)) : 0.5;
    buckets[key].penalty += weight * conf;
    buckets[key].weightSum += conf;
    buckets[key].contributors.add(zone);
    buckets[key].count += 1;
  }

  for (const key of ["corners", "edges", "surface"] as const) {
    const bucket = buckets[key];
    if (bucket.count === 0) continue;
    // Each unit of weighted penalty drops the score by 0.5; cap at -3.5.
    const adjustment = Math.min(3.5, bucket.penalty * 0.5);
    const score = clampScore(base - adjustment);
    const confidence = Math.min(1, bucket.weightSum / Math.max(1, bucket.count));
    result[key] = {
      score,
      confidence,
      contributors: [...bucket.contributors],
      findingCount: bucket.count,
    };
  }
  // Surface — augment with glare_score if no surface findings were captured.
  if (result.surface.score === null) {
    const glare = report.glare_score ?? report.glareScore;
    if (typeof glare === "number" && Number.isFinite(glare)) {
      result.surface = {
        score: clampScore(base - glare * 1.5),
        confidence: 0.4,
        contributors: ["glare_score"],
        findingCount: 0,
      };
    }
  }

  return result;
}

export function summarizeSubGrades(grades: SubGrades): string {
  const parts: string[] = [];
  for (const key of ["centering", "corners", "edges", "surface"] as const) {
    const value = grades[key];
    if (value.score === null) {
      parts.push(`${key}: —`);
    } else {
      parts.push(`${key}: ${value.score.toFixed(1)}`);
    }
  }
  return parts.join(" · ");
}
