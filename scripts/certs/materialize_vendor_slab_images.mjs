#!/usr/bin/env node
// Copy user/vendor-provided slab/card images into the replayable local evidence
// folder expected by the certified-reference eval gates.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { certDataDir, writeJson } from "./cert_reference_lib.mjs";

const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const args = parseArgs(process.argv.slice(2));

if (!args.cert || (!args.front && !args.back && !args.label && !args.other)) {
  console.error("Usage: node scripts/certs/materialize_vendor_slab_images.mjs --cert psa_154378339 --front front.jpg [--back back.jpg] --consent");
  process.exit(1);
}
if (!args.consent) {
  console.error("Refusing to store image artifacts without --consent. Only user/vendor-provided or permissioned images are allowed.");
  process.exit(1);
}

const certId = cleanCertId(args.cert);
const targetDir = join(certDataDir(), "slab-images", certId);
mkdirSync(targetDir, { recursive: true });

const artifacts = [];
for (const view of ["front", "back", "label", "other"]) {
  const source = args[view];
  if (!source) continue;
  const sourcePath = resolve(source);
  if (!existsSync(sourcePath) || !IMAGE_RE.test(sourcePath)) {
    artifacts.push({ view, ok: false, sourcePath, error: "missing or unsupported image extension" });
    continue;
  }
  const ext = extname(sourcePath).toLowerCase() === ".jpeg" ? ".jpg" : extname(sourcePath).toLowerCase();
  const filename = `${view}${ext}`;
  const targetPath = join(targetDir, filename);
  copyFileSync(sourcePath, targetPath);
  const bytes = readFileSync(targetPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const metadata = {
    certId,
    view,
    filename,
    sourcePath,
    targetPath,
    sha256,
    sizeBytes: bytes.length,
    source: "vendor_provided_slab_image",
    consentToStore: true,
    trainingAllowed: false,
    storedAt: new Date().toISOString(),
  };
  writeFileSync(join(targetDir, `${view}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
  artifacts.push({ view, ok: true, targetPath, sha256 });
}

const manifestPath = join(targetDir, "materialization.json");
writeJson(manifestPath, {
  schemaVersion: 1,
  certId,
  createdAt: new Date().toISOString(),
  artifacts,
  policy: "Replayable certified-reference image evidence only. Not training data unless a separate rights/consent record permits it.",
});
console.log(JSON.stringify({ ok: artifacts.some((artifact) => artifact.ok), certId, manifestPath, artifacts }, null, 2));

function parseArgs(argv) {
  const out = { consent: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--consent") out.consent = true;
    else if (arg === "--cert" && argv[i + 1]) out.cert = argv[++i];
    else if (arg.startsWith("--cert=")) out.cert = arg.slice("--cert=".length);
    else if (arg === "--front" && argv[i + 1]) out.front = argv[++i];
    else if (arg.startsWith("--front=")) out.front = arg.slice("--front=".length);
    else if (arg === "--back" && argv[i + 1]) out.back = argv[++i];
    else if (arg.startsWith("--back=")) out.back = arg.slice("--back=".length);
    else if (arg === "--label" && argv[i + 1]) out.label = argv[++i];
    else if (arg.startsWith("--label=")) out.label = arg.slice("--label=".length);
    else if (arg === "--other" && argv[i + 1]) out.other = argv[++i];
    else if (arg.startsWith("--other=")) out.other = arg.slice("--other=".length);
  }
  return out;
}

function cleanCertId(value) {
  const certId = String(value ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!certId) throw new Error("cert id required");
  return certId;
}
