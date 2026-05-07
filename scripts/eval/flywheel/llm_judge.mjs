// LLM-judge framework for the agentic cert-eval flywheel.
//
// Today: deterministic rubric. Built so the same shape can be returned by an
// actual LLM call (e.g., Claude/GPT) later — every judgment carries a
// `rationale` string + `signals` it grounded against, exactly the artifact a
// human reviewer would expect from an LLM judge.
//
// Six layers, scored 0..1:
//   - ml          (detector behaved appropriately for the official tier)
//   - agent       (tool sequence is rational, no over-spawning, glare gate)
//   - calibration (predicted band aligns with official band)
//   - trust       (claims are grounded; disclaimers present; no grade claims)
//   - ux          (visible action emitted; report length sane)
//   - evidence    (sha256 + bbox + modelVersion attached)
//
// systemScore = weighted average across layers that produced a signal.
// errorBucket: classification of dominant failure mode for this cert.
// recommendedFixLayer: which layer should ship a change to address the bucket.

export const AGENT_POLICY_VERSION = "agent-policy-v1.0";
export const JUDGE_RUBRIC_VERSION = "judge-rubric-v1.1-real-image-proof-gate";

const LAYER_WEIGHTS = {
  ml: 0.2,
  agent: 0.15,
  calibration: 0.25,
  trust: 0.15,
  ux: 0.1,
  evidence: 0.15,
};

// =============================================================================
// per-cert judgment
// =============================================================================

export function judgeTrace(trace) {
  const ml = scoreMl(trace);
  const agent = scoreAgent(trace);
  const calibration = scoreCalibration(trace);
  const trust = scoreTrust(trace);
  const ux = scoreUx(trace);
  const evidence = scoreEvidence(trace);

  const layers = { ml, agent, calibration, trust, ux, evidence };
  const systemScore = weightedAverage(layers);
  const errorBucket = classifyErrorBucket(trace, layers);
  const recommendedFixLayer = recommendFixLayer(errorBucket, layers);

  return {
    layers,
    systemScore,
    errorBucket,
    recommendedFixLayer,
  };
}

// =============================================================================
// layer scorers
// =============================================================================

function scoreMl(trace) {
  if (!trace.imagePresent) {
    return {
      score: null,
      rationale: "no slab image present — ml signal not produced",
      signals: { imagePresent: false },
    };
  }
  if (trace.inferenceIsSimulated) {
    return {
      score: 0.35,
      rationale: "inference was simulated/mock. This can exercise the loop but cannot prove certified-reference outcome matching.",
      signals: {
        imagePresent: trace.imagePresent,
        imageSource: trace.imageSource ?? "mock",
        inferenceIsSimulated: true,
        modelVersion: trace.inferenceModelVersion ?? null,
      },
    };
  }
  if (trace.error) {
    return {
      score: 0.0,
      rationale: `inference call failed: ${trace.error}`,
      signals: { error: trace.error },
    };
  }
  const expected = expectedFindingsRange(trace.officialBand);
  const actual = trace.detectionCount ?? 0;
  const inRange = actual >= expected.min && actual <= expected.max;
  let score;
  let rationale;
  if (inRange) {
    score = 1.0;
    rationale = `${actual} findings is in the expected range [${expected.min}..${expected.max}] for band ${trace.officialBand}.`;
  } else if (actual < expected.min) {
    const gap = expected.min - actual;
    score = Math.max(0.2, 1 - 0.25 * gap);
    rationale = `${actual} findings is BELOW expected range [${expected.min}..${expected.max}] for ${trace.officialBand} — possible overconfident clean failure.`;
  } else {
    const gap = actual - expected.max;
    score = Math.max(0.3, 1 - 0.15 * gap);
    rationale = `${actual} findings is ABOVE expected range [${expected.min}..${expected.max}] for ${trace.officialBand} — possible false positive storm.`;
  }
  // Penalty: high severity on top tier.
  if (trace.officialBand === "950-1000_gem_pristine" && trace.detectionMaxSeverity === "high") {
    score = Math.min(score, 0.2);
    rationale += " Severity escalated to 'high' on a GEM-tier cert — strong overcall signal.";
  }
  return {
    score,
    rationale,
    signals: {
      detectionCount: actual,
      detectionMaxSeverity: trace.detectionMaxSeverity,
      expectedRange: expected,
      officialBand: trace.officialBand,
    },
  };
}

function scoreAgent(trace) {
  const seq = trace.toolSequence ?? [];
  const seqNames = seq.map((c) => c.tool);
  const contains = (name) => seqNames.includes(name);
  const positiveSignals = [];
  const negativeSignals = [];
  let score = 1.0;

  if (contains("compare_to_cert_reference")) {
    positiveSignals.push("compare_to_cert_reference: agent grounded itself before predicting");
  } else {
    negativeSignals.push("compare_to_cert_reference: agent did not ground against official cert");
    score -= 0.25;
  }

  if (trace.imagePresent) {
    if (contains("run_ding_detector")) {
      positiveSignals.push("run_ding_detector: ML pipeline invoked when image was present");
    } else {
      negativeSignals.push("run_ding_detector: missing despite slab image");
      score -= 0.2;
    }
    if (contains("cite_evidence")) {
      positiveSignals.push("cite_evidence: per-finding evidence trail attached");
    } else if ((trace.detectionCount ?? 0) > 0) {
      negativeSignals.push("cite_evidence: findings present but no per-finding evidence cited");
      score -= 0.15;
    }
    if (trace.finishHint === "holo" || trace.finishHint === "glossy") {
      if (contains("evaluate_glare_risk")) {
        positiveSignals.push("evaluate_glare_risk: glare check fired on holo/glossy as required");
      } else {
        negativeSignals.push("evaluate_glare_risk: missing on holo/glossy — surface claims would be glare-uncertain");
        score -= 0.15;
      }
    }
    if (contains("request_zoom_animation")) {
      positiveSignals.push("request_zoom_animation: visible UI action emitted before describing region");
    } else if ((trace.detectionCount ?? 0) > 0) {
      negativeSignals.push("request_zoom_animation: described findings without visible inspection cue");
      score -= 0.1;
    }
  }

  // Honest gating: flag_mismatch only on non-match.
  const flaggedMismatch = contains("flag_mismatch");
  if (trace.bandAgreement === "match" && flaggedMismatch) {
    negativeSignals.push("flag_mismatch fired on a band-match — unnecessary escalation");
    score -= 0.1;
  } else if (trace.bandAgreement === "mismatch" && !flaggedMismatch) {
    negativeSignals.push("flag_mismatch missing on a band-mismatch — silent disagreement");
    score -= 0.15;
  } else if (trace.bandAgreement === "mismatch" && flaggedMismatch) {
    positiveSignals.push("flag_mismatch fired on band-mismatch as required");
  }

  // create_human_review_task only on mismatch.
  const reviewed = contains("create_human_review_task");
  if (trace.bandAgreement === "match" && reviewed) {
    negativeSignals.push("create_human_review_task fired on match — over-escalation");
    score -= 0.1;
  } else if (trace.bandAgreement === "mismatch" && !reviewed) {
    negativeSignals.push("create_human_review_task missing on mismatch");
    score -= 0.1;
  } else if (trace.bandAgreement === "mismatch" && reviewed) {
    positiveSignals.push("create_human_review_task drafted for human follow-up");
  }

  // propose_inspection_method should be selective, not per-cert.
  if (contains("propose_inspection_method")) {
    if (trace.bandAgreement === "match") {
      negativeSignals.push("propose_inspection_method fired on match — over-spawning skill proposals");
      score -= 0.15;
    } else {
      positiveSignals.push("propose_inspection_method fired on disagreement (acceptable)");
    }
  }

  score = Math.max(0, Math.min(1, score));
  return {
    score,
    rationale:
      negativeSignals.length === 0
        ? "Tool sequence is rational and gates fired correctly."
        : `Issues: ${negativeSignals.join("; ")}.`,
    signals: { positiveSignals, negativeSignals, sequence: seqNames },
  };
}

function scoreCalibration(trace) {
  if (!trace.officialBand) {
    return {
      score: null,
      rationale: "no official band — calibration signal not produced",
      signals: { officialBand: null },
    };
  }
  if (!trace.predictedBand) {
    return {
      score: 0.0,
      rationale: "no predicted band emitted — calibrator silent",
      signals: { predictedBand: null, officialBand: trace.officialBand },
    };
  }
  let score;
  let rationale;
  if (trace.bandAgreement === "match") {
    score = 1.0;
    rationale = `predicted ${trace.predictedBand} == official ${trace.officialBand}`;
  } else if (trace.bandAgreement === "adjacent") {
    score = 0.6;
    rationale = `predicted ${trace.predictedBand} is adjacent to official ${trace.officialBand} (distance=${trace.bandDistance}).`;
  } else if (trace.bandAgreement === "mismatch") {
    score = 0.0;
    rationale = `predicted ${trace.predictedBand} mismatches official ${trace.officialBand} (distance=${trace.bandDistance}).`;
  } else {
    score = null;
    rationale = "no_official_band path";
  }
  return {
    score,
    rationale,
    signals: {
      predictedBand: trace.predictedBand,
      officialBand: trace.officialBand,
      bandAgreement: trace.bandAgreement,
      bandDistance: trace.bandDistance,
    },
  };
}

function scoreTrust(trace) {
  const claims = trace.claims ?? [];
  const text = claims.join("\n").toLowerCase();
  const positiveSignals = [];
  const negativeSignals = [];
  let score = 0.5; // start neutral

  if (text.includes("ai-assisted") && text.includes("not an official grade")) {
    score += 0.2;
    positiveSignals.push("disclaimer present");
  } else {
    score -= 0.15;
    negativeSignals.push("missing 'AI-assisted / not an official grade' disclaimer");
  }
  if (text.includes("internal band only") || text.includes("not a grade claim")) {
    score += 0.2;
    positiveSignals.push("internal-band only language present");
  } else {
    score -= 0.1;
    negativeSignals.push("missing 'internal band only' or 'not a grade claim' phrasing");
  }
  // Forbidden grader-grade language.
  const gradeClaim =
    /\bpsa\s*10\b|\bpsa\s*9\b|\bgem mt 10\b|\bofficial grade\s*=/.test(text) &&
    !text.includes("internal band only");
  if (gradeClaim) {
    score -= 0.4;
    negativeSignals.push("language sounds like a grader-grade claim");
  }
  // Confidence honesty: 0.0 confidence on a real prediction = baseline mirror.
  if (trace.imagePresent && trace.bandAgreement && trace.bandAgreement !== "no_official_band") {
    const conf = lastFindingConfidence(trace);
    if (conf === 0) {
      score -= 0.25;
      negativeSignals.push("hardcoded 0 confidence on real prediction (baseline mirror residue)");
    }
  }
  if (trace.inferenceIsSimulated) {
    score -= 0.2;
    negativeSignals.push("simulated inference cannot be used as outcome proof");
  }

  score = Math.max(0, Math.min(1, score));
  return {
    score,
    rationale:
      negativeSignals.length === 0
        ? "Claims grounded; honest disclaimers present."
        : `Issues: ${negativeSignals.join("; ")}.`,
    signals: { positiveSignals, negativeSignals, claimCount: claims.length },
  };
}

function scoreUx(trace) {
  const seq = trace.toolSequence ?? [];
  const ui = trace.uiActions ?? [];
  let score = 0.5;
  const signals = [];
  if (ui.some((a) => a.kind === "zoom")) {
    score += 0.4;
    signals.push("zoom UI action emitted (visible inspection)");
  } else if (trace.imagePresent && (trace.detectionCount ?? 0) > 0) {
    score -= 0.2;
    signals.push("findings described without zoom UI cue");
  }
  if (seq.length >= 4 && seq.length <= 12) {
    score += 0.1;
    signals.push("tool sequence length is within sane bounds");
  } else if (seq.length > 16) {
    score -= 0.2;
    signals.push("tool sequence too noisy (>16 calls)");
  } else if (seq.length < 3) {
    score -= 0.2;
    signals.push("tool sequence too quiet (<3 calls)");
  }
  // Time-to-first-zoom: zoom action should land before claim is rendered (encoded
  // as zoom must appear before tool sequence index of run_condition_band_calibrator).
  const zoomIdx = seq.findIndex((c) => c.tool === "request_zoom_animation");
  const calibIdx = seq.findIndex((c) => c.tool === "run_condition_band_calibrator");
  if (zoomIdx >= 0 && calibIdx >= 0 && zoomIdx < calibIdx) {
    signals.push("zoom emitted before calibrator (visible reasoning order)");
  } else if (calibIdx >= 0 && zoomIdx >= 0 && zoomIdx > calibIdx) {
    score -= 0.1;
    signals.push("zoom emitted AFTER calibrator (claim before show)");
  }
  score = Math.max(0, Math.min(1, score));
  return {
    score,
    rationale:
      signals.length > 0
        ? signals.join("; ")
        : "No explicit UX signal — slab image absent.",
    signals: { signals, sequenceLength: seq.length, zoomCount: ui.filter((a) => a.kind === "zoom").length },
  };
}

function scoreEvidence(trace) {
  const ev = trace.evidence ?? [];
  const positiveSignals = [];
  const negativeSignals = [];
  let score = 0.4;

  if (trace.cardIdentity) {
    score += 0.15;
    positiveSignals.push("cardIdentity present (provenance)");
  } else {
    negativeSignals.push("cardIdentity missing");
  }

  if (trace.imagePresent && (trace.detectionCount ?? 0) > 0) {
    const withSha = ev.filter((e) => e.sha256).length;
    const withBbox = ev.filter((e) => e.bbox).length;
    if (withSha === ev.length && ev.length > 0) {
      score += 0.2;
      positiveSignals.push("every finding has sha256");
    } else if (ev.length > 0) {
      score -= 0.1;
      negativeSignals.push(`only ${withSha}/${ev.length} findings have sha256`);
    }
    if (withBbox === ev.length && ev.length > 0) {
      score += 0.1;
      positiveSignals.push("every finding has bbox");
    } else if (ev.length > 0) {
      score -= 0.05;
      negativeSignals.push(`only ${withBbox}/${ev.length} findings have bbox`);
    }
    if (trace.inferenceModelVersion) {
      score += 0.15;
      positiveSignals.push(`modelVersion=${trace.inferenceModelVersion} attached`);
    } else {
      score -= 0.1;
      negativeSignals.push("modelVersion missing");
    }
  } else if (!trace.imagePresent) {
    // No image, no findings, no evidence to hash. Neutral.
    score = 0.5;
    negativeSignals.push("no image — evidence trail incomplete by design");
  }
  score = Math.max(0, Math.min(1, score));
  return {
    score,
    rationale:
      negativeSignals.length === 0
        ? "Evidence trail complete: identity + sha256 + bbox + modelVersion."
        : `Gaps: ${negativeSignals.join("; ")}.`,
    signals: { positiveSignals, negativeSignals, evidenceCount: ev.length },
  };
}

// =============================================================================
// error bucket classification
// =============================================================================

function classifyErrorBucket(trace, layers) {
  if (!trace.imagePresent) {
    return { bucket: "missing_image", severity: "p1" };
  }
  if (trace.inferenceIsSimulated) {
    return { bucket: "simulated_inference_not_proof", severity: "p1" };
  }
  if (trace.error) {
    return { bucket: "inference_failure", severity: "p1" };
  }
  if (trace.bandAgreement === "mismatch") {
    if (
      trace.officialBand &&
      ["below_700_heavy_wear", "700-799_visible_issues"].includes(trace.officialBand) &&
      (trace.detectionCount ?? 0) === 0
    ) {
      return { bucket: "overconfident_clean_failure", severity: "p0" };
    }
    if (
      trace.officialBand === "950-1000_gem_pristine" &&
      (trace.detectionCount ?? 0) > 2
    ) {
      return { bucket: "false_positive_storm", severity: "p0" };
    }
    return { bucket: "band_calibrator_drift", severity: "p1" };
  }
  if (trace.bandAgreement === "adjacent") {
    return { bucket: "band_off_by_one", severity: "p2" };
  }
  if (lastFindingConfidence(trace) === 0 && (trace.detectionCount ?? 0) > 0) {
    return { bucket: "stale_baseline_mirror", severity: "p1" };
  }
  if (
    (trace.finishHint === "holo" || trace.finishHint === "glossy") &&
    (trace.glareScore ?? 0) > 0.4 &&
    !(trace.toolSequence ?? []).some((c) => c.tool === "evaluate_glare_risk")
  ) {
    return { bucket: "glare_false_positive_risk", severity: "p1" };
  }
  if (layers.evidence.score !== null && layers.evidence.score < 0.5) {
    return { bucket: "low_evidence_completeness", severity: "p2" };
  }
  return { bucket: null, severity: null };
}

function recommendFixLayer(errorBucket, layers) {
  if (!errorBucket?.bucket) return null;
  const bucket = errorBucket.bucket;
  if (bucket === "missing_image") return "Data";
  if (bucket === "simulated_inference_not_proof") return "Data";
  if (bucket === "inference_failure") return "Infra";
  if (bucket === "overconfident_clean_failure") return "ML";
  if (bucket === "false_positive_storm") return "ML";
  if (bucket === "band_calibrator_drift") return "Calibration";
  if (bucket === "band_off_by_one") return "Calibration";
  if (bucket === "stale_baseline_mirror") return "ML";
  if (bucket === "glare_false_positive_risk") return "Agent";
  if (bucket === "low_evidence_completeness") return "Evidence";
  return null;
}

// =============================================================================
// helpers
// =============================================================================

function expectedFindingsRange(officialBand) {
  switch (officialBand) {
    case "950-1000_gem_pristine":
      return { min: 0, max: 0 };
    case "900-949_mint":
      return { min: 0, max: 1 };
    case "850-899_strong_nm_mint":
      return { min: 0, max: 2 };
    case "800-849_near_mint":
      return { min: 1, max: 3 };
    case "700-799_visible_issues":
      return { min: 3, max: 7 };
    case "below_700_heavy_wear":
      return { min: 5, max: 15 };
    default:
      return { min: 0, max: 8 };
  }
}

function weightedAverage(layers) {
  let sum = 0;
  let weightSum = 0;
  for (const [layer, value] of Object.entries(layers)) {
    if (value.score === null) continue;
    const w = LAYER_WEIGHTS[layer] ?? 0.1;
    sum += value.score * w;
    weightSum += w;
  }
  if (weightSum === 0) return 0;
  return sum / weightSum;
}

function lastFindingConfidence(trace) {
  const ev = trace.evidence ?? [];
  if (ev.length === 0) return null;
  return ev[ev.length - 1].confidence ?? null;
}

// =============================================================================
// aggregation
// =============================================================================

export function buildAggregate(traces, opts) {
  const judged = traces.map((t) => t.judge);
  const byLayer = computeByLayer(judged);
  const systemScore = average(judged.map((j) => j.systemScore).filter(Number.isFinite));
  const counts = countAgreements(traces);
  const errorBuckets = countBuckets(judged);
  const recommendedFixes = synthesizeFixes({ traces, errorBuckets, byLayer });
  const realImageCount = traces.filter((t) => t.imagePresent && !t.inferenceIsSimulated).length;
  const simulatedImageCount = traces.filter((t) => t.imagePresent && t.inferenceIsSimulated).length;
  const proofEligibleMatches = traces.filter(
    (t) => t.imagePresent && !t.inferenceIsSimulated && t.bandAgreement === "match",
  ).length;
  const topRecommendedFixLayer = recommendedFixes[0]?.layer ?? null;
  const deltaVsPrevious = opts.previous
    ? {
        byLayer: opts.previous.byLayer,
        systemScore: opts.previous.systemScore,
        matchRate: opts.previous.matchRate,
      }
    : null;
  return {
    runId: opts.runId,
    iteration: opts.iteration,
    generatedAt: new Date().toISOString(),
    agentPolicyVersion: opts.agentPolicyVersion,
    judgeRubricVersion: opts.judgeRubricVersion,
    certCount: traces.length,
    imagedCount: traces.filter((t) => t.imagePresent).length,
    realImageCount,
    simulatedImageCount,
    proofEligibleMatches,
    proofMatchRate: rate(proofEligibleMatches, realImageCount),
    byLayer,
    systemScore,
    matchRate: rate(counts.match, counts.total),
    adjacentRate: rate(counts.adjacent, counts.total),
    mismatchRate: rate(counts.mismatch, counts.total),
    noOfficialBandRate: rate(counts.noOfficial, counts.total),
    errorBuckets,
    recommendedFixes,
    topRecommendedFixLayer,
    deltaVsPrevious,
  };
}

function computeByLayer(judged) {
  const layerNames = ["ml", "agent", "calibration", "trust", "ux", "evidence"];
  const out = {};
  for (const layer of layerNames) {
    const values = judged
      .map((j) => j.layers[layer]?.score)
      .filter((v) => v !== null && Number.isFinite(v));
    out[layer] = values.length === 0 ? null : average(values);
  }
  return out;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function countAgreements(traces) {
  const counts = { match: 0, adjacent: 0, mismatch: 0, noOfficial: 0, total: 0 };
  for (const t of traces) {
    counts.total += 1;
    if (t.bandAgreement === "match") counts.match += 1;
    else if (t.bandAgreement === "adjacent") counts.adjacent += 1;
    else if (t.bandAgreement === "mismatch") counts.mismatch += 1;
    else counts.noOfficial += 1;
  }
  return counts;
}

function countBuckets(judged) {
  const out = {};
  for (const j of judged) {
    const b = j.errorBucket?.bucket;
    if (!b) continue;
    out[b] = (out[b] ?? 0) + 1;
  }
  return out;
}

function rate(num, denom) {
  if (!denom) return 0;
  return num / denom;
}

function synthesizeFixes({ traces, errorBuckets, byLayer }) {
  const fixes = [];
  const total = traces.length;
  const imaged = traces.filter((t) => t.imagePresent).length;

  if ((errorBuckets.missing_image ?? 0) > 0) {
    const count = errorBuckets.missing_image;
    fixes.push({
      layer: "Data",
      severity: count > total / 2 ? "p1" : "p2",
      rationale: `${count}/${total} certs lack a slab image. The flywheel cannot exercise the ML/UX layers on those rows.`,
      actions: [
        "Send Friend Ask v2 prioritizing the disagreement-band candidates first.",
        "Drop friend slab photos into data/cert-references/slab-images/<certId>/front.jpg.",
        "Re-run pnpm flywheel:run after each batch lands so the loop picks up new images automatically.",
      ],
    });
  }
  if ((errorBuckets.simulated_inference_not_proof ?? 0) > 0) {
    const count = errorBuckets.simulated_inference_not_proof;
    fixes.push({
      layer: "Data",
      severity: "p1",
      rationale: `${count}/${total} cert(s) used simulated/mock inference. These rows can dogfood the agent loop but cannot prove certified-reference outcome matching.`,
      actions: [
        "Use data/cert-references/slab-images/<certId>/ for user-provided slabs or run pnpm eval:certrefs:remote-proof for public marketplace reference images.",
        "Keep mock-inference runs visually labelled and exclude them from deployability gates.",
      ],
    });
  }
  if ((errorBuckets.stale_baseline_mirror ?? 0) > 0) {
    fixes.push({
      layer: "ML",
      severity: "p1",
      rationale: `${errorBuckets.stale_baseline_mirror} cert(s) emitted hardcoded 0 confidence (baseline-trust-cert mirror residue). The model isn't actually being asked to predict.`,
      actions: [
        "Run pnpm eval:certrefs:run to replace mirror predictions with real inference output.",
        "Verify modelVersion is no longer 'baseline-trust-cert' in data/cert-references/predictions.json.",
      ],
    });
  }
  if ((errorBuckets.overconfident_clean_failure ?? 0) > 0) {
    fixes.push({
      layer: "ML",
      severity: "p0",
      rationale: `${errorBuckets.overconfident_clean_failure} cert(s) returned 0 findings on a known low-tier (EX/EX-MT) card — the detector is being too clean. Symptoms: false-clean.`,
      actions: [
        "Lower the DING-detector confidence threshold OR retrain with more low-tier examples.",
        "Inspect run-traces for the affected certs in the flywheel dashboard.",
        "Consider widening the candidate-bbox suppression radius in the inference pipeline.",
      ],
    });
  }
  if ((errorBuckets.false_positive_storm ?? 0) > 0) {
    fixes.push({
      layer: "ML",
      severity: "p0",
      rationale: `${errorBuckets.false_positive_storm} cert(s) returned >2 findings on a GEM-tier card. Detector is finding artefacts (slab glare, holo bands) rather than real defects.`,
      actions: [
        "Add a glare/foil pre-filter before the DING detector.",
        "Treat findings on GEM-tier slabs as glare_uncertain unless confirmed by tilt-frame.",
      ],
    });
  }
  if ((errorBuckets.band_calibrator_drift ?? 0) > 0) {
    fixes.push({
      layer: "Calibration",
      severity: "p1",
      rationale: `${errorBuckets.band_calibrator_drift} cert(s) mismatched the official band but the detection counts looked sane. Bucket boundaries (score → band) may be off.`,
      actions: [
        "Inspect bucketScoreToBand thresholds in scripts/eval/agentic_cert_flywheel.mjs and apps/web/lib/cert-references-eval.ts.",
        "Recompute mean/median predicted-score per official-band over the latest run; adjust bucket cutoffs.",
      ],
    });
  }
  if ((errorBuckets.band_off_by_one ?? 0) > 0) {
    fixes.push({
      layer: "Calibration",
      severity: "p2",
      rationale: `${errorBuckets.band_off_by_one} cert(s) landed in a band adjacent to the official one. Sub-grade calibration likely needs a small adjustment.`,
      actions: [
        "Inspect predictedSubGrades vs officialSubGrades on the affected certs in the flywheel dashboard.",
        "Tune severityWeight() multipliers in deriveSubGradesShallow.",
      ],
    });
  }
  if ((errorBuckets.glare_false_positive_risk ?? 0) > 0) {
    fixes.push({
      layer: "Agent",
      severity: "p1",
      rationale: `${errorBuckets.glare_false_positive_risk} cert(s) reported surface findings on holo/glossy without firing evaluate_glare_risk first.`,
      actions: [
        "Update agent policy in scripts/eval/agentic_cert_flywheel.mjs to always evaluate_glare_risk before claiming surface findings on holo/glossy.",
        "Consider promoting a pinned skill 'holo-glare-gate' via apps/web/lib/agent/skill-store.ts.",
      ],
    });
  }
  if ((errorBuckets.low_evidence_completeness ?? 0) > 0) {
    fixes.push({
      layer: "Evidence",
      severity: "p2",
      rationale: `${errorBuckets.low_evidence_completeness} cert(s) had incomplete evidence (sha256/bbox/modelVersion gaps).`,
      actions: [
        "Verify FastAPI /scan/analyze emits sha256 + bbox on every finding (services/inference-api/app/main.py).",
        "Ensure modelVersion is non-empty in the inference response.",
      ],
    });
  }
  // Layer-floor fallback fixes when score is below 0.5.
  for (const [layer, score] of Object.entries(byLayer)) {
    if (score === null || score >= 0.5) continue;
    if (fixes.find((f) => f.layer.toLowerCase().startsWith(layer))) continue;
    fixes.push({
      layer: capitalize(layer),
      severity: "p2",
      rationale: `Aggregate ${layer} score ${score.toFixed(3)} is below 0.5. Investigate per-cert traces to find systematic gaps.`,
      actions: [
        `Open data/cert-references/flywheel/runs/<latest>/traces.jsonl and filter for layers.${layer}.score < 0.5.`,
      ],
    });
  }
  return fixes;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
