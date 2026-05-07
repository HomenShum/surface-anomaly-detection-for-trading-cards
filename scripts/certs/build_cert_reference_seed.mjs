#!/usr/bin/env node
// Materialize verified cert-reference candidates into imports.jsonl.
//
// This intentionally writes to imports.jsonl rather than replacing seed.json.
// Existing seed rows stay stable; vendor batches are append-only imports.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { certDataDir, loadAllRefs } from "./cert_reference_lib.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.input || !existsSync(resolve(args.input))) {
  console.error("Usage: node scripts/certs/build_cert_reference_seed.mjs --input data/cert-references/vendor-batches/<batch>.verified.json [--publish-examples]");
  process.exit(1);
}

const payload = JSON.parse(readFileSync(resolve(args.input), "utf-8"));
const existing = new Set(loadAllRefs().map((ref) => ref.id));
const refs = (payload.refs ?? []).filter((ref) => ref?.id && !existing.has(ref.id));
const importsPath = join(certDataDir(), "imports.jsonl");
if (refs.length > 0) {
  appendFileSync(
    importsPath,
    refs
      .map((ref) =>
        JSON.stringify({
          ...ref,
          publicExampleAllowed: args.publishExamples ? Boolean(ref.publicExampleAllowed) : false,
          importedAt: new Date().toISOString(),
        }),
      )
      .join("\n") + "\n",
    "utf-8",
  );
}
console.log(JSON.stringify({ ok: true, importsPath, appended: refs.length, skippedExisting: (payload.refs ?? []).length - refs.length }, null, 2));

function parseArgs(argv) {
  const out = { publishExamples: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" && argv[i + 1]) out.input = argv[++i];
    else if (arg.startsWith("--input=")) out.input = arg.slice("--input=".length);
    else if (arg === "--publish-examples") out.publishExamples = true;
  }
  return out;
}
