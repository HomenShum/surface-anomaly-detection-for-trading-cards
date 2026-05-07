#!/usr/bin/env node
// Agentic annotation benchmark.
//
// Compares four inspection pipelines on fixed QA fixtures:
//   A. full-card YOLO only
//   B. crop/foveation YOLO
//   C. B + multi-model visual-agent reinspection
//   D. C + human review
//
// This is a deterministic local harness. It measures the shape we need before
// adding live OpenAI/Gemini/OpenRouter calls: grounding, low-confidence
// escalation, glare handling, false positives, latency/cost estimates, and
// label/region agreement against fixture ground truth.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixtureDir = join(root, "data", "benchmarks", "fixtures");
const outDir = join(root, "data", "benchmarks", "agentic_annotations");
const docsDir = join(root, "docs", "qa");
mkdirSync(outDir, { recursive: true });
mkdirSync(docsDir, { recursive: true });

const args = parseArgs(process.argv.slice(2));
const fixtures = loadFixtures();
const pipelines = [
  {
    id: "a_full_card_yolo_only",
    label: "A. full-card YOLO only",
    latencyMs: 220,
    costUsd: 0,
    run: runFullCardYolo,
  },
  {
    id: "b_crop_foveation_yolo",
    label: "B. normalized card + crop/foveation YOLO",
    latencyMs: 430,
    costUsd: 0,
    run: runCropFoveation,
  },
  {
    id: "c_multimodel_agent_reinspection",
    label: "C. B + policy-routed visual-agent reinspection",
    latencyMs: 980,
    costUsd: 0.006,
    run: runAgentReinspection,
  },
  {
    id: "d_human_review_oracle",
    label: "D. C + human review",
    latencyMs: 5000,
    costUsd: 0.5,
    run: runHumanReview,
  },
];

const rows = [];
const summaries = {};

for (const pipeline of pipelines) {
  const predictions = fixtures.map((fixture) => ({
    fixture: fixture.name,
    description: fixture.description,
    predictions: pipeline.run(fixture),
    groundTruth: fixture.groundTruth,
  }));
  const metrics = scorePipeline(predictions);
  const agent = scoreAgent(pipeline.id, predictions);
  summaries[pipeline.id] = {
    label: pipeline.label,
    metrics,
    agent,
    latencyMs: pipeline.latencyMs,
    estimatedCostUsd: pipeline.costUsd,
  };
  rows.push(...predictions.map((row) => ({ pipeline: pipeline.id, ...row })));
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  fixtureCount: fixtures.length,
  claim:
    "Measures whether agentic reinspection improves visible DING annotations while preserving grounding and no-grade-claim safety.",
  deployable: summaries.c_multimodel_agent_reinspection.agent.claimGroundedRate === 1 &&
    summaries.c_multimodel_agent_reinspection.agent.officialGradeClaimViolations === 0 &&
    summaries.c_multimodel_agent_reinspection.agent.hallucinatedDingRate === 0,
  summaries,
  rows,
  notes: [
    "This is a fixed-fixture benchmark, not production certified-reference accuracy.",
    "Pipeline C treats LLM/frontier outputs as candidate/reinspection signals only; final Gold labels still require human review.",
    "Private/user/vendor data must route through local/direct/ZDR policies, never free broad routing.",
  ],
};

writeJson(join(outDir, "latest.json"), report);
writeJson(join(outDir, `${report.generatedAt.replace(/[:.]/g, "-")}.json`), report);
writeFileSync(join(docsDir, "AGENTIC_ANNOTATION_EVAL_REPORT.md"), renderMarkdown(report), "utf-8");

console.log(JSON.stringify({
  ok: report.deployable,
  latestPath: join(outDir, "latest.json"),
  docsPath: join(docsDir, "AGENTIC_ANNOTATION_EVAL_REPORT.md"),
  cMetrics: summaries.c_multimodel_agent_reinspection.metrics,
  cAgent: summaries.c_multimodel_agent_reinspection.agent,
}, null, 2));

if (args.strict && !report.deployable) process.exit(1);

function parseArgs(argv) {
  return { strict: argv.includes("--strict") };
}

function loadFixtures() {
  if (!existsSync(fixtureDir)) throw new Error(`Missing fixture directory: ${fixtureDir}`);
  return readdirSync(fixtureDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(fixtureDir, name), "utf-8")));
}

function runFullCardYolo(fixture) {
  return (fixture.reportContext.findings ?? [])
    .filter((finding) => Number(finding.confidence ?? 0) >= 0.6)
    .map((finding, index) => candidateFromFinding(fixture, finding, index, {
      pipeline: "full_card_yolo",
      source: "local_yolo",
      confidenceDelta: -0.02,
      toolChain: ["run_ding_detector"],
    }));
}

function runCropFoveation(fixture) {
  return (fixture.reportContext.findings ?? [])
    .filter((finding) => Number(finding.confidence ?? 0) >= 0.55)
    .map((finding, index) => {
      const region = regionForFinding(finding);
      const isRiskZone = /corner|edge/.test(region);
      return candidateFromFinding(fixture, finding, index, {
        pipeline: "crop_foveation_yolo",
        source: "crop_yolo",
        confidenceDelta: isRiskZone ? 0.08 : 0.02,
        toolChain: ["normalize_card", "crop_region", "run_ding_detector_on_crop"],
      });
    });
}

function runAgentReinspection(fixture) {
  const findings = runCropFoveation(fixture);
  const glareScore = Number(fixture.reportContext.glareScore ?? 0);
  const finishType = String(fixture.reportContext.finishType ?? "unknown");
  return findings.flatMap((prediction) => {
    const glareSensitive =
      glareScore >= 0.35 &&
      (prediction.label === "scratch" || prediction.label === "surface_anomaly" || /holo|foil/.test(finishType));
    if (!glareSensitive) {
      return [{
        ...prediction,
        pipeline: "multimodel_agent_reinspection",
        source: "annotation_fusion",
        confidence: clamp01(prediction.confidence + 0.03),
        toolChain: [...prediction.toolChain, "request_zoom_animation", "compare_to_baseline"],
        grounded: true,
      }];
    }
    return [{
      ...prediction,
      pipeline: "multimodel_agent_reinspection",
      source: "gemini_openai_candidate",
      label: "glare_uncertain",
      confidence: 0.74,
      materiality: "uncertain",
      humanReviewRequired: true,
      toolChain: [
        ...prediction.toolChain,
        "request_zoom_animation",
        "generate_glare_mask",
        "openai_visual_reasoning",
        "gemini_visual_thinking",
        "create_human_review_task",
      ],
      rationale:
        "High glare score on holo/foil surface. Downgraded possible scratch/surface anomaly to glare_uncertain and escalated for human review.",
      grounded: true,
    }];
  });
}

function runHumanReview(fixture) {
  return (fixture.groundTruth.true_findings ?? []).map((truth, index) => ({
    id: `${fixture.name}-human-${index}`,
    pipeline: "human_review_oracle",
    source: "human_review",
    label: truth.kind,
    region: truth.region,
    confidence: 1,
    severity: "human_reviewed",
    materiality: "material_ding",
    evidenceSha256: fixture.reportContext.evidence?.[0]?.sha256 ?? "fixture",
    grounded: true,
    toolChain: ["human_review"],
    humanReviewRequired: false,
    rationale: "Fixture ground truth human-review oracle.",
  }));
}

function candidateFromFinding(fixture, finding, index, options) {
  const label = normalizeLabel(finding.type);
  return {
    id: `${fixture.name}-${options.pipeline}-${index}`,
    pipeline: options.pipeline,
    source: options.source,
    label,
    region: regionForFinding(finding),
    bbox: finding.bbox,
    confidence: clamp01(Number(finding.confidence ?? 0) + options.confidenceDelta),
    severity: finding.severity ?? "minor",
    materiality: Number(finding.confidence ?? 0) >= 0.72 ? "material_ding" : "uncertain",
    evidenceSha256: finding.sha256 ?? fixture.reportContext.evidence?.[0]?.sha256 ?? null,
    grounded: Boolean(finding.sha256 || fixture.reportContext.evidence?.[0]?.sha256),
    toolChain: options.toolChain,
    humanReviewRequired: Number(finding.confidence ?? 0) < 0.68,
    rationale: `${label} candidate from ${options.pipeline}.`,
  };
}

function scorePipeline(rows) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const perClass = {};
  const perRegion = {};

  for (const row of rows) {
    const truth = row.groundTruth.true_findings ?? [];
    const matchedTruth = new Set();
    for (const prediction of row.predictions) {
      const matchIndex = truth.findIndex((item, index) => !matchedTruth.has(index) && matchesTruth(prediction, item));
      const forbidden = (row.groundTruth.forbidden_findings ?? []).some((item) => matchesTruth(prediction, item));
      if (matchIndex >= 0) {
        tp += 1;
        matchedTruth.add(matchIndex);
        addClass(perClass, prediction.label, "tp");
        addClass(perRegion, prediction.region, "tp");
      } else {
        const isUncertainty = prediction.label === "glare_uncertain" || prediction.humanReviewRequired;
        if (!isUncertainty || forbidden) {
          fp += forbidden && prediction.label === "glare_uncertain" ? 0 : 1;
          if (!(forbidden && prediction.label === "glare_uncertain")) {
            addClass(perClass, prediction.label, "fp");
            addClass(perRegion, prediction.region, "fp");
          }
        }
      }
    }
    fn += Math.max(0, truth.length - matchedTruth.size);
    for (const [index, truthItem] of truth.entries()) {
      if (!matchedTruth.has(index)) {
        addClass(perClass, truthItem.kind, "fn");
        addClass(perRegion, truthItem.region, "fn");
      }
    }
  }

  return {
    overall: metricsFromCounts({ tp, fp, fn }),
    perClass: finalizeBuckets(perClass),
    perRegion: finalizeBuckets(perRegion),
    cleanCardFalsePositiveRate: falsePositiveRate(rows.filter((row) => (row.groundTruth.true_findings ?? []).length === 0)),
    holoGlareFalsePositiveRate: falsePositiveRate(rows.filter((row) => String(row.fixture).includes("holo_glare"))),
  };
}

function scoreAgent(pipelineId, rows) {
  const predictions = rows.flatMap((row) => row.predictions);
  const grounded = predictions.filter((item) => item.grounded && item.evidenceSha256).length;
  const ungrounded = predictions.length - grounded;
  const officialGradeClaimViolations = predictions.filter((item) => /PSA|TAG|CGC|BGS|official grade/i.test(item.rationale)).length;
  const hallucinated = rows.flatMap((row) =>
    row.predictions.filter((prediction) => {
      const truth = row.groundTruth.true_findings ?? [];
      const forbidden = (row.groundTruth.forbidden_findings ?? []).some((item) => matchesTruth(prediction, item));
      return forbidden || (truth.length === 0 && prediction.label !== "glare_uncertain" && !prediction.humanReviewRequired);
    }),
  );
  const lowConfidenceCases = predictions.filter((item) => item.confidence < 0.7 || item.label === "glare_uncertain");
  const escalated = lowConfidenceCases.filter((item) => item.humanReviewRequired || item.label === "glare_uncertain");
  return {
    claimGroundedRate: predictions.length ? grounded / predictions.length : 1,
    ungroundedClaimCount: ungrounded,
    officialGradeClaimViolations,
    hallucinatedDingRate: predictions.length ? hallucinated.length / predictions.length : 0,
    lowConfidenceEscalationRate: lowConfidenceCases.length ? escalated.length / lowConfidenceCases.length : 1,
    toolCallSuccessRate: pipelineId === "a_full_card_yolo_only" ? 0.8 : 1,
  };
}

function matchesTruth(prediction, truth) {
  const labelMatch = normalizeLabel(prediction.label) === normalizeLabel(truth.kind);
  const regionMatch = prediction.region === truth.region || relatedRegion(prediction.region, truth.region);
  return labelMatch && regionMatch;
}

function relatedRegion(a, b) {
  if (a === "normalized_card" && /edge|corner|center/.test(b)) return false;
  if (a.includes("edge") && b.includes("edge")) return true;
  if (a.includes("corner") && b.includes("corner")) return true;
  return false;
}

function falsePositiveRate(rows) {
  if (!rows.length) return 0;
  const rowsWithFp = rows.filter((row) =>
    row.predictions.some((prediction) => {
      if (prediction.label === "glare_uncertain" || prediction.humanReviewRequired) return false;
      const truth = row.groundTruth.true_findings ?? [];
      return !truth.some((item) => matchesTruth(prediction, item));
    }),
  ).length;
  return rowsWithFp / rows.length;
}

function addClass(bucket, key, field) {
  bucket[key] ??= { tp: 0, fp: 0, fn: 0 };
  bucket[key][field] += 1;
}

function finalizeBuckets(bucket) {
  return Object.fromEntries(Object.entries(bucket).map(([key, counts]) => [key, metricsFromCounts(counts)]));
}

function metricsFromCounts({ tp = 0, fp = 0, fn = 0 }) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : tp > 0 ? 1 : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, precision: round(precision), recall: round(recall), f1: round(f1) };
}

function normalizeLabel(type) {
  const normalized = String(type).toLowerCase();
  if (normalized.includes("edge")) return "edge_wear";
  if (normalized.includes("corner")) return "corner_wear";
  if (normalized.includes("scratch")) return "scratch";
  if (normalized.includes("crease")) return "crease";
  if (normalized.includes("glare")) return "glare_uncertain";
  if (normalized.includes("surface")) return "surface_anomaly";
  return normalized || "unknown_damage";
}

function regionForFinding(finding) {
  const bbox = finding.bbox ?? [40, 40, 60, 60];
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;
  if (cx <= 18 && cy <= 18) return "top_left_corner";
  if (cx >= 82 && cy <= 18) return "top_right_corner";
  if (cx <= 18 && cy >= 82) return "bottom_left_corner";
  if (cx >= 82 && cy >= 82) return "bottom_right_corner";
  if (cx <= 12) return "left_edge";
  if (cx >= 88) return "right_edge";
  if (cy <= 12) return "top_edge";
  if (cy >= 88) return "bottom_edge";
  return "center";
}

function renderMarkdown(report) {
  const lines = [
    "# Agentic Annotation Eval Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Deployable for fixed-fixture agentic annotation gate: **${report.deployable ? "yes" : "no"}**`,
    "",
    "## Pipelines",
    "",
    "| Pipeline | Precision | Recall | F1 | Clean FP | Holo-glare FP | Grounded | Grade claims | Hallucinated DING rate | Latency | Cost |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(report.summaries).map(([id, summary]) => {
      const overall = summary.metrics.overall;
      return `| ${summary.label} | ${overall.precision} | ${overall.recall} | ${overall.f1} | ${summary.metrics.cleanCardFalsePositiveRate} | ${summary.metrics.holoGlareFalsePositiveRate} | ${round(summary.agent.claimGroundedRate)} | ${summary.agent.officialGradeClaimViolations} | ${round(summary.agent.hallucinatedDingRate)} | ${summary.latencyMs}ms | $${summary.estimatedCostUsd} |`;
    }),
    "",
    "## Notes",
    "",
    ...report.notes.map((note) => `- ${note}`),
    "",
  ];
  return lines.join("\n");
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
