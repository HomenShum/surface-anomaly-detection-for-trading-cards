#!/usr/bin/env node
// Runs the local inference API on each slab image found in
//   data/cert-references/slab-images/<cert_id>/{front,back,*.jpg|png|webp}
// and writes the resulting predictions to
//   data/cert-references/predictions.json
//
// Designed so a non-engineer can:
//   1. drop slab photos into the directory above (one folder per cert id)
//   2. start the inference API: `pnpm dev:api`
//   3. run: `pnpm eval:certrefs:run`
//   4. run: `pnpm eval:certrefs:bands` to produce the band-agreement report
//
// Honest behaviour:
//   - cert ids without images are NOT included in predictions.json (they show
//     up as "skipped" in the band-agreement eval — does NOT count as match).
//   - inference failures are recorded with a notes field; the cert is still
//     omitted from predictions.json so the eval doesn't silently absorb errors.
//   - We never claim the predicted band IS the official grade. The eval
//     compares internal bands only.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..", "..");
const slabRoot = join(root, "data", "cert-references", "slab-images");
const seedPath = join(root, "data", "cert-references", "seed.json");
const importsPath = join(root, "data", "cert-references", "imports.jsonl");
const outPath = join(root, "data", "cert-references", "predictions.json");
const errorsPath = join(root, "data", "cert-references", "predictions-errors.json");
const inferenceBase = (process.env.INFERENCE_API_URL ?? process.env.NEXT_PUBLIC_INFERENCE_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

if (!existsSync(slabRoot)) {
  mkdirSync(slabRoot, { recursive: true });
  console.error(
    `[run_inference_on_slabs] no slab-images directory yet — created ${slabRoot}.\n` +
      "Drop one folder per cert id (e.g. psa_154378339/front.jpg, psa_154378339/back.jpg) and re-run.",
  );
  process.exit(2);
}

const refs = loadAllRefs();
const errors = [];
const predictions = {};
const summary = { processed: 0, predicted: 0, skipped: 0, failed: 0 };

for (const ref of refs) {
  const certDir = join(slabRoot, ref.id);
  if (!existsSync(certDir) || !statSync(certDir).isDirectory()) {
    summary.skipped += 1;
    continue;
  }
  const images = listImageFiles(certDir);
  if (images.length === 0) {
    summary.skipped += 1;
    continue;
  }
  summary.processed += 1;
  try {
    const reports = [];
    for (const imagePath of images) {
      const report = await callAnalyze(imagePath);
      reports.push(report);
    }
    const merged = mergeReports(reports);
    if (!merged) {
      summary.failed += 1;
      errors.push({ certId: ref.id, error: "Inference returned no usable reports." });
      continue;
    }
    const { band, score } = bucketScoreToBand(merged.score);
    const subGrades = deriveSubGrades(merged);
    predictions[ref.id] = {
      predictedBand: band,
      predictedScore: score,
      confidence: merged.avgConfidence,
      modelVersion: merged.modelVersion ?? "ding-detector-v0",
      dingsSummary: `${merged.findingsCount} findings (max severity ${merged.maxSeverity})`,
      predictedSubGrades: subGrades,
    };
    summary.predicted += 1;
  } catch (error) {
    summary.failed += 1;
    errors.push({
      certId: ref.id,
      error: error instanceof Error ? error.message : "unknown inference failure",
    });
  }
}

if (Object.keys(predictions).length === 0) {
  console.error(
    "[run_inference_on_slabs] produced 0 predictions. Either no slab images exist or every inference failed.",
  );
  console.error(`Summary: ${JSON.stringify(summary)}`);
  if (errors.length > 0) {
    console.error("Errors:");
    for (const error of errors) console.error(`  ${error.certId}: ${error.error}`);
  }
  process.exit(1);
}

// Preserve the _doc and any non-cert keys from the existing predictions.json.
const existing = existsSync(outPath) ? safeReadJson(outPath, {}) : {};
const docKeys = Object.keys(existing).filter((key) => key.startsWith("_"));
const merged = {};
for (const key of docKeys) merged[key] = existing[key];
merged._lastInferenceRun = new Date().toISOString();
merged._summary = summary;
for (const [certId, prediction] of Object.entries(predictions)) merged[certId] = prediction;
writeFileSync(outPath, JSON.stringify(merged, null, 2));
writeFileSync(errorsPath, JSON.stringify({ generatedAt: new Date().toISOString(), errors }, null, 2));

console.log(JSON.stringify({ ok: true, summary, outPath, errorsPath }, null, 2));

// ===========================================================================
function loadAllRefs() {
  const seed = safeReadJson(seedPath, []);
  const imports = existsSync(importsPath)
    ? readFileSync(importsPath, "utf-8")
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        })
    : [];
  const byId = new Map();
  for (const ref of seed) byId.set(ref.id, ref);
  for (const ref of imports) byId.set(ref.id, ref);
  return [...byId.values()];
}

function safeReadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function listImageFiles(dir) {
  return readdirSync(dir)
    .filter((entry) => /\.(png|jpe?g|webp|bmp)$/i.test(entry))
    .map((entry) => join(dir, entry))
    .filter((path) => statSync(path).isFile());
}

async function callAnalyze(imagePath) {
  const buffer = readFileSync(imagePath);
  const base64 = buffer.toString("base64");
  const contentType = guessContentType(imagePath);
  const response = await fetch(`${inferenceBase}/scan/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      image_base64: base64,
      filename: imagePath,
      content_type: contentType,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`inference API ${response.status}: ${text.slice(0, 200)}`);
  }
  return await response.json();
}

function guessContentType(path) {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  return "application/octet-stream";
}

function mergeReports(reports) {
  if (reports.length === 0) return null;
  let totalScore = 0;
  let totalConfidence = 0;
  let confidenceCount = 0;
  let findingsCount = 0;
  let maxSeverity = "low";
  let modelVersion;
  const allFindings = [];
  let centeringScore;
  let glareScore;
  for (const r of reports) {
    const report = r?.report;
    if (!report) continue;
    if (typeof report.condition_score === "number") totalScore += report.condition_score;
    if (typeof report.centering_score === "number" && centeringScore == null) centeringScore = report.centering_score;
    if (typeof report.glare_score === "number" && glareScore == null) glareScore = report.glare_score;
    modelVersion = report.model_version ?? modelVersion;
    const findings = Array.isArray(report.findings) ? report.findings : [];
    findingsCount += findings.length;
    for (const finding of findings) {
      allFindings.push(finding);
      if (typeof finding.confidence === "number") {
        totalConfidence += finding.confidence;
        confidenceCount += 1;
      }
      if (severityRank(finding.severity) > severityRank(maxSeverity)) maxSeverity = finding.severity;
    }
  }
  return {
    score: totalScore / reports.length,
    avgConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
    findingsCount,
    maxSeverity,
    modelVersion,
    findings: allFindings,
    centeringScore,
    glareScore,
  };
}

const CORNER_ZONES = new Set([
  "top_left_corner", "top_right_corner", "bottom_left_corner", "bottom_right_corner",
  "tl_corner", "tr_corner", "bl_corner", "br_corner", "corner",
]);
const EDGE_ZONES = new Set(["top_edge", "bottom_edge", "left_edge", "right_edge", "edge"]);
const SURFACE_ZONES = new Set(["surface", "center", "centre", "face", "front"]);

function classifyZone(zone) {
  const k = String(zone ?? "").toLowerCase();
  if (CORNER_ZONES.has(k)) return "corners";
  if (EDGE_ZONES.has(k)) return "edges";
  if (SURFACE_ZONES.has(k)) return "surface";
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

/** Mirrors apps/web/lib/sub-grades.ts. */
function deriveSubGrades(merged) {
  const out = {
    centering: { score: null, confidence: 0, contributors: [], findingCount: 0 },
    corners: { score: null, confidence: 0, contributors: [], findingCount: 0 },
    edges: { score: null, confidence: 0, contributors: [], findingCount: 0 },
    surface: { score: null, confidence: 0, contributors: [], findingCount: 0 },
  };
  const base = Number.isFinite(merged.score) ? clampScore(merged.score / 10, 1, 10) : 8.5;
  if (Number.isFinite(merged.centeringScore)) {
    out.centering = {
      score: clampScore(merged.centeringScore / 10),
      confidence: 0.7,
      contributors: ["centering_score"],
      findingCount: 0,
    };
  }
  const buckets = {
    corners: { penalty: 0, weightSum: 0, contributors: new Set(), count: 0 },
    edges: { penalty: 0, weightSum: 0, contributors: new Set(), count: 0 },
    surface: { penalty: 0, weightSum: 0, contributors: new Set(), count: 0 },
  };
  for (const f of merged.findings ?? []) {
    const zone = (f.zone ?? f.region ?? "").toLowerCase();
    const key = classifyZone(zone);
    if (!(key in buckets)) continue;
    const conf = Number.isFinite(f.confidence) ? Math.max(0, Math.min(1, f.confidence)) : 0.5;
    buckets[key].penalty += severityWeight(f.severity) * conf;
    buckets[key].weightSum += conf;
    buckets[key].contributors.add(zone);
    buckets[key].count += 1;
  }
  for (const key of ["corners", "edges", "surface"]) {
    const b = buckets[key];
    if (b.count === 0) continue;
    const adjustment = Math.min(3.5, b.penalty * 0.5);
    out[key] = {
      score: clampScore(base - adjustment),
      confidence: Math.min(1, b.weightSum / Math.max(1, b.count)),
      contributors: [...b.contributors],
      findingCount: b.count,
    };
  }
  if (out.surface.score === null && Number.isFinite(merged.glareScore)) {
    out.surface = {
      score: clampScore(base - merged.glareScore * 1.5),
      confidence: 0.4,
      contributors: ["glare_score"],
      findingCount: 0,
    };
  }
  return out;
}

function severityRank(s) {
  if (s === "high") return 3;
  if (s === "medium") return 2;
  if (s === "low") return 1;
  return 0;
}

function bucketScoreToBand(score) {
  // condition_score is 0-100 in the inference API. We convert to our 0-1000 scale.
  const internal = Math.round(score * 10);
  if (internal >= 950) return { band: "950-1000_gem_pristine", score: internal };
  if (internal >= 900) return { band: "900-949_mint", score: internal };
  if (internal >= 850) return { band: "850-899_strong_nm_mint", score: internal };
  if (internal >= 800) return { band: "800-849_near_mint", score: internal };
  if (internal >= 700) return { band: "700-799_visible_issues", score: internal };
  return { band: "below_700_heavy_wear", score: internal };
}
