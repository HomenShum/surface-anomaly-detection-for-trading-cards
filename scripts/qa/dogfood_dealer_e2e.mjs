#!/usr/bin/env node
/**
 * End-to-end dogfood of the dealer pilot, no manual clicks.
 *
 * Steps:
 *   1. POST a real slab photo to /api/dealer/intake
 *   2. POST another photo to /api/dealer/records/<id>/attach-image (triggers detector)
 *   3. POST /api/dealer/records/<id>/review with an accept-decision payload
 *   4. GET /api/dealer/records/<id>/evidence?format=json + format=html
 *   5. GET /dealer/intake|dashboard|listings|submissions|alerts to confirm SSR
 *
 * Verifies each step produces the expected state transition + persists.
 *
 * Usage:
 *   node scripts/qa/dogfood_dealer_e2e.mjs
 *   CCV_DEMO_URL=http://127.0.0.1:3100 node scripts/qa/dogfood_dealer_e2e.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const baseUrl = (process.env.CCV_DEMO_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");

function fixturePath() {
  // Pick the Tauros sample photo — present in repo, small enough for inline base64.
  const candidates = [
    "apps/web/public/demo/sample-cards/roboflow-tauros-real-card.jpg",
    "apps/web/public/examples/corner-wear.png",
  ];
  for (const c of candidates) {
    const p = resolve(ROOT, c);
    if (existsSync(p)) return p;
  }
  throw new Error("No fixture image available");
}

function loadBase64(p) {
  return readFileSync(p).toString("base64");
}

async function step(label, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`✓ ${label} (${Date.now() - t0}ms)`);
    return r;
  } catch (err) {
    console.error(`✗ ${label} (${Date.now() - t0}ms)`);
    console.error("  ", err?.message ?? err);
    throw err;
  }
}

async function fetchJson(path, init) {
  const r = await fetch(`${baseUrl}${path}`, init);
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  if (!r.ok) {
    throw new Error(`${path} → ${r.status}: ${JSON.stringify(json).slice(0, 240)}`);
  }
  return json;
}

const results = { steps: [], failures: [] };

async function main() {
  const fixture = fixturePath();
  const base64 = loadBase64(fixture);
  console.log(`fixture: ${fixture} (${Math.round(base64.length * 0.75 / 1024)}KB)`);
  console.log(`baseUrl: ${baseUrl}`);
  console.log("");

  // 1. Intake POST
  const intake = await step("intake POST", () =>
    fetchJson("/api/dealer/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, filename: "dogfood-tauros.jpg" }),
    }),
  );
  if (!intake.batchId) throw new Error("intake did not return batchId");
  if (!Array.isArray(intake.recordIds) || intake.recordIds.length === 0) {
    throw new Error("intake did not create any records");
  }
  console.log(`  → batchId=${intake.batchId}`);
  console.log(`  → recordIds=${JSON.stringify(intake.recordIds)}`);
  console.log(`  → uniqueCerts=${JSON.stringify(intake.uniqueCerts)}`);
  console.log(`  → detectedLabels=${intake.detectedLabels}`);
  results.steps.push({ name: "intake", ok: true, batchId: intake.batchId, records: intake.recordIds.length });

  const newRecordId = intake.recordIds[0];

  // 2. State refresh — confirm record landed on the lane swimlanes
  const state = await step("state GET", () => fetchJson("/api/dealer/intake/state"));
  const found = state.records.find((r) => r.id === newRecordId);
  if (!found) throw new Error(`record ${newRecordId} not visible in state`);
  console.log(`  → lane=${found.lane} certNumber=${found.certNumber ?? "(none)"} grade=${found.officialGrade ?? "(none)"}`);
  results.steps.push({ name: "state", ok: true, lane: found.lane });

  // 3. Attach-image POST → triggers detector
  const attach = await step("attach-image POST", async () => {
    const r = await fetch(`${baseUrl}/api/dealer/records/${newRecordId}/attach-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, mimeType: "image/jpeg" }),
    });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { j = { _raw: text.slice(0, 240) }; }
    // 502 with detectorError is acceptable — detector unreachable, but
    // image MUST persist and lane must move to image_attached.
    if (!r.ok && r.status !== 502) {
      throw new Error(`${r.status}: ${JSON.stringify(j).slice(0, 240)}`);
    }
    return { status: r.status, ...j };
  });
  console.log(`  → status=${attach.status} lane=${attach.record?.lane} findings=${(attach.record?.modelFindings ?? []).length}`);
  if (!attach.record) throw new Error("attach-image did not return record");
  if (!attach.record.imageUrl) throw new Error("attach-image did not persist imageUrl");
  results.steps.push({ name: "attach-image", ok: true, status: attach.status, lane: attach.record.lane });

  // 4. Image GET — confirm bytes served back
  const imgRes = await fetch(`${baseUrl}/api/dealer/records/${newRecordId}/image`);
  if (!imgRes.ok) throw new Error(`image GET ${imgRes.status}`);
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  console.log(`✓ image GET (${imgBuf.length}B, content-type=${imgRes.headers.get("content-type")})`);
  results.steps.push({ name: "image", ok: true, bytes: imgBuf.length });

  // 5. Review POST — accept first finding (if any) + set decision
  const findingsCount = (attach.record.modelFindings ?? []).length;
  const decisions = findingsCount > 0 ? { 0: "accepted" } : undefined;
  const reviewBody = {
    reviewer: "dogfood_e2e",
    decisions,
    notes: "End-to-end dogfood smoke run. Friend's actual review will overwrite.",
    decision: "submit_for_grading",
  };
  const review = await step("review POST", () =>
    fetchJson(`/api/dealer/records/${newRecordId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reviewBody),
    }),
  );
  console.log(`  → lane=${review.record.lane} accepted=${review.record.humanReview?.acceptedFindings} reviewer=${review.record.humanReview?.reviewer}`);
  if (!review.record.humanReview?.reviewer) throw new Error("review did not persist reviewer");
  if (review.record.humanReview.decision !== "submit_for_grading") {
    throw new Error(`expected decision submit_for_grading, got ${review.record.humanReview.decision}`);
  }
  results.steps.push({ name: "review", ok: true, lane: review.record.lane });

  // 6. Evidence JSON
  const evJson = await step("evidence GET (json)", () =>
    fetchJson(`/api/dealer/records/${newRecordId}/evidence?format=json`),
  );
  if (!evJson.signature || evJson.signature.length !== 64) {
    throw new Error(`bad signature: ${evJson.signature?.slice(0, 32)}…`);
  }
  if (evJson.algorithm !== "HMAC-SHA256") throw new Error("missing algorithm");
  if (!evJson.body?.packetId) throw new Error("missing packetId");
  console.log(`  → packetId=${evJson.body.packetId}`);
  console.log(`  → signature=${evJson.signature.slice(0, 24)}…`);
  console.log(`  → cert=${evJson.body.cert.provider} ${evJson.body.cert.number}`);
  console.log(`  → reviewer=${evJson.body.review.reviewer} decision=${evJson.body.review.decision}`);
  results.steps.push({ name: "evidence:json", ok: true });

  // 7. Evidence HTML
  const htmlRes = await fetch(`${baseUrl}/api/dealer/records/${newRecordId}/evidence?format=html`);
  if (!htmlRes.ok) throw new Error(`evidence html ${htmlRes.status}`);
  const html = await htmlRes.text();
  for (const needle of ["Evidence Packet", "Cert", "sha256", "Findings", "Signature", "AI-assisted visible condition report"]) {
    if (!html.includes(needle)) throw new Error(`evidence html missing "${needle}"`);
  }
  console.log(`✓ evidence GET (html) — ${html.length} bytes, all 6 anchors present`);
  results.steps.push({ name: "evidence:html", ok: true, bytes: html.length });

  // 8. SSR sweep on the 5 dealer surfaces (desktop)
  for (const path of ["/dealer/intake", "/dealer/dashboard", "/dealer/listings", "/dealer/submissions", "/dealer/alerts"]) {
    const r = await fetch(`${baseUrl}${path}`);
    const t = await r.text();
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    if (!t.includes("dealer-shell")) throw new Error(`${path} missing .dealer-shell`);
    console.log(`✓ SSR ${path} (${t.length} bytes)`);
    results.steps.push({ name: `ssr:${path}`, ok: true, bytes: t.length });
  }

  console.log("");
  console.log(`OK — ${results.steps.length} steps passed`);
}

main().catch((err) => {
  console.error("");
  console.error("FAIL:", err?.message ?? err);
  process.exit(1);
});
