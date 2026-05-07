import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createInspectionSkillCandidate,
  evaluateSkillPromotion,
  summarizeSkillCandidate,
  type InspectionSkillBenchmarkResult,
} from "../../apps/web/lib/agent/inspection-skill-evolution";
import type { CertEvalResult } from "../../apps/web/lib/cert-references-eval";

const writeReport = !process.argv.includes("--check");

const holoGlareCandidate = createInspectionSkillCandidate({
  skillId: "holo_glare_reinspect_v1",
  title: "Holo glare reinspection",
  trigger: {
    finishType: "holo",
    maxConfidence: 0.65,
    minGlareScore: 0.35,
    userQuestionIntent: "scratch_vs_glare",
  },
  steps: [
    { tool: "crop_region", purpose: "Isolate the suspicious reflective area.", region: "surface" },
    { tool: "zoom_region", purpose: "Magnify the region for detector and user review.", region: "surface" },
    { tool: "run_glare_check", purpose: "Separate glare evidence from material damage.", region: "surface" },
    { tool: "run_ding_detector", purpose: "Re-run the detector on the zoomed crop.", region: "surface" },
    { tool: "explain_uncertainty", purpose: "Explain whether the result supports scratch, glare, or retake." },
  ],
  consentScope: "anonymized_method_stats",
  storesDerivedCrops: true,
  sharesAcrossUsers: true,
});

const passingBenchmark: InspectionSkillBenchmarkResult = {
  benchmarkId: "holo-glare-fixtures-v1",
  datasetVersion: "ccv-alpha-fixtures-20260506",
  precisionDelta: 0.12,
  recallDelta: 0.03,
  falsePositiveDelta: -0.18,
  latencyAddedMs: 420,
  agentClaimsWithoutToolEvidence: 0,
  officialGradeClaims: 0,
  privacyViolations: 0,
  passed: true,
};

const unsafeCandidate = {
  ...holoGlareCandidate,
  skillId: "unsafe_raw_image_memory_v1",
  title: "Unsafe raw image memory",
  evidencePolicy: {
    ...holoGlareCandidate.evidencePolicy,
    storesRawUserImages: true,
    sharesAcrossUsers: true,
  },
  consentScope: "private_user_memory" as const,
};

// Synthetic cert-eval result that satisfies the cert-reference promotion gate
// (5 of 5 covered, all matched). Used to keep this skill-evolution test focused
// on the evolution-specific gates; cert-reference logic has its own dedicated
// eval at scripts/eval/eval_cert_band_agreement.mjs.
const passingCertEval: CertEvalResult = {
  modelVersion: "fixture-cert-eval-v1",
  evaluatedAt: new Date().toISOString(),
  totals: {
    references: 5,
    predictionsCovered: 5,
    matched: 5,
    adjacent: 0,
    mismatched: 0,
    skipped: 0,
    silverPlusCovered: 4,
    silverPlusMatched: 4,
    silverCovered: 1,
    silverMatched: 1,
  },
  rows: [],
  notes: ["Synthetic cert-eval fixture for the evolution QA — every prediction matches."],
};

const decisions = {
  draftToStaging: evaluateSkillPromotion(holoGlareCandidate, [], "staging"),
  stagingToCanary: evaluateSkillPromotion(holoGlareCandidate, [passingBenchmark], "canary", {
    certEval: { candidateResult: passingCertEval },
  }),
  productionWithoutHuman: evaluateSkillPromotion(holoGlareCandidate, [passingBenchmark], "production", {
    certEval: { candidateResult: passingCertEval },
  }),
  productionWithHuman: evaluateSkillPromotion(holoGlareCandidate, [passingBenchmark], "production", {
    humanApproved: true,
    certEval: { candidateResult: passingCertEval },
  }),
  unsafeSharedMemory: evaluateSkillPromotion(unsafeCandidate, [passingBenchmark], "canary", {
    certEval: { candidateResult: passingCertEval },
  }),
  // Negative cert-eval test — show the new gate actually blocks promotion.
  canaryWithoutCertEval: evaluateSkillPromotion(holoGlareCandidate, [passingBenchmark], "canary"),
};

const failures: string[] = [];
if (!decisions.draftToStaging.allowed) failures.push("Safe draft should be allowed into staging.");
if (!decisions.stagingToCanary.allowed) failures.push("Safe benchmarked candidate should be allowed into canary.");
if (decisions.productionWithoutHuman.allowed) failures.push("Production promotion must require human approval.");
if (!decisions.productionWithHuman.allowed) failures.push("Human-approved production promotion should pass.");
if (decisions.unsafeSharedMemory.allowed) failures.push("Unsafe raw-image sharing candidate must be blocked.");
if (decisions.canaryWithoutCertEval.allowed) failures.push("Canary without cert-reference eval must be blocked.");

const report = `# Inspection Skill Evolution QA

Generated: ${new Date().toISOString()}

## Candidate

\`\`\`json
${JSON.stringify(summarizeSkillCandidate(holoGlareCandidate), null, 2)}
\`\`\`

## Benchmark Fixture

\`\`\`json
${JSON.stringify(passingBenchmark, null, 2)}
\`\`\`

## Promotion Decisions

\`\`\`json
${JSON.stringify(decisions, null, 2)}
\`\`\`

## Result

${failures.length === 0 ? "PASS - controlled inspection skill evolution gates are working." : `FAIL\n\n- ${failures.join("\n- ")}`}
`;

if (writeReport) {
  const outPath = resolve("docs/qa/INSPECTION_SKILL_EVOLUTION_REPORT.md");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report);
}

if (failures.length > 0) {
  throw new Error(failures.join(" "));
}

console.log("Inspection skill evolution QA passed.");
