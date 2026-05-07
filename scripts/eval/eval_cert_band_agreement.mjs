#!/usr/bin/env node
// Cert-reference offline eval. Loads model predictions from
//   data/cert-references/predictions.json
// and compares them against the certified-reference outcomes in
//   data/cert-references/seed.json (+ imports.jsonl).
//
// Output:
//   data/benchmarks/cert_refs/<label>.json  (canonical report)
//   data/benchmarks/cert_refs/latest.json    (always-rewritten alias)
//
// Exit codes:
//   0 — gate passed (match-rate floor + non-regression vs baseline if present)
//   1 — gate failed; reasons printed to stderr
//   2 — fatal: predictions file missing/malformed

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..", "..");

// Band ordering used by classifyAgreement — defined at module scope so
// downstream functions reference it without a temporal-dead-zone error when
// invoked at top-level before the original declaration site below.
const BAND_ORDER = [
  "below_700_heavy_wear",
  "700-799_visible_issues",
  "800-849_near_mint",
  "850-899_strong_nm_mint",
  "900-949_mint",
  "950-1000_gem_pristine",
];

// ----------- Resolve repo paths --------------------------------------------
const dataDir = join(root, "data");
const certRefsDir = join(dataDir, "cert-references");
const seedPath = join(certRefsDir, "seed.json");
const importsPath = join(certRefsDir, "imports.jsonl");
const predictionsPath = join(certRefsDir, "predictions.json");
const reportDir = join(dataDir, "benchmarks", "cert_refs");
mkdirSync(reportDir, { recursive: true });
const baselinePath = join(reportDir, "production-baseline.json");

const args = parseArgs(process.argv.slice(2));
const strict = Boolean(args.strict);
const modelVersion = args.modelVersion ?? readModelVersionDefault();
const label = args.label ?? `${modelVersion}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outPath = join(reportDir, `${label}.json`);
const latestPath = join(reportDir, "latest.json");

// ----------- Inputs --------------------------------------------------------
if (!existsSync(seedPath)) {
  console.error(`[eval:certrefs] missing seed file: ${seedPath}`);
  process.exit(2);
}
if (!existsSync(predictionsPath)) {
  console.error(
    `[eval:certrefs] missing predictions file: ${predictionsPath}\n` +
      "  Write a JSON object of {<certId>: { predictedBand, predictedScore, confidence, modelVersion }}.\n" +
      "  Tip: pnpm eval:certrefs:run writes real model predictions from slab images when available.",
  );
  process.exit(2);
}

const seed = readJson(seedPath);
const imports = readJsonl(importsPath);
const refsById = new Map();
for (const entry of seed) refsById.set(entry.id, entry);
for (const entry of imports) refsById.set(entry.id, entry);
const refs = [...refsById.values()];
const predictions = readJson(predictionsPath);
const predictionsSha256 = sha256File(predictionsPath);

// ----------- Run eval ------------------------------------------------------
const result = evaluate(refs, predictions, modelVersion);
writeFileSync(outPath, JSON.stringify(result, null, 2));
writeFileSync(latestPath, JSON.stringify(result, null, 2));

// ----------- Gate ---------------------------------------------------------
const baseline = existsSync(baselinePath) ? readJson(baselinePath) : null;
const gate = evaluateGate(result, baseline);

console.log(JSON.stringify({
  modelVersion,
  label,
  outPath,
  totals: result.totals,
  metrics: gate.metrics,
  reasons: gate.reasons,
  allowed: gate.allowed,
}, null, 2));

if (!gate.allowed) {
  console.error(`[eval:certrefs] gate FAILED:\n  - ${gate.reasons.join("\n  - ")}`);
  if (strict) process.exit(1);
}

// ===========================================================================
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--model-version" && argv[i + 1]) out.modelVersion = argv[++i];
    else if (a === "--label" && argv[i + 1]) out.label = argv[++i];
    else if (a === "--strict") out.strict = true;
  }
  return out;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    console.error(`[eval:certrefs] failed to read ${path}: ${error.message}`);
    process.exit(2);
  }
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function readModelVersionDefault() {
  const fromEnv = process.env.MODEL_VERSION;
  if (fromEnv) return fromEnv;
  const fromPredictions = inferPredictionModelVersion();
  if (fromPredictions) return fromPredictions;
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root });
  if (result.status === 0) return `git-${result.stdout.toString().trim()}`;
  return "ding-detector-v0";
}

function inferPredictionModelVersion() {
  if (!existsSync(predictionsPath)) return null;
  try {
    const predictions = JSON.parse(readFileSync(predictionsPath, "utf-8"));
    const versions = Object.entries(predictions)
      .filter(([key, value]) => !key.startsWith("_") && value && typeof value === "object")
      .map(([, value]) => value.modelVersion)
      .filter(Boolean);
    const unique = [...new Set(versions)];
    return unique.length === 1 ? unique[0] : null;
  } catch {
    return null;
  }
}

function mapOfficialGradeToBand(reference) {
  const numeric = reference.numericGrade;
  if (typeof numeric === "number") {
    if (numeric >= 9.5) return "950-1000_gem_pristine";
    if (numeric >= 9) return "900-949_mint";
    if (numeric >= 8.5) return "850-899_strong_nm_mint";
    if (numeric >= 8) return "800-849_near_mint";
    if (numeric >= 6) return "700-799_visible_issues";
    return "below_700_heavy_wear";
  }
  const grade = reference.officialGrade ?? "";
  if (reference.provider === "TAG") {
    const m = grade.match(/(\d{3,4})/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 950) return "950-1000_gem_pristine";
      if (n >= 900) return "900-949_mint";
      if (n >= 850) return "850-899_strong_nm_mint";
      if (n >= 800) return "800-849_near_mint";
      if (n >= 700) return "700-799_visible_issues";
      return "below_700_heavy_wear";
    }
  }
  const upper = grade.toUpperCase();
  if (upper.includes("GEM") || upper.includes("PRISTINE") || upper.includes(" 10")) {
    return "950-1000_gem_pristine";
  }
  if (upper.includes("MINT 9") || upper === "MINT") return "900-949_mint";
  if (upper.includes("NM-MT 8") || upper.includes("NM-MT")) return "800-849_near_mint";
  return null;
}

function classifyAgreement(official, predicted) {
  if (!official) return { agreement: "no_official_band", distance: null };
  if (!predicted) return { agreement: "mismatch", distance: null };
  const distance = Math.abs(BAND_ORDER.indexOf(official) - BAND_ORDER.indexOf(predicted));
  if (distance === 0) return { agreement: "match", distance };
  if (distance === 1) return { agreement: "adjacent", distance };
  return { agreement: "mismatch", distance };
}

function evaluate(refs, predictions, modelVersion) {
  const map = new Map(Object.entries(predictions));
  const rows = [];
  let matched = 0;
  let adjacent = 0;
  let mismatched = 0;
  let skipped = 0;
  let silverPlusCovered = 0;
  let silverPlusMatched = 0;
  let silverCovered = 0;
  let silverMatched = 0;

  for (const ref of refs) {
    const officialBand = mapOfficialGradeToBand(ref);
    const prediction = map.get(ref.id);
    if (!prediction) {
      skipped += 1;
      rows.push({
        certId: ref.id,
        provider: ref.provider,
        certNumber: ref.certNumber,
        trustTier: ref.trustTier,
        officialGrade: ref.officialGrade,
        officialBand,
        predictedBand: null,
        predictedScore: null,
        confidence: null,
        bandAgreement: officialBand ? "mismatch" : "no_official_band",
        bandDistance: null,
        notes: ["No prediction supplied; reference not yet evaluated against this model version."],
      });
      continue;
    }
    const { agreement, distance } = classifyAgreement(officialBand, prediction.predictedBand);
    if (agreement === "match") matched += 1;
    if (agreement === "adjacent") adjacent += 1;
    if (agreement === "mismatch") mismatched += 1;
    if (officialBand && ref.trustTier === "silver_plus") {
      silverPlusCovered += 1;
      if (agreement === "match") silverPlusMatched += 1;
    }
    if (officialBand && ref.trustTier === "silver") {
      silverCovered += 1;
      if (agreement === "match") silverMatched += 1;
    }
    rows.push({
      certId: ref.id,
      provider: ref.provider,
      certNumber: ref.certNumber,
      trustTier: ref.trustTier,
      officialGrade: ref.officialGrade,
      officialBand,
      predictedBand: prediction.predictedBand ?? null,
      predictedScore: prediction.predictedScore ?? null,
      confidence: prediction.confidence ?? null,
      bandAgreement: agreement,
      bandDistance: distance,
      notes: [],
      predictedSubGrades: prediction.predictedSubGrades ?? null,
    });
  }

  const predictionsCovered = rows.length - skipped;
  return {
    modelVersion,
    evaluatedAt: new Date().toISOString(),
    totals: {
      references: refs.length,
      predictionsCovered,
      matched,
      adjacent,
      mismatched,
      skipped,
      silverPlusCovered,
      silverPlusMatched,
      silverCovered,
      silverMatched,
    },
    rows,
    inputFingerprint: {
      predictionsPath,
      predictionsSha256,
    },
    notes: [
      "Eval compares INTERNAL CONDITION BAND, not the official grade.",
      "Adjacent-band misses do not count as matched.",
      "Mismatches feed the agent's self-correction loop.",
    ],
  };
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function evaluateGate(candidate, baseline) {
  const reasons = [];
  const predictedRows = candidate.rows.filter((row) => row.predictedBand);
  const isPlaceholderMirror =
    candidate.modelVersion === "baseline-trust-cert" ||
    candidate.modelVersion === "test-baseline-mirror" ||
    (predictedRows.length > 0 && predictedRows.every((row) => row.confidence === 0));
  const candidateMatchRate =
    candidate.totals.predictionsCovered > 0
      ? candidate.totals.matched / candidate.totals.predictionsCovered
      : 0;
  const candidateSilverPlusMatchRate =
    candidate.totals.silverPlusCovered > 0
      ? candidate.totals.silverPlusMatched / candidate.totals.silverPlusCovered
      : 0;
  const candidateSilverMatchRate =
    candidate.totals.silverCovered > 0
      ? candidate.totals.silverMatched / candidate.totals.silverCovered
      : 0;

  if (candidate.totals.predictionsCovered === 0) {
    reasons.push("Candidate has no cert-reference predictions covered.");
  } else if (isPlaceholderMirror) {
    reasons.push("Candidate cert-reference eval is a placeholder mirror, not a real slab-image model run.");
  } else if (candidateMatchRate < 0.5) {
    reasons.push(`Candidate match rate ${candidateMatchRate.toFixed(2)} < 0.50 floor.`);
  }

  let baselineMatchRate;
  let baselineSilverPlusMatchRate;
  if (baseline) {
    baselineMatchRate =
      baseline.totals.predictionsCovered > 0
        ? baseline.totals.matched / baseline.totals.predictionsCovered
        : 0;
    baselineSilverPlusMatchRate =
      baseline.totals.silverPlusCovered > 0
        ? baseline.totals.silverPlusMatched / baseline.totals.silverPlusCovered
        : 0;
    if (candidateMatchRate < baselineMatchRate) {
      reasons.push(
        `Candidate match rate ${candidateMatchRate.toFixed(2)} below baseline ${baselineMatchRate.toFixed(2)}.`,
      );
    }
    if (candidateSilverPlusMatchRate + 1e-9 < baselineSilverPlusMatchRate) {
      reasons.push(
        `Candidate Silver+ match rate ${candidateSilverPlusMatchRate.toFixed(
          2,
        )} regresses vs baseline ${baselineSilverPlusMatchRate.toFixed(2)}.`,
      );
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons: reasons.length > 0 ? reasons : ["Cert-reference promotion gate passed."],
    metrics: {
      candidateMatchRate,
      candidateSilverPlusMatchRate,
      candidateSilverMatchRate,
      baselineMatchRate,
      baselineSilverPlusMatchRate,
    },
  };
}
