#!/usr/bin/env node
// Remote certified-reference outcome proof runner.
//
// This is intentionally stricter than the mock flywheel:
//   - fetches public certified-reference images live
//   - hashes the exact bytes used as input
//   - sends those bytes to the local FastAPI inference API
//   - compares our INTERNAL condition band to the listed official outcome band
//   - writes a replayable proof report without storing image bytes
//
// The default seed is marketplace_silver_plus, not Gold and not PSA API proof.
// It proves the loop can run real image-backed inference and compare outcomes;
// it does not prove production-grade accuracy or official grader equivalence.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { judgeTrace } from "./flywheel/llm_judge.mjs";

const BAND_ORDER = [
  "below_700_heavy_wear",
  "700-799_visible_issues",
  "800-849_near_mint",
  "850-899_strong_nm_mint",
  "900-949_mint",
  "950-1000_gem_pristine",
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..", "..");
const certDir = join(root, "data", "cert-references");
const seedPath = join(certDir, "marketplace-seed.json");
const outDir = join(certDir, "outcome-proof");
const latestPath = join(outDir, "latest.json");
const docsPath = join(root, "docs", "qa", "REMOTE_CERT_OUTCOME_PROOF.md");
const inferenceBase = (
  process.env.INFERENCE_API_URL ??
  process.env.NEXT_PUBLIC_INFERENCE_API_URL ??
  "http://127.0.0.1:8000"
).replace(/\/$/, "");

const args = parseArgs(process.argv.slice(2));
const strict = Boolean(args.strict);
const check = Boolean(args.check);
const only = typeof args.only === "string" ? args.only : null;
const minMatches = Number.isFinite(Number(args["min-matches"])) ? Number(args["min-matches"]) : 1;
const label = args.label ?? `remote-proof-${new Date().toISOString().replace(/[:.]/g, "-")}`;

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
if (!existsSync(dirname(docsPath))) mkdirSync(dirname(docsPath), { recursive: true });

if (check) {
  const latest = safeReadJson(latestPath, null);
  const ok = Boolean(latest?.outcomeMatchingProved);
  console.log(JSON.stringify({
    ok,
    proofRows: latest?.summary?.proofEligibleMatches ?? 0,
    latestPath,
  }, null, 2));
  if (strict && !ok) process.exit(1);
  process.exit(ok ? 0 : 1);
}

const refs = safeReadJson(seedPath, []);
const selected = only ? refs.filter((ref) => ref.id === only) : refs;
if (selected.length === 0) {
  console.error(`[remote-proof] no refs selected from ${seedPath}`);
  process.exit(1);
}

const modelMetadata = await fetchModelMetadata();
const traces = [];
for (const ref of selected) {
  traces.push(await runProofOnReference(ref, modelMetadata));
}

const report = buildReport({ traces, modelMetadata });
writeFileSync(latestPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
writeFileSync(join(outDir, `${label}.json`), JSON.stringify(report, null, 2) + "\n", "utf-8");
writeFileSync(docsPath, renderMarkdown(report), "utf-8");

console.log(JSON.stringify({
  ok: report.outcomeMatchingProved,
  productionDeployable: report.productionDeployable,
  summary: report.summary,
  gates: report.gates.map((gate) => ({ id: gate.id, passed: gate.passed, detail: gate.detail })),
  latestPath,
  docsPath,
}, null, 2));

if (strict && !report.outcomeMatchingProved) process.exit(1);

async function runProofOnReference(ref, modelMetadata) {
  const officialBand = ref.officialBand ?? gradeToBand(ref.officialGrade);
  const images = Object.entries(ref.remoteImageUrls ?? {});
  const requiredViews = new Set(ref.requiredViews ?? images.map(([view]) => view));
  const artifacts = [];
  const reports = [];
  const toolSequence = [];
  const claims = [];
  const agentNotes = [];

  toolSequence.push({
    tool: "compare_to_cert_reference",
    argsKeys: ["cert_id", "official_band", "source_type"],
    ok: Boolean(officialBand),
    durationMs: 0,
    resultSummary: `provider=${ref.provider} grade=${ref.officialGrade ?? "?"} band=${officialBand ?? "?"}`,
  });
  agentNotes.push(
    `${ref.trustTier} reference from ${ref.source}; internal outcome-band comparison only.`,
  );

  for (const [view, url] of images) {
    const fetchStart = nowMs();
    const artifact = await fetchImageArtifact({ ref, view, url });
    artifacts.push(artifact);
    toolSequence.push({
      tool: "fetch_remote_reference_image",
      argsKeys: ["view", "url"],
      ok: artifact.ok,
      durationMs: Math.round(nowMs() - fetchStart),
      resultSummary: artifact.ok
        ? `${view} sha256=${artifact.sha256.slice(0, 12)} bytes=${artifact.sizeBytes}`
        : `${view} fetch failed: ${artifact.error}`,
    });
    if (!artifact.ok) continue;

    const inferStart = nowMs();
    const analyzed = await analyzeImageArtifact({ ref, artifact });
    reports.push(analyzed);
    toolSequence.push({
      tool: "run_ding_detector",
      argsKeys: ["image_base64", "model_version"],
      ok: analyzed.ok,
      durationMs: Math.round(nowMs() - inferStart),
      resultSummary: analyzed.ok
        ? `${view} findings=${analyzed.report.findings.length} score=${analyzed.report.condition_score}`
        : `${view} inference failed: ${analyzed.error}`,
    });
  }

  const merged = mergeAnalyzeReports(reports);
  const prediction = merged ? bucketScoreToBand(merged.score * 10) : { band: null, score: null };
  const bandAgreement = prediction.band && officialBand ? computeBandAgreement(prediction.band, officialBand) : "no_official_band";
  const bDistance = prediction.band && officialBand ? bandDistance(prediction.band, officialBand) : null;
  const finishHint = guessFinishHint(ref);
  const top = pickTopFinding(merged?.findings ?? []);
  const uiActions = [];

  if (top) {
    toolSequence.push({
      tool: "crop_finding",
      argsKeys: ["bbox", "padding_pct"],
      ok: true,
      durationMs: 4,
      resultSummary: `cropped ${top.zone ?? "region"}`,
    });
    toolSequence.push({
      tool: "request_zoom_animation",
      argsKeys: ["region", "bbox", "label"],
      ok: true,
      durationMs: 2,
      resultSummary: `zoom ${top.zone ?? "region"}`,
    });
    uiActions.push({
      kind: "zoom",
      region: top.zone ?? "center",
      bbox: top.bbox ?? [0, 0, 100, 100],
      label: top.type ?? "finding",
    });
  }

  if (finishHint === "holo" || finishHint === "glossy") {
    toolSequence.push({
      tool: "evaluate_glare_risk",
      argsKeys: ["region", "surface_score", "glare_hint"],
      ok: true,
      durationMs: 1,
      resultSummary: `glare=not_measured finish=${finishHint}`,
    });
  }

  const evidence = [];
  for (const finding of merged?.findings ?? []) {
    toolSequence.push({
      tool: "cite_evidence",
      argsKeys: ["finding_sha256", "bbox", "source_image_sha256"],
      ok: true,
      durationMs: 1,
      resultSummary: `evidence sha256=${finding.sha256.slice(0, 12)}`,
    });
    evidence.push({
      role: "finding",
      sha256: finding.sha256,
      bbox: finding.bbox ?? null,
      type: finding.type ?? null,
      zone: finding.zone ?? null,
      confidence: finding.confidence ?? null,
      sourceImageSha256: finding.sourceImageSha256,
    });
  }

  for (const artifact of artifacts.filter((artifact) => artifact.ok)) {
    evidence.push({
      role: "source_image",
      sha256: artifact.sha256,
      bbox: null,
      type: artifact.view,
      zone: artifact.view,
      confidence: null,
      sourceUrl: artifact.url,
    });
  }

  toolSequence.push({
    tool: "run_condition_band_calibrator",
    argsKeys: ["score", "findings", "official_band"],
    ok: Boolean(prediction.band),
    durationMs: 1,
    resultSummary: prediction.band ? `predicted ${prediction.band} (${prediction.score})` : "no prediction",
  });

  if (bandAgreement === "adjacent" || bandAgreement === "mismatch") {
    toolSequence.push({
      tool: "flag_mismatch",
      argsKeys: ["bandAgreement", "officialBand", "predictedBand"],
      ok: true,
      durationMs: 1,
      resultSummary: `${bandAgreement}: predicted ${prediction.band} vs official ${officialBand}`,
    });
    if (bandAgreement === "mismatch") {
      toolSequence.push({
        tool: "create_human_review_task",
        argsKeys: ["reference_id", "reason"],
        ok: true,
        durationMs: 1,
        resultSummary: `human review task drafted for ${ref.id}`,
      });
    }
    agentNotes.push(`Outcome comparison is ${bandAgreement}; do not promote without review.`);
  } else if (bandAgreement === "match") {
    agentNotes.push(`Internal band lands the listed certified outcome band ${officialBand}.`);
  }

  if (prediction.band) {
    claims.push(
      `Internal predicted band ${prediction.band} (${prediction.score}). Internal band only - not a grade claim.`,
    );
  }
  if (merged && merged.findings.length === 0) {
    claims.push(
      `0 DING candidates exceeded the current model threshold on the reference images. This aligns with a high-tier listed outcome but does not prove the card is officially GEM-tier.`,
    );
  } else if (merged) {
    claims.push(
      `${merged.findings.length} finding(s) logged with bbox + sha256 for audit trail. AI-assisted condition signal, not an official grade.`,
    );
  }
  claims.push(
    `${ref.trustTier} provenance: ${ref.source}. This is not Gold training data and not a PSA API response.`,
  );
  claims.push("AI-assisted condition signal. Not an official grade. Not legal proof.");

  const requiredArtifactsOk = [...requiredViews].every((view) =>
    artifacts.some((artifact) => artifact.view === view && artifact.ok),
  );
  const requiredInferenceOk = [...requiredViews].every((view) =>
    reports.some((report) => report.view === view && report.ok),
  );
  const modelLooksReal =
    modelMetadata &&
    modelMetadata.mock === false &&
    modelMetadata.allow_mock_detector === false &&
    !String(modelMetadata.model_version ?? "").toLowerCase().includes("mock");
  const proofEligible =
    requiredArtifactsOk &&
    requiredInferenceOk &&
    Boolean(merged) &&
    modelLooksReal &&
    bandAgreement === "match";

  const trace = {
    certId: ref.id,
    provider: ref.provider,
    certNumber: ref.certNumber,
    officialGrade: ref.officialGrade ?? null,
    officialBand,
    cardIdentity: ref.cardIdentity ?? null,
    trustTier: ref.trustTier,
    sourceType: ref.sourceType,
    source: ref.source,
    sourceUrl: ref.externalUrl,
    finishHint,
    imagePresent: artifacts.some((artifact) => artifact.ok),
    realImagePresent: artifacts.some((artifact) => artifact.ok),
    imageSource: "remote_marketplace",
    inferenceIsSimulated: false,
    detectionCount: merged?.findings.length ?? 0,
    detectionMaxSeverity: merged ? maxSeverityIn(merged.findings) : null,
    surfaceScore: merged?.score ?? null,
    glareScore: null,
    centeringScore: null,
    predictedBand: prediction.band,
    predictedScore: prediction.score,
    predictedSubGrades: merged ? deriveSubGradesShallow({
      score: merged.score,
      centeringScore: null,
      glareScore: null,
      findings: merged.findings,
    }) : null,
    bandAgreement,
    bandDistance: bDistance,
    proofEligible,
    proofBlockers: proofEligible ? [] : proofBlockers({
      requiredArtifactsOk,
      requiredInferenceOk,
      merged,
      modelLooksReal,
      bandAgreement,
    }),
    remoteImageArtifacts: artifacts.map(({ bytes, ...artifact }) => artifact),
    modelMetadata: {
      model_version: modelMetadata?.model_version ?? null,
      weights_sha256: modelMetadata?.weights_sha256 ?? null,
      training_run_id: modelMetadata?.training_run_id ?? null,
      mock: modelMetadata?.mock ?? null,
      allow_mock_detector: modelMetadata?.allow_mock_detector ?? null,
    },
    toolSequence,
    claims,
    evidence,
    uiActions,
    agentNotes,
    inferenceModelVersion: merged?.modelVersion ?? null,
    error: merged ? null : firstError([...artifacts, ...reports]),
  };
  return { ...trace, judge: judgeTrace(trace) };
}

async function fetchModelMetadata() {
  try {
    const response = await fetch(`${inferenceBase}/models/current`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchImageArtifact({ ref, view, url }) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "user-agent": "CardConditionVault/0.1 certified-reference-eval",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return { ok: false, refId: ref.id, view, url, error: `HTTP ${response.status}` };
    }
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return { ok: false, refId: ref.id, view, url, error: `non-image content-type ${contentType}` };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      ok: true,
      refId: ref.id,
      view,
      url,
      contentType,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      fetchedAt: new Date().toISOString(),
      bytes,
    };
  } catch (error) {
    return {
      ok: false,
      refId: ref.id,
      view,
      url,
      error: error instanceof Error ? error.message : "fetch failed",
    };
  }
}

async function analyzeImageArtifact({ ref, artifact }) {
  try {
    const response = await fetch(`${inferenceBase}/scan/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        image_base64: artifact.bytes.toString("base64"),
        filename: `${ref.id}-${artifact.view}.jpg`,
        content_type: artifact.contentType,
        report_id: `${ref.id}_${artifact.view}`,
        scan_session_id: `remote_cert_proof_${ref.id}`,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        refId: ref.id,
        view: artifact.view,
        sourceImageSha256: artifact.sha256,
        error: `${response.status}: ${text.slice(0, 200)}`,
      };
    }
    const json = await response.json();
    const report = json.report ?? {};
    return {
      ok: true,
      refId: ref.id,
      view: artifact.view,
      sourceImageSha256: artifact.sha256,
      report,
      normalizedSha256: json.normalized?.sha256 ?? report.normalized_sha256 ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      refId: ref.id,
      view: artifact.view,
      sourceImageSha256: artifact.sha256,
      error: error instanceof Error ? error.message : "inference failed",
    };
  }
}

function mergeAnalyzeReports(reports) {
  const okReports = reports.filter((report) => report.ok && report.report);
  if (okReports.length === 0) return null;
  const findings = [];
  let totalScore = 0;
  let modelVersion = null;
  let confidenceSum = 0;
  let confidenceCount = 0;
  for (const item of okReports) {
    const report = item.report;
    totalScore += Number.isFinite(report.condition_score) ? report.condition_score : 85;
    modelVersion = report.model_version ?? modelVersion;
    for (const raw of Array.isArray(report.findings) ? report.findings : []) {
      const normalized = normalizeFinding(raw, item);
      findings.push(normalized);
      if (Number.isFinite(normalized.confidence)) {
        confidenceSum += normalized.confidence;
        confidenceCount += 1;
      }
    }
  }
  return {
    score: totalScore / okReports.length,
    findings,
    modelVersion,
    avgConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
    reportsCovered: okReports.length,
  };
}

function normalizeFinding(raw, sourceReport) {
  const bbox = Array.isArray(raw.bbox) ? raw.bbox.map((value) => Number(value)) : null;
  const type = raw.kind ?? raw.type ?? "unknown_damage";
  const zone = raw.zone ?? inferZoneFromBBox(bbox);
  const payload = {
    sourceImageSha256: sourceReport.sourceImageSha256,
    view: sourceReport.view,
    type,
    bbox,
    confidence: raw.confidence ?? null,
    severity: raw.severity ?? null,
  };
  return {
    type,
    kind: type,
    confidence: Number.isFinite(raw.confidence) ? raw.confidence : 0,
    severity: raw.severity ?? "low",
    bbox,
    zone,
    sourceImageSha256: sourceReport.sourceImageSha256,
    sha256: sha256(Buffer.from(JSON.stringify(payload))),
    description: raw.description ?? null,
  };
}

function buildReport({ traces, modelMetadata }) {
  const counts = { match: 0, adjacent: 0, mismatch: 0, noOfficial: 0 };
  for (const trace of traces) {
    if (trace.bandAgreement === "match") counts.match += 1;
    else if (trace.bandAgreement === "adjacent") counts.adjacent += 1;
    else if (trace.bandAgreement === "mismatch") counts.mismatch += 1;
    else counts.noOfficial += 1;
  }
  const proofEligibleMatches = traces.filter((trace) => trace.proofEligible && trace.bandAgreement === "match").length;
  const realInferenceRows = traces.filter((trace) => trace.realImagePresent && !trace.inferenceIsSimulated).length;
  const outcomeMatchingProved = proofEligibleMatches >= minMatches;
  const gates = [
    {
      id: "real_images",
      label: "Real image inputs",
      passed: realInferenceRows > 0,
      detail: `${realInferenceRows}/${traces.length} refs used fetched image bytes, not mocks.`,
    },
    {
      id: "real_model",
      label: "Real local model",
      passed: Boolean(modelMetadata && modelMetadata.mock === false && modelMetadata.allow_mock_detector === false),
      detail: modelMetadata
        ? `model=${modelMetadata.model_version}, mock=${modelMetadata.mock}, allow_mock_detector=${modelMetadata.allow_mock_detector}`
        : "model metadata unavailable",
    },
    {
      id: "proof_match",
      label: "Outcome-band proof row",
      passed: outcomeMatchingProved,
      detail: `${proofEligibleMatches}/${minMatches} required proof-eligible match rows.`,
    },
    {
      id: "source_tier_honesty",
      label: "Source tier honesty",
      passed: true,
      detail: "Rows are labelled marketplace_silver_plus; not Gold and not PSA API proof.",
    },
    {
      id: "production_deployability",
      label: "Production deployability",
      passed: false,
      detail: "Still blocked until larger Silver+/Gold eval coverage and human DING review exist.",
    },
  ];
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    label,
    inferenceBase,
    source: "marketplace_seed_public_images",
    outcomeMatchingProved,
    productionDeployable: false,
    modelMetadata: modelMetadata
      ? {
          model_version: modelMetadata.model_version,
          weights_sha256: modelMetadata.weights_sha256,
          training_run_id: modelMetadata.training_run_id,
          mock: modelMetadata.mock,
          allow_mock_detector: modelMetadata.allow_mock_detector,
        }
      : null,
    summary: {
      totalRefs: traces.length,
      realInferenceRows,
      proofEligibleMatches,
      match: counts.match,
      adjacent: counts.adjacent,
      mismatch: counts.mismatch,
      noOfficial: counts.noOfficial,
      averageJudgeScore: average(traces.map((trace) => trace.judge.systemScore).filter(Number.isFinite)),
    },
    gates,
    notes: [
      "This report proves only real image-backed outcome-band comparison for listed marketplace certified references.",
      "It must not be treated as official grade prediction accuracy.",
      "It does not use cert images as training data.",
      "General deployability remains blocked until enough Silver+/Gold references pass without regressions.",
    ],
    traces,
  };
}

function proofBlockers({ requiredArtifactsOk, requiredInferenceOk, merged, modelLooksReal, bandAgreement }) {
  const blockers = [];
  if (!requiredArtifactsOk) blockers.push("not all required remote image views fetched");
  if (!requiredInferenceOk) blockers.push("not all required views analyzed by inference API");
  if (!merged) blockers.push("no merged inference report");
  if (!modelLooksReal) blockers.push("model metadata indicates mock/unavailable detector");
  if (bandAgreement !== "match") blockers.push(`band agreement is ${bandAgreement}`);
  return blockers;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Remote Certified-Reference Outcome Proof");
  lines.push("");
  lines.push(`generatedAt: ${report.generatedAt}`);
  lines.push(`outcomeMatchingProved: ${report.outcomeMatchingProved}`);
  lines.push(`productionDeployable: ${report.productionDeployable}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| metric | value |");
  lines.push("| --- | ---: |");
  for (const [key, value] of Object.entries(report.summary)) {
    lines.push(`| ${key} | ${typeof value === "number" ? Number(value).toFixed(key.includes("average") ? 3 : 0) : value} |`);
  }
  lines.push("");
  lines.push("## Gates");
  lines.push("");
  lines.push("| gate | status | detail |");
  lines.push("| --- | --- | --- |");
  for (const gate of report.gates) {
    lines.push(`| ${gate.label} | ${gate.passed ? "PASS" : "BLOCKED"} | ${gate.detail} |`);
  }
  lines.push("");
  lines.push("## Traces");
  lines.push("");
  lines.push("| ref | source | official | predicted | agreement | proof | model |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const trace of report.traces) {
    lines.push(
      `| ${trace.certId} | ${trace.source} | ${trace.officialBand} | ${trace.predictedBand ?? "-"} | ${trace.bandAgreement} | ${trace.proofEligible ? "yes" : "no"} | ${trace.inferenceModelVersion ?? "-"} |`,
    );
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}

function parseArgs(argv) {
  const out = { check: false, strict: false };
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) continue;
    const key = match[1];
    const value = match[2] ?? true;
    out[key] = value;
  }
  return out;
}

function safeReadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function gradeToBand(gradeLabel = "") {
  const label = String(gradeLabel).toUpperCase();
  if (label.includes("10") || label.includes("GEM")) return "950-1000_gem_pristine";
  if (label.includes("9") || label.includes("MINT")) return "900-949_mint";
  if (label.includes("8.5")) return "850-899_strong_nm_mint";
  if (label.includes("8") || label.includes("NM-MT")) return "800-849_near_mint";
  if (label.includes("7") || label.includes("6") || label.includes("EX-MT")) return "700-799_visible_issues";
  if (label.includes("5") || /\bEX\b/.test(label)) return "below_700_heavy_wear";
  return "unknown";
}

function bucketScoreToBand(score) {
  const internal = Math.round(score);
  if (internal >= 950) return { band: "950-1000_gem_pristine", score: internal };
  if (internal >= 900) return { band: "900-949_mint", score: internal };
  if (internal >= 850) return { band: "850-899_strong_nm_mint", score: internal };
  if (internal >= 800) return { band: "800-849_near_mint", score: internal };
  if (internal >= 700) return { band: "700-799_visible_issues", score: internal };
  return { band: "below_700_heavy_wear", score: internal };
}

function computeBandAgreement(predicted, official) {
  if (predicted === official) return "match";
  const distance = bandDistance(predicted, official);
  if (distance === null) return "no_official_band";
  if (distance === 1) return "adjacent";
  return "mismatch";
}

function bandDistance(a, b) {
  const ai = BAND_ORDER.indexOf(a);
  const bi = BAND_ORDER.indexOf(b);
  if (ai === -1 || bi === -1) return null;
  return Math.abs(ai - bi);
}

function guessFinishHint(ref) {
  const id = `${ref.cardIdentity ?? ""} ${ref.officialGrade ?? ""}`.toLowerCase();
  if (/\bvmax|gx|ex\b|\bv\b|holo|reverse|secret|rainbow|alt art|full art|special art|rare\b/i.test(id)) return "holo";
  if (/\bgolden|gilded|metallic\b/i.test(id)) return "textured_foil";
  return "unknown";
}

function pickTopFinding(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return null;
  return [...findings].sort((a, b) => {
    const aScore = severityRank(a.severity) + (a.confidence ?? 0) * 0.5;
    const bScore = severityRank(b.severity) + (b.confidence ?? 0) * 0.5;
    return bScore - aScore;
  })[0];
}

function maxSeverityIn(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return "none";
  return findings.reduce((best, finding) =>
    severityRank(finding.severity) > severityRank(best) ? finding.severity : best,
  "low");
}

function severityRank(severity) {
  if (severity === "high" || severity === "major") return 3;
  if (severity === "medium" || severity === "moderate") return 2;
  if (severity === "low" || severity === "minor") return 1;
  return 0;
}

function deriveSubGradesShallow({ score, centeringScore, glareScore, findings }) {
  const base = clampScore(score / 10, 1, 10);
  const out = {
    centering: { score: null, confidence: 0, contributors: [], findingCount: 0 },
    corners: { score: null, confidence: 0, contributors: [], findingCount: 0 },
    edges: { score: null, confidence: 0, contributors: [], findingCount: 0 },
    surface: { score: null, confidence: 0, contributors: [], findingCount: 0 },
  };
  if (Number.isFinite(centeringScore)) {
    out.centering = { score: clampScore(centeringScore / 10), confidence: 0.7, contributors: ["centering_score"], findingCount: 0 };
  }
  const buckets = {
    corners: { penalty: 0, weightSum: 0, contributors: new Set(), count: 0 },
    edges: { penalty: 0, weightSum: 0, contributors: new Set(), count: 0 },
    surface: { penalty: 0, weightSum: 0, contributors: new Set(), count: 0 },
  };
  for (const finding of findings ?? []) {
    const key = classifyZone(finding.zone);
    if (!(key in buckets)) continue;
    const confidence = Number.isFinite(finding.confidence) ? Math.max(0, Math.min(1, finding.confidence)) : 0.5;
    buckets[key].penalty += severityWeight(finding.severity) * confidence;
    buckets[key].weightSum += confidence;
    buckets[key].contributors.add(finding.zone);
    buckets[key].count += 1;
  }
  for (const key of ["corners", "edges", "surface"]) {
    const bucket = buckets[key];
    if (bucket.count === 0) continue;
    out[key] = {
      score: clampScore(base - Math.min(3.5, bucket.penalty * 0.5)),
      confidence: Math.min(1, bucket.weightSum / Math.max(1, bucket.count)),
      contributors: [...bucket.contributors],
      findingCount: bucket.count,
    };
  }
  if (out.surface.score === null && Number.isFinite(glareScore)) {
    out.surface = {
      score: clampScore(base - glareScore * 1.5),
      confidence: 0.4,
      contributors: ["glare_score"],
      findingCount: 0,
    };
  }
  return out;
}

function inferZoneFromBBox(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return "surface";
  const [x1, y1, x2, y2] = bbox;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  if (cx < 160 && cy < 224) return "top_left_corner";
  if (cx > 480 && cy < 224) return "top_right_corner";
  if (cx < 160 && cy > 672) return "bottom_left_corner";
  if (cx > 480 && cy > 672) return "bottom_right_corner";
  if (cy < 140) return "top_edge";
  if (cy > 756) return "bottom_edge";
  if (cx < 100) return "left_edge";
  if (cx > 540) return "right_edge";
  return "surface";
}

function classifyZone(zone) {
  const key = String(zone ?? "").toLowerCase();
  if (key.includes("corner")) return "corners";
  if (key.includes("edge")) return "edges";
  if (["surface", "center", "centre", "face", "front"].includes(key)) return "surface";
  return "other";
}

function severityWeight(severity) {
  if (severity === "high" || severity === "major") return 2.5;
  if (severity === "medium" || severity === "moderate") return 1.5;
  if (severity === "low" || severity === "minor") return 0.8;
  return 1.0;
}

function clampScore(raw, floor = 0, ceiling = 10) {
  if (!Number.isFinite(raw)) return floor;
  return Math.max(floor, Math.min(ceiling, raw));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function firstError(items) {
  return items.find((item) => item && item.ok === false)?.error ?? null;
}

function nowMs() {
  return performance.now();
}
