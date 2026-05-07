#!/usr/bin/env node
// Snapshots the current `data/benchmarks/cert_refs/latest.json` into
// `data/benchmarks/cert_refs/production-baseline.json`.
//
// The promotion gate uses the baseline as the "non-regression" reference for
// future canary/production promotions. Snapshot ONLY when:
//   1. The latest report came from a real model run (modelVersion is not the
//      baseline-trust-cert mirror).
//   2. The latest report passed the gate (allowed=true equivalent).
//   3. You've reviewed the per-cert agreement and are ready to lock it in.
//
// Use `--force` to override safety checks (sparingly).

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..", "..");
const reportDir = join(root, "data", "benchmarks", "cert_refs");
const latestPath = join(reportDir, "latest.json");
const baselinePath = join(reportDir, "production-baseline.json");
const predictionsPath = join(root, "data", "cert-references", "predictions.json");

const force = process.argv.includes("--force");

if (!existsSync(latestPath)) {
  console.error(`[snapshot] no latest.json at ${latestPath}. Run \`pnpm eval:certrefs:bands\` first.`);
  process.exit(1);
}

const latest = JSON.parse(readFileSync(latestPath, "utf-8"));
const refusalReasons = [];

if (latest.modelVersion === "baseline-trust-cert") {
  refusalReasons.push(
    `latest.json modelVersion is "baseline-trust-cert" — this is the trivial mirror, not a real model run.`,
  );
}

// Inspect predictions.json — if every per-prediction modelVersion is the
// baseline-trust-cert mirror, the latest.json was scored against the trivial
// mirror regardless of what --model-version label the operator chose.
if (existsSync(predictionsPath)) {
  try {
    const predictions = JSON.parse(readFileSync(predictionsPath, "utf-8"));
    const perPredictionVersions = Object.entries(predictions)
      .filter(([key]) => !key.startsWith("_"))
      .map(([, value]) => (value && typeof value === "object" ? value.modelVersion : undefined))
      .filter(Boolean);
    const allMirror = perPredictionVersions.length > 0 && perPredictionVersions.every((v) => v === "baseline-trust-cert");
    if (allMirror) {
      refusalReasons.push(
        `predictions.json contains only the baseline-trust-cert mirror — every prediction = official band. Snapshotting would lock in a 100% baseline that no real model can sustain.`,
      );
    }
  } catch {
    /* fall through */
  }
}

const totals = latest.totals ?? {};
if (typeof totals.predictionsCovered === "number" && totals.predictionsCovered === 0) {
  refusalReasons.push("latest.json has 0 predictions covered. Run model inference first.");
}

const matchRate = totals.predictionsCovered > 0 ? totals.matched / totals.predictionsCovered : 0;
if (matchRate < 0.5) {
  refusalReasons.push(`latest.json match rate ${matchRate.toFixed(2)} < 0.50 floor. Cannot snapshot a regressive baseline.`);
}

if (refusalReasons.length > 0 && !force) {
  console.error("[snapshot] refused to write production-baseline:");
  for (const reason of refusalReasons) console.error(`  - ${reason}`);
  console.error("Pass --force to override (only when you understand the consequences).");
  process.exit(1);
}

if (existsSync(baselinePath)) {
  const previous = JSON.parse(readFileSync(baselinePath, "utf-8"));
  console.log(
    `[snapshot] overwriting baseline ${previous.modelVersion} -> ${latest.modelVersion} (was ${previous.evaluatedAt}).`,
  );
}

copyFileSync(latestPath, baselinePath);
console.log(JSON.stringify({
  ok: true,
  baselinePath,
  modelVersion: latest.modelVersion,
  evaluatedAt: latest.evaluatedAt,
  matchRate,
  totals,
}, null, 2));
