#!/usr/bin/env node
// System-level certified-reference evaluation runner.
//
// This is intentionally broader than "image -> model -> prediction":
//   cert reference
//   -> agent tool plan
//   -> ML/model prediction state
//   -> calibration comparison
//   -> evidence/manifest readiness
//   -> LLM-judge-style scoring
//   -> self-correction proposals
//
// Default judge is deterministic and local so the laptop demo has no paid/API
// dependency. Each row also writes a judge prompt artifact that can be replayed
// later through pi-ai/OpenAI as a stricter LLM judge.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gradeToBand, loadAllRefs, readJson, repoRoot, summarizeRefs, writeJson } from "../certs/cert_reference_lib.mjs";

const BAND_ORDER = [
  "below_700_heavy_wear",
  "700-799_visible_issues",
  "800-849_near_mint",
  "850-899_strong_nm_mint",
  "900-949_mint",
  "950-1000_gem_pristine",
];

const REQUIRED_TOOLS = [
  "get_cert_reference",
  "load_cert_images",
  "detect_card_boundary",
  "normalize_card",
  "crop_corners",
  "crop_edges",
  "crop_surface",
  "run_ding_detector",
  "run_glare_check",
  "run_severity_scorer",
  "run_condition_band_calibrator",
  "compare_to_cert_reference",
  "cite_evidence",
  "flag_mismatch",
  "create_human_review_task",
];

const TOOL_IMPLEMENTATION_EQUIVALENTS = {
  get_cert_reference: ["compare_to_cert_reference"],
  load_cert_images: ["crop_finding"],
  detect_card_boundary: [],
  normalize_card: [],
  crop_corners: ["crop_finding"],
  crop_edges: ["crop_finding"],
  crop_surface: ["crop_finding"],
  zoom_region: ["request_zoom_animation"],
  run_ding_detector: ["rerun_detector_on_crop"],
  run_glare_check: ["glare_check_on_crop", "evaluate_glare_risk"],
  run_severity_scorer: [],
  run_condition_band_calibrator: ["compare_to_cert_reference"],
  compare_to_cert_reference: ["compare_to_cert_reference"],
  cite_evidence: ["cite_evidence"],
  flag_mismatch: ["compare_to_cert_reference"],
  create_human_review_task: [],
  propose_inspection_method: ["propose_inspection_method"],
};

const PROMOTION_REQUIRED_TOOLS = new Set([
  "detect_card_boundary",
  "normalize_card",
  "crop_corners",
  "crop_edges",
  "crop_surface",
  "run_ding_detector",
  "run_glare_check",
  "run_severity_scorer",
  "run_condition_band_calibrator",
  "compare_to_cert_reference",
  "cite_evidence",
]);

const args = parseArgs(process.argv.slice(2));
const strict = args.strict;
const check = args.check;
const label = args.label ?? `agentic-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const root = repoRoot();
const certDir = join(root, "data", "cert-references");
const evalDir = join(certDir, "agentic-eval");
const slabRoot = join(certDir, "slab-images");
const benchmarkDir = join(root, "data", "benchmarks", "cert_refs");
const docsQaDir = join(root, "docs", "qa");
const predictionsPath = join(certDir, "predictions.json");
const bandReportPath = join(benchmarkDir, "latest.json");
const readinessReportPath = join(certDir, "eval-report.json");

for (const dir of [evalDir, docsQaDir]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const refs = loadAllRefs();
const refSummary = summarizeRefs(refs);
const predictions = sanitizePredictionMap(readJson(predictionsPath, {}));
const readinessReport = readJson(readinessReportPath, null);
const modelVersion = inferModelVersion(predictions);
const implementedAgentTools = loadImplementedAgentTools();
const toolSurface = summarizeToolSurface(implementedAgentTools);

const rows = refs.map((ref) => evaluateReference(ref, predictions.get(ref.id)));
const totals = summarizeAgenticRows(rows);
const gates = evaluatePromotionGates({ rows, totals, refSummary, toolSurface });
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  label,
  modelVersion,
  checkMode: check,
  judgeMode: "deterministic_llm_judge_fallback",
  deployable: gates.every((gate) => gate.passed),
  totals,
  gates,
  referenceSummary: refSummary,
  readinessSummary: readinessReport?.summary ?? null,
  toolSurface,
  rows,
  notes: [
    "This is a system-level eval over agent policy, tools, model output, calibration, evidence, and explanation grounding.",
    "The default judge is local/deterministic; judgePromptsPath contains replayable inputs for an external pi-ai/OpenAI judge.",
    "Silver/Silver+ cert references calibrate outcomes but are not training data. Gold requires raw pre-submission scan, consent, official outcome, and human DING review.",
  ],
};

const latestPath = join(evalDir, "latest.json");
const labeledPath = join(evalDir, `${label}.json`);
const promptsPath = join(evalDir, `${label}.judge-prompts.jsonl`);
const latestPromptsPath = join(evalDir, "latest.judge-prompts.jsonl");
writeJson(labeledPath, report);
writeJson(latestPath, report);
writeFileSync(promptsPath, rows.map((row) => JSON.stringify(row.judgePrompt)).join("\n") + "\n", "utf-8");
writeFileSync(latestPromptsPath, rows.map((row) => JSON.stringify(row.judgePrompt)).join("\n") + "\n", "utf-8");
writeFileSync(join(docsQaDir, "AGENTIC_CERT_EVAL_REPORT.md"), renderMarkdown(report), "utf-8");

console.log(JSON.stringify({
  ok: report.deployable,
  label,
  modelVersion,
  totals,
  gates: gates.map((gate) => ({ id: gate.id, passed: gate.passed, detail: gate.detail })),
  reportPath: latestPath,
  judgePromptsPath: latestPromptsPath,
}, null, 2));

if (strict && !report.deployable) process.exit(1);

function parseArgs(argv) {
  const out = { check: false, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") out.check = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--label" && argv[i + 1]) out.label = argv[++i];
  }
  return out;
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

function inferModelVersion(predictionMap) {
  const versions = [...predictionMap.values()].map((prediction) => prediction.modelVersion).filter(Boolean);
  const unique = [...new Set(versions)];
  if (unique.length === 1) return unique[0];
  return "unknown";
}

function loadImplementedAgentTools() {
  const toolsPath = join(root, "apps", "web", "lib", "agent", "tools.ts");
  if (!existsSync(toolsPath)) return [];
  const source = readFileSync(toolsPath, "utf-8");
  return [...source.matchAll(/name:\s*"([^"]+)"/g)].map((match) => match[1]).sort();
}

function classifyToolImplementation(toolPlan, implementedTools) {
  const implemented = new Set(implementedTools);
  return toolPlan.map((item) => {
    const equivalents = TOOL_IMPLEMENTATION_EQUIVALENTS[item.tool] ?? [];
    const exact = implemented.has(item.tool);
    const implementedBy = exact ? [item.tool] : equivalents.filter((tool) => implemented.has(tool));
    const status = exact ? "implemented" : implementedBy.length > 0 ? "partial" : "missing";
    return {
      tool: item.tool,
      status,
      implementedBy,
      requiredForPromotion: PROMOTION_REQUIRED_TOOLS.has(item.tool),
    };
  });
}

function summarizeToolSurface(implementedTools) {
  const required = REQUIRED_TOOLS.map((tool) => {
    const item = classifyToolImplementation([{ tool, rationale: "" }], implementedTools)[0];
    return item;
  });
  return {
    implemented: implementedTools,
    required,
    missingRequired: required.filter((tool) => tool.status === "missing" && tool.requiredForPromotion).map((tool) => tool.tool),
  };
}

function evaluateReference(ref, prediction) {
  const officialBand = gradeToBand(ref.officialGrade);
  const predictedBand = prediction?.predictedBand ?? null;
  const predictedConfidence = numberOrNull(prediction?.confidence);
  const predictedScore = numberOrNull(prediction?.predictedScore);
  const classified = classifyAgreement(officialBand, predictedBand);
  const bandAgreement = classified.agreement;
  const bandDistance = classified.distance;
  const imageState = getImageState(ref);
  const inputStatus = classifyInputStatus({ prediction, imageState });
  const toolPlan = buildToolPlan({ ref, inputStatus, bandAgreement, predictedConfidence, imageState });
  const toolImplementation = classifyToolImplementation(toolPlan, implementedAgentTools);
  const judgePrompt = buildJudgePrompt({
    ref,
    officialBand,
    prediction,
    predictedBand,
    predictedScore,
    predictedConfidence,
    bandAgreement,
    bandDistance,
    imageState,
    toolPlan,
    toolImplementation,
  });
  const judge = deterministicJudge({
    ref,
    officialBand,
    prediction,
    predictedBand,
    predictedConfidence,
    bandAgreement,
    inputStatus,
    imageState,
    toolPlan,
    toolImplementation,
  });

  return {
    certId: ref.id,
    provider: ref.provider,
    certNumber: ref.certNumber,
    trustTier: ref.trustTier,
    officialGrade: ref.officialGrade ?? null,
    officialBand,
    predictedBand,
    predictedScore,
    predictedConfidence,
    bandAgreement,
    bandDistance,
    inputStatus,
    imageState,
    toolPlan,
    toolImplementation,
    judge,
    selfCorrection: proposeSelfCorrection({
      ref,
      officialBand,
      predictedBand,
      bandAgreement,
      inputStatus,
      imageState,
      prediction,
    }),
    judgePrompt,
  };
}

function classifyAgreement(officialBand, predictedBand) {
  if (!officialBand || officialBand === "unknown") return { agreement: "no_official_band", distance: null };
  if (!predictedBand) return { agreement: "mismatch", distance: null };
  const officialIndex = BAND_ORDER.indexOf(officialBand);
  const predictedIndex = BAND_ORDER.indexOf(predictedBand);
  if (officialIndex < 0 || predictedIndex < 0) return { agreement: "mismatch", distance: null };
  const distance = Math.abs(officialIndex - predictedIndex);
  if (distance === 0) return { agreement: "match", distance };
  if (distance === 1) return { agreement: "adjacent", distance };
  return { agreement: "mismatch", distance };
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function getImageState(ref) {
  const dir = join(slabRoot, ref.id);
  const localImages = existsSync(dir) && statSync(dir).isDirectory()
    ? readdirSync(dir).filter((entry) => /\.(png|jpe?g|webp|bmp)$/i.test(entry)).length
    : 0;
  return {
    hasFrontBackSlabImages: Boolean(ref.hasFrontBackSlabImages),
    hasLocalSlabImages: localImages > 0,
    localImageCount: localImages,
    hasRawPreSubmissionScan: Boolean(ref.rawPreSubmissionScanAvailable || ref.trustTier === "gold" || ref.trustTier === "gold_candidate"),
    hasHumanDingReview: Boolean(ref.humanDingReview || ref.trustTier === "gold"),
    canTrain: Boolean(ref.trainingAllowed),
    publicExampleAllowed: Boolean(ref.publicExampleAllowed),
  };
}

function classifyInputStatus({ prediction, imageState }) {
  if (!prediction) return "no_prediction";
  const confidence = numberOrNull(prediction?.confidence);
  const version = String(prediction?.modelVersion ?? "");
  if (version === "baseline-trust-cert" || version === "test-baseline-mirror" || confidence === 0) {
    return "placeholder_mirror";
  }
  if (!imageState.hasLocalSlabImages && !imageState.hasRawPreSubmissionScan) return "prediction_without_replayable_image";
  return "real_prediction";
}

function buildToolPlan({ ref, inputStatus, bandAgreement, predictedConfidence, imageState }) {
  const plan = [
    step("get_cert_reference", "Load official cert metadata, trust tier, policy, and outcome band."),
    step("load_cert_images", imageState.hasLocalSlabImages ? "Load local slab/raw artifacts." : "Record missing local slab/raw artifacts."),
  ];

  if (imageState.hasLocalSlabImages || imageState.hasRawPreSubmissionScan) {
    plan.push(
      step("detect_card_boundary", "Locate the card/holder in the uploaded reference image."),
      step("normalize_card", "Perspective-normalize the visible card region."),
      step("crop_corners", "Generate foveated corner crops."),
      step("crop_edges", "Generate foveated edge strips."),
      step("crop_surface", "Generate surface/glare inspection crops."),
      step("run_ding_detector", "Run the visible DING detector on full image and crops."),
      step("run_glare_check", "Estimate whether slab or holo glare limits surface confidence."),
      step("run_severity_scorer", "Convert detections into material/uncertain DING severity."),
      step("run_condition_band_calibrator", "Map findings to internal condition band."),
    );
  } else {
    plan.push(
      step("create_human_review_task", "Need local slab/raw image before model analysis can be replayed."),
    );
  }

  plan.push(step("compare_to_cert_reference", "Compare internal condition band against official outcome band."));

  if (inputStatus === "placeholder_mirror") {
    plan.push(step("flag_mismatch", "Block promotion because prediction is zero-confidence placeholder mirror."));
    plan.push(step("create_human_review_task", "Replace placeholder with real slab-image inference trace."));
  } else if (inputStatus === "no_prediction") {
    plan.push(step("flag_mismatch", "Mark cert reference as uncovered by current model version."));
    plan.push(step("create_human_review_task", "Add slab/raw image and run inference before calibration claims."));
  } else if (bandAgreement === "mismatch" || bandAgreement === "adjacent") {
    plan.push(step("zoom_region", "Inspect likely mismatch-driving corners, edges, and surface regions."));
    plan.push(step("flag_mismatch", "Bucket calibration/tool/model mismatch for self-correction."));
    plan.push(step("propose_inspection_method", "Draft method candidate for the relevant failure bucket."));
    plan.push(step("create_human_review_task", "Human reviewer should adjudicate cert outcome mismatch."));
  } else if ((predictedConfidence ?? 0) < 0.6) {
    plan.push(step("zoom_region", "Low-confidence match still needs crop-level evidence."));
    plan.push(step("create_human_review_task", "Low-confidence alignment cannot promote without review."));
  } else {
    plan.push(step("cite_evidence", "Attach grounded evidence trace to report."));
  }

  if (ref.provider === "TAG") {
    plan.push(step("cite_evidence", "TAG remains link-only unless screenshots/permission are supplied; no bulk scrape."));
  }

  return dedupeSteps(plan);
}

function step(tool, rationale) {
  return { tool, rationale };
}

function dedupeSteps(plan) {
  const seen = new Set();
  const out = [];
  for (const item of plan) {
    const key = `${item.tool}:${item.rationale}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildJudgePrompt(input) {
  return {
    role: "llm_judge",
    task: "Evaluate whether the card inspection agent produced a grounded, safe, replayable certified-reference analysis.",
    rubric: {
      grounding: "Every visible-condition claim must be traceable to tool output or explicitly marked unknown.",
      toolCoverage: "The agent should use foveated crops, model tools, glare checks, calibrator, cert comparison, and review tasks when appropriate.",
      calibration: "Internal condition band should align with official outcome band when evidence supports it; mismatches must be flagged.",
      evidence: "Trace should include image/artifact status, model version, confidence, and cert policy.",
      safety: "External cert references are not training data; TAG is link-only without permission; no official grade claims.",
    },
    input,
    expectedOutputSchema: {
      verdict: "pass | needs_review | blocked",
      scores: {
        grounding: "0..1",
        toolCoverage: "0..1",
        calibration: "0..1",
        evidence: "0..1",
        trustSafety: "0..1",
      },
      failureBucket: "string",
      reasons: "string[]",
      recommendedNextActions: "string[]",
    },
  };
}

function deterministicJudge({ ref, officialBand, prediction, predictedBand, predictedConfidence, bandAgreement, inputStatus, imageState, toolPlan, toolImplementation }) {
  const tools = new Set(toolPlan.map((item) => item.tool));
  const toolCoverage = scoreToolCoverage(tools, inputStatus, toolImplementation);
  const grounding = scoreGrounding({ prediction, predictedConfidence, inputStatus, imageState, tools });
  const calibration = scoreCalibration({ officialBand, predictedBand, bandAgreement, inputStatus });
  const evidence = scoreEvidence({ ref, imageState, prediction, inputStatus });
  const trustSafety = scoreTrustSafety(ref);
  const missingBlockingTools = toolImplementation.filter((tool) => tool.status === "missing" && tool.requiredForPromotion);
  const overall =
    grounding * 0.25 +
    toolCoverage * 0.2 +
    calibration * 0.2 +
    evidence * 0.2 +
    trustSafety * 0.15;
  const failureBucket = classifyFailureBucket({ officialBand, predictedBand, bandAgreement, inputStatus, imageState, ref });
  const verdict =
    overall >= 0.82 && failureBucket === "aligned_real_trace" && missingBlockingTools.length === 0
      ? "pass"
      : inputStatus === "placeholder_mirror" || inputStatus === "no_prediction"
        ? "blocked"
        : "needs_review";
  return {
    judgeType: "deterministic_llm_judge_fallback",
    verdict,
    overallScore: round(overall),
    scores: {
      grounding: round(grounding),
      toolCoverage: round(toolCoverage),
      calibration: round(calibration),
      evidence: round(evidence),
      trustSafety: round(trustSafety),
    },
    failureBucket,
    reasons: judgeReasons({ inputStatus, imageState, bandAgreement, predictedConfidence, ref, missingBlockingTools }),
  };
}

function scoreToolCoverage(tools, inputStatus, toolImplementation) {
  const required =
    inputStatus === "real_prediction"
      ? REQUIRED_TOOLS.filter((tool) => tool !== "create_human_review_task")
      : ["get_cert_reference", "load_cert_images", "compare_to_cert_reference", "flag_mismatch", "create_human_review_task"];
  const covered = required.filter((tool) => tools.has(tool)).length;
  const conceptualCoverage = covered / required.length;
  const implementationCoverage = toolImplementation.length > 0
    ? toolImplementation.filter((tool) => tool.status !== "missing").length / toolImplementation.length
    : 0;
  return conceptualCoverage * 0.55 + implementationCoverage * 0.45;
}

function scoreGrounding({ prediction, predictedConfidence, inputStatus, imageState, tools }) {
  if (inputStatus === "no_prediction") return tools.has("create_human_review_task") ? 0.45 : 0.2;
  if (inputStatus === "placeholder_mirror") return 0.25;
  let score = 0.55;
  if (prediction?.modelVersion) score += 0.12;
  if (Number.isFinite(predictedConfidence) && predictedConfidence > 0.35) score += 0.12;
  if (prediction?.dingsSummary) score += 0.08;
  if (imageState.hasLocalSlabImages || imageState.hasRawPreSubmissionScan) score += 0.1;
  if (tools.has("cite_evidence")) score += 0.03;
  return clamp(score);
}

function scoreCalibration({ officialBand, predictedBand, bandAgreement, inputStatus }) {
  if (!officialBand || officialBand === "unknown") return 0.45;
  if (inputStatus === "no_prediction") return 0;
  if (inputStatus === "placeholder_mirror") return 0.15;
  if (!predictedBand) return 0;
  if (bandAgreement === "match") return 1;
  if (bandAgreement === "adjacent") return 0.65;
  return 0.15;
}

function scoreEvidence({ ref, imageState, prediction, inputStatus }) {
  if (ref.trustTier === "gold" || ref.trustTier === "gold_candidate") return 1;
  let score = 0.18;
  if (ref.trustTier === "silver_plus") score += 0.18;
  if (imageState.hasFrontBackSlabImages) score += 0.14;
  if (imageState.hasLocalSlabImages) score += 0.24;
  if (prediction?.modelVersion && inputStatus === "real_prediction") score += 0.16;
  if (prediction?.predictedSubGrades) score += 0.06;
  if (imageState.hasHumanDingReview) score += 0.18;
  return clamp(score);
}

function scoreTrustSafety(ref) {
  let score = 1;
  if (ref.trainingAllowed && ref.trustTier !== "gold" && ref.trustTier !== "gold_candidate") score -= 0.6;
  if (ref.provider === "TAG" && !String(ref.ingestionPolicy ?? "").toLowerCase().includes("do not bulk scrape")) score -= 0.25;
  if (ref.provider === "TAG" && ref.trainingAllowed) score -= 0.35;
  return clamp(score);
}

function classifyFailureBucket({ officialBand, predictedBand, bandAgreement, inputStatus, imageState, ref }) {
  if (ref.provider === "TAG" && (!officialBand || officialBand === "unknown")) return "tag_link_only_no_structured_outcome";
  if (inputStatus === "no_prediction") return imageState.hasLocalSlabImages ? "missing_model_prediction" : "missing_replayable_image";
  if (inputStatus === "placeholder_mirror") return "placeholder_mirror";
  if (!officialBand || officialBand === "unknown") return "official_band_unknown";
  if (bandAgreement === "match") return "aligned_real_trace";
  if (!predictedBand) return "missing_condition_band";
  const officialIndex = BAND_ORDER.indexOf(officialBand);
  const predictedIndex = BAND_ORDER.indexOf(predictedBand);
  if (predictedIndex > officialIndex) return "overconfident_clean_or_under_detected_dings";
  if (predictedIndex < officialIndex) return "overflagged_damage_or_glare_false_positive";
  return "calibration_mismatch";
}

function judgeReasons({ inputStatus, imageState, bandAgreement, predictedConfidence, ref, missingBlockingTools }) {
  const reasons = [];
  if (inputStatus === "placeholder_mirror") reasons.push("Prediction is zero-confidence placeholder mirror; it cannot prove model performance.");
  if (inputStatus === "no_prediction") reasons.push("No model/tool prediction exists for this cert reference.");
  if (!imageState.hasLocalSlabImages && !imageState.hasRawPreSubmissionScan) reasons.push("No local replayable image artifact is attached to the eval trace.");
  if (bandAgreement === "mismatch" || bandAgreement === "adjacent") reasons.push(`Band agreement is ${bandAgreement}; needs mismatch review.`);
  if (Number.isFinite(predictedConfidence) && predictedConfidence < 0.6) reasons.push("Prediction confidence is below the promotion floor.");
  if (ref.provider === "TAG") reasons.push("TAG reference remains link-only/no-bulk-scrape unless permission or user screenshots exist.");
  if (ref.needsRawScanForGold) reasons.push("Still needs raw pre-submission scan plus human DING review to become Gold.");
  if (missingBlockingTools.length > 0) reasons.push(`Missing production agent tools: ${missingBlockingTools.map((tool) => tool.tool).join(", ")}.`);
  return reasons.length > 0 ? reasons : ["Grounded system trace is sufficient for this eval row."];
}

function proposeSelfCorrection({ ref, officialBand, predictedBand, bandAgreement, inputStatus, imageState, prediction }) {
  const actions = [];
  if (!imageState.hasLocalSlabImages && ref.hasFrontBackSlabImages) {
    actions.push("Attach user-permitted slab front/back images under data/cert-references/slab-images/<cert_id>/.");
  }
  if (inputStatus === "no_prediction") {
    actions.push("Run pnpm eval:certrefs:run after images are attached, then pnpm eval:certrefs:bands.");
  }
  if (inputStatus === "placeholder_mirror") {
    actions.push("Replace baseline mirror rows in predictions.json with real inference outputs before claiming alignment.");
  }
  if (bandAgreement === "mismatch" && officialBand && predictedBand) {
    const officialIndex = BAND_ORDER.indexOf(officialBand);
    const predictedIndex = BAND_ORDER.indexOf(predictedBand);
    if (predictedIndex > officialIndex) {
      actions.push("Create overconfident-clean failure: force corner/edge/surface crop review and human DING adjudication.");
    } else if (predictedIndex < officialIndex) {
      actions.push("Create overflagged-damage failure: add glare/texture false-positive review and rerun detector on low-glare crop.");
    }
  }
  if (prediction?.dingsSummary && String(prediction.dingsSummary).includes("0 findings") && officialBand && BAND_ORDER.indexOf(officialBand) < BAND_ORDER.indexOf("900-949_mint")) {
    actions.push("Escalate false-clean case: official lower-band reference had no detected findings.");
  }
  if (ref.provider === "TAG") {
    actions.push("Keep TAG as report-convention reference until user-provided screenshots or partner permission are available.");
  }
  if (actions.length === 0) actions.push("Keep as calibration witness; no method promotion until Gold data and real traces exist.");
  return {
    priority: inputStatus === "real_prediction" && bandAgreement === "match" ? "monitor" : "review",
    actions,
  };
}

function summarizeAgenticRows(rows) {
  const scoreAverage = (selector) => {
    if (rows.length === 0) return 0;
    return round(rows.reduce((sum, row) => sum + selector(row), 0) / rows.length);
  };
  const byBucket = {};
  for (const row of rows) byBucket[row.judge.failureBucket] = (byBucket[row.judge.failureBucket] ?? 0) + 1;
  return {
    references: rows.length,
    realPredictions: rows.filter((row) => row.inputStatus === "real_prediction").length,
    placeholderPredictions: rows.filter((row) => row.inputStatus === "placeholder_mirror").length,
    noPredictions: rows.filter((row) => row.inputStatus === "no_prediction").length,
    replayableImageRefs: rows.filter((row) => row.imageState.hasLocalSlabImages || row.imageState.hasRawPreSubmissionScan).length,
    goldRefs: rows.filter((row) => row.trustTier === "gold" || row.trustTier === "gold_candidate").length,
    matches: rows.filter((row) => row.bandAgreement === "match").length,
    adjacent: rows.filter((row) => row.bandAgreement === "adjacent").length,
    mismatches: rows.filter((row) => row.bandAgreement === "mismatch").length,
    needsReview: rows.filter((row) => row.judge.verdict !== "pass").length,
    averageScores: {
      overall: scoreAverage((row) => row.judge.overallScore),
      grounding: scoreAverage((row) => row.judge.scores.grounding),
      toolCoverage: scoreAverage((row) => row.judge.scores.toolCoverage),
      calibration: scoreAverage((row) => row.judge.scores.calibration),
      evidence: scoreAverage((row) => row.judge.scores.evidence),
      trustSafety: scoreAverage((row) => row.judge.scores.trustSafety),
    },
    failureBuckets: byBucket,
    missingPromotionTools: countMissingPromotionTools(rows),
  };
}

function countMissingPromotionTools(rows) {
  const counts = {};
  for (const row of rows) {
    for (const item of row.toolImplementation) {
      if (item.status !== "missing" || !item.requiredForPromotion) continue;
      counts[item.tool] = (counts[item.tool] ?? 0) + 1;
    }
  }
  return counts;
}

function evaluatePromotionGates({ rows, totals, refSummary, toolSurface }) {
  const gates = [
    gate("references_loaded", "Certified references are loaded", rows.length > 0, `${rows.length} references judged.`),
    gate("external_refs_not_training_data", "External references are not training data", refSummary.trainingViolations === 0, `${refSummary.trainingViolations} training-policy violations.`),
    gate("tag_no_bulk_scrape", "TAG remains link-only/no-bulk-scrape", refSummary.tagBulkScrapeViolations === 0, `${refSummary.tagBulkScrapeViolations} TAG policy violations.`),
    gate("no_placeholder_predictions", "No placeholder mirror predictions", totals.placeholderPredictions === 0, `${totals.placeholderPredictions} placeholder predictions found.`),
    gate("minimum_real_predictions", "At least five real model traces", totals.realPredictions >= 5, `${totals.realPredictions} real predictions available.`),
    gate("gold_eval_set_exists", "Gold/gold-candidate eval set exists", totals.goldRefs > 0, `${totals.goldRefs} Gold/gold-candidate references.`),
    gate("replayable_evidence_exists", "Every predicted row has replayable image evidence", rows.filter((row) => row.predictedBand && !row.imageState.hasLocalSlabImages && !row.imageState.hasRawPreSubmissionScan).length === 0, `${rows.filter((row) => row.predictedBand && !row.imageState.hasLocalSlabImages && !row.imageState.hasRawPreSubmissionScan).length} predicted rows lack replayable images.`),
    gate("judge_grounding_floor", "Average grounding score is promotion-ready", totals.averageScores.grounding >= 0.75, `grounding=${totals.averageScores.grounding}`),
    gate("judge_evidence_floor", "Average evidence score is promotion-ready", totals.averageScores.evidence >= 0.7, `evidence=${totals.averageScores.evidence}`),
    gate("agent_tool_surface_complete", "Production agent tool surface covers promotion-required plan", toolSurface.missingRequired.length === 0, `${toolSurface.missingRequired.join(", ") || "all required tools implemented"}.`),
    gate("human_review_queue_empty", "No non-pass judge verdicts remain", totals.needsReview === 0, `${totals.needsReview} rows need review.`),
  ];
  return gates;
}

function gate(id, label, passed, detail) {
  return { id, label, passed, detail };
}

function renderMarkdown(report) {
  const topBuckets = Object.entries(report.totals.failureBuckets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const worstRows = [...report.rows]
    .sort((a, b) => a.judge.overallScore - b.judge.overallScore)
    .slice(0, 12);
  return [
    "# Agentic Certified Reference Eval Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Deployable: **${report.deployable ? "yes" : "no"}**`,
    "",
    "This evaluates the whole inspection system: agent policy, image-manipulation tools, ML model outputs, calibration logic, evidence readiness, and grounded report explanation. It does not claim official grade prediction.",
    "",
    "## Totals",
    "",
    `- References: ${report.totals.references}`,
    `- Real predictions: ${report.totals.realPredictions}`,
    `- Placeholder predictions: ${report.totals.placeholderPredictions}`,
    `- No predictions: ${report.totals.noPredictions}`,
    `- Replayable image refs: ${report.totals.replayableImageRefs}`,
    `- Gold/gold-candidate refs: ${report.totals.goldRefs}`,
    `- Average overall judge score: ${report.totals.averageScores.overall}`,
    `- Missing promotion tools: ${report.toolSurface.missingRequired.length}`,
    "",
    "## Current Agent Tool Surface",
    "",
    `Implemented pi-ai/report-agent tools detected: ${report.toolSurface.implemented.length}`,
    "",
    "| Conceptual tool | Production status | Implemented by |",
    "| --- | --- | --- |",
    ...report.toolSurface.required.map((tool) => `| ${tool.tool} | ${tool.status} | ${tool.implementedBy.join(", ") || "missing"} |`),
    "",
    "## Gates",
    "",
    "| Gate | Status | Detail |",
    "| --- | --- | --- |",
    ...report.gates.map((gate) => `| ${gate.label} | ${gate.passed ? "PASS" : "BLOCKED"} | ${gate.detail} |`),
    "",
    "## Failure Buckets",
    "",
    "| Bucket | Rows |",
    "| --- | ---: |",
    ...topBuckets.map(([bucket, count]) => `| ${bucket} | ${count} |`),
    "",
    "## Lowest-Scoring Rows",
    "",
    "| Reference | Outcome | Predicted | Judge | Bucket | Next action |",
    "| --- | --- | --- | ---: | --- | --- |",
    ...worstRows.map((row) => {
      const action = row.selfCorrection.actions[0] ?? "Review.";
      return `| ${row.provider} ${row.certNumber} | ${row.officialGrade ?? "pending"} | ${row.predictedBand ?? "none"} | ${row.judge.overallScore} | ${row.judge.failureBucket} | ${escapeMarkdown(action)} |`;
    }),
    "",
    "## Judge Replay Artifacts",
    "",
    "The deterministic local judge is the default laptop-safe judge. Replayable LLM judge inputs are written to:",
    "",
    "- `data/cert-references/agentic-eval/latest.judge-prompts.jsonl`",
    "",
    "Use those rows with pi-ai/OpenAI later to compare the local judge against a real model judge without changing the eval schema.",
    "",
  ].join("\n");
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
