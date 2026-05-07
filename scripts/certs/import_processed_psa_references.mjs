#!/usr/bin/env node
// Import the processed PSA reference package produced from vendor-provided
// slab/cert screenshots into the replayable certified-reference evidence store.
//
// This intentionally keeps the trust boundary strict:
//   - rows with local card/slab images become silver_plus
//   - rows without local card/slab images remain silver metadata references
//   - no row becomes Gold from slab/cert imagery
//   - images are stored only when --consent is passed

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { certDataDir, loadAllRefs, readJson, writeJson } from "./cert_reference_lib.mjs";

const IMAGE_RE = /\.(png|jpe?g|webp|bmp)$/i;
const args = parseArgs(process.argv.slice(2));
const packageDir = resolve(args.packageDir ?? join(certDataDir(), "vendor-batches", "processed_psa_references"));
const sourceJsonPath = resolve(args.sourceJson ?? join(packageDir, "psa_certified_reference_seed.json"));

if (!args.consent) {
  console.error("Refusing to import local image artifacts without --consent.");
  process.exit(1);
}
if (!existsSync(sourceJsonPath)) {
  console.error(`Processed PSA package seed not found: ${sourceJsonPath}`);
  process.exit(1);
}

const source = readJson(sourceJsonPath, null);
const silverPlusRows = Array.isArray(source?.silver_plus_records) ? source.silver_plus_records : [];
const labelOnlyRows = Array.isArray(source?.label_only_candidates) ? source.label_only_candidates : [];
const slabRoot = join(certDataDir(), "slab-images");
const resolvedPath = join(certDataDir(), "resolved.json");
const existingResolved = readJson(resolvedPath, []);
const importedAt = new Date().toISOString();
const importedIds = new Set();
const copiedArtifacts = [];

mkdirSync(slabRoot, { recursive: true });

const normalizedImported = [];

for (const row of silverPlusRows) {
  const normalized = normalizeProcessedRow(row, {
    importedAt,
    hasReplayableImage: false,
    localArtifacts: [],
  });
  const sourceImage = resolvePackageImage(row.local_image_path);
  if (sourceImage && existsSync(sourceImage) && statSync(sourceImage).isFile() && IMAGE_RE.test(sourceImage)) {
    const artifact = copyEvidenceImage({
      sourceImage,
      certId: normalized.id,
      view: inferView(sourceImage),
      sourceRow: row,
      importedAt,
    });
    normalized.hasFrontBackSlabImages = true;
    normalized.trustTier = "silver_plus";
    normalized.status = "image_available";
    normalized.metadataConfidence = "vendor_image_backed_high_confidence";
    normalized.localImageEvidence = [artifact.publicMetadata];
    normalized.imageEvidenceStatus = "local_vendor_uploaded";
    normalized.limitations = uniqueStrings([
      ...(normalized.limitations ?? []),
      "Replayable local vendor-provided slab/cert image is available for evaluation.",
      "Condition inference must use card-only crops or masked label regions to prevent grade-label leakage.",
    ]);
    copiedArtifacts.push(artifact.publicMetadata);
  } else {
    normalized.hasFrontBackSlabImages = false;
    normalized.trustTier = "silver";
    normalized.status = "metadata_resolved";
    normalized.warnings = uniqueStrings([
      ...(normalized.warnings ?? []),
      "Processed package row did not include a readable local image artifact.",
    ]);
  }
  importedIds.add(normalized.id);
  normalizedImported.push(normalized);
}

for (const row of labelOnlyRows) {
  const normalized = normalizeProcessedRow(row, {
    importedAt,
    hasReplayableImage: false,
    localArtifacts: [],
  });
  normalized.trustTier = "silver";
  normalized.hasFrontBackSlabImages = false;
  normalized.status = "metadata_resolved";
  normalized.metadataConfidence = normalized.metadataConfidence ?? "vendor_label_candidate";
  normalized.imageEvidenceStatus = "label_only";
  normalized.limitations = uniqueStrings([
    ...(normalized.limitations ?? []),
    "Label-only candidate; not image-backed until a local slab/card image is attached.",
  ]);
  importedIds.add(normalized.id);
  normalizedImported.push(normalized);
}

const existingById = new Map(existingResolved.map((ref) => [ref.id, ref]));
for (const ref of normalizedImported) {
  existingById.set(ref.id, {
    ...(existingById.get(ref.id) ?? {}),
    ...ref,
  });
}

// Enforce honest Silver+ semantics across resolved output. Seed rows may have
// declared slab images before local artifacts existed; override them here so the
// gates and UI reflect only replayable evidence.
const allCurrent = loadAllRefs();
for (const ref of allCurrent) {
  if (importedIds.has(ref.id)) continue;
  const hasLocal = hasReplayableImage(ref.id);
  if ((ref.trustTier === "silver_plus" || ref.hasFrontBackSlabImages) && !hasLocal) {
    existingById.set(ref.id, {
      ...ref,
      ...(existingById.get(ref.id) ?? {}),
      trustTier: "silver",
      hasFrontBackSlabImages: false,
      imageEvidenceStatus: "none",
      status: ref.status === "model_analyzed" || ref.status === "comparison_ready" ? "metadata_resolved" : ref.status,
      warnings: uniqueStrings([
        ...(ref.warnings ?? []),
        "Downgraded from declared Silver+ until replayable local slab/card image evidence is attached.",
      ]),
    });
  }
}

const resolved = [...existingById.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
writeJson(resolvedPath, resolved);

const report = {
  schemaVersion: 1,
  importedAt,
  packageDir,
  sourceJsonPath,
  consentToStoreLocalArtifacts: true,
  silverPlusRows: silverPlusRows.length,
  labelOnlyRows: labelOnlyRows.length,
  copiedArtifactCount: copiedArtifacts.length,
  importedReferenceCount: normalizedImported.length,
  imageBackedImportedIds: copiedArtifacts.map((artifact) => artifact.certId).sort(),
  copiedArtifacts,
  policy: [
    "Vendor-provided slab/cert images are replayable certified-reference evidence only.",
    "Training is not allowed unless a separate rights/consent record permits it.",
    "No slab/cert image row is Gold; Gold requires raw pre-submission scan, official outcome, human DING review, and consent.",
  ],
};
const reportPath = join(certDataDir(), "vendor-batches", "processed_psa_references.import-report.json");
mkdirSync(dirname(reportPath), { recursive: true });
writeJson(reportPath, report);

console.log(JSON.stringify({ ok: true, reportPath, ...report }, null, 2));

function parseArgs(argv) {
  const out = { consent: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--consent") out.consent = true;
    else if (arg === "--package-dir" && argv[i + 1]) out.packageDir = argv[++i];
    else if (arg.startsWith("--package-dir=")) out.packageDir = arg.slice("--package-dir=".length);
    else if (arg === "--source-json" && argv[i + 1]) out.sourceJson = argv[++i];
    else if (arg.startsWith("--source-json=")) out.sourceJson = arg.slice("--source-json=".length);
  }
  return out;
}

function normalizeProcessedRow(row, { importedAt }) {
  const certNumber = String(row.cert_number ?? row.certNumber ?? "").replace(/\D/g, "");
  const provider = String(row.provider ?? "PSA").toUpperCase();
  const id = String(row.id ?? `${provider.toLowerCase()}_${certNumber}`).toLowerCase().replace(/[^a-z0-9_]/g, "");
  const officialGrade = String(row.official_grade ?? row.officialGrade ?? "").trim();
  return {
    id,
    provider,
    certNumber,
    externalUrl: row.external_url ?? row.externalUrl ?? `https://www.psacard.com/cert/${certNumber}`,
    trustTier: "silver",
    source: "vendor_processed_psa_package",
    sourceType: row.source_type ?? "certified_reference",
    officialGrade,
    numericGrade: Number.isFinite(row.grade_numeric) ? row.grade_numeric : parseNumericGrade(officialGrade),
    cardIdentity: row.card_identity ?? row.cardIdentity ?? "PSA certified reference",
    metadataConfidence:
      row.extraction_confidence === "high" ? "vendor_package_high_confidence" : "vendor_package_needs_review",
    hasFrontBackSlabImages: false,
    trainingAllowed: false,
    publicExampleAllowed: false,
    needsRawScanForGold: true,
    status: "metadata_resolved",
    resolvedAt: importedAt,
    psaApiAttempted: false,
    psaApiConfigured: false,
    imageEvidenceStatus: row.image_evidence_status ?? "none",
    ingestionPolicy:
      "Vendor-provided PSA package import. Use PSA API verification when configured; do not train on or publicly publish images without separate consent.",
    limitations: uniqueStrings([
      ...(Array.isArray(row.limitations) ? row.limitations : []),
      "Certified outcome reference only; not DING-level ground truth.",
      "No raw pre-submission scan is attached.",
    ]),
    warnings: row.public_example_allowed === "pending_vendor_consent"
      ? ["Public-example consent is pending; keep this private to the vendor pilot."]
      : [],
    vendorPackage: {
      importedAt,
      extractionMethod: row.extraction_method,
      extractionConfidence: row.extraction_confidence,
      sourcePhotoPath: row.source_photo_path,
      sourcePhotoSha256: row.source_photo_sha256,
      packageLocalImagePath: row.local_image_path,
      packageLocalImageSha256: row.local_image_sha256,
      notes: row.notes,
    },
  };
}

function copyEvidenceImage({ sourceImage, certId, view, sourceRow, importedAt }) {
  const certDir = join(slabRoot, certId);
  mkdirSync(certDir, { recursive: true });
  const ext = normalizeExt(extname(sourceImage));
  const targetFilename = `${view}${ext}`;
  const targetPath = join(certDir, targetFilename);
  copyFileSync(sourceImage, targetPath);
  const bytes = readFileSync(targetPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const metadata = {
    schemaVersion: 1,
    certId,
    view,
    filename: targetFilename,
    sourceFilename: basename(sourceImage),
    source: "vendor_processed_psa_package",
    sourceRowLocalImagePath: sourceRow.local_image_path,
    sourceRowLocalImageSha256: sourceRow.local_image_sha256,
    targetPath,
    sha256,
    sizeBytes: bytes.length,
    consentToStore: true,
    publicExampleAllowed: false,
    trainingAllowed: false,
    importedAt,
  };
  writeFileSync(join(certDir, `${view}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
  writeJson(join(certDir, "materialization.json"), {
    schemaVersion: 1,
    certId,
    createdAt: importedAt,
    artifacts: [metadata],
    policy:
      "Replayable certified-reference image evidence only. Not training data unless a separate rights/consent record permits it.",
  });
  return { publicMetadata: metadata };
}

function resolvePackageImage(localImagePath) {
  if (!localImagePath) return null;
  const raw = String(localImagePath).replace(/\\/g, "/");
  const candidates = [
    resolve(packageDir, raw),
    resolve(dirname(packageDir), raw),
  ];
  const packageName = basename(packageDir).replace(/\\/g, "/");
  if (raw.startsWith(`${packageName}/`)) {
    candidates.push(resolve(packageDir, raw.slice(packageName.length + 1)));
  }
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? candidates[0];
}

function hasReplayableImage(certId) {
  const dir = join(slabRoot, certId);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  return readdirSync(dir).some((entry) => IMAGE_RE.test(entry));
}

function inferView(path) {
  const name = basename(path).toLowerCase();
  if (name.includes("back")) return "back";
  if (name.includes("front")) return "front";
  return "front";
}

function normalizeExt(ext) {
  const lower = ext.toLowerCase();
  if (lower === ".jpeg") return ".jpg";
  return lower && IMAGE_RE.test(`x${lower}`) ? lower : ".jpg";
}

function parseNumericGrade(label) {
  const match = String(label ?? "").match(/(?:^|\s)(10|9|8\.5|8|7|6|5|4|3|2|1)(?:\s|$)/);
  return match ? Number(match[1]) : undefined;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}
