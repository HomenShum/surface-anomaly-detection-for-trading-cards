#!/usr/bin/env node
// Production accuracy readiness gate for certified-reference outcome matching.
//
// This gate is stricter than the demo proof. It combines:
//   - active cert-reference predictions
//   - real remote image-backed proof rows
//   - agentic system eval / local judge output
//   - local replayable image coverage
//   - Gold/human-DING coverage
// and writes a structured issue register. It is intentionally allowed to pass
// with "productionDeployable: false" so the repo can record blockers without
// pretending MVP evidence is production accuracy.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gradeToBand, loadAllRefs, readJson, repoRoot, writeJson } from "../certs/cert_reference_lib.mjs";

const THRESHOLDS = {
  minRealOutcomeRows: 100,
  minGoldRefs: 30,
  minHumanDingReviews: 30,
  minRealBandMatchRate: 0.8,
  minOfficialBandCoverage: 4,
  minImageBackedSilverPlusRefs: 100,
};

const TRUST_BETA_THRESHOLDS = {
  minRealOutcomeRows: 30,
  minGoldRefs: 10,
  minHumanDingReviews: 10,
  minRealBandMatchRate: 0.75,
  minOfficialBandCoverage: 4,
  minImageBackedSilverPlusRefs: 20,
};

const ALPHA_THRESHOLDS = {
  minCertifiedRefs: 20,
  minImageBackedSilverPlusRefs: 20,
  minRealModelRows: 1,
};

const REQUIRED_PROMOTION_TOOLS = [
  "detect_card_boundary",
  "normalize_card",
  "run_severity_scorer",
];

const args = parseArgs(process.argv.slice(2));
const root = repoRoot();
const certDir = join(root, "data", "cert-references");
const outDir = join(certDir, "production-readiness");
const docsPath = join(root, "docs", "qa", "PRODUCTION_ACCURACY_READINESS.md");
const predictionsPath = join(certDir, "predictions.json");
const proofPath = join(certDir, "outcome-proof", "latest.json");
const agenticPath = join(certDir, "agentic-eval", "latest.json");
const slabRoot = join(certDir, "slab-images");

for (const dir of [outDir, join(root, "docs", "qa")]) mkdirSync(dir, { recursive: true });

if (args.check) {
  const latest = readJson(join(outDir, "latest.json"), null);
  const selected = normalizeMode(args.mode);
  const selectedMode = latest?.releaseModes?.[selected] ?? null;
  const ok = Boolean(selectedMode?.deployable ?? latest?.productionDeployable);
  console.log(JSON.stringify({
    ok,
    mode: selected,
    deployable: selectedMode?.deployable ?? latest?.productionDeployable ?? false,
    demoDeployable: latest?.demoDeployable ?? null,
    certifiedReferenceAlphaDeployable: latest?.certifiedReferenceAlphaDeployable ?? null,
    trustBetaDeployable: latest?.trustBetaDeployable ?? null,
    productionDeployable: latest?.productionDeployable ?? false,
    blockerCount: latest?.summary?.blockerIssues ?? null,
    latestPath: join(outDir, "latest.json"),
    blockingReasons: selectedMode?.blockingReasons ?? null,
  }, null, 2));
  if (args.strict && !ok) process.exit(1);
  process.exit(0);
}

const refs = loadAllRefs();
const predictions = sanitizePredictionMap(readJson(predictionsPath, {}));
const proof = readJson(proofPath, null);
const agentic = readJson(agenticPath, null);
const report = buildReport({ refs, predictions, proof, agentic });

writeJson(join(outDir, "latest.json"), report);
writeJson(join(outDir, `${report.label}.json`), report);
writeFileSync(join(outDir, "issues.jsonl"), report.issues.map((issue) => JSON.stringify(issue)).join("\n") + "\n", "utf-8");
writeFileSync(docsPath, renderMarkdown(report), "utf-8");

console.log(JSON.stringify({
  ok: report.productionDeployable,
  label: report.label,
  summary: report.summary,
  gates: report.gates.map((gate) => ({ id: gate.id, passed: gate.passed, detail: gate.detail })),
  latestPath: join(outDir, "latest.json"),
  issuesPath: join(outDir, "issues.jsonl"),
  docsPath,
}, null, 2));

if (args.strict && !report.productionDeployable) process.exit(1);

function buildReport({ refs, predictions, proof, agentic }) {
  const generatedAt = new Date().toISOString();
  const label = `production-readiness-${generatedAt.replace(/[:.]/g, "-")}`;
  const issues = [];
  const activePredictionRows = [...predictions.entries()].map(([certId, prediction]) => ({ certId, prediction }));
  const placeholderPredictions = activePredictionRows.filter(({ prediction }) => isPlaceholderPrediction(prediction));
  const realActivePredictions = activePredictionRows.filter(({ prediction }) => !isPlaceholderPrediction(prediction));
  const proofRows = (proof?.traces ?? []).filter((trace) => trace.realImagePresent && !trace.inferenceIsSimulated);
  const proofEligibleMatches = proofRows.filter((trace) => trace.proofEligible && trace.bandAgreement === "match");
  const combinedRealRows = [
    ...proofRows.map((trace) => ({
      id: trace.certId,
      source: "remote_proof",
      officialBand: trace.officialBand,
      predictedBand: trace.predictedBand,
      agreement: trace.bandAgreement,
      trustTier: trace.trustTier,
      proofEligible: Boolean(trace.proofEligible),
    })),
    ...realActivePredictions.map(({ certId, prediction }) => {
      const ref = refs.find((item) => item.id === certId);
      const officialBand = ref ? gradeToBand(ref.officialGrade) : null;
      return {
        id: certId,
        source: "active_predictions",
        officialBand,
        predictedBand: prediction.predictedBand ?? null,
        agreement: officialBand && prediction.predictedBand === officialBand ? "match" : "mismatch",
        trustTier: ref?.trustTier ?? "unknown",
        proofEligible: hasReplayableImage(ref),
      };
    }),
  ];
  const realMatchCount = combinedRealRows.filter((row) => row.agreement === "match").length;
  const realMatchRate = combinedRealRows.length > 0 ? realMatchCount / combinedRealRows.length : 0;
  const officialBandsCovered = new Set(combinedRealRows.map((row) => row.officialBand).filter(Boolean));
  const goldRefs = refs.filter((ref) => ref.trustTier === "gold" || ref.trustTier === "gold_candidate");
  const humanDingReviews = refs.filter((ref) => Boolean(ref.humanDingReview || ref.trustTier === "gold"));
  const missingReplayableImageRefs = refs.filter((ref) => !hasReplayableImage(ref));
  const refsWithDeclaredSlabImagesButMissingLocal = refs.filter((ref) => ref.hasFrontBackSlabImages && !hasReplayableImage(ref));
  const imageBackedSilverPlusRefs = refs.filter((ref) => ref.trustTier === "silver_plus" && hasReplayableImage(ref));
  const realModelRows = proofRows.length + realActivePredictions.filter(({ prediction }) => !prediction.inferenceIsSimulated).length;
  const missingTools = Array.isArray(agentic?.toolSurface?.missingRequired)
    ? agentic.toolSurface.missingRequired
    : REQUIRED_PROMOTION_TOOLS;

  for (const { certId, prediction } of placeholderPredictions) {
    issues.push(issue({
      id: `placeholder_prediction_${certId}`,
      severity: "P0",
      layer: "eval_data",
      certId,
      title: "Active prediction is a placeholder mirror",
      detail: `modelVersion=${prediction.modelVersion ?? "unknown"} confidence=${prediction.confidence ?? "unknown"}`,
      nextAction: "Remove from active predictions or replace with real inference output plus replayable image evidence.",
    }));
  }

  if (combinedRealRows.length < THRESHOLDS.minRealOutcomeRows) {
    issues.push(issue({
      id: "insufficient_real_outcome_rows",
      severity: "P0",
      layer: "production_accuracy",
      title: "Not enough real image-backed outcome rows",
      detail: `${combinedRealRows.length}/${THRESHOLDS.minRealOutcomeRows} real outcome rows available.`,
      nextAction: "Attach more user-permitted slab/raw images or allowed remote certified-reference images and run the proof/eval runners.",
    }));
  }
  if (goldRefs.length < THRESHOLDS.minGoldRefs) {
    issues.push(issue({
      id: "insufficient_gold_records",
      severity: "P0",
      layer: "dataset",
      title: "Gold eval set is missing",
      detail: `${goldRefs.length}/${THRESHOLDS.minGoldRefs} Gold or gold-candidate records available.`,
      nextAction: "Collect raw pre-submission scan + consent + official returned outcome + human DING review.",
    }));
  }
  if (humanDingReviews.length < THRESHOLDS.minHumanDingReviews) {
    issues.push(issue({
      id: "insufficient_human_ding_reviews",
      severity: "P0",
      layer: "dataset",
      title: "Human DING review coverage is missing",
      detail: `${humanDingReviews.length}/${THRESHOLDS.minHumanDingReviews} human-reviewed records available.`,
      nextAction: "Create human review tasks for Gold/gold-candidate records and store DING boxes/severity.",
    }));
  }
  if (realMatchRate < THRESHOLDS.minRealBandMatchRate) {
    issues.push(issue({
      id: "real_band_match_rate_below_floor",
      severity: "P0",
      layer: "calibration",
      title: "Real certified-reference band match rate below production floor",
      detail: `${realMatchCount}/${combinedRealRows.length} real rows matched (${realMatchRate.toFixed(3)}).`,
      nextAction: "Do not promote until non-placeholder real rows meet the match-rate floor without sample-size loopholes.",
    }));
  }
  if (officialBandsCovered.size < THRESHOLDS.minOfficialBandCoverage) {
    issues.push(issue({
      id: "insufficient_official_band_coverage",
      severity: "P0",
      layer: "dataset",
      title: "Official outcome band coverage is too narrow",
      detail: `${officialBandsCovered.size}/${THRESHOLDS.minOfficialBandCoverage} official bands covered by real rows.`,
      nextAction: "Add real image-backed examples across Gem, Mint, Near Mint, visible issues, and heavy wear bands.",
    }));
  }
  if (imageBackedSilverPlusRefs.length < THRESHOLDS.minImageBackedSilverPlusRefs) {
    issues.push(issue({
      id: "insufficient_image_backed_silver_plus_refs",
      severity: "P0",
      layer: "dataset",
      title: "Image-backed Silver+ reference coverage is below production floor",
      detail: `${imageBackedSilverPlusRefs.length}/${THRESHOLDS.minImageBackedSilverPlusRefs} Silver+ references have replayable local images.`,
      nextAction: "Attach user-provided or permissioned local slab/front/back images and hash them as replayable reference artifacts.",
    }));
  }
  for (const tool of missingTools.filter((tool) => REQUIRED_PROMOTION_TOOLS.includes(tool))) {
    issues.push(issue({
      id: `missing_agent_tool_${tool}`,
      severity: "P0",
      layer: "agent_tools",
      title: `Missing production promotion tool: ${tool}`,
      detail: "The agentic eval requires this tool for grounded foveated inspection before promotion.",
      nextAction: "Expose the tool in the pi-ai/OpenAI agent tool surface and record its outputs in traces.",
    }));
  }
  for (const ref of refsWithDeclaredSlabImagesButMissingLocal) {
    issues.push(issue({
      id: `missing_replayable_slab_image_${ref.id}`,
      severity: "P1",
      layer: "evidence",
      certId: ref.id,
      title: "Certified reference declares slab images but no replayable local artifact is attached",
      detail: `${ref.provider} ${ref.certNumber}: ${ref.cardIdentity ?? "identity pending"}`,
      nextAction: `Attach permitted front/back images under data/cert-references/slab-images/${ref.id}/, then run pnpm eval:certrefs:run.`,
    }));
  }
  for (const ref of missingReplayableImageRefs.filter((ref) => !ref.hasFrontBackSlabImages)) {
    issues.push(issue({
      id: `missing_reference_image_${ref.id}`,
      severity: "P2",
      layer: "evidence",
      certId: ref.id,
      title: "Reference has no replayable image artifact",
      detail: `${ref.provider} ${ref.certNumber}: ${ref.cardIdentity ?? "identity pending"}`,
      nextAction: "Keep as metadata-only calibration context until user-provided images or allowed API imagery exist.",
    }));
  }

  const gates = [
    gate("active_placeholders_removed", "No active placeholder predictions", placeholderPredictions.length === 0, `${placeholderPredictions.length} active placeholder rows.`),
    gate("minimum_real_outcome_rows", "Minimum real certified-reference outcome rows", combinedRealRows.length >= THRESHOLDS.minRealOutcomeRows, `${combinedRealRows.length}/${THRESHOLDS.minRealOutcomeRows} rows.`),
    gate("real_band_match_rate", "Real band match-rate floor", combinedRealRows.length >= THRESHOLDS.minRealOutcomeRows && realMatchRate >= THRESHOLDS.minRealBandMatchRate, `${realMatchRate.toFixed(3)} match rate on ${combinedRealRows.length} rows.`),
    gate("official_band_coverage", "Official band coverage", officialBandsCovered.size >= THRESHOLDS.minOfficialBandCoverage, `${officialBandsCovered.size}/${THRESHOLDS.minOfficialBandCoverage} bands.`),
    gate("gold_eval_set", "Gold/gold-candidate eval set", goldRefs.length >= THRESHOLDS.minGoldRefs, `${goldRefs.length}/${THRESHOLDS.minGoldRefs} records.`),
    gate("human_ding_review", "Human DING review coverage", humanDingReviews.length >= THRESHOLDS.minHumanDingReviews, `${humanDingReviews.length}/${THRESHOLDS.minHumanDingReviews} records.`),
    gate("image_backed_silver_plus", "Image-backed Silver+ coverage", imageBackedSilverPlusRefs.length >= THRESHOLDS.minImageBackedSilverPlusRefs, `${imageBackedSilverPlusRefs.length}/${THRESHOLDS.minImageBackedSilverPlusRefs} records.`),
    gate("replayable_images_closed", "No missing replayable images for declared Silver+ refs", refsWithDeclaredSlabImagesButMissingLocal.length === 0, `${refsWithDeclaredSlabImagesButMissingLocal.length} declared-image refs missing local artifacts.`),
    gate("agent_tools_complete", "Agent tool surface complete", !missingTools.some((tool) => REQUIRED_PROMOTION_TOOLS.includes(tool)), `${missingTools.join(", ") || "all required tools available"}.`),
    gate("agentic_eval_deployable", "Agentic eval deployable", Boolean(agentic?.deployable), agentic ? `${agentic.totals?.needsReview ?? "unknown"} rows need review.` : "agentic eval missing."),
  ];
  const productionDeployable = gates.every((item) => item.passed);
  const releaseModes = buildReleaseModes({
    refs,
    placeholderPredictions,
    combinedRealRows,
    realMatchRate,
    officialBandsCovered,
    goldRefs,
    humanDingReviews,
    imageBackedSilverPlusRefs,
    realModelRows,
    refsWithDeclaredSlabImagesButMissingLocal,
    missingTools,
    agentic,
    productionDeployable,
  });
  const issueCounts = countBy(issues, "severity");

  return {
    schemaVersion: 1,
    generatedAt,
    label,
    demoDeployable: releaseModes.demo.deployable,
    certifiedReferenceAlphaDeployable: releaseModes.certified_reference_alpha.deployable,
    trustBetaDeployable: releaseModes.trust_beta.deployable,
    productionDeployable,
    releaseModes,
    thresholds: THRESHOLDS,
    alphaThresholds: ALPHA_THRESHOLDS,
    trustBetaThresholds: TRUST_BETA_THRESHOLDS,
    summary: {
      refs: refs.length,
      activePredictions: activePredictionRows.length,
      activePlaceholderPredictions: placeholderPredictions.length,
      realOutcomeRows: combinedRealRows.length,
      proofEligibleMatches: proofEligibleMatches.length,
      realModelRows,
      realBandMatches: realMatchCount,
      realBandMatchRate: realMatchRate,
      officialBandsCovered: officialBandsCovered.size,
      goldRefs: goldRefs.length,
      humanDingReviews: humanDingReviews.length,
      imageBackedSilverPlusRefs: imageBackedSilverPlusRefs.length,
      missingReplayableImages: missingReplayableImageRefs.length,
      declaredSlabImagesMissingLocal: refsWithDeclaredSlabImagesButMissingLocal.length,
      blockerIssues: issues.filter((item) => item.severity === "P0").length,
      issueCounts,
    },
    gates,
    issues,
    realRows: combinedRealRows,
    sourceReports: {
      predictionsPath,
      proofPath,
      agenticPath,
    },
    notes: [
      "This gate proves production deployability only when enough real, replayable, non-placeholder references pass.",
      "The current single remote proof row is useful evidence but not production accuracy.",
      "External PSA/TAG/marketplace references are not training data unless permission and consent are explicit.",
    ],
  };
}

function sanitizePredictionMap(raw) {
  const out = new Map();
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (key.startsWith("_")) continue;
    if (!value || typeof value !== "object") continue;
    out.set(key, value);
  }
  return out;
}

function isPlaceholderPrediction(prediction) {
  const model = String(prediction?.modelVersion ?? "").toLowerCase();
  return model.includes("baseline-trust-cert") || model.includes("test-baseline-mirror") || prediction?.confidence === 0;
}

function hasReplayableImage(ref) {
  if (!ref) return false;
  if (ref.rawPreSubmissionScanAvailable || ref.trustTier === "gold" || ref.trustTier === "gold_candidate") return true;
  const dir = join(slabRoot, ref.id);
  if (!existsSync(dir)) return false;
  if (!statSync(dir).isDirectory()) return false;
  return readdirSync(dir).some((entry) => /\.(png|jpe?g|webp|bmp)$/i.test(entry));
}

function issue({ id, severity, layer, certId = null, title, detail, nextAction }) {
  return { id, severity, layer, certId, title, detail, nextAction };
}

function gate(id, label, passed, detail) {
  return { id, label, passed, detail };
}

function countBy(items, key) {
  const out = {};
  for (const item of items) out[item[key]] = (out[item[key]] ?? 0) + 1;
  return out;
}

function buildReleaseModes({
  refs,
  placeholderPredictions,
  combinedRealRows,
  realMatchRate,
  officialBandsCovered,
  goldRefs,
  humanDingReviews,
  imageBackedSilverPlusRefs,
  realModelRows,
  refsWithDeclaredSlabImagesButMissingLocal,
  missingTools,
  agentic,
  productionDeployable,
}) {
  const agentToolsComplete = !missingTools.some((tool) => REQUIRED_PROMOTION_TOOLS.includes(tool));
  const noPlaceholders = placeholderPredictions.length === 0;
  const hasRefs = refs.length > 0;
  const demoChecks = [
    releaseCheck("cert_refs_loaded", hasRefs, `${refs.length} certified references loaded.`),
    releaseCheck("no_active_placeholder_predictions", noPlaceholders, `${placeholderPredictions.length} placeholder prediction rows.`),
    releaseCheck("agent_tools_complete", agentToolsComplete, `${missingTools.join(", ") || "all required tools available"}.`),
  ];
  const alphaChecks = [
    ...demoChecks,
    releaseCheck("certified_ref_count", refs.length >= ALPHA_THRESHOLDS.minCertifiedRefs, `${refs.length}/${ALPHA_THRESHOLDS.minCertifiedRefs} refs.`),
    releaseCheck(
      "image_backed_silver_plus",
      imageBackedSilverPlusRefs.length >= ALPHA_THRESHOLDS.minImageBackedSilverPlusRefs,
      `${imageBackedSilverPlusRefs.length}/${ALPHA_THRESHOLDS.minImageBackedSilverPlusRefs} image-backed Silver+ refs.`,
    ),
    releaseCheck("real_model_trace", realModelRows >= ALPHA_THRESHOLDS.minRealModelRows, `${realModelRows}/${ALPHA_THRESHOLDS.minRealModelRows} real model row(s).`),
  ];
  const betaChecks = [
    ...alphaChecks,
    releaseCheck("real_outcome_rows", combinedRealRows.length >= TRUST_BETA_THRESHOLDS.minRealOutcomeRows, `${combinedRealRows.length}/${TRUST_BETA_THRESHOLDS.minRealOutcomeRows} rows.`),
    releaseCheck("real_band_match_rate", combinedRealRows.length >= TRUST_BETA_THRESHOLDS.minRealOutcomeRows && realMatchRate >= TRUST_BETA_THRESHOLDS.minRealBandMatchRate, `${realMatchRate.toFixed(3)} on ${combinedRealRows.length} rows.`),
    releaseCheck("official_band_coverage", officialBandsCovered.size >= TRUST_BETA_THRESHOLDS.minOfficialBandCoverage, `${officialBandsCovered.size}/${TRUST_BETA_THRESHOLDS.minOfficialBandCoverage} bands.`),
    releaseCheck("gold_records", goldRefs.length >= TRUST_BETA_THRESHOLDS.minGoldRefs, `${goldRefs.length}/${TRUST_BETA_THRESHOLDS.minGoldRefs} records.`),
    releaseCheck("human_ding_reviews", humanDingReviews.length >= TRUST_BETA_THRESHOLDS.minHumanDingReviews, `${humanDingReviews.length}/${TRUST_BETA_THRESHOLDS.minHumanDingReviews} reviews.`),
  ];
  const productionChecks = [
    ...demoChecks,
    releaseCheck("certified_ref_count", refs.length >= ALPHA_THRESHOLDS.minCertifiedRefs, `${refs.length}/${ALPHA_THRESHOLDS.minCertifiedRefs} refs.`),
    releaseCheck("real_model_trace", realModelRows >= ALPHA_THRESHOLDS.minRealModelRows, `${realModelRows}/${ALPHA_THRESHOLDS.minRealModelRows} real model row(s).`),
    releaseCheck(
      "image_backed_silver_plus",
      imageBackedSilverPlusRefs.length >= THRESHOLDS.minImageBackedSilverPlusRefs,
      `${imageBackedSilverPlusRefs.length}/${THRESHOLDS.minImageBackedSilverPlusRefs} image-backed Silver+ refs.`,
    ),
    releaseCheck("real_outcome_rows", combinedRealRows.length >= THRESHOLDS.minRealOutcomeRows, `${combinedRealRows.length}/${THRESHOLDS.minRealOutcomeRows} rows.`),
    releaseCheck("real_band_match_rate", combinedRealRows.length >= THRESHOLDS.minRealOutcomeRows && realMatchRate >= THRESHOLDS.minRealBandMatchRate, `${realMatchRate.toFixed(3)} on ${combinedRealRows.length} rows.`),
    releaseCheck("official_band_coverage", officialBandsCovered.size >= THRESHOLDS.minOfficialBandCoverage, `${officialBandsCovered.size}/${THRESHOLDS.minOfficialBandCoverage} bands.`),
    releaseCheck("gold_records", goldRefs.length >= THRESHOLDS.minGoldRefs, `${goldRefs.length}/${THRESHOLDS.minGoldRefs} records.`),
    releaseCheck("human_ding_reviews", humanDingReviews.length >= THRESHOLDS.minHumanDingReviews, `${humanDingReviews.length}/${THRESHOLDS.minHumanDingReviews} reviews.`),
    releaseCheck("production_gate", productionDeployable, productionDeployable ? "All hard production gates pass." : "One or more hard production gates is blocked."),
    releaseCheck("declared_silver_plus_images_closed", refsWithDeclaredSlabImagesButMissingLocal.length === 0, `${refsWithDeclaredSlabImagesButMissingLocal.length} declared-image refs missing local artifacts.`),
    releaseCheck("agentic_eval_deployable", Boolean(agentic?.deployable), agentic ? `${agentic.totals?.needsReview ?? "unknown"} rows need review.` : "agentic eval missing."),
  ];
  return {
    demo: releaseMode("demo", "Demo", demoChecks),
    certified_reference_alpha: releaseMode("certified_reference_alpha", "Certified Reference Alpha", alphaChecks),
    trust_beta: releaseMode("trust_beta", "Trust Beta", betaChecks),
    production: releaseMode("production", "Production Trust Gate", productionChecks),
  };
}

function releaseCheck(id, passed, detail) {
  return { id, passed, detail };
}

function releaseMode(id, label, checks) {
  const blockingReasons = checks.filter((check) => !check.passed).map((check) => `${check.id}: ${check.detail}`);
  return {
    id,
    label,
    deployable: blockingReasons.length === 0,
    checks,
    blockingReasons,
  };
}

function renderMarkdown(report) {
  const p0 = report.issues.filter((issue) => issue.severity === "P0");
  const p1 = report.issues.filter((issue) => issue.severity === "P1").slice(0, 20);
  return [
    "# Production Accuracy Readiness",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Production deployable: **${report.productionDeployable ? "yes" : "no"}**`,
    `Certified Reference Alpha deployable: **${report.certifiedReferenceAlphaDeployable ? "yes" : "no"}**`,
    `Demo deployable: **${report.demoDeployable ? "yes" : "no"}**`,
    "",
    "This is the hard gate for certified-reference outcome matching. It evaluates real image-backed proof rows, active predictions, Gold/human-DING coverage, replayable image evidence, and agent tool completeness.",
    "",
    "## Summary",
    "",
    `- Active placeholder predictions: ${report.summary.activePlaceholderPredictions}`,
    `- Real model rows: ${report.summary.realModelRows}`,
    `- Real outcome rows: ${report.summary.realOutcomeRows}/${report.thresholds.minRealOutcomeRows}`,
    `- Real band match rate: ${report.summary.realBandMatchRate.toFixed(3)}`,
    `- Official bands covered by real rows: ${report.summary.officialBandsCovered}/${report.thresholds.minOfficialBandCoverage}`,
    `- Gold/gold-candidate refs: ${report.summary.goldRefs}/${report.thresholds.minGoldRefs}`,
    `- Human DING reviews: ${report.summary.humanDingReviews}/${report.thresholds.minHumanDingReviews}`,
    `- Image-backed Silver+ refs: ${report.summary.imageBackedSilverPlusRefs}/${report.thresholds.minImageBackedSilverPlusRefs}`,
    `- Missing replayable images: ${report.summary.missingReplayableImages}`,
    `- P0 blockers: ${report.summary.blockerIssues}`,
    "",
    "## Gates",
    "",
    "| Gate | Status | Detail |",
    "| --- | --- | --- |",
    ...report.gates.map((gate) => `| ${gate.label} | ${gate.passed ? "PASS" : "BLOCKED"} | ${escapeMarkdown(gate.detail)} |`),
    "",
    "## Release Modes",
    "",
    "| Mode | Status | Blocking reasons |",
    "| --- | --- | --- |",
    ...Object.values(report.releaseModes).map((mode) => `| ${mode.label} | ${mode.deployable ? "PASS" : "BLOCKED"} | ${escapeMarkdown(mode.blockingReasons.join("; ") || "none")} |`),
    "",
    "## P0 Blockers",
    "",
    "| Issue | Layer | Detail | Next action |",
    "| --- | --- | --- | --- |",
    ...p0.map((item) => `| ${escapeMarkdown(item.title)} | ${item.layer} | ${escapeMarkdown(item.detail)} | ${escapeMarkdown(item.nextAction)} |`),
    "",
    "## Missing Image Issues (First 20)",
    "",
    "| Issue | Reference | Detail | Next action |",
    "| --- | --- | --- | --- |",
    ...p1.map((item) => `| ${escapeMarkdown(item.title)} | ${item.certId ?? "-"} | ${escapeMarkdown(item.detail)} | ${escapeMarkdown(item.nextAction)} |`),
    "",
    "## Issue Register",
    "",
    "- Structured issues: `data/cert-references/production-readiness/issues.jsonl`",
    "- Full report: `data/cert-references/production-readiness/latest.json`",
    "",
    "## Honesty Contract",
    "",
    "- The current single remote proof row proves the loop can match one listed certified outcome with real image bytes.",
    "- It does not prove production accuracy.",
    "- Production deployability remains blocked until the gates above pass.",
    "",
  ].join("\n");
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function parseArgs(argv) {
  const out = { check: false, strict: false, mode: "production" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") out.check = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--mode" && argv[i + 1]) out.mode = argv[++i];
    else if (arg.startsWith("--mode=")) out.mode = arg.slice("--mode=".length);
  }
  return out;
}

function normalizeMode(mode) {
  const value = String(mode ?? "production").toLowerCase();
  if (value === "alpha") return "certified_reference_alpha";
  if (value === "certified_reference_alpha") return "certified_reference_alpha";
  if (value === "certified-reference-alpha") return "certified_reference_alpha";
  if (value === "trust_beta") return "trust_beta";
  if (value === "trust-beta") return "trust_beta";
  if (value === "beta") return "trust_beta";
  if (value === "demo") return "demo";
  return "production";
}
