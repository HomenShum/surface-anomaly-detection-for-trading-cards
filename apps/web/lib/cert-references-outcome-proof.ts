import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type OutcomeProofGate = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type OutcomeProofTrace = {
  certId: string;
  provider: string;
  certNumber: string;
  officialGrade: string | null;
  officialBand: string | null;
  cardIdentity: string | null;
  trustTier: string;
  sourceType: string;
  source: string;
  sourceUrl: string;
  imageSource: string;
  inferenceIsSimulated: boolean;
  detectionCount: number;
  predictedBand: string | null;
  predictedScore: number | null;
  bandAgreement: "match" | "adjacent" | "mismatch" | "no_official_band";
  proofEligible: boolean;
  proofBlockers: string[];
  inferenceModelVersion: string | null;
  remoteImageArtifacts: Array<{
    ok: boolean;
    view: string;
    url: string;
    contentType?: string;
    sizeBytes?: number;
    sha256?: string;
    fetchedAt?: string;
    error?: string;
  }>;
};

export type OutcomeProofReport = {
  schemaVersion: number;
  generatedAt: string;
  label: string;
  inferenceBase: string;
  outcomeMatchingProved: boolean;
  productionDeployable: boolean;
  modelMetadata: {
    model_version: string;
    weights_sha256: string | null;
    training_run_id: string | null;
    mock: boolean;
    allow_mock_detector: boolean;
  } | null;
  summary: {
    totalRefs: number;
    realInferenceRows: number;
    proofEligibleMatches: number;
    match: number;
    adjacent: number;
    mismatch: number;
    noOfficial: number;
    averageJudgeScore: number;
  };
  gates: OutcomeProofGate[];
  notes: string[];
  traces: OutcomeProofTrace[];
};

function repoRoot() {
  const cwd = process.cwd();
  if (existsSync(join(cwd, "pnpm-workspace.yaml"))) return cwd;
  const maybeRoot = resolve(cwd, "..", "..");
  if (existsSync(join(maybeRoot, "pnpm-workspace.yaml"))) return maybeRoot;
  return cwd;
}

export function loadLatestOutcomeProofReport(): OutcomeProofReport | null {
  const path = join(repoRoot(), "data", "cert-references", "outcome-proof", "latest.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as OutcomeProofReport;
  } catch {
    return null;
  }
}
