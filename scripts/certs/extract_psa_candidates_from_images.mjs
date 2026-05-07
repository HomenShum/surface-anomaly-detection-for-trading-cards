#!/usr/bin/env node
// Extract PSA/TAG cert candidates from vendor-provided label/slab photos.
//
// This is local-only. It does not fetch cert pages, cache official images, or
// train on the photos. It writes candidate metadata for later API-first
// verification.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { certDataDir, repoRoot, writeJson } from "./cert_reference_lib.mjs";

const IMAGE_RE = /\.(png|jpe?g|webp|tif|tiff)$/i;
const PSA_URL_RE = /psacard\.com\/(?:en-[a-z]{2}\/)?cert\/(\d{7,12})/gi;
const TAG_URL_RE = /my\.taggrading\.com\/card\/([A-Z0-9-]{5,20})/gi;
const DIGIT_CERT_RE = /(?<![A-Za-z0-9])\d{7,12}(?![A-Za-z0-9])/g;

const args = parseArgs(process.argv.slice(2));
if (args.inputs.length === 0) {
  console.error("Usage: node scripts/certs/extract_psa_candidates_from_images.mjs <image-or-dir>... [--batch vendor_batch_001]");
  process.exit(1);
}

const images = expandImages(args.inputs);
const candidatesByKey = new Map();
const notes = [];
const ocrScript = join(repoRoot(), "scripts", "certs", "psa_label_ocr.py");

for (const image of images) {
  const textParts = [image];
  if (existsSync(ocrScript)) {
    const result = spawnSync("python", [ocrScript, image, "--json"], {
      encoding: "utf-8",
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    if (result.error) {
      notes.push(`${image}: OCR failed (${result.error.message}). Filename-only extraction used.`);
    } else if (result.status !== 0) {
      notes.push(`${image}: OCR exited ${result.status}: ${String(result.stderr ?? "").trim()}`);
    } else {
      try {
        const payload = JSON.parse(String(result.stdout ?? "{}"));
        textParts.push(payload.text ?? "");
        notes.push(`${image}: OCR scanned ${payload.label_crop_count ?? 0} label-like crop(s).`);
      } catch {
        notes.push(`${image}: OCR returned non-JSON output.`);
      }
    }
  }
  for (const candidate of extractCandidates(textParts.join("\n"), image)) {
    candidatesByKey.set(`${candidate.provider}:${candidate.certNumber}`, candidate);
  }
}

const outDir = join(certDataDir(), "vendor-batches");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${args.batch}.cert_candidates.json`);
const payload = {
  schemaVersion: 1,
  batch: args.batch,
  createdAt: new Date().toISOString(),
  inputs: images,
  candidateCount: candidatesByKey.size,
  candidates: [...candidatesByKey.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.certNumber.localeCompare(b.certNumber)),
  notes,
  policy: "User/vendor-provided images only. Candidate extraction is not training data and does not cache official cert-page images.",
};
writeJson(outPath, payload);
console.log(JSON.stringify({ ok: true, outPath, candidateCount: payload.candidateCount, notes }, null, 2));

function parseArgs(argv) {
  const out = { inputs: [], batch: `vendor_batch_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}` };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--batch" && argv[i + 1]) out.batch = argv[++i];
    else if (arg.startsWith("--batch=")) out.batch = arg.slice("--batch=".length);
    else out.inputs.push(arg);
  }
  return out;
}

function expandImages(inputs) {
  const out = [];
  for (const input of inputs) {
    const target = resolve(input);
    if (!existsSync(target)) continue;
    const stats = readdirMaybe(target);
    if (!stats) {
      if (IMAGE_RE.test(target)) out.push(target);
      continue;
    }
    for (const entry of stats) {
      const path = join(target, entry);
      if (IMAGE_RE.test(path)) out.push(path);
    }
  }
  return [...new Set(out)];
}

function readdirMaybe(path) {
  try {
    return readdirSync(path);
  } catch {
    return null;
  }
}

function extractCandidates(text, sourcePath) {
  const out = [];
  for (const match of text.matchAll(PSA_URL_RE)) out.push(candidate("PSA", match[1], sourcePath));
  for (const match of text.matchAll(TAG_URL_RE)) out.push(candidate("TAG", match[1], sourcePath));
  for (const match of text.matchAll(DIGIT_CERT_RE)) out.push(candidate("PSA", match[0], sourcePath));
  return out;
}

function candidate(provider, rawCert, sourcePath) {
  const certNumber = String(rawCert).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return {
    provider,
    certNumber,
    id: `${provider.toLowerCase()}_${certNumber.toLowerCase()}`,
    externalUrl: provider === "TAG" ? `https://my.taggrading.com/card/${certNumber}` : `https://www.psacard.com/cert/${certNumber}`,
    sourcePath,
    source: "vendor_label_or_slab_photo",
  };
}
