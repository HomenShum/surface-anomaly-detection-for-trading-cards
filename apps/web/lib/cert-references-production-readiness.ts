import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type ProductionReadinessGate = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type ProductionReadinessIssue = {
  id: string;
  severity: "P0" | "P1" | "P2";
  layer: string;
  certId: string | null;
  title: string;
  detail: string;
  nextAction: string;
};

export type ReleaseModeReadiness = {
  id: "demo" | "certified_reference_alpha" | "trust_beta" | "production";
  label: string;
  deployable: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
  blockingReasons: string[];
};

export type ProductionReadinessReport = {
  schemaVersion: number;
  generatedAt: string;
  demoDeployable?: boolean;
  certifiedReferenceAlphaDeployable?: boolean;
  trustBetaDeployable?: boolean;
  productionDeployable: boolean;
  releaseModes?: Record<string, ReleaseModeReadiness>;
  summary: {
    refs: number;
    activePredictions: number;
    activePlaceholderPredictions: number;
    realOutcomeRows: number;
    proofEligibleMatches: number;
    realModelRows?: number;
    realBandMatches: number;
    realBandMatchRate: number;
    officialBandsCovered: number;
    goldRefs: number;
    humanDingReviews: number;
    imageBackedSilverPlusRefs?: number;
    missingReplayableImages: number;
    declaredSlabImagesMissingLocal: number;
    blockerIssues: number;
    issueCounts: Record<string, number>;
  };
  thresholds: {
    minRealOutcomeRows: number;
    minGoldRefs: number;
    minHumanDingReviews: number;
    minRealBandMatchRate: number;
    minOfficialBandCoverage: number;
    minImageBackedSilverPlusRefs?: number;
  };
  alphaThresholds?: {
    minCertifiedRefs: number;
    minImageBackedSilverPlusRefs: number;
    minRealModelRows: number;
  };
  trustBetaThresholds?: {
    minRealOutcomeRows: number;
    minGoldRefs: number;
    minHumanDingReviews: number;
    minRealBandMatchRate: number;
    minOfficialBandCoverage: number;
    minImageBackedSilverPlusRefs: number;
  };
  gates: ProductionReadinessGate[];
  issues: ProductionReadinessIssue[];
};

function repoRoot() {
  const cwd = process.cwd();
  if (existsSync(join(cwd, "pnpm-workspace.yaml"))) return cwd;
  const maybeRoot = resolve(cwd, "..", "..");
  if (existsSync(join(maybeRoot, "pnpm-workspace.yaml"))) return maybeRoot;
  return cwd;
}

export function loadLatestProductionReadinessReport(): ProductionReadinessReport | null {
  const path = join(repoRoot(), "data", "cert-references", "production-readiness", "latest.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ProductionReadinessReport;
  } catch {
    return null;
  }
}
