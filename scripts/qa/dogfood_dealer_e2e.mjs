#!/usr/bin/env node
/**
 * End-to-end dogfood of the dealer pilot, no manual clicks.
 *
 * This intentionally exercises two distinct paths:
 *   1. A real imported PSA slab/cert image that should resolve cert metadata.
 *   2. A real card-condition fixture that should produce at least one model finding.
 *
 * The previous Tauros-only smoke proved persistence but did not exercise cert
 * resolution or a positive DING finding. This script fails if either path stops
 * working.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const baseUrl = (process.env.CCV_DEMO_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");

function firstExisting(candidates) {
  for (const candidate of candidates) {
    const path = resolve(ROOT, candidate);
    if (existsSync(path)) return path;
  }
  throw new Error(`No fixture image available from: ${candidates.join(", ")}`);
}

function certFixturePath() {
  return firstExisting([
    "data/cert-references/vendor-batches/processed_psa_references/slab_crops/psa_148901890_front_slab.jpg",
    "data/cert-references/slab-images/psa_148901890/front.jpg",
  ]);
}

function dingFixturePath() {
  return firstExisting([
    "apps/web/public/examples/corner-wear.png",
    "apps/web/public/demo/sample-cards/roboflow-tauros-real-card.jpg",
  ]);
}

function loadBase64(path) {
  return readFileSync(path).toString("base64");
}

async function step(label, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`OK ${label} (${Date.now() - started}ms)`);
    return result;
  } catch (error) {
    console.error(`FAIL ${label} (${Date.now() - started}ms)`);
    console.error("  ", error?.message ?? error);
    throw error;
  }
}

async function fetchJson(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}: ${JSON.stringify(json).slice(0, 240)}`);
  }
  return json;
}

async function postIntake({ label, imageBase64, filename, expectCert }) {
  const intake = await step(`${label}: intake POST`, () =>
    fetchJson("/api/dealer/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64, filename, uploaderHint: "dogfood_e2e" }),
    }),
  );
  if (!intake.batchId) throw new Error(`${label}: intake did not return batchId`);
  if (!Array.isArray(intake.recordIds) || intake.recordIds.length === 0) {
    throw new Error(`${label}: intake did not create records`);
  }
  if (expectCert && (!Array.isArray(intake.uniqueCerts) || intake.uniqueCerts.length === 0)) {
    throw new Error(`${label}: expected at least one cert number from OCR or seed match`);
  }
  console.log(`  batchId=${intake.batchId}`);
  console.log(`  recordIds=${JSON.stringify(intake.recordIds)}`);
  console.log(`  uniqueCerts=${JSON.stringify(intake.uniqueCerts)}`);
  console.log(`  seedReferenceMatches=${JSON.stringify(intake.seedReferenceMatches ?? [])}`);
  console.log(`  detectedLabels=${intake.detectedLabels}`);
  return intake;
}

async function attachImage({ label, recordId, imageBase64, expectFinding }) {
  const attach = await step(`${label}: attach-image POST`, () =>
    fetchJson(`/api/dealer/records/${recordId}/attach-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64, mimeType: "image/jpeg" }),
    }),
  );
  const findings = attach.record?.modelFindings ?? [];
  console.log(`  lane=${attach.record?.lane} findings=${findings.length}`);
  if (!attach.record?.imageUrl) throw new Error(`${label}: attach-image did not persist imageUrl`);
  if (expectFinding && findings.length === 0) throw new Error(`${label}: expected at least one model finding`);
  if (expectFinding && findings.some((finding) => !String(finding.type ?? "").trim())) {
    throw new Error(`${label}: detector returned a blank finding type`);
  }
  return attach;
}

async function verifyImage({ label, recordId }) {
  const imageResponse = await fetch(`${baseUrl}/api/dealer/records/${recordId}/image`);
  if (!imageResponse.ok) throw new Error(`${label}: image GET ${imageResponse.status}`);
  const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
  if (imageBytes.length < 1024) throw new Error(`${label}: image response too small (${imageBytes.length}B)`);
  console.log(`OK ${label}: image GET (${imageBytes.length}B, content-type=${imageResponse.headers.get("content-type")})`);
}

async function reviewRecord({ label, recordId, findingsCount }) {
  const decisions = findingsCount > 0 ? { 0: "accepted" } : undefined;
  const review = await step(`${label}: review POST`, () =>
    fetchJson(`/api/dealer/records/${recordId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewer: "dogfood_e2e",
        decisions,
        notes: `${label} dogfood smoke run.`,
        decision: findingsCount > 0 ? "sell_raw" : "human_review",
      }),
    }),
  );
  if (!review.record?.humanReview?.reviewer) throw new Error(`${label}: review did not persist reviewer`);
  console.log(
    `  lane=${review.record.lane} accepted=${review.record.humanReview.acceptedFindings} decision=${review.record.humanReview.decision}`,
  );
  return review;
}

async function verifyEvidence({ label, recordId, requireAcceptedFinding }) {
  const evidence = await step(`${label}: evidence GET (json)`, () =>
    fetchJson(`/api/dealer/records/${recordId}/evidence?format=json`),
  );
  if (!evidence.signature || evidence.signature.length !== 64) {
    throw new Error(`${label}: bad signature`);
  }
  if (evidence.algorithm !== "HMAC-SHA256") throw new Error(`${label}: missing algorithm`);
  if (requireAcceptedFinding && evidence.body?.detector?.acceptedFindings < 1) {
    throw new Error(`${label}: expected at least one accepted finding in evidence`);
  }
  console.log(`  packetId=${evidence.body.packetId}`);
  console.log(`  signature=${evidence.signature.slice(0, 24)}...`);

  const htmlResponse = await fetch(`${baseUrl}/api/dealer/records/${recordId}/evidence?format=html`);
  if (!htmlResponse.ok) throw new Error(`${label}: evidence html ${htmlResponse.status}`);
  const html = await htmlResponse.text();
  for (const needle of ["Evidence Packet", "Cert", "sha256", "Findings", "Signature", "AI-assisted visible condition report"]) {
    if (!html.includes(needle)) throw new Error(`${label}: evidence html missing "${needle}"`);
  }
  console.log(`OK ${label}: evidence GET (html) - ${html.length} bytes, all anchors present`);
}

async function runCycle({ label, imagePath, expectCert, expectFinding }) {
  const imageBase64 = loadBase64(imagePath);
  console.log("");
  console.log(`${label} fixture: ${imagePath} (${Math.round((imageBase64.length * 0.75) / 1024)}KB)`);
  const intake = await postIntake({
    label,
    imageBase64,
    filename: imagePath.split(/[\\/]/).at(-1) ?? `${label}.jpg`,
    expectCert,
  });
  const recordId = intake.recordIds[0];

  const state = await step(`${label}: state GET`, () => fetchJson("/api/dealer/intake/state"));
  const found = state.records.find((record) => record.id === recordId);
  if (!found) throw new Error(`${label}: record ${recordId} not visible in intake state`);
  if (expectCert && !found.certNumber) throw new Error(`${label}: expected certNumber in state`);
  console.log(`  lane=${found.lane} certNumber=${found.certNumber ?? "(none)"} grade=${found.officialGrade ?? "(none)"}`);

  const attach = await attachImage({ label, recordId, imageBase64, expectFinding });
  await verifyImage({ label, recordId });
  const findingsCount = (attach.record.modelFindings ?? []).length;
  await reviewRecord({ label, recordId, findingsCount });
  await verifyEvidence({ label, recordId, requireAcceptedFinding: expectFinding });
  return { recordId, findingsCount };
}

async function verifySsr() {
  for (const path of ["/dealer/intake", "/dealer/dashboard", "/dealer/listings", "/dealer/submissions", "/dealer/alerts"]) {
    const response = await fetch(`${baseUrl}${path}`);
    const html = await response.text();
    if (!response.ok) throw new Error(`${path} ${response.status}`);
    if (!html.includes("dealer-shell")) throw new Error(`${path} missing .dealer-shell`);
    console.log(`OK SSR ${path} (${html.length} bytes)`);
  }
}

async function main() {
  console.log(`baseUrl: ${baseUrl}`);
  await runCycle({
    label: "cert-silver-plus",
    imagePath: certFixturePath(),
    expectCert: true,
    expectFinding: false,
  });
  await runCycle({
    label: "raw-positive-ding",
    imagePath: dingFixturePath(),
    expectCert: false,
    expectFinding: true,
  });
  await verifySsr();
  console.log("");
  console.log("OK - dealer E2E covered cert intake, positive DING detection, review persistence, signed JSON/HTML evidence, and SSR.");
}

main().catch((error) => {
  console.error("");
  console.error("FAIL:", error?.message ?? error);
  process.exit(1);
});
