#!/usr/bin/env node
/**
 * Vendor pilot seed: turn the existing cert-reference seed into 20 Silver+
 * dealer records with realistic findings + reviewer state, plus a few
 * already-reviewed records so /dealer/dashboard renders something useful
 * out of the box.
 *
 *   node scripts/dealer/seed_vendor_pilot.mjs           # writes data/dealer/records.jsonl
 *   node scripts/dealer/seed_vendor_pilot.mjs --reset   # clears existing records first
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = new Set(process.argv.slice(2));
const RESET = args.has("--reset");

const seedPath = join(ROOT, "data", "cert-references", "seed.json");
const recordsPath = join(ROOT, "data", "dealer", "records.jsonl");
const batchesPath = join(ROOT, "data", "dealer", "intake-batches.jsonl");

mkdirSync(dirname(recordsPath), { recursive: true });

if (!existsSync(seedPath)) {
  console.error("Missing data/cert-references/seed.json");
  process.exit(2);
}

const refs = JSON.parse(readFileSync(seedPath, "utf-8"));
const records = Array.isArray(refs) ? refs : refs.records ?? refs.references ?? [];
console.log("input refs:", records.length);

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
}

function bandFromGrade(grade) {
  if (!grade) return undefined;
  const m = String(grade).match(/(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (n >= 10) return "950+_gem_pristine";
  if (n >= 9) return "900-949_mint";
  if (n >= 8) return "850-899_strong_nm_mint";
  if (n >= 7) return "800-849_near_mint";
  return "700-799_visible_issues";
}

function trustTierForGrade(numericGrade) {
  if (numericGrade == null) return "silver";
  if (numericGrade >= 9) return "silver_plus";
  if (numericGrade >= 7) return "silver_plus";
  return "silver";
}

function makeFindings(numericGrade, certId) {
  // Deterministic synthetic findings keyed off (certId, grade) so re-running
  // the seed is idempotent. Higher grades get fewer findings; PSA 8 gets
  // some material wear; PSA 6 gets multiple. Mirrors the flywheel mock.
  const seed = createHash("sha1").update(`${certId}|${numericGrade}`).digest("hex");
  const rand = (offset) => parseInt(seed.slice(offset, offset + 4), 16) / 0xffff;
  const findingsCount = numericGrade >= 10 ? 0 : numericGrade >= 9 ? 1 : numericGrade >= 8 ? 2 : numericGrade >= 7 ? 3 : 5;
  const types = ["corner_wear", "edge_wear", "scratch", "surface_contamination", "print_line"];
  const out = [];
  for (let i = 0; i < findingsCount; i++) {
    const x1 = Math.round(rand(i * 4) * 80);
    const y1 = Math.round(rand(i * 4 + 4) * 80);
    const w = 8 + Math.round(rand(i * 4 + 8) * 12);
    const h = 8 + Math.round(rand(i * 4 + 12) * 12);
    out.push({
      type: types[i % types.length],
      bbox: [x1, y1, Math.min(100, x1 + w), Math.min(100, y1 + h)],
      severity: numericGrade >= 9 ? "minor" : numericGrade >= 8 ? "moderate" : "major",
      confidence: 0.55 + rand(i * 4 + 16) * 0.4,
      modelVersion: "ding-detector-v0",
      imageHash: createHash("sha256").update(`${certId}-image`).digest("hex"),
      acceptedByReview: i % 2 === 0 ? "accepted" : "pending",
    });
  }
  return out;
}

function pricingForGrade(numericGrade) {
  if (numericGrade == null) return undefined;
  const base = 60 + numericGrade * 14;
  const rawLow = Math.round(base * 0.55);
  const rawMid = Math.round(base * 0.75);
  const rawHigh = Math.round(base);
  return {
    rawLow,
    rawMid,
    rawHigh,
    graded8: Math.round(base * 1.4),
    graded9: Math.round(base * 2.6),
    graded10: Math.round(base * 5.4),
    source: "vendor-pilot-stub",
    confidence: numericGrade >= 9 ? "medium" : "low",
    saleCount: 4 + (numericGrade % 5),
    variance: numericGrade >= 9 ? "low" : "high",
    freshness: `${5 + (numericGrade % 7)} days ago`,
  };
}

function roiForGrade(numericGrade, pricing) {
  if (!pricing) return undefined;
  const fee = 25;
  const ship = 12;
  const expectedDist = numericGrade >= 9
    ? { "950+_gem_pristine": 0.3, "900-949_mint": 0.55, "850-899_strong_nm_mint": 0.15 }
    : numericGrade >= 8
    ? { "900-949_mint": 0.2, "850-899_strong_nm_mint": 0.6, "800-849_near_mint": 0.2 }
    : { "850-899_strong_nm_mint": 0.15, "800-849_near_mint": 0.45, "700-799_visible_issues": 0.4 };
  const ev =
    expectedDist["950+_gem_pristine"] * pricing.graded10 +
    (expectedDist["900-949_mint"] ?? 0) * pricing.graded9 +
    (expectedDist["850-899_strong_nm_mint"] ?? 0) * pricing.graded8 +
    (expectedDist["800-849_near_mint"] ?? 0) * pricing.graded8 * 0.85 +
    (expectedDist["700-799_visible_issues"] ?? 0) * pricing.graded8 * 0.6;
  const net = ev - fee - ship;
  const recommendation =
    net > pricing.rawHigh * 1.25
      ? "submit"
      : net > pricing.rawHigh * 0.95
      ? "hold"
      : pricing.rawHigh > 0
      ? "sell_raw"
      : "human_review";
  return {
    rawValue: pricing.rawHigh,
    expectedGradeDistribution: expectedDist,
    expectedGradedEv: Math.round(ev),
    gradingFee: fee,
    shippingFee: ship,
    netEv: Math.round(net),
    recommendation,
    rationale:
      recommendation === "submit"
        ? "Expected graded EV beats raw value comfortably after fees."
        : recommendation === "hold"
        ? "EV roughly matches raw value — hold for stronger comp confidence first."
        : "Raw value beats expected graded EV after fees and shipping.",
    dealScore: net > pricing.rawHigh * 1.4 ? "high" : net > pricing.rawHigh * 1.1 ? "medium" : "low",
  };
}

function loadExisting() {
  if (RESET || !existsSync(recordsPath)) return [];
  return readFileSync(recordsPath, "utf-8")
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

const existing = loadExisting();
const existingIds = new Set(existing.map((r) => r.id));
const out = [...existing];
let added = 0;
const reviewerPool = ["vendor_friend_01", "vendor_friend_02", "ccv_qa"];
const decisionPool = ["submit_for_grading", "sell_raw", "hold", "rescan", "human_review"];

const target = 20;
const limit = Math.min(target, records.length);
const now = new Date();

for (let i = 0; i < limit; i++) {
  const ref = records[i];
  if (!ref?.id) continue;
  const id = `dlr_seed_${ref.id}`;
  if (existingIds.has(id)) continue;
  const numericGrade = typeof ref.numericGrade === "number" ? ref.numericGrade : Number((ref.officialGrade ?? "").match(/(\d+)/)?.[1] ?? 8);
  const findings = makeFindings(numericGrade, ref.id);
  const pricing = pricingForGrade(numericGrade);
  const roi = roiForGrade(numericGrade, pricing);
  // First 10 records are already reviewed, the rest are queued.
  const reviewed = i < 10;
  const accepted = findings.filter((f) => f.acceptedByReview === "accepted").length;
  const lane = reviewed ? "ready" : findings.length > 0 ? "human_review" : "image_attached";
  const createdAt = new Date(now.getTime() - (target - i) * 60_000).toISOString();
  const rec = {
    id,
    createdAt,
    updatedAt: createdAt,
    inventoryType: "graded",
    lane,
    sourceBatchId: "batch_seed_vendor_pilot",
    certNumber: ref.certNumber,
    certProvider: ref.provider ?? "PSA",
    certUrl: ref.externalUrl ?? `https://www.psacard.com/cert/${ref.certNumber}`,
    cardIdentity: ref.cardIdentity,
    quantity: 1,
    imageHash: createHash("sha256").update(`${ref.id}-image`).digest("hex"),
    imageUrl: undefined,
    officialGrade: ref.officialGrade ?? `PSA ${numericGrade}`,
    officialBand: bandFromGrade(numericGrade),
    modelFindings: findings,
    humanReview: reviewed
      ? {
          reviewedAt: createdAt,
          reviewer: reviewerPool[i % reviewerPool.length],
          acceptedFindings: accepted,
          rejectedFindings: findings.length - accepted,
          addedFindings: [],
          notes: i % 3 === 0 ? "Visible material wear; consistent with grade band." : undefined,
          decision: decisionPool[i % decisionPool.length],
        }
      : undefined,
    pricing,
    roi,
    listing: reviewed && i % 4 === 0
      ? {
          marketplace: "ebay",
          title: `${ref.cardIdentity ?? "Card"} · ${ref.officialGrade ?? `PSA ${numericGrade}`} · evidence packet attached`,
          description: "AI-assisted visible condition report attached. Cert verified. Front/back slab images saved.",
          conditionNotes: `Reviewer accepted ${accepted}/${findings.length} findings. Decision: ${decisionPool[i % decisionPool.length]}.`,
          recommendedPrice: pricing?.graded9 ?? pricing?.rawHigh,
          photosReady: true,
          draftStatus: "drafted",
          publicReportUrl: `/dealer/records/${id}/evidence`,
        }
      : undefined,
    submission: reviewed && i % 5 === 0
      ? {
          submissionId: `sub_${ref.certNumber}`,
          declaredValue: pricing?.graded9 ?? 0,
          submittedAt: createdAt,
          status: "submitted",
          preSubmissionEvidenceId: `pkt_${id}`,
        }
      : undefined,
    notes: i % 7 === 0 ? "Friend's batch - imported manually for vendor pilot demo." : undefined,
    consentFlag: "granted",
    trustTier: trustTierForGrade(numericGrade),
  };
  out.push(rec);
  added++;
}

writeFileSync(recordsPath, out.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");

// Also seed an intake-batch entry so /dealer/intake shows the seed batch.
const batches = existsSync(batchesPath)
  ? readFileSync(batchesPath, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      })
  : [];
if (!batches.find((b) => b.batchId === "batch_seed_vendor_pilot")) {
  batches.push({
    batchId: "batch_seed_vendor_pilot",
    uploadedAt: now.toISOString(),
    inputFilename: "vendor-pilot-seed.json",
    uploaderHint: "Seeded from data/cert-references/seed.json",
    imageHash: null,
    uniqueCertNumbers: out.filter((r) => r.sourceBatchId === "batch_seed_vendor_pilot").map((r) => r.certNumber).filter(Boolean),
    recordIds: out.filter((r) => r.sourceBatchId === "batch_seed_vendor_pilot").map((r) => r.id),
    status: "ready",
  });
}
writeFileSync(batchesPath, batches.map((b) => JSON.stringify(b)).join("\n") + "\n", "utf-8");

console.log(JSON.stringify({
  added,
  total: out.length,
  reviewed: out.filter((r) => r.humanReview).length,
  listed: out.filter((r) => r.listing).length,
  submitted: out.filter((r) => r.submission).length,
  recordsPath,
  batchesPath,
}, null, 2));
