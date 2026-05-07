import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "./cert-references";

export type AgenticCertEvalGate = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type AgenticCertEvalReport = {
  generatedAt: string;
  label: string;
  modelVersion: string;
  judgeMode: string;
  deployable: boolean;
  totals: {
    references: number;
    realPredictions: number;
    placeholderPredictions: number;
    noPredictions: number;
    replayableImageRefs: number;
    goldRefs: number;
    needsReview: number;
    averageScores: {
      overall: number;
      grounding: number;
      toolCoverage: number;
      calibration: number;
      evidence: number;
      trustSafety: number;
    };
    failureBuckets: Record<string, number>;
    missingPromotionTools: Record<string, number>;
  };
  gates: AgenticCertEvalGate[];
  toolSurface?: {
    missingRequired: string[];
    implemented: string[];
  };
};

export function agenticCertEvalReportPath(label = "latest") {
  return join(repoRoot(), "data", "cert-references", "agentic-eval", `${label}.json`);
}

export function loadLatestAgenticCertEvalReport(label = "latest"): AgenticCertEvalReport | null {
  const path = agenticCertEvalReportPath(label);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AgenticCertEvalReport;
  } catch {
    return null;
  }
}
