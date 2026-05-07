#!/usr/bin/env node
/**
 * Disk hygiene: prune old agentic-eval + flywheel run artifacts, keeping
 * only the most recent N of each.
 *
 *   node scripts/qa/prune_eval_runs.mjs           → keep last 5 (default)
 *   node scripts/qa/prune_eval_runs.mjs --keep=10 → keep last 10
 *   node scripts/qa/prune_eval_runs.mjs --dry-run → print what would go
 *
 * Preserves `latest.json` / `latest.judge-prompts.jsonl` pointers and the
 * directories themselves; only timestamped artifacts are removed.
 */

import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const KEEP = Number.parseInt(args.keep ?? "5", 10) || 5;
const DRY = Boolean(args["dry-run"]);

function pruneAgenticEval(dir, keep) {
  if (!existsSync(dir)) return { kept: 0, dropped: 0 };
  const all = readdirSync(dir).filter((n) => n.startsWith("agentic-"));
  const stamps = [...new Set(all.map((n) => n.replace(/\.judge-prompts\.jsonl$/, "").replace(/\.json$/, "")))]
    .sort();
  const keepStamps = stamps.slice(-keep);
  const dropStamps = stamps.slice(0, -keep);
  let droppedCount = 0;
  for (const ts of dropStamps) {
    for (const ext of [".json", ".judge-prompts.jsonl"]) {
      const p = join(dir, ts + ext);
      if (existsSync(p)) {
        if (!DRY) unlinkSync(p);
        droppedCount++;
      }
    }
  }
  return { kept: keepStamps.length, dropped: droppedCount, keepStamps, dropStamps };
}

function pruneFlywheel(dir, keep) {
  if (!existsSync(dir)) return { kept: 0, dropped: 0 };
  const dirs = readdirSync(dir).filter((n) => {
    try { return statSync(join(dir, n)).isDirectory(); } catch { return false; }
  }).sort();
  const keepDirs = dirs.slice(-keep);
  const dropDirs = dirs.slice(0, -keep);
  for (const subdir of dropDirs) {
    if (!DRY) rmSync(join(dir, subdir), { recursive: true, force: true });
  }
  return { kept: keepDirs.length, dropped: dropDirs.length, keepDirs, dropDirs };
}

const evalDir = join(ROOT, "data", "cert-references", "agentic-eval");
const flywheelDir = join(ROOT, "data", "cert-references", "flywheel", "runs");

const e = pruneAgenticEval(evalDir, KEEP);
const f = pruneFlywheel(flywheelDir, KEEP);

console.log(JSON.stringify({
  dryRun: DRY,
  keepN: KEEP,
  agenticEval: { kept: e.kept, dropped: e.dropped },
  flywheel: { kept: f.kept, dropped: f.dropped },
  removedSamples: {
    agentic: e.dropStamps?.slice(0, 3) ?? [],
    flywheel: f.dropDirs?.slice(0, 3) ?? [],
  },
}, null, 2));
