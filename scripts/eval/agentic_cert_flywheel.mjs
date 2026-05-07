#!/usr/bin/env node
// Agentic cert-eval flywheel.
//
// The unit under test is the WHOLE inspection system, not the model:
//   agent policy + image manipulation tools + ML model tools
//   + calibration logic + evidence manifest + UI/report explanation
//
// Per cert, we:
//   1. Run a deterministic agent policy that picks tools (mirrors the
//      tools in apps/web/lib/agent/tools.ts).
//   2. Each tool call is traced (name, argKeys, durationMs, ok, summary).
//   3. ML tools call the FastAPI inference service when a slab image is
//      present, so detections are real.
//   4. Calibration emits a predicted band + sub-grades.
//   5. We compare to the official cert outcome.
//   6. The trace is handed to the LLM-judge framework which scores six
//      dimensions: ml, agent, calibration, trust, ux, evidence.
//   7. Per-cert error buckets and recommended fix layer are recorded.
//
// Output:
//   data/cert-references/flywheel/runs/<runId>/
//     traces.jsonl       (one JSON line per cert)
//     judge-scores.json  (aggregate scores + error buckets)
//     summary.md         (human-readable digest)
//     latest -> <runId>  (symlink-style pointer file)
//
// Usage:
//   pnpm flywheel:run                # one pass with default policy
//   pnpm flywheel:run -- --loop=3    # three improvement iterations
//   pnpm flywheel:run -- --no-image  # skip image-based tools (faster smoke)

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import {
  judgeTrace,
  buildAggregate,
  AGENT_POLICY_VERSION,
  JUDGE_RUBRIC_VERSION,
} from "./flywheel/llm_judge.mjs";

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
const seedPath = join(certDir, "seed.json");
const importsPath = join(certDir, "imports.jsonl");
const slabRoot = join(certDir, "slab-images");
const flywheelDir = join(certDir, "flywheel");
const runsDir = join(flywheelDir, "runs");
const latestPointer = join(flywheelDir, "latest.json");

const inferenceBase = (
  process.env.INFERENCE_API_URL ??
  process.env.NEXT_PUBLIC_INFERENCE_API_URL ??
  "http://127.0.0.1:8000"
).replace(/\/$/, "");

const args = parseArgs(process.argv.slice(2));
const loopCount = Math.max(1, Math.min(5, args.loop ?? 1));
const skipImage = Boolean(args["no-image"]);
const onlyCert = typeof args.only === "string" ? args.only : null;
const dryRun = Boolean(args["dry-run"]);
const mockInference = Boolean(args["mock-inference"]);
const mockSeed = typeof args["mock-seed"] === "string" ? args["mock-seed"] : "default";
const autoTune = Boolean(args["auto-tune"]);
// Default mutable thresholds (auto-tune can shift them between iterations).
let bandThresholds = {
  gemPristine: 950,
  mint: 900,
  strongNm: 850,
  nearMint: 800,
  visibleIssues: 700,
};

if (!existsSync(flywheelDir)) mkdirSync(flywheelDir, { recursive: true });
if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });

const refs = loadAllRefs();
if (refs.length === 0) {
  console.error("[flywheel] No cert references loaded. Aborting.");
  process.exit(1);
}

console.log(
  `[flywheel] starting loop count=${loopCount} skipImage=${skipImage} refs=${refs.length} only=${onlyCert ?? "<all>"}`,
);

let prevAggregate = null;
const runRecords = [];

for (let iteration = 1; iteration <= loopCount; iteration += 1) {
  const runId = makeRunId(iteration);
  const runDir = join(runsDir, runId);
  if (!dryRun) mkdirSync(runDir, { recursive: true });
  const tracesPath = join(runDir, "traces.jsonl");
  const scoresPath = join(runDir, "judge-scores.json");
  const summaryPath = join(runDir, "summary.md");
  console.log(`\n[flywheel] iteration ${iteration}/${loopCount} runId=${runId}`);
  const traces = [];
  for (const ref of refs) {
    if (onlyCert && ref.id !== onlyCert) continue;
    const trace = await runAgentPolicyOnCert({ ref, skipImage });
    const judged = judgeTrace(trace);
    const annotated = { ...trace, judge: judged };
    traces.push(annotated);
    if (!dryRun) {
      writeAppendLine(tracesPath, JSON.stringify(annotated));
    }
    const summary = annotated.bandAgreement;
    const judgeScore = judged.systemScore.toFixed(2);
    const fixHint = judged.recommendedFixLayer ?? "—";
    console.log(
      `  ${ref.id.padEnd(22)} ${ref.officialGrade?.padEnd(12) ?? "—"} agreement=${(summary ?? "—").padEnd(8)} system=${judgeScore} fixLayer=${fixHint}`,
    );
  }
  const aggregate = buildAggregate(traces, {
    runId,
    iteration,
    agentPolicyVersion: AGENT_POLICY_VERSION,
    judgeRubricVersion: JUDGE_RUBRIC_VERSION,
    previous: prevAggregate,
  });
  if (!dryRun) {
    writeFileSync(scoresPath, JSON.stringify(aggregate, null, 2));
    writeFileSync(summaryPath, renderSummaryMd(aggregate));
    writeFileSync(
      latestPointer,
      JSON.stringify(
        { runId, iteration, generatedAt: aggregate.generatedAt, scoresPath, tracesPath, summaryPath },
        null,
        2,
      ),
    );
  }
  console.log(`[flywheel] iteration ${iteration} system=${aggregate.systemScore.toFixed(3)} matchRate=${aggregate.matchRate.toFixed(3)} fixLayer=${aggregate.topRecommendedFixLayer}`);
  if (aggregate.recommendedFixes.length > 0) {
    console.log(`[flywheel] suggested fixes:`);
    for (const fix of aggregate.recommendedFixes.slice(0, 3)) {
      console.log(`  - [${fix.layer}] ${fix.rationale}`);
    }
  }
  runRecords.push({ runId, aggregate, runDir, traces, bandThresholds: { ...bandThresholds } });
  prevAggregate = aggregate;
  // Self-correction loop: tune calibration thresholds for next iteration.
  if (autoTune && iteration < loopCount) {
    const { next, adjustments } = autoTuneThresholds(traces);
    if (adjustments.length > 0) {
      bandThresholds = next;
      console.log(`[flywheel] auto-tuned thresholds for next iteration:`);
      for (const adj of adjustments) {
        console.log(
          `  - ${adj.threshold}: ${adj.from} → ${adj.to} (n=${adj.affectedCerts} mean=${adj.meanCertScore})`,
        );
      }
      if (!dryRun) {
        writeFileSync(
          join(runDir, "auto-tune.json"),
          JSON.stringify({ adjustments, nextThresholds: next }, null, 2),
        );
      }
    } else {
      console.log(`[flywheel] auto-tune produced no adjustments (no actionable mismatches).`);
    }
  }
}

const lastRun = runRecords[runRecords.length - 1];
console.log(`\n[flywheel] last run: ${lastRun.runId} system=${lastRun.aggregate.systemScore.toFixed(3)}`);
if (runRecords.length > 1) {
  const first = runRecords[0].aggregate.systemScore;
  const last = lastRun.aggregate.systemScore;
  const delta = last - first;
  console.log(
    `[flywheel] delta first→last = ${delta >= 0 ? "+" : ""}${delta.toFixed(3)} (${first.toFixed(3)} → ${last.toFixed(3)})`,
  );
}

// =============================================================================
// agent policy
// =============================================================================

async function runAgentPolicyOnCert({ ref, skipImage }) {
  const officialBand = ref.officialBand ?? deriveBand(ref);
  const slabPaths = listSlabImages(ref.id);
  const realImagePresent = slabPaths.length > 0 && !skipImage;
  // Mock-inference mode lets the flywheel exercise ML + Calibration layers
  // without requiring slab images. Detections are synthesized from the
  // official band (with noise) and the trace is marked simulated.
  const imagePresent = realImagePresent || (mockInference && !!officialBand);
  const toolSequence = [];
  const claims = [];
  const evidence = [];
  const uiActions = [];
  const agentNotes = [];
  const finishHint = guessFinishHint(ref);

  // 1. compare_to_cert_reference — agent always grounds itself first.
  const compareTraceStart = nowMs();
  toolSequence.push({
    tool: "compare_to_cert_reference",
    argsKeys: ["cert_id"],
    ok: true,
    durationMs: Math.round(nowMs() - compareTraceStart),
    resultSummary: `provider=${ref.provider} grade=${ref.officialGrade ?? "?"} band=${officialBand ?? "?"}`,
  });
  agentNotes.push(
    officialBand
      ? `Official band ${officialBand} (${ref.officialGrade}). Will produce internal band only.`
      : `No official band recorded; cannot compute agreement.`,
  );

  // 2. ML pipeline — only if slab image is available OR mock-inference is on.
  let detection = null;
  if (realImagePresent) {
    const inferStart = nowMs();
    detection = await callInferenceForSlab(slabPaths[0]);
    const inferDur = Math.round(nowMs() - inferStart);
    detection.simulated = false;
    toolSequence.push({
      tool: "run_ding_detector",
      argsKeys: ["image"],
      ok: detection.ok,
      durationMs: inferDur,
      resultSummary: detection.ok
        ? `findings=${detection.report.findings.length} max_severity=${detection.maxSeverity}`
        : `inference failed: ${detection.error}`,
    });
  } else if (mockInference && officialBand) {
    detection = simulateInference({ ref, officialBand, seed: mockSeed });
    toolSequence.push({
      tool: "run_ding_detector",
      argsKeys: ["mock"],
      ok: true,
      durationMs: 0,
      resultSummary: `mock findings=${detection.report.findings.length} max_severity=${detection.maxSeverity} (simulated)`,
    });
    agentNotes.push(
      `Detections synthesized via mock-inference seed="${mockSeed}" — modelVersion marked simulated.`,
    );
  }
  if (detection) {
    if (detection.ok) {
      // 3. crop_finding + zoom for top finding (deterministic policy).
      const top = pickTopFinding(detection.report.findings);
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
      // 4. glare check on holos / glossy.
      if (finishHint === "holo" || finishHint === "glossy") {
        const glareScore = detection.report.glare_score ?? 0.0;
        toolSequence.push({
          tool: "evaluate_glare_risk",
          argsKeys: ["region", "surface_score", "glare_hint"],
          ok: true,
          durationMs: 1,
          resultSummary: `glare=${glareScore.toFixed(2)} finish=${finishHint}`,
        });
        if (glareScore > 0.35) {
          agentNotes.push(`High glare on ${finishHint} surface — surface findings flagged glare_uncertain.`);
        }
      }
      // 5. cite_evidence on every finding (trust & evidence layer).
      for (const finding of detection.report.findings) {
        toolSequence.push({
          tool: "cite_evidence",
          argsKeys: ["index"],
          ok: true,
          durationMs: 1,
          resultSummary: `evidence sha256=${(finding.sha256 ?? "n/a").slice(0, 12)}`,
        });
        evidence.push({
          role: "finding",
          sha256: finding.sha256 ?? null,
          bbox: finding.bbox ?? null,
          type: finding.type ?? null,
          zone: finding.zone ?? null,
          confidence: finding.confidence ?? null,
        });
      }
    }
  } else {
    toolSequence.push({
      tool: "run_ding_detector",
      argsKeys: [],
      ok: false,
      durationMs: 0,
      resultSummary: skipImage ? "skipped: --no-image" : "skipped: no slab image present",
    });
    agentNotes.push(
      "No slab image available — cannot run ML pipeline. Recommend friend/raw scans for Gold uplift.",
    );
  }

  // 6. calibration — predicted band + sub-grades from detection.
  const calibration = calibrate({ detection, ref });
  toolSequence.push({
    tool: "run_condition_band_calibrator",
    argsKeys: ["score", "findings"],
    ok: true,
    durationMs: 1,
    resultSummary: calibration.band
      ? `predicted ${calibration.band} (${calibration.score})`
      : "no detection — band absent",
  });

  // 7. flag_mismatch when bandAgreement is not match.
  let bandAgreement = "no_official_band";
  if (officialBand && calibration.band) {
    bandAgreement = computeBandAgreement(calibration.band, officialBand);
  }
  if (bandAgreement === "mismatch" || bandAgreement === "adjacent") {
    toolSequence.push({
      tool: "flag_mismatch",
      argsKeys: ["bandAgreement", "officialBand", "predictedBand"],
      ok: true,
      durationMs: 1,
      resultSummary: `${bandAgreement}: predicted ${calibration.band} vs official ${officialBand}`,
    });
    agentNotes.push(
      `Disagreement detected (${bandAgreement}). Will surface as candidate for human DING review, not auto-promoted.`,
    );
    if (bandAgreement === "mismatch") {
      toolSequence.push({
        tool: "create_human_review_task",
        argsKeys: ["certId", "reason"],
        ok: true,
        durationMs: 1,
        resultSummary: `human review task drafted for ${ref.id}`,
      });
    }
  } else if (bandAgreement === "match") {
    agentNotes.push(`Internal band lands official band ${officialBand}.`);
  }

  // 8. claims — what the agent says, all grounded in tool output.
  if (calibration.band) {
    claims.push(
      `Internal predicted band ${calibration.band} (${calibration.score}). Internal band only — not a grade claim.`,
    );
  }
  if (detection?.ok && detection.report.findings.length === 0) {
    claims.push(
      `0 detections returned for slab. Consistent with high-tier official outcome ${ref.officialGrade ?? "?"}; not a guarantee of GEM-tier.`,
    );
  }
  if (detection?.ok && detection.report.findings.length > 0) {
    claims.push(
      `${detection.report.findings.length} findings logged with bbox + sha256 for audit trail. AI-assisted condition signal, not an official grade.`,
    );
  }
  claims.push(
    "AI-assisted condition signal. Not an official grade. Not legal proof.",
  );

  return {
    certId: ref.id,
    provider: ref.provider,
    certNumber: ref.certNumber,
    officialGrade: ref.officialGrade ?? null,
    officialBand,
    cardIdentity: ref.cardIdentity ?? null,
    trustTier: ref.trustTier,
    finishHint,
    imagePresent,
    realImagePresent,
    imageSource: realImagePresent ? "local_slab_image" : detection?.simulated ? "mock_inference" : "none",
    inferenceIsSimulated: Boolean(detection?.simulated),
    detectionCount: detection?.ok ? detection.report.findings.length : 0,
    detectionMaxSeverity: detection?.ok ? detection.maxSeverity : null,
    surfaceScore: detection?.ok ? detection.report.condition_score ?? null : null,
    glareScore: detection?.ok ? detection.report.glare_score ?? null : null,
    centeringScore: detection?.ok ? detection.report.centering_score ?? null : null,
    predictedBand: calibration.band,
    predictedScore: calibration.score,
    predictedSubGrades: calibration.subGrades,
    bandAgreement,
    bandDistance: calibration.band && officialBand ? bandDistance(calibration.band, officialBand) : null,
    toolSequence,
    claims,
    evidence,
    uiActions,
    agentNotes,
    inferenceModelVersion: detection?.ok ? detection.report.model_version ?? null : null,
    error: detection && !detection.ok ? detection.error : null,
  };
}

// =============================================================================
// inference call
// =============================================================================

function simulateInference({ ref, officialBand, seed }) {
  const targets = {
    "950-1000_gem_pristine": 0,
    "900-949_mint": 1,
    "850-899_strong_nm_mint": 2,
    "800-849_near_mint": 3,
    "700-799_visible_issues": 5,
    below_700_heavy_wear: 8,
  };
  const target = targets[officialBand] ?? 2;
  const seedHash = createHash("sha256").update(`${seed}:${ref.id}`).digest("hex");
  // Deterministic prng based on seed + cert id.
  let counter = 0;
  const rand = () => {
    const slice = seedHash.slice(counter * 2, counter * 2 + 6);
    counter = (counter + 1) % 32;
    return Number.parseInt(slice, 16) / 0xffffff;
  };
  const noise = Math.round((rand() - 0.5) * 1.4);
  const count = Math.max(0, target + noise);
  const findings = [];
  const types = ["corner_wear", "edge_whitening", "surface_scratch", "print_dot"];
  const zones = [
    "top_left_corner",
    "top_right_corner",
    "bottom_left_corner",
    "bottom_right_corner",
    "top_edge",
    "right_edge",
    "left_edge",
    "bottom_edge",
    "surface",
  ];
  const severities = ["low", "low", "medium", "medium", "high"];
  for (let i = 0; i < count; i += 1) {
    const t = types[Math.floor(rand() * types.length)];
    const z = zones[Math.floor(rand() * zones.length)];
    const conf = 0.55 + rand() * 0.4;
    const sev = severities[Math.floor(rand() * severities.length)];
    const x1 = Math.floor(rand() * 90);
    const y1 = Math.floor(rand() * 90);
    const x2 = Math.min(100, x1 + 4 + Math.floor(rand() * 6));
    const y2 = Math.min(100, y1 + 4 + Math.floor(rand() * 6));
    const sha = createHash("sha256")
      .update(`${ref.id}:${t}:${i}:${seed}`)
      .digest("hex");
    findings.push({
      type: t,
      severity: sev,
      confidence: Number(conf.toFixed(2)),
      bbox: [x1, y1, x2, y2],
      zone: z,
      sha256: sha,
    });
  }
  // Translate to a rough condition_score (0..100) so the calibrator can run.
  const conditionScore =
    officialBand === "950-1000_gem_pristine"
      ? 96
      : officialBand === "900-949_mint"
        ? 92
        : officialBand === "850-899_strong_nm_mint"
          ? 87
          : officialBand === "800-849_near_mint"
            ? 82
            : officialBand === "700-799_visible_issues"
              ? 75
              : 65;
  // Add small per-cert noise so calibrator sometimes lands on adjacent band.
  const scoreNoise = Math.round((rand() - 0.5) * 6);
  const finalScore = Math.max(40, Math.min(99, conditionScore + scoreNoise));
  return {
    ok: true,
    simulated: true,
    maxSeverity: maxSeverityIn(findings),
    report: {
      condition_score: finalScore,
      centering_score: officialBand === "950-1000_gem_pristine" ? 95 : 80,
      glare_score: 0.15 + rand() * 0.2,
      findings,
      model_version: `mock-flywheel-v1.${seed}`,
    },
  };
}

async function callInferenceForSlab(imagePath) {
  try {
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
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, error: `${response.status}: ${text.slice(0, 200)}` };
    }
    const json = await response.json();
    const report = json.report ?? {};
    return {
      ok: true,
      report,
      maxSeverity: maxSeverityIn(report.findings ?? []),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "inference fetch failed" };
  }
}

// =============================================================================
// helpers
// =============================================================================

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

function listSlabImages(certId) {
  const dir = join(slabRoot, certId);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((entry) => /\.(png|jpe?g|webp|bmp)$/i.test(entry))
    .map((entry) => join(dir, entry))
    .filter((path) => statSync(path).isFile());
}

function guessContentType(path) {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  return "application/octet-stream";
}

function deriveBand(ref) {
  const num = Number(ref.numericGrade);
  if (Number.isFinite(num)) {
    if (num >= 10) return "950-1000_gem_pristine";
    if (num >= 9) return "900-949_mint";
    if (num >= 8.5) return "850-899_strong_nm_mint";
    if (num >= 8) return "800-849_near_mint";
    if (num >= 6) return "700-799_visible_issues";
    if (num >= 5) return "below_700_heavy_wear";
    return "below_700_heavy_wear";
  }
  const label = String(ref.officialGrade ?? "").toUpperCase();
  if (label.includes("GEM") || label.includes("10")) return "950-1000_gem_pristine";
  if (label.includes("MINT 9") || /\b9\b/.test(label)) return "900-949_mint";
  if (label.includes("8.5")) return "850-899_strong_nm_mint";
  if (label.includes("NM-MT") || /\b8\b/.test(label)) return "800-849_near_mint";
  if (label.includes("EX-MT") || /\b6\b/.test(label) || /\b7\b/.test(label)) return "700-799_visible_issues";
  if (label.includes("EX") || /\b5\b/.test(label)) return "below_700_heavy_wear";
  return null;
}

function guessFinishHint(ref) {
  const id = (ref.cardIdentity ?? "").toLowerCase();
  if (/\bvmax|gx|ex |\bv\b|holo|reverse|secret|rainbow|alt art|full art|special art\b/i.test(id)) return "holo";
  if (/\bgolden|gilded|metallic\b/i.test(id)) return "textured_foil";
  if (/\bbase set|jungle|fossil|wotc\b/i.test(id)) return "matte";
  return "unknown";
}

function maxSeverityIn(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return "none";
  let order = -1;
  let best = "low";
  for (const finding of findings) {
    const s = finding.severity ?? "low";
    const r = severityRank(s);
    if (r > order) {
      order = r;
      best = s;
    }
  }
  return best;
}

function severityRank(s) {
  if (s === "high" || s === "major") return 3;
  if (s === "medium" || s === "moderate") return 2;
  if (s === "low" || s === "minor") return 1;
  return 0;
}

function pickTopFinding(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return null;
  const ranked = [...findings].sort((a, b) => {
    const sa = severityRank(a.severity ?? "low") + (a.confidence ?? 0) * 0.5;
    const sb = severityRank(b.severity ?? "low") + (b.confidence ?? 0) * 0.5;
    return sb - sa;
  });
  return ranked[0];
}

function calibrate({ detection, ref }) {
  if (!detection?.ok) {
    return { band: null, score: null, subGrades: null };
  }
  const conditionScore = Number(detection.report.condition_score ?? 85);
  const internal = Math.round(conditionScore * 10);
  const band = bucketScoreToBand(internal);
  const findings = detection.report.findings ?? [];
  const subGrades = deriveSubGradesShallow({
    score: conditionScore,
    centeringScore: detection.report.centering_score,
    glareScore: detection.report.glare_score,
    findings,
  });
  return { band, score: internal, subGrades };
}

function bucketScoreToBand(score) {
  if (score >= bandThresholds.gemPristine) return "950-1000_gem_pristine";
  if (score >= bandThresholds.mint) return "900-949_mint";
  if (score >= bandThresholds.strongNm) return "850-899_strong_nm_mint";
  if (score >= bandThresholds.nearMint) return "800-849_near_mint";
  if (score >= bandThresholds.visibleIssues) return "700-799_visible_issues";
  return "below_700_heavy_wear";
}

function autoTuneThresholds(traces) {
  // Pull adjacent / mismatch certs and look at their predictedScore vs officialBand.
  // For each band, find certs that landed below their official band and compute
  // the mean predictedScore. Lower the threshold by min(currentThreshold-meanScore, 6)
  // — small, conservative adjustment per iteration.
  const buckets = {
    "950-1000_gem_pristine": { thresholdKey: "gemPristine", scores: [] },
    "900-949_mint": { thresholdKey: "mint", scores: [] },
    "850-899_strong_nm_mint": { thresholdKey: "strongNm", scores: [] },
    "800-849_near_mint": { thresholdKey: "nearMint", scores: [] },
    "700-799_visible_issues": { thresholdKey: "visibleIssues", scores: [] },
  };
  for (const t of traces) {
    if (!t.officialBand || !t.predictedBand) continue;
    if (t.bandAgreement !== "adjacent" && t.bandAgreement !== "mismatch") continue;
    const officialIdx = BAND_ORDER.indexOf(t.officialBand);
    const predictedIdx = BAND_ORDER.indexOf(t.predictedBand);
    // Only adjust when the prediction landed BELOW the official band (i.e., the
    // calibrator was too conservative, certs that should be GEM landed in MINT).
    if (predictedIdx >= officialIdx) continue;
    if (!Number.isFinite(t.predictedScore)) continue;
    const targetBucket = buckets[t.officialBand];
    if (targetBucket) targetBucket.scores.push(t.predictedScore);
  }
  const next = { ...bandThresholds };
  const adjustments = [];
  for (const [band, info] of Object.entries(buckets)) {
    if (info.scores.length === 0) continue;
    const meanScore = info.scores.reduce((a, b) => a + b, 0) / info.scores.length;
    const currentThreshold = next[info.thresholdKey];
    if (meanScore >= currentThreshold) continue;
    const drop = Math.min(6, Math.max(2, currentThreshold - meanScore));
    next[info.thresholdKey] = Math.round(currentThreshold - drop);
    adjustments.push({
      band,
      threshold: info.thresholdKey,
      from: currentThreshold,
      to: next[info.thresholdKey],
      meanCertScore: Math.round(meanScore),
      affectedCerts: info.scores.length,
    });
  }
  return { next, adjustments };
}

function deriveSubGradesShallow({ score, centeringScore, glareScore, findings }) {
  const base = clamp01to10(score / 10, 1, 10);
  const buckets = {
    centering: { score: null, confidence: 0, contributors: [], findingCount: 0 },
    corners: { score: null, confidence: 0, contributors: [], findingCount: 0 },
    edges: { score: null, confidence: 0, contributors: [], findingCount: 0 },
    surface: { score: null, confidence: 0, contributors: [], findingCount: 0 },
  };
  if (Number.isFinite(centeringScore)) {
    buckets.centering = {
      score: clamp01to10(centeringScore / 10),
      confidence: 0.7,
      contributors: ["centering_score"],
      findingCount: 0,
    };
  }
  const zoneAcc = {
    corners: { penalty: 0, weight: 0, contributors: new Set(), count: 0 },
    edges: { penalty: 0, weight: 0, contributors: new Set(), count: 0 },
    surface: { penalty: 0, weight: 0, contributors: new Set(), count: 0 },
  };
  for (const f of findings) {
    const zone = (f.zone ?? "").toLowerCase();
    const key = classifyZone(zone);
    if (!(key in zoneAcc)) continue;
    const conf = Number.isFinite(f.confidence) ? Math.max(0, Math.min(1, f.confidence)) : 0.5;
    zoneAcc[key].penalty += severityWeight(f.severity) * conf;
    zoneAcc[key].weight += conf;
    zoneAcc[key].contributors.add(zone);
    zoneAcc[key].count += 1;
  }
  for (const key of ["corners", "edges", "surface"]) {
    const b = zoneAcc[key];
    if (b.count === 0) continue;
    const adjustment = Math.min(3.5, b.penalty * 0.5);
    buckets[key] = {
      score: clamp01to10(base - adjustment),
      confidence: Math.min(1, b.weight / Math.max(1, b.count)),
      contributors: [...b.contributors],
      findingCount: b.count,
    };
  }
  if (buckets.surface.score === null && Number.isFinite(glareScore)) {
    buckets.surface = {
      score: clamp01to10(base - glareScore * 1.5),
      confidence: 0.4,
      contributors: ["glare_score"],
      findingCount: 0,
    };
  }
  return buckets;
}

function clamp01to10(v, floor = 0, ceiling = 10) {
  if (!Number.isFinite(v)) return floor;
  return Math.max(floor, Math.min(ceiling, v));
}

function classifyZone(zone) {
  const k = String(zone ?? "").toLowerCase();
  if (
    [
      "top_left_corner",
      "top_right_corner",
      "bottom_left_corner",
      "bottom_right_corner",
      "tl_corner",
      "tr_corner",
      "bl_corner",
      "br_corner",
      "corner",
    ].includes(k)
  )
    return "corners";
  if (["top_edge", "bottom_edge", "left_edge", "right_edge", "edge"].includes(k)) return "edges";
  if (["surface", "center", "centre", "face", "front"].includes(k)) return "surface";
  return "other";
}

function severityWeight(sev) {
  if (sev === "high" || sev === "major") return 2.5;
  if (sev === "medium" || sev === "moderate") return 1.5;
  if (sev === "low" || sev === "minor") return 0.8;
  return 1.0;
}

function bandDistance(a, b) {
  const ai = BAND_ORDER.indexOf(a);
  const bi = BAND_ORDER.indexOf(b);
  if (ai === -1 || bi === -1) return null;
  return Math.abs(ai - bi);
}

function computeBandAgreement(predicted, official) {
  if (predicted === official) return "match";
  const d = bandDistance(predicted, official);
  if (d === null) return "no_official_band";
  if (d === 1) return "adjacent";
  return "mismatch";
}

function nowMs() {
  return performance.now();
}

function makeRunId(iteration) {
  const ts = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const rand = createHash("sha256").update(`${ts}-${iteration}-${Math.random()}`).digest("hex").slice(0, 6);
  return `${ts}-it${iteration}-${rand}`;
}

function writeAppendLine(path, line) {
  if (!existsSync(path)) writeFileSync(path, "");
  appendFileSync(path, `${line}\n`);
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    const key = m[1];
    const value = m[2] ?? true;
    if (key === "loop") out.loop = Number.parseInt(String(value), 10);
    else out[key] = value;
  }
  return out;
}

function renderSummaryMd(aggregate) {
  const lines = [];
  lines.push(`# Agentic cert-eval flywheel run ${aggregate.runId}`);
  lines.push("");
  lines.push(`generatedAt: ${aggregate.generatedAt}`);
  lines.push(`agentPolicyVersion: ${aggregate.agentPolicyVersion}`);
  lines.push(`judgeRubricVersion: ${aggregate.judgeRubricVersion}`);
  lines.push("");
  lines.push("## System scores");
  lines.push("");
  lines.push("| layer | score |");
  lines.push("| --- | --- |");
  for (const [layer, score] of Object.entries(aggregate.byLayer)) {
    lines.push(`| ${layer} | ${score === null ? "—" : score.toFixed(3)} |`);
  }
  lines.push(`| **system** | **${aggregate.systemScore.toFixed(3)}** |`);
  lines.push("");
  lines.push("## Calibration agreement");
  lines.push("");
  lines.push(`- match rate: ${aggregate.matchRate.toFixed(3)}`);
  lines.push(`- adjacent rate: ${aggregate.adjacentRate.toFixed(3)}`);
  lines.push(`- mismatch rate: ${aggregate.mismatchRate.toFixed(3)}`);
  lines.push(`- no_official_band: ${aggregate.noOfficialBandRate.toFixed(3)}`);
  lines.push("");
  if (Object.keys(aggregate.errorBuckets).length > 0) {
    lines.push("## Error buckets");
    lines.push("");
    lines.push("| bucket | count |");
    lines.push("| --- | ---: |");
    for (const [bucket, count] of Object.entries(aggregate.errorBuckets)) {
      lines.push(`| ${bucket} | ${count} |`);
    }
    lines.push("");
  }
  if (aggregate.recommendedFixes.length > 0) {
    lines.push("## Recommended fixes (layer-aware)");
    lines.push("");
    for (const fix of aggregate.recommendedFixes) {
      lines.push(`### ${fix.layer}`);
      lines.push("");
      lines.push(fix.rationale);
      lines.push("");
      for (const action of fix.actions) lines.push(`- ${action}`);
      lines.push("");
    }
  }
  if (aggregate.deltaVsPrevious) {
    lines.push("## Delta vs previous iteration");
    lines.push("");
    lines.push("| layer | prev | now | Δ |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const [layer, current] of Object.entries(aggregate.byLayer)) {
      const prev = aggregate.deltaVsPrevious.byLayer?.[layer] ?? null;
      const delta = prev != null && current != null ? current - prev : null;
      lines.push(
        `| ${layer} | ${prev != null ? prev.toFixed(3) : "—"} | ${current != null ? current.toFixed(3) : "—"} | ${
          delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}` : "—"
        } |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
