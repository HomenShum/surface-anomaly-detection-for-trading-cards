#!/usr/bin/env node
/**
 * Runs verify_gif_with_gemini.mjs across every demo GIF with route-aware
 * expectations, then prints a one-row-per-GIF table.
 *
 *   node scripts/qa/verify_all_demo_gifs.mjs           → all 13 GIFs
 *   node scripts/qa/verify_all_demo_gifs.mjs 09        → match name substring
 *
 * Reads artifacts from public/demo/gemini-qa/<basename>.json.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename, extname, resolve } from "node:path";

const REPO = process.cwd();
const GIF_DIR = join(REPO, "public", "demo", "gifs");
const QA_DIR = join(REPO, "public", "demo", "gemini-qa");

mkdirSync(QA_DIR, { recursive: true });

const EXPECTATIONS = {
  "01-scan-end-to-end-desktop":
    "the /scan?mode=sample page running a 14-stage condition checklist with the analyze canvas, corner/edge zoom inspections, and rendering a post-scan report — desktop (1440x900). Inference service is running; no 'offline' overlays expected. NOTE: the sample card is intentionally a CLEAN reference card; 'DETECTIONS 0' in the report summary is the honest expected output and NOT a bug. Real labeled DING bounding boxes are demonstrated in flow 04 (Example detail tour).",
  "01-scan-end-to-end-mobile":
    "the /scan?mode=sample page running the 14-stage condition checklist with analyze canvas + zoom-lens, ending with a report — mobile (390x844). Inference service is running; no 'offline' overlays expected. NOTE: the sample card is intentionally a CLEAN reference card; the 'DETECTIONS 0' in the report summary is the honest, expected output and NOT a bug. Real labeled DING bounding boxes are demonstrated in flow 04 (Example detail tour), not here.",
  "02-landing-trust-onboarding-desktop":
    "the landing page (/) scrolling through the trust strip, outcome library, and verified community methods — desktop (1440x900). Inference service is running; no 'INFERENCE OFFLINE' banner expected.",
  "02-landing-trust-onboarding-mobile":
    "the landing page (/) on mobile (390x844), scrolling through the trust strip, outcome library, verified methods. Inference service is running; no 'INFERENCE OFFLINE' banner expected.",
  "03-examples-library-tour-desktop":
    "the /examples page with an examples grid, the failure-cases-only toggle being toggled, and the tier filter switching to silver — desktop (1440x900).",
  "03-examples-library-tour-mobile":
    "the /examples page on mobile (390x844), showing the example library grid, trust/source badges, filter controls, and at least one visible example card. The mobile clip does not need to show the failure-cases-only state.",
  "04-example-detail-grader-desktop":
    "the real Tauros card example detail page on desktop (1440x900), with visible DING bounding boxes and readable labels over actual card pixels, plus a DINGs panel showing type, severity, materiality, confidence/provenance, and the not-an-official-grade disclaimer. Verdict should fail if the card image is blank or the DING labels are not visible.",
  "04-example-detail-grader-mobile":
    "the real Tauros card example detail page on mobile (390x844), with visible DING bounding boxes and readable labels over actual card pixels, plus the DINGs panel with type, severity, materiality, confidence/provenance, and the not-an-official-grade disclaimer. Sequential visibility is acceptable on mobile.",
  "05-methods-board-flywheel-desktop":
    "the /methods page showing the verified-methods board, reward toast, and methods flywheel — desktop (1440x900).",
  "06-benchmarks-transparency-desktop":
    "the /benchmarks page showing per-class YOLO metrics, dataset provenance, and transparency tables — desktop (1440x900). Note: the dataset note 'hand-authored seed, full registry to follow' is honest product disclosure, NOT a bug.",
  "07-certs-import-pipeline-desktop":
    "the /certs/import page showing the cert-reference import pipeline UI: provider mix (PSA / TAG), Silver / Silver+ / Gold trust tiers, and a list / table of certified references with metadata — desktop (1440x900). 'Image cards' here means the per-reference rows / cards, not necessarily image thumbnails.",
  "07-certs-import-pipeline-mobile":
    "the /certs/import page with cert reference import pipeline (PSA/TAG providers, Silver/Silver+/Gold tiers, per-reference rows) — mobile (390x844).",
  "08-benchmarks-certified-references-desktop":
    "the /benchmarks/certified-references page showing band-agreement metrics, predicted vs official band breakdowns, and a per-cert table — desktop (1440x900). IMPORTANT: 'Agentic system eval is blocked for deployability', 'no predictions yet' for PSA 10, and 'no eval' for some certs are HONEST PRODUCT DISCLOSURES of evaluation gaps — they are NOT bugs and SHOULD appear. The page is intentionally transparent about which gates remain unmet.",
  "09-benchmarks-flywheel-desktop":
    "the /benchmarks/flywheel agentic flywheel dashboard: a system score (any value 0..1, fluctuates per run), per-layer scoreboard (ML, Agent, Calibration, Trust, UX, Evidence), recommended fixes, error buckets, per-cert traces table, and run history — desktop.",
  "10-dealer-intake-desktop":
    "the /dealer/intake bulk PSA-label intake page: drop zone for slab/binder photos, lane swimlanes (Uploaded / Certs detected / Verified / Image attached / Ready / Needs human review / Listed), and a recent-batches table — desktop (1440x900). The page is the Day-1 deliverable of the dealer pilot.",
  "10-dealer-intake-mobile":
    "the /dealer/intake bulk PSA-label intake page on mobile (390x844): drop zone, lane swimlanes (may stack vertically), and recent-batches table. Layout should not horizontally overflow.",
  "11-dealer-dashboard-desktop":
    "the /dealer/dashboard daily ops view: inventory $, expected graded EV, reviewed count, listed count, submission pipeline, stale count, then sectional tables for ready-to-list / worth-grading / needs-human-review / recent-imports — desktop (1440x900).",
  "11-dealer-dashboard-mobile":
    "the /dealer/dashboard on mobile (390x844): summary cards stack vertically, sectional tables scroll horizontally inside their containers if needed.",
  "12-dealer-record-review-desktop":
    "the /dealer/records/<id> human-review workbench for a Silver+ Snorlax VMAX cert: cert metadata, accept/reject buttons on each model finding, pricing + ROI panel, variant resolver, and evidence-packet section — desktop (1440x900). DING bbox overlays may not appear because no slab image is attached to seeded records (intentional — reviewer attaches it before publishing).",
  "12-dealer-record-review-mobile":
    "the /dealer/records/<id> human-review workbench on mobile (390x844): the image-stage and aside columns stack vertically; cert metadata, findings list, pricing/ROI, variant resolver, evidence-packet section all visible while scrolling.",
  "real-dataset-card-corner-wear-model-annotations":
    "a real dataset card image analyzed by the live inference API, with visible DING annotation bounding boxes and readable labels on actual card pixels. CRITICAL: the GIF MUST show at least one real corner_wear DING bbox, confidence label, zoom/crop reinspection panel, evidence/proof text, and the not-an-official-grade disclaimer. Verdict should fail if this looks like a blank page, a placeholder, or unlabeled boxes.",
  "real-card-upload-agent-workspace-desktop":
    "the agent workspace uploading a real card image, running the DING detector/checklist, and saving the reviewed card on desktop.",
  "real-card-upload-agent-workspace-mobile":
    "the mobile-sized agent workspace with an uploaded real card image visible, the DING detector/checklist running, tool/status messages visible, and no blank/error page. The desktop version demonstrates the final save confirmation; the mobile clip may focus on the upload and analysis state because of the narrow viewport.",
  "upload-checklist-zoom-inspection-desktop":
    "the upload-first scan flow showing the actual card, streaming checklist rows, and zoom/inspection visual states on desktop.",
  "sample-scan-checklist-zoom-inspection-mobile":
    "the mobile sample scan flow showing the streaming checklist, card canvas, and visual inspection states.",
  "verified-outcome-library-trust-explorer":
    "the public example/outcome library with filters and an inspectable example detail page.",
  "real-ding-annotations-tauros-card-desktop":
    "a real-card example detail page with visible DING annotation boxes, labels, confidence/materiality notes, and DING panel on desktop.",
  "real-ding-annotations-tauros-card-mobile":
    "a real-card example detail page with visible DING annotation boxes, labels, confidence/materiality notes, and DING panel on mobile.",
  "certified-reference-import-eval-workbench":
    "the certified reference import workbench showing PSA/TAG style reference intake, trust tiers, and import/eval status.",
  "certified-reference-benchmark-grade-spread":
    "the certified reference benchmark dashboard showing grade spread, band alignment, and blocked trust gates.",
  "community-verified-methods-reward-board":
    "the verified inspection methods board with reward/toast/community method registry surfaces.",
  "before-after-evidence-compare-dispute":
    "the before/after evidence comparison flow showing split/swipe/diff modes and DING/evidence annotations.",
};

Object.assign(EXPECTATIONS, {
  "03-examples-library-tour-desktop":
    "the /examples page with an examples grid, the failure-cases-only toggle being turned on and then back off to demonstrate both states, and the tier filter switching to silver - desktop (1440x900). Returning to all examples after showing failure cases is intentional.",
  "03-examples-library-tour-mobile":
    "the /examples page on mobile (390x844), showing the example library grid, trust/source badges, filter controls, and at least one visible example card. The mobile clip does not need to show the failure-cases-only state.",
  "04-example-detail-grader-desktop":
    "the real Tauros card example detail page on desktop (1440x900), with visible DING bounding boxes and readable labels over actual card pixels, plus a DINGs panel showing type, severity, materiality, confidence/provenance, and the not-an-official-grade disclaimer. The DINGs count is expected product copy, not a browser error. Verdict should fail if the card image is blank or the DING labels are not visible.",
  "05-methods-board-flywheel-desktop":
    "the /methods page showing the verified-methods board, reward toast, and methods flywheel - desktop (1440x900). The reward toast is intentionally held open in this shareable demo so the badge/reward copy is readable.",
  "verified-outcome-library-trust-explorer":
    "the public example/outcome library with filters and inspectable example cards. External certified references without local images should show explicit external-reference/no-local-image placeholders rather than blank cards.",
  "sample-scan-checklist-zoom-inspection-mobile":
    "the mobile sample scan flow showing the streaming checklist, card canvas, and visual inspection states. Sequential zoom animation frames may transition quickly between neighboring corners; pass if the clip clearly shows the card canvas, live checklist progress, and region inspection overlays.",
});

function listTargets(filter) {
  const expected = new Set(Object.keys(EXPECTATIONS).map((stem) => `${stem}.gif`));
  const all = readdirSync(GIF_DIR)
    .filter((n) => expected.has(n))
    .sort((a, b) => a.localeCompare(b));
  if (!filter) return all;
  return all.filter((n) => n.includes(filter));
}

function run(gifFile) {
  const stem = basename(gifFile, extname(gifFile));
  const expect = EXPECTATIONS[stem] ?? "the recorded surface to render correctly with no broken UI";
  const gifArg = `public/demo/gifs/${gifFile}`;
  const proc = spawnSync(
    "node",
    ["scripts/qa/verify_gif_with_gemini.mjs", `--gif=${gifArg}`, `--expect=${expect}`, "--frames=8"],
    { cwd: REPO, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 }
  );
  return { stem, code: proc.status, stdout: proc.stdout, stderr: proc.stderr, error: proc.error };
}

function summarize() {
  const rows = [];
  for (const f of readdirSync(QA_DIR)) {
    if (!f.endsWith(".json")) continue;
    if (f === "INDEX.json") continue;
    try {
      const j = JSON.parse(readFileSync(join(QA_DIR, f), "utf-8"));
      const r = j.response ?? {};
      rows.push({
        gif: j.gif,
        verdict: r.verdict ?? "?",
        matches: r.matches_expectation ?? null,
        confidence: r.match_confidence ?? null,
        issues: Array.isArray(r.issues) ? r.issues.length : 0,
        suggested_followups: r.suggested_followups ?? [],
      });
    } catch {}
  }
  rows.sort((a, b) => a.gif.localeCompare(b.gif));
  return rows;
}

async function main() {
  const filter = process.argv[2] ?? "";
  const targets = listTargets(filter);
  if (targets.length === 0) {
    console.error("No GIFs matched filter");
    process.exit(2);
  }
  console.error(`▶ Verifying ${targets.length} GIF(s) via Gemini…`);
  const failures = [];
  for (const file of targets) {
    process.stderr.write(`  · ${file} … `);
    const t0 = Date.now();
    const { code, stdout, stderr, error } = run(file);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    let verdict = "?";
    let matchesExpectation = null;
    try {
      const parsed = JSON.parse(stdout);
      const response = parsed.response ?? parsed;
      verdict = response.verdict ?? "?";
      matchesExpectation = response.matches_expectation ?? null;
    } catch {}
    process.stderr.write(`${verdict} (${dt}s)\n`);
    if (code !== 0) {
      failures.push({ file, code, stderr: String(error?.message ?? stderr ?? stdout ?? "").slice(0, 400) });
    } else if (verdict === "fail" || matchesExpectation === false) {
      failures.push({ file, code: 1, stderr: `Gemini verdict=${verdict} matches_expectation=${matchesExpectation}` });
    }
  }
  const rows = summarize();
  const indexPath = join(QA_DIR, "INDEX.json");
  writeFileSync(indexPath, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));

  console.log("\n=== Gemini QA verdicts ===");
  for (const r of rows) {
    const tag = r.verdict === "pass" ? "✅" : r.verdict === "warn" ? "⚠️" : r.verdict === "fail" ? "❌" : "·";
    const conf = r.confidence == null ? "?" : Number(r.confidence).toFixed(2);
    console.log(`${tag} ${r.verdict.padEnd(5)} conf=${conf} issues=${r.issues}  ${r.gif}`);
    if (Array.isArray(r.suggested_followups) && r.suggested_followups.length) {
      for (const s of r.suggested_followups.slice(0, 3)) console.log(`     ↳ ${s}`);
    }
  }
  if (failures.length) {
    console.log("\n=== Failed runs ===");
    for (const f of failures) console.log(` - ${f.file} (exit ${f.code}): ${f.stderr.slice(0, 240)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
