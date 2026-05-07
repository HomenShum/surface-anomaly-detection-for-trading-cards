#!/usr/bin/env node
// Consolidated visible-condition assistance proof harness.
//
// This is not a grading-accuracy gate. It stitches together the evidence we
// can honestly prove today:
//   - open DING dataset integrity
//   - real DING model training/eval metadata
//   - certified-reference outcome comparison status
//   - pi-ai/OpenAI-style agent tool surface + deterministic LLM-judge eval
//   - evidence manifest/hash completeness from replayable proof traces
//   - release-mode gates that keep alpha/production blocked when data is absent
//
// Outputs:
//   docs/proof/VISIBLE_CONDITION_ASSISTANCE_REPORT.md
//   docs/proof/model_metrics.json
//   docs/proof/agent_eval.json
//   docs/proof/example_gallery.json
//   docs/proof/failure_cases.json
//   data/proof/visible-condition/latest.json

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadAllRefs, readJson, repoRoot, summarizeRefs, writeJson } from "../certs/cert_reference_lib.mjs";

const args = parseArgs(process.argv.slice(2));
const root = repoRoot();
const docsDir = join(root, "docs", "proof");
const dataDir = join(root, "data", "proof", "visible-condition");
const certDir = join(root, "data", "cert-references");
const certBenchDir = join(root, "data", "benchmarks", "cert_refs");

for (const dir of [docsDir, dataDir]) mkdirSync(dir, { recursive: true });

const commandResults = args.skipRunners ? [] : runProofRunners();

const refs = loadAllRefs();
const refSummary = summarizeRefs(refs);
const datasetAudit = readJson(join(root, "ml", "datasets", "manifests", "roboflow_alpha_manifest.audit.json"), null);
const modelMetrics = readJson(join(root, "services", "inference-api", "app", "models", "ding-detector-v0.metrics.json"), null);
const yoloEval = readJson(join(root, "ml", "runs", "eval_yolo_test_report.json"), null);
const certEval = readJson(join(certDir, "eval-report.json"), null);
const bandEval = readJson(join(certBenchDir, "latest.json"), null);
const agenticAnnotationEval = readJson(join(root, "data", "benchmarks", "agentic_annotations", "latest.json"), null);
const agentEval = readJson(join(certDir, "agentic-eval", "latest.json"), null);
const outcomeProof = readJson(join(certDir, "outcome-proof", "latest.json"), null);
const productionReadiness = readJson(join(certDir, "production-readiness", "latest.json"), null);
const gifManifest = readJson(join(root, "public", "demo", "gifs", "manifest.json"), null);

const openDatasetSummary = summarizeOpenDatasets(datasetAudit);
const imageEvidence = summarizeImageEvidence(refs);
const humanReview = summarizeHumanReview(refs);
const evidenceProof = summarizeEvidenceProof(outcomeProof);
const exampleGallery = buildExampleGallery({ refs, gifManifest, outcomeProof });
const failureCases = buildFailureCases({ productionReadiness, agentEval, bandEval });
const gates = buildGates({
  refSummary,
  datasetAudit,
  modelMetrics,
  yoloEval,
  certEval,
  bandEval,
  agenticAnnotationEval,
  agentEval,
  outcomeProof,
  productionReadiness,
  imageEvidence,
  humanReview,
  evidenceProof,
  gifManifest,
});

const release = {
  demoVisibleConditionAssistance: gates.demo.every((gate) => gate.passed),
  vendorPilotAlpha: gates.vendorPilot.every((gate) => gate.passed),
  customerAlpha: gates.customerAlpha.every((gate) => gate.passed),
  productionTrustBeta: gates.production.every((gate) => gate.passed),
};

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  claim: {
    provedNow:
      "AI-assisted visible condition detection demo: real model metadata, open DING dataset audit, DING annotation UI, agent tool-surface checks, and evidence-hash traces are present.",
    notProvedYet: [
      "PSA/TAG/CGC/BGS-equivalent grading",
      "production certified-reference outcome accuracy",
      "Gold raw pre-submission scan alignment",
      "human DING review agreement",
      "authenticity, market value, or legal guarantee",
    ],
  },
  commandResults,
  release,
  gates,
  openDatasetSummary,
  model: summarizeModel({ modelMetrics, yoloEval }),
  certifiedReferences: {
    summary: refSummary,
    imageEvidence,
    humanReview,
    certEvalSummary: certEval?.summary ?? null,
    bandEvalTotals: bandEval?.totals ?? null,
    releaseModes: productionReadiness?.releaseModes ?? null,
  },
  agent: summarizeAgent(agentEval),
  agenticAnnotations: summarizeAgenticAnnotations(agenticAnnotationEval),
  llmJudge: summarizeLlmJudge(agentEval),
  evidence: evidenceProof,
  examples: exampleGallery,
  failures: failureCases,
  artifacts: {
    markdown: "docs/proof/VISIBLE_CONDITION_ASSISTANCE_REPORT.md",
    modelMetrics: "docs/proof/model_metrics.json",
    agentEval: "docs/proof/agent_eval.json",
    agenticAnnotationEval: "data/benchmarks/agentic_annotations/latest.json",
    exampleGallery: "docs/proof/example_gallery.json",
    failureCases: "docs/proof/failure_cases.json",
    latestJson: "data/proof/visible-condition/latest.json",
  },
  nextActions: [
    "Attach 20 user/vendor-permitted local slab/front/back images to declared Silver+ references.",
    "Run pnpm eval:certrefs:run after local reference images are attached.",
    "Collect at least 10 human DING reviews for Vendor Pilot Alpha; 30+ for Production Trust Beta.",
    "Create Gold records from raw pre-submission scans plus returned official outcomes and human DING review.",
    "Keep agent claims grounded to tool/model/evidence outputs and continue using the LLM-judge replay prompts.",
  ],
};

writeJson(join(dataDir, "latest.json"), report);
writeJson(join(dataDir, `${report.generatedAt.replace(/[:.]/g, "-")}.json`), report);
writeJson(join(docsDir, "model_metrics.json"), report.model);
writeJson(join(docsDir, "agent_eval.json"), {
  agent: report.agent,
  llmJudge: report.llmJudge,
  gates: agentEval?.gates ?? [],
  rowsNeedingReview: agentEval?.totals?.needsReview ?? null,
  judgePromptsPath: "data/cert-references/agentic-eval/latest.judge-prompts.jsonl",
});
writeJson(join(docsDir, "example_gallery.json"), report.examples);
writeJson(join(docsDir, "failure_cases.json"), report.failures);
writeFileSync(join(docsDir, "VISIBLE_CONDITION_ASSISTANCE_REPORT.md"), renderMarkdown(report), "utf-8");

const selectedMode = args.mode ?? "demo";
const selectedOk =
  selectedMode === "production"
    ? release.productionTrustBeta
    : selectedMode === "customer-alpha"
      ? release.customerAlpha
      : selectedMode === "vendor-alpha"
        ? release.vendorPilotAlpha
        : release.demoVisibleConditionAssistance;

console.log(JSON.stringify({
  ok: selectedOk,
  mode: selectedMode,
  release,
  reportPath: join(docsDir, "VISIBLE_CONDITION_ASSISTANCE_REPORT.md"),
  latestJson: join(dataDir, "latest.json"),
  blockers: blockingReasonsForMode(report, selectedMode),
}, null, 2));

if (args.strict && !selectedOk) process.exit(1);

function parseArgs(argv) {
  const out = { strict: false, skipRunners: false, mode: "demo" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--strict") out.strict = true;
    else if (arg === "--skip-runners") out.skipRunners = true;
    else if (arg === "--mode" && argv[i + 1]) out.mode = argv[++i];
    else if (arg.startsWith("--mode=")) out.mode = arg.slice("--mode=".length);
  }
  return out;
}

function runProofRunners() {
  const runners = [
    ["cert_reference_eval", ["scripts/eval/eval_certrefs.mjs"]],
    ["cert_band_agreement", ["scripts/eval/eval_cert_band_agreement.mjs"]],
    ["agentic_cert_eval", ["scripts/eval/agentic_cert_eval_runner.mjs", "--check"]],
    ["production_readiness", ["scripts/eval/production_accuracy_gate.mjs"]],
  ];
  return runners.map(([id, nodeArgs]) => {
    const result = spawnSync(process.execPath, nodeArgs, {
      cwd: root,
      encoding: "utf-8",
      windowsHide: true,
    });
    return {
      id,
      command: `node ${nodeArgs.join(" ")}`,
      status: result.status,
      ok: result.status === 0,
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
    };
  });
}

function tail(text = "", max = 1400) {
  const normalized = String(text).trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(normalized.length - max);
}

function summarizeOpenDatasets(datasetAudit) {
  if (!datasetAudit) {
    return {
      present: false,
      verified: false,
      blocker: "Missing ml/datasets/manifests/roboflow_alpha_manifest.audit.json.",
    };
  }
  return {
    present: true,
    verified: datasetAudit.status === "verified" && datasetAudit.license_status === "verified",
    records: datasetAudit.records ?? 0,
    splits: datasetAudit.splits ?? {},
    sources: datasetAudit.sources ?? {},
    classes: datasetAudit.classes ?? {},
    manifest: datasetAudit.manifest ?? null,
    manifestSha256: datasetAudit.manifest_sha256 ?? null,
    usage: "Open DING detector bootstrap only; not official grade proof.",
  };
}

function summarizeModel({ modelMetrics, yoloEval }) {
  const metrics = modelMetrics?.metrics ?? {};
  return {
    modelVersion: modelMetrics?.model_version ?? yoloEval?.modelVersion ?? "unknown",
    trainingRunId: modelMetrics?.training_run_id ?? null,
    weightsSha256: modelMetrics?.weights_sha256 ?? null,
    datasetManifest: modelMetrics?.dataset_manifest ?? yoloEval?.dataset ?? null,
    datasetManifestSha256: modelMetrics?.dataset_manifest_sha256 ?? null,
    sourceDatasets: modelMetrics?.source_datasets ?? [],
    yolo: {
      mAP50: numberOrNull(metrics.mAP50),
      mAP50_95: numberOrNull(metrics.mAP50_95),
      precision: numberOrNull(metrics.precision),
      recall: numberOrNull(metrics.recall),
    },
    baselines: {
      randomDetectorF1: numberOrNull(yoloEval?.baselines?.random_detector?.overall?.f1),
      classPriorF1: numberOrNull(yoloEval?.baselines?.class_prior_regions?.overall?.f1),
    },
    proofUse:
      "Shows a real alpha DING detector exists and beats empty/random demo logic. Does not prove official grading accuracy.",
  };
}

function summarizeImageEvidence(refs) {
  const replayable = refs.filter((ref) => hasReplayableImage(ref));
  const silverPlusReplayable = refs.filter((ref) => ref.trustTier === "silver_plus" && hasReplayableImage(ref));
  const declaredSilverPlusMissing = refs.filter((ref) => ref.trustTier === "silver_plus" && ref.hasFrontBackSlabImages && !hasReplayableImage(ref));
  return {
    replayableRefs: replayable.length,
    silverPlusReplayable: silverPlusReplayable.length,
    declaredSilverPlusMissing: declaredSilverPlusMissing.length,
    missingExamples: declaredSilverPlusMissing.slice(0, 12).map((ref) => ({
      id: ref.id,
      provider: ref.provider,
      certNumber: ref.certNumber,
      cardIdentity: ref.cardIdentity,
      nextAction: `Attach permitted front/back images under data/cert-references/slab-images/${ref.id}/.`,
    })),
  };
}

function hasReplayableImage(ref) {
  if (!ref?.id) return false;
  const dir = join(certDir, "slab-images", ref.id);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((name) => {
    const path = join(dir, name);
    if (!statSync(path).isFile()) return false;
    return /\.(png|jpe?g|webp)$/i.test(name);
  });
}

function summarizeHumanReview(refs) {
  const reviewed = refs.filter((ref) => Boolean(ref.humanDingReview || ref.trustTier === "gold"));
  const gold = refs.filter((ref) => ref.trustTier === "gold" || ref.trustTier === "gold_candidate");
  return {
    humanDingReviews: reviewed.length,
    goldOrCandidateRecords: gold.length,
    reviewedExamples: reviewed.slice(0, 10).map((ref) => ({
      id: ref.id,
      dingCount: ref.humanDingReview?.dingCount ?? null,
      reviewedAt: ref.humanDingReview?.reviewedAt ?? null,
    })),
  };
}

function summarizeAgent(agentEval) {
  const totals = agentEval?.totals ?? {};
  return {
    judgeMode: agentEval?.judgeMode ?? "missing",
    deployable: Boolean(agentEval?.deployable),
    references: totals.references ?? 0,
    realPredictions: totals.realPredictions ?? 0,
    replayableImageRefs: totals.replayableImageRefs ?? 0,
    needsReview: totals.needsReview ?? 0,
    averageScores: totals.averageScores ?? {},
    failureBuckets: totals.failureBuckets ?? {},
    toolSurface: agentEval?.toolSurface ?? null,
  };
}

function summarizeAgenticAnnotations(report) {
  const multimodel = report?.summaries?.c_multimodel_agent_reinspection;
  const human = report?.summaries?.d_human_review_oracle;
  return {
    present: Boolean(report),
    deployable: Boolean(report?.deployable),
    fixtureCount: report?.fixtureCount ?? 0,
    multimodelAgent: multimodel
      ? {
          precision: multimodel.metrics?.overall?.precision ?? null,
          recall: multimodel.metrics?.overall?.recall ?? null,
          f1: multimodel.metrics?.overall?.f1 ?? null,
          cleanCardFalsePositiveRate: multimodel.metrics?.cleanCardFalsePositiveRate ?? null,
          holoGlareFalsePositiveRate: multimodel.metrics?.holoGlareFalsePositiveRate ?? null,
          claimGroundedRate: multimodel.agent?.claimGroundedRate ?? null,
          hallucinatedDingRate: multimodel.agent?.hallucinatedDingRate ?? null,
          officialGradeClaimViolations: multimodel.agent?.officialGradeClaimViolations ?? null,
          latencyMs: multimodel.latencyMs ?? null,
          estimatedCostUsd: multimodel.estimatedCostUsd ?? null,
        }
      : null,
    humanReviewOracle: human
      ? {
          precision: human.metrics?.overall?.precision ?? null,
          recall: human.metrics?.overall?.recall ?? null,
          f1: human.metrics?.overall?.f1 ?? null,
        }
      : null,
  };
}

function summarizeLlmJudge(agentEval) {
  const scores = agentEval?.totals?.averageScores ?? {};
  return {
    mode: agentEval?.judgeMode ?? "deterministic_llm_judge_fallback_missing",
    rubric: "System-level judge over ML, agent, calibration, trust, UX, and evidence layers.",
    grounding: numberOrNull(scores.grounding),
    toolCoverage: numberOrNull(scores.toolCoverage),
    calibration: numberOrNull(scores.calibration),
    evidence: numberOrNull(scores.evidence),
    trustSafety: numberOrNull(scores.trustSafety),
    promptArtifact: "data/cert-references/agentic-eval/latest.judge-prompts.jsonl",
    note: "The current judge is deterministic/local so it is replayable without paid LLM calls; the prompt artifact can be sent through pi-ai/OpenAI later.",
  };
}

function summarizeEvidenceProof(outcomeProof) {
  const traces = Array.isArray(outcomeProof?.traces) ? outcomeProof.traces : [];
  const imageArtifacts = traces.flatMap((trace) => trace.remoteImageArtifacts ?? []);
  const completeImages = imageArtifacts.filter((artifact) => artifact.ok && isSha256(artifact.sha256));
  const findings = traces.flatMap((trace) => trace.findings ?? []);
  const findingsWithSha = findings.filter((finding) => isSha256(finding.sha256));
  return {
    present: Boolean(outcomeProof),
    source: outcomeProof?.source ?? null,
    realInferenceRows: outcomeProof?.summary?.realInferenceRows ?? 0,
    proofEligibleMatches: outcomeProof?.summary?.proofEligibleMatches ?? 0,
    productionDeployable: Boolean(outcomeProof?.productionDeployable),
    imageArtifacts: imageArtifacts.length,
    completeImageArtifacts: completeImages.length,
    findings: findings.length,
    findingsWithSha256: findingsWithSha.length,
    modelMetadata: outcomeProof?.modelMetadata ?? null,
    gates: outcomeProof?.gates ?? [],
  };
}

function buildExampleGallery({ refs, gifManifest, outcomeProof }) {
  const certifiedExamples = refs.slice(0, 12).map((ref) => ({
    id: ref.id,
    provider: ref.provider,
    certNumber: ref.certNumber,
    trustTier: ref.trustTier,
    officialGrade: ref.officialGrade ?? null,
    cardIdentity: ref.cardIdentity ?? null,
    replayableImage: hasReplayableImage(ref),
    goldEligible: ref.trustTier === "gold" || ref.trustTier === "gold_candidate",
  }));
  const gifs = (gifManifest?.gifs ?? [])
    .filter((gif) => /ding|outcome|certified|compare/i.test(`${gif.file} ${gif.label} ${gif.description}`))
    .map((gif) => ({
      file: gif.file,
      label: gif.label,
      description: gif.description,
      loop: gif.loop ?? "unspecified",
    }));
  return {
    certifiedExamples,
    realDingDemo: {
      route: "/examples/roboflow-tauros-real-ding-annotations",
      desktopGif: "public/demo/gifs/real-ding-annotations-tauros-card-desktop.gif",
      mobileGif: "public/demo/gifs/real-ding-annotations-tauros-card-mobile.gif",
      note: "Real-card/open-dataset fixture with visible DING labels. Not an official cert outcome.",
    },
    outcomeProofExamples: (outcomeProof?.traces ?? []).map((trace) => ({
      certId: trace.certId,
      officialGrade: trace.officialGrade,
      predictedBand: trace.predictedBand,
      bandAgreement: trace.bandAgreement,
      realImagePresent: trace.realImagePresent,
      inferenceIsSimulated: trace.inferenceIsSimulated,
    })),
    shareableGifs: gifs,
  };
}

function buildFailureCases({ productionReadiness, agentEval, bandEval }) {
  const issues = productionReadiness?.issues ?? [];
  const rows = Array.isArray(agentEval?.rows) ? agentEval.rows : [];
  const bandRows = Array.isArray(bandEval?.rows) ? bandEval.rows : [];
  return {
    blockers: issues.slice(0, 30).map((issue) => ({
      id: issue.id,
      severity: issue.severity,
      layer: issue.layer,
      title: issue.title,
      detail: issue.detail,
      nextAction: issue.nextAction,
    })),
    agentFailureBuckets: agentEval?.totals?.failureBuckets ?? {},
    agentReviewQueue: rows
      .filter((row) => row.verdict !== "pass" && row.needsHumanReview)
      .slice(0, 20)
      .map((row) => ({
        certId: row.certId,
        provider: row.provider,
        officialGrade: row.officialGrade,
        predictedBand: row.predictedBand,
        failureBucket: row.failureBucket,
        verdict: row.verdict,
        nextActions: row.nextActions,
      })),
    unevaluatedCertifiedRefs: bandRows
      .filter((row) => !row.predictedBand)
      .slice(0, 20)
      .map((row) => ({
        certId: row.certId,
        officialGrade: row.officialGrade,
        officialBand: row.officialBand,
        notes: row.notes,
      })),
  };
}

function buildGates({
  refSummary,
  datasetAudit,
  modelMetrics,
  yoloEval,
  agenticAnnotationEval,
  agentEval,
  outcomeProof,
  productionReadiness,
  imageEvidence,
  humanReview,
  evidenceProof,
  gifManifest,
}) {
  const base = [
    gate("open_ding_dataset_verified", "Open DING dataset audit is verified", datasetAudit?.status === "verified", `${datasetAudit?.records ?? 0} records.`),
    gate(
      "real_ding_model_metadata",
      "Real DING model metadata exists",
      Boolean(modelMetrics?.weights_sha256 && modelMetrics?.model_version),
      `model=${modelMetrics?.model_version ?? "missing"}.`,
    ),
    gate(
      "model_eval_measured",
      "YOLO detector metrics are measured",
      typeof modelMetrics?.metrics?.mAP50 === "number" && typeof modelMetrics?.metrics?.recall === "number",
      `mAP50=${modelMetrics?.metrics?.mAP50 ?? "n/a"} recall=${modelMetrics?.metrics?.recall ?? "n/a"}.`,
    ),
    gate(
      "baseline_sanity_present",
      "Random/class-prior baselines exist",
      typeof yoloEval?.baselines?.random_detector?.overall?.f1 === "number" &&
        typeof yoloEval?.baselines?.class_prior_regions?.overall?.f1 === "number",
      "Baseline sanity checks are present in ml/runs/eval_yolo_test_report.json.",
    ),
    gate("cert_refs_loaded", "Certified references are loaded", refSummary.total >= 20, `${refSummary.total}/20 references.`),
    gate(
      "external_refs_not_training",
      "External certified references are not training data",
      refSummary.trainingViolations === 0,
      `${refSummary.trainingViolations} training-policy violations.`,
    ),
    gate(
      "tag_no_bulk_scrape",
      "TAG references remain link-only/no-bulk-scrape",
      refSummary.tagBulkScrapeViolations === 0,
      `${refSummary.tagBulkScrapeViolations} TAG policy violations.`,
    ),
    gate(
      "agent_tool_surface_complete",
      "Agent tool surface covers inspection workflow",
      (agentEval?.toolSurface?.missingRequired ?? []).length === 0,
      `${(agentEval?.toolSurface?.missingRequired ?? []).length} promotion-required tools missing.`,
    ),
    gate(
      "agentic_annotation_eval_passes",
      "Agentic annotation fixture eval passes",
      Boolean(agenticAnnotationEval?.deployable),
      agenticAnnotationEval
        ? `C precision=${agenticAnnotationEval.summaries?.c_multimodel_agent_reinspection?.metrics?.overall?.precision ?? "n/a"} grounding=${agenticAnnotationEval.summaries?.c_multimodel_agent_reinspection?.agent?.claimGroundedRate ?? "n/a"}.`
        : "Run pnpm eval:agentic-annotations.",
    ),
    gate(
      "agent_trust_safety",
      "Agent judge did not detect official-grade claim failures",
      (agentEval?.totals?.averageScores?.trustSafety ?? 0) >= 1,
      `trustSafety=${agentEval?.totals?.averageScores?.trustSafety ?? "n/a"}.`,
    ),
    gate(
      "real_ding_gifs_looping",
      "Shareable real-DING GIFs exist and loop",
      Boolean((gifManifest?.gifs ?? []).some((gif) => gif.file?.includes("real-ding-annotations") && gif.loop === "infinite")),
      "Manifest includes real-ding-annotations GIF entries with loop=infinite.",
    ),
    gate(
      "evidence_hash_trace_present",
      "Evidence proof includes SHA-256 image artifacts",
      evidenceProof.completeImageArtifacts > 0 && isSha256(evidenceProof.modelMetadata?.weights_sha256),
      `${evidenceProof.completeImageArtifacts} complete image artifact(s); model hash present=${isSha256(evidenceProof.modelMetadata?.weights_sha256)}.`,
    ),
  ];

  const vendorPilot = [
    ...base,
    gate(
      "image_backed_silver_plus_20",
      "20 image-backed Silver+ references are replayable",
      imageEvidence.silverPlusReplayable >= 20,
      `${imageEvidence.silverPlusReplayable}/20 image-backed Silver+ refs.`,
    ),
    gate("human_ding_reviews_10", "10 human DING reviews exist", humanReview.humanDingReviews >= 10, `${humanReview.humanDingReviews}/10 reviews.`),
    gate(
      "agent_grounding_floor",
      "Agent LLM-judge grounding is vendor-alpha ready",
      (agentEval?.totals?.averageScores?.grounding ?? 0) >= 0.8,
      `grounding=${agentEval?.totals?.averageScores?.grounding ?? "n/a"}.`,
    ),
    gate(
      "cert_alpha_gate",
      "Certified Reference Alpha release mode passes",
      Boolean(productionReadiness?.certifiedReferenceAlphaDeployable),
      productionReadiness?.releaseModes?.certified_reference_alpha?.blockingReasons?.join("; ") || "passed",
    ),
  ];

  const customerAlpha = [
    ...vendorPilot,
    gate(
      "human_ding_reviews_20",
      "20 human DING reviews exist",
      humanReview.humanDingReviews >= 20,
      `${humanReview.humanDingReviews}/20 reviews.`,
    ),
    gate(
      "image_backed_silver_plus_50",
      "50 image-backed references exist",
      imageEvidence.silverPlusReplayable >= 50,
      `${imageEvidence.silverPlusReplayable}/50 image-backed refs.`,
    ),
  ];

  const production = [
    ...customerAlpha,
    gate(
      "production_gate",
      "Production Trust Gate passes",
      Boolean(productionReadiness?.productionDeployable),
      productionReadiness?.releaseModes?.production?.blockingReasons?.join("; ") || "passed",
    ),
  ];

  return {
    demo: base,
    vendorPilot,
    customerAlpha,
    production,
  };
}

function gate(id, label, passed, detail) {
  return { id, label, passed: Boolean(passed), detail };
}

function blockingReasonsForMode(report, mode) {
  const list =
    mode === "production"
      ? report.gates.production
      : mode === "customer-alpha"
        ? report.gates.customerAlpha
        : mode === "vendor-alpha"
          ? report.gates.vendorPilot
          : report.gates.demo;
  return list.filter((gate) => !gate.passed).map((gate) => `${gate.id}: ${gate.detail}`);
}

function renderMarkdown(report) {
  const lines = [
    "# Visible Condition Assistance Proof",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Claim",
    "",
    `**Proved now:** ${report.claim.provedNow}`,
    "",
    "**Not proved yet:**",
    "",
    ...report.claim.notProvedYet.map((item) => `- ${item}`),
    "",
    "## Release State",
    "",
    "| Mode | Status |",
    "| --- | --- |",
    `| Demo visible-condition assistance | ${status(report.release.demoVisibleConditionAssistance)} |`,
    `| Vendor Pilot Alpha | ${status(report.release.vendorPilotAlpha)} |`,
    `| Customer Alpha | ${status(report.release.customerAlpha)} |`,
    `| Production Trust Beta | ${status(report.release.productionTrustBeta)} |`,
    "",
    "## Dataset + Model",
    "",
    `- Open DING records: ${report.openDatasetSummary.records ?? 0}`,
    `- Dataset manifest hash: ${report.openDatasetSummary.manifestSha256 ?? "missing"}`,
    `- Model: ${report.model.modelVersion}`,
    `- Training run: ${report.model.trainingRunId ?? "missing"}`,
    `- Weights SHA-256: ${report.model.weightsSha256 ?? "missing"}`,
    `- mAP@50: ${formatMetric(report.model.yolo.mAP50)}`,
    `- mAP@50-95: ${formatMetric(report.model.yolo.mAP50_95)}`,
    `- Precision: ${formatMetric(report.model.yolo.precision)}`,
    `- Recall: ${formatMetric(report.model.yolo.recall)}`,
    "",
    "## Certified References",
    "",
    `- Total references: ${report.certifiedReferences.summary.total}`,
    `- Silver+: ${report.certifiedReferences.summary.silverPlus}`,
    `- Replayable Silver+ images: ${report.certifiedReferences.imageEvidence.silverPlusReplayable}`,
    `- Gold/gold-candidate records: ${report.certifiedReferences.humanReview.goldOrCandidateRecords}`,
    `- Human DING reviews: ${report.certifiedReferences.humanReview.humanDingReviews}`,
    "",
    "## Agent + LLM Judge",
    "",
    `- Judge mode: ${report.llmJudge.mode}`,
    `- Tool coverage: ${formatMetric(report.llmJudge.toolCoverage)}`,
    `- Grounding: ${formatMetric(report.llmJudge.grounding)}`,
    `- Evidence: ${formatMetric(report.llmJudge.evidence)}`,
    `- Trust safety: ${formatMetric(report.llmJudge.trustSafety)}`,
    `- Rows needing review: ${report.agent.needsReview}`,
    `- Agentic annotation eval: ${report.agenticAnnotations.deployable ? "pass" : "blocked/missing"}`,
    `- Multimodel annotation precision: ${formatMetric(report.agenticAnnotations.multimodelAgent?.precision)}`,
    `- Multimodel annotation recall: ${formatMetric(report.agenticAnnotations.multimodelAgent?.recall)}`,
    `- Multimodel claim grounding: ${formatMetric(report.agenticAnnotations.multimodelAgent?.claimGroundedRate)}`,
    `- Multimodel hallucinated DING rate: ${formatMetric(report.agenticAnnotations.multimodelAgent?.hallucinatedDingRate)}`,
    "",
    "## Evidence Trace",
    "",
    `- Real inference rows: ${report.evidence.realInferenceRows}`,
    `- Proof-eligible matches: ${report.evidence.proofEligibleMatches}`,
    `- Complete image SHA-256 artifacts: ${report.evidence.completeImageArtifacts}/${report.evidence.imageArtifacts}`,
    `- Findings with SHA-256: ${report.evidence.findingsWithSha256}/${report.evidence.findings}`,
    "",
    "## Demo Proof Gates",
    "",
    ...renderGateTable(report.gates.demo),
    "",
    "## Vendor Pilot Blockers",
    "",
    ...renderGateTable(report.gates.vendorPilot.filter((gate) => !gate.passed)),
    "",
    "## Top Failure Cases",
    "",
    "| Layer | Issue | Next action |",
    "| --- | --- | --- |",
    ...report.failures.blockers.slice(0, 12).map((item) => `| ${escapeCell(item.layer)} | ${escapeCell(item.title)} | ${escapeCell(item.nextAction)} |`),
    "",
    "## Shareable Proof Examples",
    "",
    `- Real DING desktop GIF: \`${report.examples.realDingDemo.desktopGif}\``,
    `- Real DING mobile GIF: \`${report.examples.realDingDemo.mobileGif}\``,
    `- Example route: \`${report.examples.realDingDemo.route}\``,
    "",
    "## Next Actions",
    "",
    ...report.nextActions.map((item) => `- ${item}`),
    "",
  ];
  return lines.join("\n");
}

function renderGateTable(gates) {
  if (gates.length === 0) return ["No blocking gates."];
  return [
    "| Gate | Status | Detail |",
    "| --- | --- | --- |",
    ...gates.map((gate) => `| ${escapeCell(gate.label)} | ${gate.passed ? "PASS" : "BLOCKED"} | ${escapeCell(gate.detail)} |`),
  ];
}

function status(value) {
  return value ? "PASS" : "BLOCKED";
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatMetric(value) {
  return typeof value === "number" ? value.toFixed(3) : "n/a";
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function sha256File(path) {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
