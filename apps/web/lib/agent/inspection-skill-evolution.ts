import {
  evaluateCertEvalPromotionGate,
  type CertEvalResult,
} from "../cert-references-eval";

export type InspectionSkillStatus = "draft" | "staging" | "canary" | "production" | "rejected" | "retired";

export type InspectionSkillConsentScope =
  | "session_only"
  | "private_user_memory"
  | "anonymized_method_stats"
  | "shared_training_opt_in";

export type InspectionToolName =
  | "detect_card_boundary"
  | "normalize_card"
  | "crop_corners"
  | "crop_edges"
  | "crop_surface"
  | "crop_region"
  | "zoom_region"
  | "rotate_image"
  | "enhance_contrast"
  | "run_glare_check"
  | "run_ding_detector"
  | "run_surface_anomaly"
  | "run_severity_scorer"
  | "run_condition_band_calibrator"
  | "compare_to_cert_reference"
  | "compare_regions"
  | "save_evidence_crop"
  | "cite_evidence"
  | "create_human_review_task"
  | "explain_uncertainty";

export type InspectionSkillTrigger = {
  finishType?: "matte" | "glossy" | "holo" | "textured_foil" | "unknown";
  findingType?: string;
  region?: string;
  maxConfidence?: number;
  minGlareScore?: number;
  userQuestionIntent?: string;
};

export type InspectionSkillStep = {
  tool: InspectionToolName;
  purpose: string;
  region?: string;
  requiresUserApproval?: boolean;
};

export type InspectionSkillContributor = {
  /** Stable handle, lowercase a-z0-9 with dashes. Empty/anon-derived if user opted out. */
  handle: string;
  /** Display name. May equal handle. */
  displayName: string;
  /** Source of the proposal. */
  source: "agent_self_proposal" | "agent_chat_user_remark" | "trace_clusterer" | "manual_submit" | "human_authored";
  /** Raw user message that prompted this skill, if any. KEPT PRIVATE — never published. */
  originalUserRemark?: string;
  /** Public-safe rewrite of the contribution. Shown on /methods cards. */
  publicRemark?: string;
  /** Has the contributor explicitly opted into public attribution? */
  consentPublicAttribution: boolean;
};

export type InspectionSkillCandidate = {
  skillId: string;
  title: string;
  status: InspectionSkillStatus;
  trigger: InspectionSkillTrigger;
  steps: InspectionSkillStep[];
  consentScope: InspectionSkillConsentScope;
  evidencePolicy: {
    storesRawUserImages: boolean;
    storesDerivedCrops: boolean;
    storesAnonymizedMetrics: boolean;
    sharesAcrossUsers: boolean;
  };
  guardrails: {
    requiresToolEvidence: boolean;
    forbidsOfficialGradeClaims: boolean;
    forbidsLegalProofClaims: boolean;
    requiresHumanApprovalForProduction: boolean;
  };
  /** Optional public-board metadata. Absent for purely internal/auto-clustered skills until a contributor claims them. */
  contributor?: InspectionSkillContributor;
  /** Folder path under repo's inspection-methods/, set when skill graduates and gets exported. */
  openSourcePath?: string;
  /** Hex sha256 over the canonical (skillId+steps+trigger) JSON, set at export time. */
  versionHash?: string;
  /** Counters for reward-event triggering. */
  usageCount?: number;
  createdAt: string;
};

export type InspectionSkillBenchmarkResult = {
  benchmarkId: string;
  datasetVersion: string;
  precisionDelta: number;
  recallDelta: number;
  falsePositiveDelta: number;
  latencyAddedMs: number;
  agentClaimsWithoutToolEvidence: number;
  officialGradeClaims: number;
  privacyViolations: number;
  passed: boolean;
};

export type SkillPromotionTarget = "staging" | "canary" | "production";

export type SkillPromotionDecision = {
  allowed: boolean;
  targetStatus: SkillPromotionTarget;
  reasons: string[];
};

const MAX_LATENCY_FOR_AUTO_CANARY_MS = 1200;

export const INSPECTION_SKILL_EVOLUTION_RULES = [
  "No production self-modification without benchmark pass.",
  "No shared learning from user data without explicit consent.",
  "No new tool access without permission review.",
  "No official grade claims.",
  "No legal proof claims.",
  "No raw user image sharing into global memory by default.",
  "No agent claim without tool output.",
  "Every promoted skill has a version, benchmark, and rollback path.",
] as const;

export function createInspectionSkillCandidate(input: {
  skillId: string;
  title: string;
  trigger: InspectionSkillTrigger;
  steps: InspectionSkillStep[];
  consentScope?: InspectionSkillConsentScope;
  storesDerivedCrops?: boolean;
  sharesAcrossUsers?: boolean;
  contributor?: InspectionSkillContributor;
}): InspectionSkillCandidate {
  const sharesAcrossUsers = input.sharesAcrossUsers ?? false;
  const consentScope = input.consentScope ?? (sharesAcrossUsers ? "anonymized_method_stats" : "session_only");

  return {
    skillId: input.skillId,
    title: input.title,
    status: "draft",
    trigger: input.trigger,
    steps: input.steps,
    consentScope,
    evidencePolicy: {
      storesRawUserImages: false,
      storesDerivedCrops: input.storesDerivedCrops ?? true,
      storesAnonymizedMetrics: sharesAcrossUsers,
      sharesAcrossUsers,
    },
    guardrails: {
      requiresToolEvidence: true,
      forbidsOfficialGradeClaims: true,
      forbidsLegalProofClaims: true,
      requiresHumanApprovalForProduction: true,
    },
    contributor: input.contributor,
    usageCount: 0,
    createdAt: new Date().toISOString(),
  };
}

export type CertEvalGateOptions = {
  /** Candidate (new) cert-reference eval. Required for canary/production promotion. */
  candidateResult: CertEvalResult;
  /** Optional production baseline. When present, candidate must not regress. */
  baselineResult?: CertEvalResult;
};

export function evaluateSkillPromotion(
  candidate: InspectionSkillCandidate,
  benchmarks: InspectionSkillBenchmarkResult[],
  targetStatus: SkillPromotionTarget,
  options: { humanApproved?: boolean; certEval?: CertEvalGateOptions } = {},
): SkillPromotionDecision {
  const reasons: string[] = [];
  const passedBenchmarks = benchmarks.filter((benchmark) => benchmark.passed);

  if (candidate.evidencePolicy.storesRawUserImages) {
    reasons.push("Candidate attempts to store raw user images.");
  }
  if (candidate.evidencePolicy.sharesAcrossUsers && candidate.consentScope !== "shared_training_opt_in" && candidate.consentScope !== "anonymized_method_stats") {
    reasons.push("Candidate shares across users without an allowed consent scope.");
  }
  if (!candidate.guardrails.requiresToolEvidence) {
    reasons.push("Candidate does not require tool-backed evidence for claims.");
  }
  if (!candidate.guardrails.forbidsOfficialGradeClaims || !candidate.guardrails.forbidsLegalProofClaims) {
    reasons.push("Candidate weakens official-grade or legal-proof claim guardrails.");
  }
  if (targetStatus !== "staging" && passedBenchmarks.length === 0) {
    reasons.push("Canary or production promotion requires at least one passed benchmark.");
  }
  if (targetStatus === "production" && !options.humanApproved) {
    reasons.push("Production promotion requires explicit human approval.");
  }

  for (const benchmark of benchmarks) {
    if (benchmark.agentClaimsWithoutToolEvidence > 0) {
      reasons.push(`Benchmark ${benchmark.benchmarkId} had ungrounded agent claims.`);
    }
    if (benchmark.officialGradeClaims > 0) {
      reasons.push(`Benchmark ${benchmark.benchmarkId} included official-grade claims.`);
    }
    if (benchmark.privacyViolations > 0) {
      reasons.push(`Benchmark ${benchmark.benchmarkId} had privacy violations.`);
    }
    if (targetStatus === "canary" && benchmark.latencyAddedMs > MAX_LATENCY_FOR_AUTO_CANARY_MS) {
      reasons.push(`Benchmark ${benchmark.benchmarkId} added too much latency for canary.`);
    }
  }

  // Cert-reference band-agreement gate. Required for canary/production.
  if (targetStatus !== "staging") {
    if (!options.certEval) {
      reasons.push(
        "Canary or production promotion requires a cert-reference eval (CertEvalResult). Run `pnpm eval:certrefs:bands` and pass the result.",
      );
    } else {
      const gate = evaluateCertEvalPromotionGate({
        candidate: options.certEval.candidateResult,
        baseline: options.certEval.baselineResult,
      });
      if (!gate.allowed) {
        for (const reason of gate.reasons) {
          reasons.push(`Cert-reference gate: ${reason}`);
        }
      }
    }
  }

  return {
    allowed: reasons.length === 0,
    targetStatus,
    reasons: reasons.length > 0 ? reasons : ["All promotion gates passed."],
  };
}

export function summarizeSkillCandidate(candidate: InspectionSkillCandidate) {
  return {
    id: candidate.skillId,
    title: candidate.title,
    status: candidate.status,
    toolCount: candidate.steps.length,
    tools: candidate.steps.map((step) => step.tool),
    canShareAcrossUsers:
      candidate.evidencePolicy.sharesAcrossUsers &&
      (candidate.consentScope === "anonymized_method_stats" || candidate.consentScope === "shared_training_opt_in") &&
      !candidate.evidencePolicy.storesRawUserImages,
  };
}
