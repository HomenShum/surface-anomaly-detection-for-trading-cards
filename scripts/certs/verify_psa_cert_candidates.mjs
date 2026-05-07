#!/usr/bin/env node
// Verify extracted certified-reference candidates through API-first metadata.
//
// PSA uses PSA_PUBLIC_API_KEY / PSA_API_KEY when configured. Without credentials
// the script still materializes candidate rows with warnings so the user can
// keep working locally, but those rows remain metadata candidates.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { certDataDir, resolvePsaViaApi, writeJson } from "./cert_reference_lib.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.input || !existsSync(resolve(args.input))) {
  console.error("Usage: node scripts/certs/verify_psa_cert_candidates.mjs --input data/cert-references/vendor-batches/<batch>.cert_candidates.json [--batch vendor_batch_001]");
  process.exit(1);
}

const inputPath = resolve(args.input);
const input = JSON.parse(readFileSync(inputPath, "utf-8"));
const refs = [];
for (const candidate of input.candidates ?? []) {
  const base = baseRef(candidate);
  refs.push(candidate.provider === "PSA" ? await resolvePsaViaApi(base) : base);
}

const outDir = join(certDataDir(), "vendor-batches");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${args.batch ?? input.batch ?? "vendor_batch"}.verified.json`);
writeJson(outPath, {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  sourceCandidatesPath: inputPath,
  refs,
  policy: "Verified rows are certified-reference metadata only until user-provided or permissioned local images are attached.",
});
console.log(JSON.stringify({ ok: true, outPath, refs: refs.length }, null, 2));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" && argv[i + 1]) out.input = argv[++i];
    else if (arg.startsWith("--input=")) out.input = arg.slice("--input=".length);
    else if (arg === "--batch" && argv[i + 1]) out.batch = argv[++i];
    else if (arg.startsWith("--batch=")) out.batch = arg.slice("--batch=".length);
  }
  return out;
}

function baseRef(candidate) {
  const provider = candidate.provider === "TAG" ? "TAG" : "PSA";
  const certNumber = String(candidate.certNumber).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return {
    id: `${provider.toLowerCase()}_${certNumber.toLowerCase()}`,
    provider,
    certNumber,
    externalUrl: candidate.externalUrl ?? (provider === "TAG" ? `https://my.taggrading.com/card/${certNumber}` : `https://www.psacard.com/cert/${certNumber}`),
    trustTier: provider === "PSA" ? "silver" : "silver",
    source: "friend_cert_photo",
    officialGrade: candidate.officialGrade,
    cardIdentity: candidate.cardIdentity,
    metadataConfidence: "extracted_candidate",
    hasFrontBackSlabImages: false,
    trainingAllowed: false,
    publicExampleAllowed: false,
    needsRawScanForGold: true,
    status: "cert_detected",
    limitations: [
      "Candidate extracted from user/vendor-provided label/slab image.",
      "Not image-backed until local slab/front/back artifacts are attached.",
    ],
    warnings: [],
  };
}
