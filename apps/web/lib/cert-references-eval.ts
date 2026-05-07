/**
 * Cert-reference evaluation — compares model predictions against the certified
 * reference outcomes in `data/cert-references/seed.json` (+ imports.jsonl).
 *
 * This is the **separate-from-user-experience** evaluation pipeline:
 *   - Production scan/upload UX never invokes this.
 *   - This is invoked offline via `pnpm eval:certrefs` and on every promotion
 *     attempt for a new inspection skill.
 *
 * Promotion gate contract:
 *   - For a new model/skill version to graduate, the per-cert band agreement
 *     must beat the production baseline on Silver+ entries (PSA cert + slab
 *     image on file) AND not regress on Silver entries (cert-link only).
 *   - Mismatches are flagged and become candidate inputs for the agent's
 *     self-correction loop (`compare_to_cert_reference` tool).
 *
 * No production grade-claiming. The eval is "did our band match the official
 * outcome's band?" — not "did we predict the exact PSA grade?"
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  loadAllCertifiedReferences,
  repoRoot,
  type CertProvider,
  type CertTrustTier,
  type CertifiedReference,
} from "./cert-references";
import type { ConditionBand } from "./examples/registry";
import type { SubGrades } from "./sub-grades";

export type CertEvalPrediction = {
  certId: string;
  predictedBand: ConditionBand;
  predictedScore: number;
  confidence: number;
  modelVersion: string;
  /** Optional list of agent-proposed inspection-method skill ids that ran. */
  appliedSkillIds?: string[];
  /** Optional captured DING summary — used for self-correction proposals. */
  dingsSummary?: string;
  /** Optional BGS-style sub-grades produced by the slab-inference batch. */
  predictedSubGrades?: SubGrades;
};

export type CertEvalRowResult = {
  certId: string;
  provider: CertProvider;
  certNumber: string;
  trustTier: CertTrustTier;
  officialGrade?: string;
  officialBand: ConditionBand | null;
  predictedBand: ConditionBand | null;
  predictedScore: number | null;
  confidence: number | null;
  bandAgreement: "match" | "adjacent" | "mismatch" | "no_official_band";
  bandDistance: number | null;
  notes: string[];
  predictedSubGrades?: SubGrades | null;
};

export type CertEvalResult = {
  modelVersion: string;
  evaluatedAt: string;
  totals: {
    references: number;
    predictionsCovered: number;
    matched: number;
    adjacent: number;
    mismatched: number;
    skipped: number;
    silverPlusCovered: number;
    silverPlusMatched: number;
    silverCovered: number;
    silverMatched: number;
  };
  rows: CertEvalRowResult[];
  notes: string[];
};

export type CertEvalGateInput = {
  candidate: CertEvalResult;
  /**
   * Optional production baseline. When omitted the gate uses a fixed floor
   * (matchRate >= 0.5, no Silver+ regression because there is no baseline).
   */
  baseline?: CertEvalResult;
};

export type CertEvalGateDecision = {
  allowed: boolean;
  reasons: string[];
  metrics: {
    candidateMatchRate: number;
    candidateSilverPlusMatchRate: number;
    candidateSilverMatchRate: number;
    baselineMatchRate?: number;
    baselineSilverPlusMatchRate?: number;
  };
};

const BAND_ORDER: ConditionBand[] = [
  "below_700_heavy_wear",
  "700-799_visible_issues",
  "800-849_near_mint",
  "850-899_strong_nm_mint",
  "900-949_mint",
  "950-1000_gem_pristine",
];

/**
 * Maps an official grader's grade string into our internal condition band.
 * Honest: returns null when we cannot reliably map.
 */
export function mapOfficialGradeToBand(reference: CertifiedReference): ConditionBand | null {
  const numeric = reference.numericGrade;
  if (typeof numeric === "number") {
    if (numeric >= 9.5) return "950-1000_gem_pristine";
    if (numeric >= 9) return "900-949_mint";
    if (numeric >= 8.5) return "850-899_strong_nm_mint";
    if (numeric >= 8) return "800-849_near_mint";
    // PSA 6 (EX-MT) and PSA 7 (NM) both belong in our "visible condition risk"
    // band per the conditionLadder. PSA 5 (EX) drops into heavy wear.
    if (numeric >= 6) return "700-799_visible_issues";
    return "below_700_heavy_wear";
  }
  // TAG Score (0-1000) when grader is TAG and grade contains a number-like token
  const grade = reference.officialGrade ?? "";
  if (reference.provider === "TAG") {
    const m = grade.match(/(\d{3,4})/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 950) return "950-1000_gem_pristine";
      if (n >= 900) return "900-949_mint";
      if (n >= 850) return "850-899_strong_nm_mint";
      if (n >= 800) return "800-849_near_mint";
      if (n >= 700) return "700-799_visible_issues";
      return "below_700_heavy_wear";
    }
  }
  // Heuristic: PSA-style label words.
  const upper = grade.toUpperCase();
  if (upper.includes("GEM") || upper.includes("PRISTINE") || upper.includes(" 10")) {
    return "950-1000_gem_pristine";
  }
  if (upper.includes("MINT 9") || upper === "MINT") return "900-949_mint";
  if (upper.includes("NM-MT 8") || upper.includes("NM-MT")) return "800-849_near_mint";
  return null;
}

function bandIndex(band: ConditionBand) {
  return BAND_ORDER.indexOf(band);
}

function classifyAgreement(official: ConditionBand | null, predicted: ConditionBand | null): {
  agreement: CertEvalRowResult["bandAgreement"];
  distance: number | null;
} {
  if (!official) return { agreement: "no_official_band", distance: null };
  if (!predicted) return { agreement: "mismatch", distance: null };
  const distance = Math.abs(bandIndex(official) - bandIndex(predicted));
  if (distance === 0) return { agreement: "match", distance };
  if (distance === 1) return { agreement: "adjacent", distance };
  return { agreement: "mismatch", distance };
}

/**
 * Runs the eval given a map of {certId -> prediction}. References without a
 * prediction are recorded as `skipped` rows (so the eval is honest about
 * coverage, not silently averaging only what we predicted).
 */
export function evaluateAgainstCertReferences(
  predictions: Map<string, CertEvalPrediction> | Record<string, CertEvalPrediction>,
  options: { modelVersion?: string; references?: CertifiedReference[] } = {},
): CertEvalResult {
  const refs = options.references ?? loadAllCertifiedReferences();
  const map =
    predictions instanceof Map
      ? predictions
      : new Map(Object.entries(predictions));

  const rows: CertEvalRowResult[] = [];
  let silverPlusCovered = 0;
  let silverPlusMatched = 0;
  let silverCovered = 0;
  let silverMatched = 0;
  let matched = 0;
  let adjacent = 0;
  let mismatched = 0;
  let skipped = 0;

  for (const ref of refs) {
    const officialBand = mapOfficialGradeToBand(ref);
    const prediction = map.get(ref.id);
    const notes: string[] = [];
    if (!officialBand) {
      notes.push(
        "Cannot map official grade to internal band — entry counted but excluded from match-rate denominators.",
      );
    }
    if (!prediction) {
      skipped += 1;
      rows.push({
        certId: ref.id,
        provider: ref.provider,
        certNumber: ref.certNumber,
        trustTier: ref.trustTier,
        officialGrade: ref.officialGrade,
        officialBand,
        predictedBand: null,
        predictedScore: null,
        confidence: null,
        bandAgreement: officialBand ? "mismatch" : "no_official_band",
        bandDistance: null,
        notes: [
          ...notes,
          "No prediction supplied; reference not yet evaluated against this model version.",
        ],
      });
      continue;
    }

    const { agreement, distance } = classifyAgreement(officialBand, prediction.predictedBand);
    if (agreement === "match") matched += 1;
    if (agreement === "adjacent") adjacent += 1;
    if (agreement === "mismatch") mismatched += 1;

    const isSilverPlus = ref.trustTier === "silver_plus";
    const isSilver = ref.trustTier === "silver";
    if (officialBand) {
      if (isSilverPlus) {
        silverPlusCovered += 1;
        if (agreement === "match") silverPlusMatched += 1;
      }
      if (isSilver) {
        silverCovered += 1;
        if (agreement === "match") silverMatched += 1;
      }
    }

    rows.push({
      certId: ref.id,
      provider: ref.provider,
      certNumber: ref.certNumber,
      trustTier: ref.trustTier,
      officialGrade: ref.officialGrade,
      officialBand,
      predictedBand: prediction.predictedBand,
      predictedScore: prediction.predictedScore,
      confidence: prediction.confidence,
      bandAgreement: agreement,
      bandDistance: distance,
      notes,
      predictedSubGrades: prediction.predictedSubGrades ?? null,
    });
  }

  const predictionsCovered = rows.length - skipped;
  const result: CertEvalResult = {
    modelVersion: options.modelVersion ?? "unknown",
    evaluatedAt: new Date().toISOString(),
    totals: {
      references: refs.length,
      predictionsCovered,
      matched,
      adjacent,
      mismatched,
      skipped,
      silverPlusCovered,
      silverPlusMatched,
      silverCovered,
      silverMatched,
    },
    rows,
    notes: [
      "Eval compares INTERNAL CONDITION BAND, not the official grade itself. We never claim to predict the exact PSA/CGC/BGS/TAG grade.",
      "Adjacent-band misses are recorded but do not count as matched.",
      "Mismatches are surfaced to the agent's self-correction loop as candidate inspection-method proposals.",
    ],
  };
  return result;
}

export function evaluateCertEvalPromotionGate(input: CertEvalGateInput): CertEvalGateDecision {
  const reasons: string[] = [];
  const candidate = input.candidate;
  const baseline = input.baseline;
  const predictedRows = candidate.rows.filter((row) => row.predictedBand);
  const isPlaceholderMirror =
    candidate.modelVersion === "baseline-trust-cert" ||
    candidate.modelVersion === "test-baseline-mirror" ||
    (predictedRows.length > 0 && predictedRows.every((row) => row.confidence === 0));

  const candidateMatchRate =
    candidate.totals.predictionsCovered > 0
      ? candidate.totals.matched / candidate.totals.predictionsCovered
      : 0;
  const candidateSilverPlusMatchRate =
    candidate.totals.silverPlusCovered > 0
      ? candidate.totals.silverPlusMatched / candidate.totals.silverPlusCovered
      : 0;
  const candidateSilverMatchRate =
    candidate.totals.silverCovered > 0
      ? candidate.totals.silverMatched / candidate.totals.silverCovered
      : 0;

  // Hard floor: at least half of supplied predictions must match.
  if (candidate.totals.predictionsCovered === 0) {
    reasons.push("Candidate has no cert-reference predictions covered.");
  } else if (candidate.totals.predictionsCovered < 5) {
    reasons.push(
      `Candidate has only ${candidate.totals.predictionsCovered} cert-reference predictions; promotion requires at least 5 real traces.`,
    );
  } else if (isPlaceholderMirror) {
    reasons.push(
      "Candidate cert-reference eval is a placeholder mirror, not a real slab-image model run.",
    );
  } else if (candidateMatchRate < 0.5) {
    reasons.push(
      `Candidate cert-reference match rate ${candidateMatchRate.toFixed(2)} < 0.50 floor.`,
    );
  }

  let baselineMatchRate: number | undefined;
  let baselineSilverPlusMatchRate: number | undefined;
  if (baseline) {
    baselineMatchRate =
      baseline.totals.predictionsCovered > 0
        ? baseline.totals.matched / baseline.totals.predictionsCovered
        : 0;
    baselineSilverPlusMatchRate =
      baseline.totals.silverPlusCovered > 0
        ? baseline.totals.silverPlusMatched / baseline.totals.silverPlusCovered
        : 0;

    if (candidateMatchRate < baselineMatchRate) {
      reasons.push(
        `Candidate overall match rate ${candidateMatchRate.toFixed(
          2,
        )} below production baseline ${baselineMatchRate.toFixed(2)}.`,
      );
    }
    if (candidateSilverPlusMatchRate + 1e-9 < baselineSilverPlusMatchRate) {
      reasons.push(
        `Candidate Silver+ match rate ${candidateSilverPlusMatchRate.toFixed(
          2,
        )} regresses against production Silver+ baseline ${baselineSilverPlusMatchRate.toFixed(2)}.`,
      );
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons: reasons.length > 0 ? reasons : ["Cert-reference promotion gate passed."],
    metrics: {
      candidateMatchRate,
      candidateSilverPlusMatchRate,
      candidateSilverMatchRate,
      baselineMatchRate,
      baselineSilverPlusMatchRate,
    },
  };
}

export function findMismatchRows(result: CertEvalResult): CertEvalRowResult[] {
  return result.rows.filter((row) => row.bandAgreement === "mismatch" || row.bandAgreement === "adjacent");
}

export function certEvalReportDir() {
  const dir = join(repoRoot(), "data", "benchmarks", "cert_refs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function persistCertEvalReport(result: CertEvalResult, label = "latest"): string {
  const dir = certEvalReportDir();
  const path = join(dir, `${label}.json`);
  writeFileSync(path, JSON.stringify(result, null, 2));
  return path;
}

export function loadLatestCertEvalReport(label = "latest"): CertEvalResult | null {
  const path = join(certEvalReportDir(), `${label}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CertEvalResult;
  } catch {
    return null;
  }
}
